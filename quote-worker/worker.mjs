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

// One instrument's quote: bid (the price you can SELL at), ask (the price you
// BUY at) and the last traded price, each validated (see normalizeQuote).
// The same single request as before already carries all three.
async function fetchQuote(insref) {
  const response = await apiContext.get(INSTRUMENT_API(insref));
  if (!response.ok()) {
    throw new Error(`HTTP ${response.status()} fetching instrument ${insref}`);
  }
  return normalizeQuote(await response.json());
}

// Every portfolio's positions, in as few queries as possible. PostgREST caps a
// single response (1000 rows by default), and a silently truncated list would
// produce a wrong NAV, so page through by id until a short page comes back.
// For normal sizes that is exactly ONE query, i.e. one consistent snapshot.
// ---- Which price values the portfolio ------------------------------------------
// A position is valued at the BID (the default): the price you could actually sell it
//   at. NAV and open profit/loss follow it, so a position bought at the ask starts out a
//   little below zero, by the spread. Contracts that rarely trade still have a bid that
//   follows the market, so their value no longer freezes between trades.
// PRICE_BASIS=last switches back to the old way: the last traded price (falling back to
//   the bid/ask midpoint). Only the exact word "last" does that.
// Either way the bid, ask and last price are recorded on every tick.
const PRICE_BASIS = (process.env.PRICE_BASIS || "bid").toLowerCase() === "last" ? "last" : "bid";

function positive(v) {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

// Validate a raw instrument response. A price must be a positive number; a
// bid above the ask is a broken quote, so BOTH sides of it are discarded
// rather than trusting either one.
function normalizeQuote(json) {
  let bid = positive(json?.bidprice);
  let ask = positive(json?.askprice);
  const last = positive(json?.lastprice);
  if (bid != null && ask != null && bid > ask) {
    bid = null;
    ask = null;
  }
  return { bid, ask, last };
}

// The price this tick values a position at, or null if there is no usable one
// (then the position keeps its last known price and is never auto-closed).
// Unusually wide spread: when the underlying's own market has closed (e.g.
// Stockholm 17:30 for a Nordea certificate) Vontobel keeps quoting until 22:00 but
// widens the spread, and the bid drops although nothing really happened. Valuing
// at that bid made the daily chart fall sharply after 17:30 and then go flat.
// Above MAX_SPREAD_PCT the quote is treated as unusable, so the position keeps its
// last normal price (and is never auto-closed on such a quote).
const MAX_SPREAD_PCT = Number(process.env.MAX_SPREAD_PCT || 1.5);
function spreadPct(q) {
  return q && q.bid != null && q.ask != null && q.ask > 0 ? ((q.ask - q.bid) / q.ask) * 100 : null;
}

function valuationPrice(q, basis) {
  if (!q) return null;
  const sp = spreadPct(q);
  if (sp != null && sp > MAX_SPREAD_PCT) return null;
  if (basis === "bid") return q.bid;
  if (q.last != null) return q.last;
  if (q.bid != null && q.ask != null) return (q.bid + q.ask) / 2;
  return q.ask ?? q.bid ?? null;
}

// ---- Making sure a bid comes in every tick ----------------------------------------
// Occasionally NGM answers with no bid for a contract, or the request fails, for a
// moment. Ask once more, a split second later, before giving up on that contract for this
// tick (then it keeps its last known price). Without this, a thinly traded contract
// would be missing from one tick in a while for no good reason.
const RETRY_DELAY_MS = Number(process.env.QUOTE_RETRY_DELAY_MS ?? 500);

async function fetchQuoteReliably(insref) {
  let quote = null;
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      quote = await fetchQuote(insref);
      lastErr = null;
      if (valuationPrice(quote, PRICE_BASIS) != null) return quote;
    } catch (e) {
      lastErr = e;
    }
    if (attempt === 1 && RETRY_DELAY_MS > 0) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
  }
  if (!quote && lastErr) throw lastErr;
  return quote;
}

