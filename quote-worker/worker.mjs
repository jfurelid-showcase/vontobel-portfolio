// worker.mjs
//
// A small always-on Node process, meant to run on Railway/Fly.io/a VPS/a
// Raspberry Pi — anywhere that can stay alive 24/7, which Vercel functions
// cannot. It:
//   1. Reads the ISINs currently in the open portfolio from Supabase.
//   2. Re-scrapes just those instruments' rows from the NGM list (reusing a
//      single persistent headless browser instead of relaunching one per
//      tick — that's what makes a ~5-10s loop realistic instead of hammering
//      NGM with a fresh full-browser session every time).
//   3. Writes current_price back onto each position, appends to price_ticks,
//      recomputes NAV and appends to nav_history.
//   4. Because portfolio_positions/price_ticks/nav_history are in the
//      Supabase Realtime publication, the website updates instantly with no
//      polling on its side — it just subscribes.
//
// REFRESH_INTERVAL_MS below controls the cadence. NGM's own market data
// typically doesn't tick faster than every few seconds anyway, and hammering
// their site harder than that risks being rate-limited/blocked — 10000 (10s)
// is a reasonable floor; the code supports going lower if you confirm NGM is
// fine with it.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node worker.mjs

import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REFRESH_INTERVAL_MS = Number(process.env.REFRESH_INTERVAL_MS || 10000);
const BASE_URL = "https://www.ngm.se/market/etp";
const ISIN_RE = /\b([A-Z]{2}[A-Z0-9]{9}\d)\b/;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars.");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function parseSvNumber(s) {
  if (s == null) return null;
  const n = parseFloat(String(s).replace(/\s/g, "").replace(",", ".").replace("%", ""));
  return Number.isFinite(n) ? n : null;
}

let browser;
let page;

async function ensureBrowser() {
  if (browser && browser.isConnected()) return;
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ locale: "sv-SE" });
}

// Looks up the last known NGM page number for each ISIN (populated daily by
// the full-list scraper into certificates_full.ngm_page) so the worker only
// has to load the specific pages that actually contain open positions,
// instead of walking the whole site every tick.
async function getPagesForIsins(isins) {
  const { data, error } = await supabase
    .from("certificates_full")
    .select("isin, ngm_page")
    .in("isin", isins);
  if (error) throw error;
  const pageOf = new Map(data.map((r) => [r.isin, r.ngm_page || 1]));
  const pages = new Set(Array.from(pageOf.values()));
  return { pageOf, pages: Array.from(pages) };
}

async function scrapeIsinsOnPage(pageNum, wantedIsins) {
  await page.goto(`${BASE_URL}?page=${pageNum}`, {
    waitUntil: "networkidle",
    timeout: 30000,
  });
  await page
    .waitForSelector("table, [role='table'], [role='row']", { timeout: 30000 })
    .catch(() => {});

  const rows = await page.$$eval(
    "table tbody tr, [role='row']:not(:first-child)",
    (trs) =>
      trs.map((tr) =>
        Array.from(tr.querySelectorAll("td, [role='cell'], [role='gridcell']")).map((td) =>
          td.textContent.trim()
        )
      )
  );

  const found = new Map();
  for (const cells of rows) {
    const isinCell = cells.find((c) => ISIN_RE.test(c));
    const m = isinCell && isinCell.match(ISIN_RE);
    if (!m || !wantedIsins.has(m[1])) continue;
    // "Senast" (last traded price) — same heuristic column-position fallback
    // as the full-list scraper. Adjust the index if your table's column
    // order differs; cross-check against certificates_full.last_price.
    const numericCells = cells.map(parseSvNumber).filter((n) => n !== null);
    const lastPrice = numericCells[numericCells.length - 3] ?? numericCells[0] ?? null;
    if (lastPrice !== null) found.set(m[1], lastPrice);
  }
  return found;
}

async function tick() {
  const { data: openPositions, error } = await supabase
    .from("portfolio_positions")
    .select("id, isin, entry_price, stake_sek")
    .eq("status", "open");
  if (error) throw error;

  if (!openPositions || openPositions.length === 0) {
    console.log("No open positions — nothing to refresh.");
    return;
  }

  await ensureBrowser();

  const isins = [...new Set(openPositions.map((p) => p.isin))];
  const { pageOf, pages } = await getPagesForIsins(isins);

  const priceByIsin = new Map();
  for (const pageNum of pages) {
    const wanted = new Set(isins.filter((i) => (pageOf.get(i) || 1) === pageNum));
    if (wanted.size === 0) continue;
    const found = await scrapeIsinsOnPage(pageNum, wanted);
    for (const [isin, price] of found) priceByIsin.set(isin, price);
  }

  const now = new Date().toISOString();
  let nav = 0;

  const { data: settings } = await supabase
    .from("portfolio_settings")
    .select("cash_sek")
    .single();
  nav += settings?.cash_sek || 0;

  for (const pos of openPositions) {
    const price = priceByIsin.get(pos.isin);
    if (price == null) {
      console.warn(`No fresh price found for ${pos.isin} this tick.`);
      continue;
    }
    nav += pos.stake_sek * (price / pos.entry_price);

    await supabase
      .from("portfolio_positions")
      .update({ current_price: price, current_updated_at: now })
      .eq("id", pos.id);

    await supabase.from("price_ticks").insert({
      position_id: pos.id,
      price,
      ts: now,
    });
  }

  // Include closed positions' realized value so NAV reflects the whole book,
  // not just what's currently open.
  const { data: closedPositions } = await supabase
    .from("portfolio_positions")
    .select("stake_sek, entry_price, exit_price")
    .eq("status", "closed");
  for (const pos of closedPositions || []) {
    if (pos.exit_price != null) {
      nav += pos.stake_sek * (pos.exit_price / pos.entry_price);
    }
  }

  await supabase.from("nav_history").insert({ ts: now, nav });
  console.log(`Tick ${now}: ${priceByIsin.size}/${isins.length} prices updated, NAV=${nav.toFixed(2)}`);
}

async function loop() {
  try {
    await tick();
  } catch (err) {
    console.error("Tick failed:", err);
    // If the browser/page died mid-navigation, force a fresh one next tick.
    try {
      await browser?.close();
    } catch {}
    browser = null;
  } finally {
    setTimeout(loop, REFRESH_INTERVAL_MS);
  }
}

console.log(`Starting quote worker, refreshing every ${REFRESH_INTERVAL_MS}ms.`);
loop();
