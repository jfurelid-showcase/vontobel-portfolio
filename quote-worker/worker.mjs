// worker.mjs
//
// Always-on Node process (deploy to Railway/Fly.io/any host that stays
// alive 24/7 — Vercel functions cannot). Every REFRESH_INTERVAL_MS it:
//   1. Reads every portfolio's positions from Supabase (the owner's and each
//      guest's) and collects the distinct ISINs of all open positions.
//   2. Looks up each one's NGM internal id (insref) from certificates_full.
//   3. Calls NGM's own per-instrument API directly for a fresh price —
//      the same backend endpoint discovered while building the full-list
//      scraper (see scraper-full-list/inspect-api.mjs and its README notes).
//      This is a lightweight JSON GET per position, not a page render, so
//      polling every ~10s for a normal-sized portfolio is cheap.
//   4. Writes current_price back onto each position, appends to
//      price_ticks, recomputes each portfolio's own NAV and appends one
//      nav_history row per portfolio.
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

// Only fetch during trading hours: Mon–Fri 08:00–22:15 (Europe/Stockholm, DST
// handled automatically). Outside that window the worker idles — no price
// fetches, no nav_history rows — and closes its browser to save memory.
// Change the two numbers below to adjust the window. Set ALWAYS_ON=true to
// bypass the schedule entirely (handy for testing).
const MARKET_OPEN_MIN = 8 * 60; // 08:00
const MARKET_CLOSE_MIN = 22 * 60; // 22:00 (the 22:00 minute still ticks, giving a closing NAV)
const CLOSED_CHECK_MS = 30000;
const ALWAYS_ON = process.env.ALWAYS_ON === "true";
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const HOURS_LABEL = `Mon–Fri ${hhmm(MARKET_OPEN_MIN)}–${hhmm(MARKET_CLOSE_MIN)} Stockholm time`;

function isMarketOpen(d = new Date()) {
  if (ALWAYS_ON) return true;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Stockholm",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t).value;
  const weekday = get("weekday"); // Mon, Tue, ...
  if (weekday === "Sat" || weekday === "Sun") return false;
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  return minutes >= MARKET_OPEN_MIN && minutes <= MARKET_CLOSE_MIN;
}
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

// Every portfolio's positions, in as few queries as possible. PostgREST caps a
// single response (1000 rows by default), and a silently truncated list would
// produce a wrong NAV, so page through by id until a short page comes back.
// For normal sizes that is exactly ONE query, i.e. one consistent snapshot.
const POSITION_PAGE = 1000;
async function fetchAllPositions() {
  const all = [];
  let cursor = null;
  for (let page = 0; page < 500; page++) {
    let q = supabase
      .from("portfolio_positions")
      .select("id, portfolio_id, isin, status, entry_price, stake_sek, current_price, exit_price")
      .order("id", { ascending: true })
      .limit(POSITION_PAGE);
    if (cursor) q = q.gt("id", cursor);
    const { data, error } = await q;
    if (error) throw error;
    const rows = data || [];
    all.push(...rows);
    if (rows.length < POSITION_PAGE) break;
    cursor = rows[rows.length - 1].id;
  }
  return all;
}