// How long to wait before the next tick so that ticks start every `interval` ms, not
// `interval` ms after the previous one FINISHED (which made them drift to 12-15 s).
const MIN_GAP_MS = 500;
function nextDelayMs(elapsedMs, interval) {
  return Math.max(MIN_GAP_MS, interval - elapsedMs);
}

// ---- Writing quotes (columns from 0004_bid_ask.sql) -----------------------------
// The new columns are added by SQL that is run by hand. If the database
// doesn't have them yet, write without them (everything else carries on) and
// look again every so often, so they switch on by themselves once the SQL ran.
const QUOTE_RETRY_EVERY_TICKS = 30;
let quoteColumnsOk = true;
let ticksSinceQuoteCheck = 0;

function markQuoteColumnsMissing() {
  if (quoteColumnsOk) {
    console.warn("Bid/ask are not being saved: the database has no bid/ask columns yet (run 0004_bid_ask.sql).");
  }
  quoteColumnsOk = false;
  ticksSinceQuoteCheck = 0;
}

// A position's bid and ask are only saved as a consistent PAIR: a new bid next
// to an old ask could cross it, which the database (rightly) refuses.
function positionQuoteExtras(q, now) {
  if (q && q.bid != null && q.ask != null) return { current_bid: q.bid, current_ask: q.ask, quote_updated_at: now };
  return {};
}
function tickQuoteExtras(q) {
  return q ? { bid: q.bid, ask: q.ask, last_price: q.last } : {};
}

async function updatePosition(id, base, extras, { onlyIfOpen = false } = {}) {
  const attempt = (values) => {
    let query = supabase.from("portfolio_positions").update(values).eq("id", id);
    if (onlyIfOpen) query = query.eq("status", "open").select("id");
    return query;
  };
  const withExtras = quoteColumnsOk && Object.keys(extras).length > 0;
  let res = await attempt(withExtras ? { ...base, ...extras } : base);
  if (withExtras && res.error && isMissingColumn(res.error)) {
    markQuoteColumnsMissing();
    res = await attempt(base);
  }
  return res;
}

async function insertTick(base, extras) {
  const withExtras = quoteColumnsOk && Object.keys(extras).length > 0;
  let res = await supabase.from("price_ticks").insert(withExtras ? { ...base, ...extras } : base);
  if (withExtras && res.error && isMissingColumn(res.error)) {
    markQuoteColumnsMissing();
    res = await supabase.from("price_ticks").insert(base);
  }
  return res;
}

// One line per problem instrument at most every 5 minutes, not every tick.
const lastWarned = new Map();
function warnThrottled(key, message) {
  const t = Date.now();
  if (t - (lastWarned.get(key) ?? 0) < 5 * 60 * 1000) return;
  lastWarned.set(key, t);
  console.warn(message);
}

const POSITION_PAGE = 1000;

// The automatic stop loss / target columns come from 0003_auto_close.sql, which
// is run by hand. If the database doesn't have them yet, fall back to the
// plain columns (NAV keeps working, auto-close is simply off) and look again
// every so often, so it switches on by itself once the SQL has been run.
const BASE_COLUMNS = "id, portfolio_id, isin, status, entry_price, stake_sek, current_price, exit_price";
const AUTO_COLUMNS = `${BASE_COLUMNS}, name, stop_loss, target_price, auto_stop, auto_target`;
const AUTO_RETRY_EVERY_TICKS = 30;
let autoColumnsOk = true;
let ticksSinceAutoCheck = 0;

function isMissingColumn(err) {
  return !!err && (err.code === "42703" || err.code === "PGRST204" || /does not exist|schema cache/i.test(err.message || ""));
}

