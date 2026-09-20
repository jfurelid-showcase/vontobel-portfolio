// scrape-full-list.mjs
//
// Scrapes https://www.ngm.se/market/etp?page=1..N, filters to Vontobel-issued
// instruments, and upserts the full offer into Supabase `certificates_full`.
// Meant to run once/day at 17:30 CET (see ../.github/workflows/full-list.yml).
//
// IMPORTANT: I could not execute JavaScript against ngm.se from this sandbox
// (the site is a client-rendered SPA and my tools here can't run a browser
// against it), so the CSS selectors below are written defensively — they
// look for table-like rows and pull cells by matching an ISIN pattern and
// header text, rather than hard-coding a fragile class name. Run this once
// with HEADLESS=false locally against the real site and adjust the
// `ROW_SELECTOR` / `HEADER_SELECTOR` constants below if it doesn't find rows —
// open devtools, inspect one row of the table, and update the selector.
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

const BASE_URL = "https://www.ngm.se/market/etp";
const ISSUER_FILTER = /vontobel|^von$/i; // matches "Vontobel" or the short code "VON"
const ISIN_RE = /\b([A-Z]{2}[A-Z0-9]{9}\d)\b/; // standard ISIN pattern
const MAX_PAGES = 400; // hard safety cap so a bug can't loop forever
const NAV_TIMEOUT_MS = 30000;

// Swedish month/number formatting: NGM shows numbers like "1 019,74" and
// dates like "2026-09-19 09:45". Normalize both.
function parseSvNumber(s) {
  if (s == null) return null;
  const cleaned = String(s).replace(/\s/g, "").replace(",", ".").replace("%", "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseSvTimestamp(s) {
  if (!s) return null;
  const d = new Date(s.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function scrapePage(page, pageNum) {
  const url = `${BASE_URL}?page=${pageNum}`;
  await page.goto(url, { waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS });

  // Wait for *some* table content to hydrate. Adjust this selector if the
  // real DOM uses something else (e.g. a specific data-testid).
  try {
    await page.waitForSelector("table, [role='table'], [role='row']", {
      timeout: NAV_TIMEOUT_MS,
    });
  } catch {
    return { rows: [], isLastPage: true };
  }

  // Pull header text once (first row / thead) so we can map columns by name
  // instead of by fixed index — resilient to column reordering.
  const headers = await page.$$eval(
    "table thead th, [role='row']:first-child [role='columnheader'], [role='row']:first-child > *",
    (cells) => cells.map((c) => c.textContent.trim().toLowerCase())
  ).catch(() => []);

  const rows = await page.$$eval(
    "table tbody tr, [role='row']:not(:first-child)",
    (trs) =>
      trs.map((tr) =>
        Array.from(tr.querySelectorAll("td, [role='cell'], [role='gridcell']")).map((td) =>
          td.textContent.trim()
        )
      )
  );

  const nextDisabled = await page
    .$eval(
      "[aria-label='Next'], [aria-label='Nästa'], button:has-text('Nästa')",
      (el) => el.disabled || el.getAttribute("aria-disabled") === "true"
    )
    .catch(() => true); // if we can't find a "next" control, assume this is the last page

  return { headers, rows, isLastPage: nextDisabled };
}

function mapRowToCertificate(headers, cells, pageNum) {
  // Build a header->value map when we have headers; otherwise fall back to
  // scanning every cell for an ISIN and treating neighbouring cells
  // heuristically. This double path is intentional — real header text from
  // the live site may not exactly match the guesses below.
  const byHeader = {};
  headers.forEach((h, i) => {
    if (cells[i] !== undefined) byHeader[h] = cells[i];
  });

  const isinCell = cells.find((c) => ISIN_RE.test(c));
  const isinMatch = isinCell && isinCell.match(ISIN_RE);
  const isin = isinMatch ? isinMatch[1] : null;
  if (!isin) return null;

  const get = (...keys) => {
    for (const k of keys) {
      const hit = Object.keys(byHeader).find((h) => h.includes(k));
      if (hit) return byHeader[hit];
    }
    return null;
  };

  const issuer = get("emittent", "issuer") || "";
  if (!ISSUER_FILTER.test(issuer)) return null; // keep only Vontobel

  return {
    isin,
    insref: cells[0] && /^\d+$/.test(cells[0]) ? Number(cells[0]) : null,
    name: get("namn", "name") || cells[1] || "",
    issuer: "Vontobel",
    underlying: get("underliggande", "underlying"),
    buy_price: parseSvNumber(get("köpkurs", "köp")),
    sell_price: parseSvNumber(get("säljkurs", "sälj")),
    last_price: parseSvNumber(get("senast", "last")),
    direction: get("riktning", "direction"),
    leverage: parseSvNumber(get("hävstång", "leverage")),
    daily_change_pct: parseSvNumber(get("dagsutveckling", "%")),
    turnover: parseSvNumber(get("omsättning", "turnover")),
    ngm_updated_at: parseSvTimestamp(get("uppdaterad", "updated")),
    ngm_page: pageNum,
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

  let all = [];
  try {
    for (let p = 1; p <= MAX_PAGES; p++) {
      const { headers, rows, isLastPage } = await scrapePage(page, p);

      if (p === 1) {
        // One-time diagnostic dump so we can see exactly what the live DOM
        // looks like, instead of guessing again. Safe to delete once the
        // mapping below is confirmed correct.
        console.log("=== DEBUG: headers detected on page 1 ===");
        console.log(JSON.stringify(headers));
        console.log("=== DEBUG: first 2 raw rows on page 1 ===");
        console.log(JSON.stringify(rows.slice(0, 2), null, 2));
      }

      const mapped = rows
        .map((r) => mapRowToCertificate(headers, r, p))
        .filter(Boolean);
      console.log(`page ${p}: ${rows.length} rows seen, ${mapped.length} Vontobel rows kept`);
      all = all.concat(mapped);
      if (isLastPage || rows.length === 0) break;
    }

    // De-dupe by ISIN (in case pagination overlaps)
    const byIsin = new Map(all.map((c) => [c.isin, c]));
    const finalRows = Array.from(byIsin.values());

    if (finalRows.length === 0) {
      throw new Error(
        "0 Vontobel rows scraped — selectors most likely need adjusting against the live DOM (see comments at top of this file)."
      );
    }

    // Upsert in batches
    const BATCH = 500;
    for (let i = 0; i < finalRows.length; i += BATCH) {
      const { error } = await supabase
        .from("certificates_full")
        .upsert(finalRows.slice(i, i + BATCH), { onConflict: "isin" });
      if (error) throw error;
    }

    await supabase
      .from("scrape_runs")
      .update({
        finished_at: new Date().toISOString(),
        rows_written: finalRows.length,
        ok: true,
      })
      .eq("id", run.id);

    console.log(`Done. Wrote ${finalRows.length} Vontobel certificates.`);
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