async function tick() {
  // Fetch EVERY portfolio's positions (status and prices) in one go, so there
  // is one consistent snapshot in time. Splitting this into separate queries
  // for open and closed positions, with several seconds of price-fetching in
  // between, once let a position that was closed mid-tick be counted twice
  // (as open AND as closed), producing a brief NAV spike. Reading each row's
  // status once makes that impossible.
  const allPositions = await fetchAllPositions();
  const openPositions = allPositions.filter((p) => p.status === "open");
  const closedPositions = allPositions.filter((p) => p.status === "closed");

  const now = new Date().toISOString();
  const priceByIsin = new Map();

  if (openPositions.length === 0) {
    // No open positions to fetch live prices for, but we still record a NAV
    // point below from closed trades. Without this, closing the last open
    // position of a portfolio would silently stop updating its NAV.
    console.log("No open positions — recording NAV from closed trades only.");
  } else {
    await ensureBrowser();

    // Prices are fetched once per instrument, however many portfolios hold it.
    const isins = [...new Set(openPositions.map((p) => p.isin))];
    const { data: certs, error: certErr } = await supabase
      .from("certificates_full")
      .select("isin, insref")
      .in("isin", isins);
    if (certErr) throw certErr;
    const insrefByIsin = new Map(certs.map((c) => [c.isin, c.insref]));

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
  }

  // Each portfolio has its own capital base:
  //   NAV = 100 + 100 * (total P/L in SEK) / base_capital
  const { data: settingsRows } = await supabase.from("portfolio_settings").select("id, cash_sek");
  const capitalById = new Map((settingsRows || []).map((s) => [s.id, Number(s.cash_sek) || 100000]));

  const plById = new Map(); // portfolio id -> total P/L in SEK
  const addPl = (portfolioId, amount) => plById.set(portfolioId, (plById.get(portfolioId) ?? 0) + amount);

  for (const pos of openPositions) {
    if (!plById.has(pos.portfolio_id)) plById.set(pos.portfolio_id, 0);
    const price = priceByIsin.get(pos.isin) ?? pos.current_price; // fall back to last known price if this tick's fetch failed
    if (price != null) {
      addPl(pos.portfolio_id, pos.stake_sek * ((price - pos.entry_price) / pos.entry_price));
    }

    const freshPrice = priceByIsin.get(pos.isin);
    if (freshPrice == null) continue; // nothing new to write for this position this tick

    await supabase
      .from("portfolio_positions")
      .update({ current_price: freshPrice, current_updated_at: now })
      .eq("id", pos.id);

    await supabase.from("price_ticks").insert({ position_id: pos.id, price: freshPrice, ts: now });
  }

  for (const pos of closedPositions) {
    if (!plById.has(pos.portfolio_id)) plById.set(pos.portfolio_id, 0);
    if (pos.exit_price != null) {
      addPl(pos.portfolio_id, pos.stake_sek * ((pos.exit_price - pos.entry_price) / pos.entry_price));
    }
  }

  // One NAV point per portfolio that has (or had) positions. A portfolio with
  // none can't have changed, so it gets no rows. Inserted separately so that a
  // portfolio deleted a moment ago can't stop the others from being recorded.
  const navRows = [...plById.entries()].map(([portfolioId, pl]) => {
    const capital = capitalById.get(portfolioId) ?? 100000;
    return { ts: now, nav: 100 + (100 * pl) / capital, portfolio_id: portfolioId };
  });
  const results = await Promise.allSettled(
    navRows.map(async (row) => {
      const { error } = await supabase.from("nav_history").insert(row);
      if (error) throw new Error(`portfolio ${row.portfolio_id}: ${error.message}`);
    })
  );
  for (const r of results) if (r.status === "rejected") console.warn("NAV insert failed:", r.reason?.message ?? r.reason);

  const summary = navRows.map((r) => `#${r.portfolio_id}=${r.nav.toFixed(2)}`).join(" ");
  console.log(
    `Tick ${now}: ${priceByIsin.size}/${new Set(openPositions.map((p) => p.isin)).size} prices updated (${openPositions.length} open positions), ${navRows.length} portfolios NAV: ${summary || "none"}`
  );
}

let marketWasOpen = null;

async function loop() {
  if (!isMarketOpen()) {
    if (marketWasOpen !== false) {
      console.log(`Outside trading hours (${HOURS_LABEL}) — idling.`);
      marketWasOpen = false;
      try {
        await browser?.close();
      } catch {}
      browser = null;
      apiContext = null;
    }
    setTimeout(loop, CLOSED_CHECK_MS);
    return;
  }
  if (marketWasOpen !== true) {
    console.log("Trading hours — starting price refresh.");
    marketWasOpen = true;
  }
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

console.log(`Starting quote worker, refreshing every ${REFRESH_INTERVAL_MS}ms during trading hours (${ALWAYS_ON ? "ALWAYS_ON" : HOURS_LABEL}).`);
loop();