async function fetchAllPositions() {
  if (!autoColumnsOk && ++ticksSinceAutoCheck >= AUTO_RETRY_EVERY_TICKS) {
    autoColumnsOk = true; // try the full column list again
    ticksSinceAutoCheck = 0;
  }
  const all = [];
  let cursor = null;
  for (let page = 0; page < 500; page++) {
    let q = supabase
      .from("portfolio_positions")
      .select(autoColumnsOk ? AUTO_COLUMNS : BASE_COLUMNS)
      .order("id", { ascending: true })
      .limit(POSITION_PAGE);
    if (cursor) q = q.gt("id", cursor);
    const { data, error } = await q;
    if (error) {
      if (autoColumnsOk && isMissingColumn(error)) {
        console.warn("Automatic stop loss / target is off: the database has no auto_stop/auto_target columns yet (run 0003_auto_close.sql).");
        autoColumnsOk = false;
        ticksSinceAutoCheck = 0;
        return fetchAllPositions();
      }
      throw error;
    }
    const rows = data || [];
    all.push(...rows);
    if (rows.length < POSITION_PAGE) break;
    cursor = rows[rows.length - 1].id;
  }
  return all;
}

// ---- Automatic stop loss / take profit --------------------------------------
// A position that has asked to be closed automatically is closed when the fresh
// price reaches its stop loss (price <= stop) or target (price >= target).
//
// A single wrong price could otherwise close a position for good — this feed
// has produced one-off bad prices before — so the level must be reached on
// CONFIRM_TICKS fresh prices in a row (about 12 seconds apart) before the
// position closes. A tick with no fresh price neither counts nor resets.
const CONFIRM_TICKS = 2;
const breachCount = new Map(); // positionId -> { reason, n }

function autoTrigger(pos, price) {
  if (pos.auto_stop && pos.stop_loss != null && price <= pos.stop_loss) return "stop_loss";
  if (pos.auto_target && pos.target_price != null && price >= pos.target_price) return "take_profit";
  return null;
}

// Decide which of this tick's open positions to close. Pure bookkeeping on
// breachCount; the caller does the database write.
function positionsToAutoClose(openPositions, priceByIsin) {
  const due = [];
  const seen = new Set();
  for (const pos of openPositions) {
    seen.add(pos.id);
    if (!pos.auto_stop && !pos.auto_target) {
      breachCount.delete(pos.id);
      continue;
    }
    const price = priceByIsin.get(pos.isin);
    if (price == null) continue; // no fresh price this tick: leave the count as it is
    const reason = autoTrigger(pos, price);
    if (!reason) {
      breachCount.delete(pos.id);
      continue;
    }
    const prev = breachCount.get(pos.id);
    const n = prev && prev.reason === reason ? prev.n + 1 : 1;
    breachCount.set(pos.id, { reason, n });
    if (n >= CONFIRM_TICKS) due.push({ pos, reason, price });
  }
  for (const id of [...breachCount.keys()]) if (!seen.has(id)) breachCount.delete(id); // closed/deleted meanwhile
  return due;
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
  const priceByIsin = new Map(); // instrument -> the price positions are valued at this tick
  const quoteByIsin = new Map(); // instrument -> its validated bid / ask / last
  if (!quoteColumnsOk && ++ticksSinceQuoteCheck >= QUOTE_RETRY_EVERY_TICKS) {
    quoteColumnsOk = true; // try writing the bid/ask columns again
    ticksSinceQuoteCheck = 0;
  }

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
          const quote = await fetchQuoteReliably(insref);
          quoteByIsin.set(isin, quote);
          const price = valuationPrice(quote, PRICE_BASIS);
          if (price != null) priceByIsin.set(isin, price);
          else if ((spreadPct(quote) ?? 0) > MAX_SPREAD_PCT) warnThrottled(`spread:${isin}`, `Wide spread ${spreadPct(quote).toFixed(2)} % for ${isin} (over ${MAX_SPREAD_PCT} %, underlying market likely closed) — keeping its last normal price.`);
          else warnThrottled(`noprice:${isin}`, `No usable ${PRICE_BASIS === "bid" ? "bid" : "price"} for ${isin} (insref ${insref}) — keeping its last known price.`);
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

  const autoDue = new Map(positionsToAutoClose(openPositions, priceByIsin).map((d) => [d.pos.id, d]));

  for (const pos of openPositions) {
    if (!plById.has(pos.portfolio_id)) plById.set(pos.portfolio_id, 0);
    const price = priceByIsin.get(pos.isin) ?? pos.current_price; // fall back to last known price if this tick's fetch failed
    if (price != null) {
      addPl(pos.portfolio_id, pos.stake_sek * ((price - pos.entry_price) / pos.entry_price));
    }

    const freshPrice = priceByIsin.get(pos.isin);
    if (freshPrice == null) continue; // nothing new to write for this position this tick

    const quote = quoteByIsin.get(pos.isin);
    const posExtras = positionQuoteExtras(quote, now);
    const tickExtras = tickQuoteExtras(quote);

    const due = autoDue.get(pos.id);
    if (due) {
      // Close it, but only if it is still open: if you closed it by hand a
      // moment ago, leave that close alone. Its profit is counted once above,
      // at this same price, so the NAV written below is the same either way.
      const { data: closed, error: closeErr } = await updatePosition(
        pos.id,
        {
          status: "closed",
          exit_price: freshPrice,
          exit_time: now,
          current_price: freshPrice,
          current_updated_at: now,
          close_reason: due.reason,
        },
        posExtras,
        { onlyIfOpen: true }
      );
      if (closeErr) {
        console.warn(`Auto-close of ${pos.name ?? pos.id} failed: ${closeErr.message}`);
      } else if (closed && closed.length > 0) {
        breachCount.delete(pos.id);
        console.log(
          `AUTO-CLOSE ${due.reason === "stop_loss" ? "stop loss" : "target"}: ${pos.name ?? pos.id} (portfolio ${pos.portfolio_id}) closed at ${freshPrice}`
        );
      } else {
        breachCount.delete(pos.id); // already closed by someone else
      }
      await insertTick({ position_id: pos.id, price: freshPrice, ts: now }, tickExtras);
      continue;
    }

    await updatePosition(pos.id, { current_price: freshPrice, current_updated_at: now }, posExtras);
    await insertTick({ position_id: pos.id, price: freshPrice, ts: now }, tickExtras);
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
    `Tick ${now} [${PRICE_BASIS}]: ${priceByIsin.size}/${new Set(openPositions.map((p) => p.isin)).size} prices updated (${openPositions.length} open positions), ${navRows.length} portfolios NAV: ${summary || "none"}`
  );
}

