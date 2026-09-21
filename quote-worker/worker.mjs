// worker.mjs
//
// Always-on Node process (deploy to Railway/Fly.io/any host that stays
// alive 24/7 — Vercel functions cannot). Every REFRESH_INTERVAL_MS it:
//   1. Reads the ISINs of currently open portfolio positions from Supabase.
//   2. Looks up each one's NGM internal id (insref) from certificates_full.
//   3. Calls NGM's own per-instrument API directly for a fresh price —
//      the same backend endpoint discovered while building the full-list
//      scraper (see scraper-full-list/inspect-api.mjs and its README notes).
//      This is a lightweight JSON GET per position, not a page render, so
//      polling every ~10s for a normal-sized portfolio is cheap.
//   4. Writes current_price back onto each position, appends to
//      price_ticks, recomputes NAV, and appends to nav_history.
//
// Because portfolio_positions/price_ticks/nav_history are in the Supabase
// Realtime publication (see supabase/migrations/0001_init.sql), the
// dashboard updates instantly with no polling on its side.
//
// A single headless browser is launched once at startup (not per tick) —
// purely to establish whatever cookies/session NGM's API expects, mirroring
// what worked for the full-list scraper. All the actual per-tick work after
// that is plain JSON HTTP calls through that same browser context.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node worker.mjs

import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REFRESH_INTERVAL_MS = Number(process.env.REFRESH_INTERVAL_MS || 10000);
const SITE_URL = "https://www.ngm.se/market/etp?issuers=vontobel&page=1";
const INSTRUMENT_API = (insref) => `https://ngm-api-prod.vmate.se/instrument/${insref}`;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars.");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  realtime: { transport: ws },
});

let browser;
let apiContext;

async function ensureBrowser() {
  if (browser && browser.isConnected() && apiContext) return;
  try {
    await browser?.close();
  } catch {}
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ locale: "sv-SE" });
  // One real page load to pick up any cookies the API expects — see the
  // full-list scraper for the same pattern and why it's there.
  await page.goto(SITE_URL, { waitUntil: "networkidle", timeout: 30000 });
  apiContext = page.context().request;
}

async function fetchLivePrice(insref) {
  const response = await apiContext.get(INSTRUMENT_API(insref));
  if (!response.ok()) {
    throw new Error(`HTTP ${response.status()} fetching instrument ${insref}`);
  }
  const json = await response.json();
  // Prefer the last traded price; fall back to a bid/ask midpoint if the
  // instrument hasn't traded recently (common for these — many rows in
  // certificates_full show null lastprice too).
  if (json.lastprice != null) return json.lastprice;
  if (json.bidprice != null && json.askprice != null) return (json.bidprice + json.askprice) / 2;
  if (json.askprice != null) return json.askprice;
  if (json.bidprice != null) return json.bidprice;
  return null;
}

async function tick() {
  const { data: openPositions, error } = await supabase
    .from("portfolio_positions")
    .select("id, isin, entry_price, stake_sek, current_price")
    .eq("status", "open");
  if (error) throw error;

  if (!openPositions || openPositions.length === 0) {
    console.log("No open positions — nothing to refresh.");
    return;
  }

  await ensureBrowser();

  const isins = [...new Set(openPositions.map((p) => p.isin))];
  const { data: certs, error: certErr } = await supabase
    .from("certificates_full")
    .select("isin, insref")
    .in("isin", isins);
  if (certErr) throw certErr;
  const insrefByIsin = new Map(certs.map((c) => [c.isin, c.insref]));

  const now = new Date().toISOString();
  const priceByIsin = new Map();

  await Promise.all(
    isins.map(async (isin) => {
      const insref = insrefByIsin.get(isin);
      if (!insref) {
        console.warn(`No insref found in certificates_full for ${isin} — skipping this tick.`);
        return;
      }
      try {
        const price = await fetchLivePrice(insref);
        if (price != null) priceByIsin.set(isin, price);
      } catch (e) {
        console.warn(`Price fetch failed for ${isin} (insref ${insref}): ${e.message}`);
      }
    })
  );

  // NAV is now pinned to a fixed capital base (portfolio_settings.cash_sek,
  // e.g. 100000 SEK = NAV 100) instead of a weighted-return index. This way
  // NAV moves in direct proportion to real SEK profit/loss against that
  // base:  NAV = 100 + 100 * (total P/L in SEK) / base_capital.
  const { data: settings } = await supabase.from("portfolio_settings").select("cash_sek").single();
  const baseCapital = settings?.cash_sek || 100000;

  let totalPl = 0;

  for (const pos of openPositions) {
    const price = priceByIsin.get(pos.isin) ?? pos.current_price; // fall back to last known price if this tick's fetch failed
    if (price != null) {
      totalPl += pos.stake_sek * ((price - pos.entry_price) / pos.entry_price);
    }

    const freshPrice = priceByIsin.get(pos.isin);
    if (freshPrice == null) continue; // nothing new to write for this position this tick

    await supabase
      .from("portfolio_positions")
      .update({ current_price: freshPrice, current_updated_at: now })
      .eq("id", pos.id);

    await supabase.from("price_ticks").insert({ position_id: pos.id, price: freshPrice, ts: now });
  }

  const { data: closedPositions } = await supabase
    .from("portfolio_positions")
    .select("stake_sek, entry_price, exit_price")
    .eq("status", "closed");
  for (const pos of closedPositions || []) {
    if (pos.exit_price != null) {
      totalPl += pos.stake_sek * ((pos.exit_price - pos.entry_price) / pos.entry_price);
    }
  }

  const nav = 100 + (100 * totalPl) / baseCapital;

  await supabase.from("nav_history").insert({ ts: now, nav });
  console.log(`Tick ${now}: ${priceByIsin.size}/${isins.length} prices updated, P/L=${totalPl.toFixed(0)} SEK, NAV=${nav.toFixed(2)}`);
}

async function loop() {
  try {
    await tick();
  } catch (err) {
    console.error("Tick failed:", err);
    try {
      await browser?.close();
    } catch {}
    browser = null;
    apiContext = null;
  } finally {
    setTimeout(loop, REFRESH_INTERVAL_MS);
  }
}

console.log(`Starting quote worker, refreshing every ${REFRESH_INTERVAL_MS}ms.`);
loop();
