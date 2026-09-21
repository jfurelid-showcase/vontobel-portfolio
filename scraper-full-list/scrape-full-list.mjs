// scrape-full-list.mjs
//
// Pulls the full Vontobel ETP offer directly from NGM's backend API
// (discovered via network inspection — see inspect-api.mjs) and upserts it
// into Supabase `certificates_full`. Meant to run once/day at 17:30 CET
// (see ../.github/workflows/full-list.yml).
//
// This replaced an earlier version that scraped the rendered HTML table
// and then visited a detail page per instrument for its ISIN — that
// approach doesn't scale to ~25,000 Vontobel instruments (would take many
// hours and hammer NGM's site with one page load per instrument). The API
// below returns everything, including the ISIN, in a handful of calls.
//
// A real browser is still used for exactly one page load, purely to pick
// up any cookies/session state the API might expect (mirrors what the
// diagnostic script confirmed works) — all the actual data pulls after
// that are lightweight JSON POSTs through the same browser context, not
// full page renders.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scrape-full-list.mjs

import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars.");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const SITE_URL = "https://www.ngm.se/market/etp?issuers=vontobel&page=1";
const API_URL = "https://ngm-api-prod.vmate.se/instrument/list";
const PAGE_SIZE = 500; // ask for a big page; if the server clamps it, we adapt using what it actually returns
const MAX_LOOPS = 2000; // hard safety cap so a bug (e.g. totalNumber never reached) can't loop forever

function mapItemToCertificate(item) {
  return {
    isin: item.isin,
    insref: item.insref ?? null,
    name: item.name || item.symbol || "",
    issuer: "Vontobel",
    underlying: item.subsubclass ?? null,
    // NGM shows these to retail customers as "Köpkurs" (price to buy, i.e.
    // the ask) and "Säljkurs" (price to sell, i.e. the bid) — matching the
    // column meaning from the original Power Query spreadsheet.
    buy_price: item.askprice ?? null,
    sell_price: item.bidprice ?? null,
    last_price: item.lastprice ?? null,
    direction: item.funddirection ?? null,
    // NGM stores leverage with two implicit decimals (300 = 3.00x) —
    // confirmed via "BULL NVIDIA X3" showing raw value 300 for actual 3x.
    leverage: item.fundleverage != null ? item.fundleverage / 100 : null,
    daily_change_pct: item.dailyPerformance ?? null,
    turnover: item.turnover ?? null,
    ngm_updated_at: null, // API doesn't expose a per-instrument "last updated" timestamp
    ngm_page: null,
    scraped_at: new Date().toISOString(),
  };
}

async function main() {
  const { data: run } = await supabase
    .from("scrape_runs")
    .insert({ job: "full_list" })
    .select()
    .single();

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ locale: "sv-SE" });

  const all = [];
  try {
    // One real page load, purely to establish any cookies the API expects.
    await page.goto(SITE_URL, { waitUntil: "networkidle", timeout: 30000 });

    const apiContext = page.context().request;
    let totalNumber = null;

    for (let p = 0; p < MAX_LOOPS; p++) {
      const response = await apiContext.post(API_URL, {
        headers: { "Content-Type": "application/json" },
        data: {
          page: p,
          size: PAGE_SIZE,
          market: "etp",
          instrumentType: "ALL",
          issuers: "VON",
          sortField: "turnover",
          sortDirection: "desc",
        },
      });

      if (!response.ok()) {
        throw new Error(`API call failed on page ${p}: HTTP ${response.status()}`);
      }

      const json = await response.json();
      const items = json.data || [];
      if (totalNumber === null) {
        totalNumber = json.totalNumber ?? null;
        console.log(`API reports totalNumber=${totalNumber}, actual page size returned=${items.length}`);
      }

      console.log(`page ${p}: ${items.length} items (running total ${all.length + items.length}${totalNumber ? `/${totalNumber}` : ""})`);
      all.push(...items);

      if (items.length === 0) break;
      if (totalNumber !== null && all.length >= totalNumber) break;
    }

    const finalRows = all
      .filter((item) => item.isin) // safety: drop anything without an ISIN rather than fail the whole run
      .map(mapItemToCertificate);

    // De-dupe by ISIN just in case of any overlap between page requests
    const byIsin = new Map(finalRows.map((c) => [c.isin, c]));
    const deduped = Array.from(byIsin.values());

    if (deduped.length === 0) {
      throw new Error("0 Vontobel rows fetched from the API — check inspect-api.mjs output, the request shape may have changed.");
    }

    const BATCH = 500;
    for (let i = 0; i < deduped.length; i += BATCH) {
      const { error } = await supabase
        .from("certificates_full")
        .upsert(deduped.slice(i, i + BATCH), { onConflict: "isin" });
      if (error) throw error;
    }

    await supabase
      .from("scrape_runs")
      .update({
        finished_at: new Date().toISOString(),
        rows_written: deduped.length,
        ok: true,
      })
      .eq("id", run.id);

    console.log(`Done. Wrote ${deduped.length} Vontobel certificates.`);
  } catch (err) {
    console.error(err);
    if (run) {
      await supabase
        .from("scrape_runs")
        .update({
          finished_at: new Date().toISOString(),
          ok: false,
          error: String(err.message || err),
        })
        .eq("id", run.id);
    }
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