// ---------------------------------------------------------------------------
// Ticker for the Skin in the Game website: today's most traded Vontobel ETPs.
//
// One call per tick to NGM's list endpoint (the same one the daily full-list
// scraper uses), sorted by turnover, gives both the ranking and the prices.
// Early in the day almost nothing has traded, so until at least
// TICKER_MIN_TRADED products have turnover today, the ticker shows the
// previous day's ranking from certificates_full, with live prices fetched
// per instrument. Rows go into ticker_quotes (see 0004_ticker_quotes.sql),
// which the website reads and subscribes to via Realtime.
// ---------------------------------------------------------------------------
const LIST_API = "https://ngm-api-prod.vmate.se/instrument/list";
const TICKER_SIZE = Number(process.env.TICKER_SIZE || 10);
const TICKER_MIN_TRADED = Number(process.env.TICKER_MIN_TRADED || 5);
let lastTickerSnapshot = "";
let lastTickerLog = 0;

function priceOf(item) {
  if (item.lastprice != null) return item.lastprice;
  if (item.bidprice != null && item.askprice != null) return (item.bidprice + item.askprice) / 2;
  return item.askprice ?? item.bidprice ?? null;
}

async function fetchTopByTurnover(size) {
  const response = await apiContext.post(LIST_API, {
    headers: { "Content-Type": "application/json" },
    data: {
      page: 0,
      size,
      market: "etp",
      instrumentType: "ALL",
      issuers: "VON",
      sortField: "turnover",
      sortDirection: "desc",
    },
  });
  if (!response.ok()) throw new Error(`HTTP ${response.status()} from instrument/list`);
  const json = await response.json();
  return json.data || [];
}

function tickerRowFromItem(item, rank) {
  return {
    rank,
    isin: item.isin,
    insref: item.insref ?? null,
    name: item.name || item.symbol || item.isin,
    underlying: item.subsubclass ?? null,
    direction: item.funddirection ?? null,
    // NGM stores leverage with two implicit decimals (300 = 3.00x).
    leverage: item.fundleverage != null ? item.fundleverage / 100 : null,
    last_price: priceOf(item),
    daily_change_pct: item.dailyPerformance ?? null,
    turnover: item.turnover ?? null,
    source: "today",
  };
}

async function previousDayTickerRows() {
  const { data, error } = await supabase
    .from("certificates_full")
    .select("isin, insref, name, underlying, direction, leverage, last_price, turnover")
    .gt("turnover", 0)
    .order("turnover", { ascending: false })
    .limit(TICKER_SIZE);
  if (error) throw new Error(`certificates_full: ${error.message}`);

  return Promise.all(
    (data || []).map(async (c, i) => {
      let price = null;
      let change = null;
      if (c.insref != null) {
        try {
          const r = await apiContext.get(INSTRUMENT_API(c.insref));
          if (r.ok()) {
            const j = await r.json();
            price = priceOf(j);
            change = j.dailyPerformance ?? null;
          }
        } catch {}
      }
      // If NGM doesn't report a daily change for the instrument, compare
      // against the price captured by the last daily scrape.
      if (change == null && price != null && c.last_price) {
        change = ((price - Number(c.last_price)) / Number(c.last_price)) * 100;
      }
      return {
        rank: i + 1,
        isin: c.isin,
        insref: c.insref,
        name: c.name,
        underlying: c.underlying,
        direction: c.direction,
        leverage: c.leverage,
        last_price: price ?? c.last_price,
        daily_change_pct: change,
        turnover: c.turnover,
        source: "previous",
      };
    })
  );
}

async function tickerTick() {
  await ensureBrowser();
  const items = await fetchTopByTurnover(TICKER_SIZE);
  const tradedToday = items.filter((it) => (it.turnover ?? 0) > 0);

  const rows =
    tradedToday.length >= TICKER_MIN_TRADED
      ? tradedToday.slice(0, TICKER_SIZE).map((it, i) => tickerRowFromItem(it, i + 1))
      : await previousDayTickerRows();
  if (rows.length === 0) return; // keep whatever the table already shows

  // Skip the write (and the Realtime event to every visitor) when nothing moved.
  const snapshot = JSON.stringify(rows);
  if (snapshot === lastTickerSnapshot) return;
  lastTickerSnapshot = snapshot;

  const updated_at = new Date().toISOString();
  const { error } = await supabase
    .from("ticker_quotes")
    .upsert(rows.map((r) => ({ ...r, updated_at })), { onConflict: "rank" });
  if (error) throw new Error(`ticker_quotes upsert: ${error.message}`);
  await supabase.from("ticker_quotes").delete().gt("rank", rows.length);

  // Once a minute, log the leader's turnover — watching it grow through the
  // day confirms the list endpoint reports intraday turnover.
  if (Date.now() - lastTickerLog > 60000) {
    lastTickerLog = Date.now();
    console.log(
      `Ticker: ${rows.length} rows (${rows[0].source}), #1 ${rows[0].name} turnover=${rows[0].turnover} price=${rows[0].last_price}`
    );
  }
}

// ---------------------------------------------------------------------------
// Produkt i motsatt riktning, matchad på Vontobels hävstång.
//
// NGM:s produktlista saknar hävstång för mini futures och turbos, så den
// hämtas från Vontobels produktsida ("Hävstång" under Nyckeltal) — samma siffra
// som visas på markets.vontobel.com. För varje ny position utan vald produkt:
//   1. Kandidater: samma underliggande, samma produkttyp, motsatt riktning
//      (MFS<->MFL, BEAR<->BULL, TLNG<->TSRT/TSHO) ur certificates_full.
//   2. Förurval på kurs (de 40 närmast positionens certifikat), så att bara
//      ett fåtal produktsidor behöver hämtas.
//   3. Hävstång för positionens certifikat och kandidaterna hämtas från
//      Vontobel; den med närmast hävstång väljs.
// Går det inte att läsa hävstång används databasens reservregel
// (sitg_find_opposite). Körs högst var femte minut.
// ---------------------------------------------------------------------------
const OPP_EVERY_MS = 5 * 60 * 1000;
const OPP_PREFILTER = 40;
const leverageCache = new Map(); // isin -> { value, at }
let lastOppRun = 0;

const OPP_PREFIXES = {
  MFS: ["MFL"], MFL: ["MFS"], BEAR: ["BULL"], BULL: ["BEAR"],
  TLNG: ["TSRT", "TSHO"], TSRT: ["TLNG"], TSHO: ["TLNG"],
};
const prefixOf = (name) => String(name || "").trim().split(/\s+/)[0].toUpperCase();

function vontobelProductUrl(name, isin) {
  const pre = prefixOf(name);
  const type = pre === "BULL" || pre === "BEAR" ? "bull-bear-certifikat"
    : pre === "MFL" || pre === "MFS" ? "mini-futures"
    : "knock-out-warrants-open-end";
  return `https://markets.vontobel.com/sv-se/produkter/leverage/${type}/${encodeURIComponent(isin)}`;
}

async function vontobelLeverage(name, isin) {
  const hit = leverageCache.get(isin);
  if (hit && Date.now() - hit.at < 15 * 60 * 1000) return hit.value;
  let value = null;
  try {
    const res = await apiContext.get(vontobelProductUrl(name, isin), { timeout: 20000 });
    if (res.ok()) {
      const text = (await res.text()).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
      // "Hävstång 2,49" (tabellen) eller "Hävstång: 2,49" (rubriken)
      const m = text.match(/Hävstång:?\s+(\d{1,3}(?:[ .]\d{3})*(?:,\d+)?|\d+(?:[.,]\d+)?)/);
      if (m) value = Number(m[1].replace(/[ .](?=\d{3}\b)/g, "").replace(",", "."));
      if (!isFinite(value) || value <= 0) value = null;
    }
  } catch {}
  leverageCache.set(isin, { value, at: Date.now() });
  return value;
}

async function fillOppositeProducts() {
  if (Date.now() - lastOppRun < OPP_EVERY_MS) return;
  lastOppRun = Date.now();
  const { data: positions, error } = await supabase
    .from("portfolio_positions")
    .select("id, isin, name, underlying, leverage, note, opposite_source")
    .eq("status", "open")
    // Nya positioner har ett preliminärt val från databasen (0010); de förfinas
    // här på Vontobels hävstång. Klara positioner har opposite_source 'leverage'.
    .or("opposite_source.is.null,opposite_source.eq.preliminary")
    .limit(5);
  if (error) { console.warn("Motsatt riktning:", error.message); return; }
  if (!positions?.length) return;

  await ensureBrowser();
  for (const pos of positions) {
    try {
      const opp = OPP_PREFIXES[prefixOf(pos.name)];
      if (!opp) {
        // Ingen motsvarighet (t.ex. tracker): markera så att den inte prövas igen.
        await supabase.from("portfolio_positions").update({ opposite_source: "none" }).eq("id", pos.id);
        continue;
      }
      const { data: self } = await supabase
        .from("certificates_full").select("underlying, last_price, buy_price, sell_price").eq("isin", pos.isin).maybeSingle();
      const und = self?.underlying ?? pos.underlying;
      const px = (r) => Number(r?.last_price ?? (r?.buy_price != null && r?.sell_price != null ? (r.buy_price + r.sell_price) / 2 : r?.sell_price ?? r?.buy_price)) || null;
      const selfPx = px(self);

      let q = supabase.from("certificates_full").select("isin, name, underlying, last_price, buy_price, sell_price, turnover").neq("isin", pos.isin);
      q = und ? q.ilike("underlying", und) : q.ilike("name", `% ${String(pos.name).split(/\s+/)[1] || ""} %`);
      const { data: all } = await q.limit(1000);
      const cands = (all || []).filter((c) => opp.includes(prefixOf(c.name)));
      if (!cands.length) {
        await supabase.from("portfolio_positions").update({ opposite_source: "none" }).eq("id", pos.id);
        continue;
      }

      // Förurval på kurs, sedan riktig hävstång från Vontobel.
      const ranked = cands
        .map((c) => ({ c, d: selfPx && px(c) ? Math.abs(Math.log(px(c) / selfPx)) : Infinity }))
        .sort((a, b) => a.d - b.d || (b.c.turnover ?? 0) - (a.c.turnover ?? 0))
        .slice(0, OPP_PREFILTER)
        .map((x) => x.c);
      const selfLev = (await vontobelLeverage(pos.name, pos.isin)) ?? (pos.leverage ? Number(pos.leverage) : null);
      let best = null;
      if (selfLev) {
        for (const c of ranked) {
          const lev = await vontobelLeverage(c.name, c.isin);
          if (lev == null) continue;
          const d = Math.abs(lev - selfLev);
          if (!best || d < best.d) best = { c, d, lev };
        }
      }
      let chosen = best?.c;
      if (!chosen) {
        // Reserv: databasens regel (närmast kurs / hävstång i produktlistan).
        const { data: fb } = await supabase.rpc("sitg_find_opposite", { p_name: pos.name, p_underlying: pos.underlying, p_leverage: pos.leverage, p_isin: pos.isin });
        chosen = fb?.[0];
      }
      if (chosen) {
        // Produkten skrivs också in i kommentaren, så att den syns i portföljverktyget
        // (admin och listor). Webbplatsen visar den ändå bara en gång.
        const fmtLev = (v) => Number(v).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const levTxt = best && selfLev
          ? ` (hävstång ${fmtLev(best.lev)} · positionens hävstång ${fmtLev(selfLev)})`
          : "";
        const line = `Produkt i motsatt riktning: ${chosen.name}${levTxt}`;
        const old = pos.note || "";
        // Byt ut en befintlig rad (t.ex. det preliminära valet) eller lägg till en ny.
        const note = /motsatt riktning:[^\n\r]*/i.test(old)
          ? old.replace(/(produkt i )?motsatt riktning:\s*[^\n\r]*/i, line)
          : (old.trim() ? `${old.trimEnd()}\n\n${line}` : line);
        await supabase.from("portfolio_positions").update({
          opposite_isin: chosen.isin, opposite_name: chosen.name, note,
          opposite_source: best ? "leverage" : "fallback",
          opposite_leverage: best ? best.lev : null,
          own_leverage: selfLev ?? null,
        }).eq("id", pos.id);
        console.log(`Motsatt riktning: ${pos.name} (hävstång ${selfLev ?? "?"}) -> ${chosen.name}${best ? ` (hävstång ${best.lev})` : " (reservregel)"}`);
      }
    } catch (err) {
      console.warn(`Motsatt riktning för ${pos.name}:`, err?.message ?? err);
    }
  }
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
  const startedAt = Date.now();
  try {
    await tick();
    // Separate from the NAV tick: a ticker problem must never stop the
    // portfolios from updating, and vice versa.
    try {
      await tickerTick();
    } catch (err) {
      console.warn("Ticker update failed:", err?.message ?? err);
    }
    try {
      await fillOppositeProducts();
    } catch (err) {
      console.warn("Opposite products failed:", err?.message ?? err);
    }
  } catch (err) {
    console.error("Tick failed:", err);
    try {
      await browser?.close();
    } catch {}
    browser = null;
    apiContext = null;
  } finally {
    setTimeout(loop, nextDelayMs(Date.now() - startedAt, REFRESH_INTERVAL_MS));
  }
}

console.log(`Starting quote worker, refreshing every ${REFRESH_INTERVAL_MS}ms during trading hours (${ALWAYS_ON ? "ALWAYS_ON" : HOURS_LABEL}).`);
console.log(
  PRICE_BASIS === "bid"
    ? "Price basis: BID — NAV and open P/L are valued at the price positions could be sold at."
    : "Price basis: LAST (PRICE_BASIS=last) — positions are valued at the last traded price. Remove PRICE_BASIS to value at the bid."
);
loop();
