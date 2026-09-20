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

  try {
    await page.waitForSelector("table, [role='table'], [role='row']", {
      timeout: NAV_TIMEOUT_MS,
    });
  } catch {
    return { rows: [], isLastPage: true };
  }

  const headers = await page.$$eval(
    "table thead th, [role='row']:first-child [role='columnheader'], [role='row']:first-child > *",
    (cells) => cells.map((c) => c.textContent.trim().toLowerCase())
  ).catch(() => []);

  const rows = await page.$$eval(
    "table tbody tr, [role='row']:not(:first-child)",
    (trs) =>
      trs.map((tr) => {
        const titledEls = Array.from(tr.querySelectorAll("[title]")).map((el) =>
          el.getAttribute("title")
        );
        const href = tr.querySelector("a[href*='/market/instrument/']")?.getAttribute("href") || null;
        return {
          cells: Array.from(tr.querySelectorAll("td, [role='cell'], [role='gridcell']")).map(
            (td) => td.textContent.trim()
          ),
          html: tr.outerHTML,
          href,
          titledEls,
        };
      })
  );

  const nextDisabled = await page
    .$eval(
      "[aria-label='Next'], [aria-label='Nästa'], button:has-text('Nästa')",
      (el) => el.disabled || el.getAttribute("aria-disabled") === "true"
    )
    .catch(() => true);

  return { headers, rows, isLastPage: nextDisabled };
}

function mapRowToCertificate(headers, row, pageNum) {
  const { cells, html, href, titledEls } = row;

  const byHeader = {};
  headers.forEach((h, i) => {
    if (cells[i] !== undefined) byHeader[h] = cells[i];
  });

  const insrefMatch = href && href.match(/\/market\/instrument\/(\d+)/);
  const insref = insrefMatch ? Number(insrefMatch[1]) : null;

  const isinMatch = html.match(ISIN_RE);
  const isin = isinMatch ? isinMatch[1] : null;

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
    isin, // may be null for now — see README, detail-page fetch comes next
    insref,
    name: titledEls?.[0] || get("namn", "name") || cells[1] || "",
    issuer: "Vontobel",
    underlying: titledEls?.[1] || null,
    buy_price: parseSvNumber(get("köp")),
    sell_price: parseSvNumber(get("sälj")),
    last_price: parseSvNumber(get("senast", "last")),
    direction: titledEls?.[2] || get("riktning", "direction"),
    leverage: parseSvNumber(get("hävstång", "leverage")),
    daily_change_pct: parseSvNumber(get("%")),
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
        console.log("=== DEBUG: headers detected on page 1 ===");
        console.log(JSON.stringify(headers));
        console.log("=== DEBUG: first row's visible cells on page 1 ===");
        console.log(JSON.stringify(rows[0]?.cells));
        console.log("=== DEBUG: first row's titled elements (name/underlying/direction) ===");
        console.log(JSON.stringify(rows[0]?.titledEls));
        console.log("=== DEBUG: first row's href ===");
        console.log(rows[0]?.href);

        if (rows[0]?.href) {
          const detailUrl = new URL(rows[0].href, BASE_URL).toString();
          console.log(`=== DEBUG: fetching detail page ${detailUrl} ===`);
          const detailPage = await browser.newPage({ locale: "sv-SE" });
          try {
            await detailPage.goto(detailUrl, { waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS });
            const bodyText = await detailPage.evaluate(() => document.body.innerText);
            const bodyHtmlSnippet = await detailPage.evaluate(() => document.body.innerHTML.slice(0, 6000));
            const isinsFound = [...bodyText.matchAll(new RegExp(ISIN_RE, "g"))].map((m) => m[1]);
            console.log("=== DEBUG: ISINs found in detail page visible text ===");
            console.log(JSON.stringify(isinsFound));
            console.log("=== DEBUG: detail page visible text (truncated to 2000 chars) ===");
            console.log(bodyText.slice(0, 2000));
            if (isinsFound.length === 0) {
              console.log("=== DEBUG: no ISIN in visible text — first 6000 chars of body HTML ===");
              console.log(bodyHtmlSnippet);
            }
          } catch (e) {
            console.log("Detail page fetch failed:", e.message);
          } finally {
            await detailPage.close();
          }
        }
      }

      const mapped = rows
        .map((r) => mapRowToCertificate(headers, r, p))
        .filter(Boolean);
      console.log(`page ${p}: ${rows.length} rows seen, ${mapped.length} Vontobel rows kept`);
      all = all.concat(mapped);
      if (isLastPage || rows.length === 0) break;
    }

    const byIsin = new Map(all.filter((c) => c.isin).map((c) => [c.isin, c]));
    const finalRows = Array.from(byIsin.values());
    const skippedNoIsin = all.length - finalRows.length;
    if (skippedNoIsin > 0) {
      console.log(`Skipped ${skippedNoIsin} Vontobel rows with no ISIN yet (detail-page lookup not implemented yet).`);
    }

    if (finalRows.length === 0) {
      throw new Error(
        "0 Vontobel rows scraped — selectors most likely need adjusting against the live DOM (see comments at top of this file)."
      );
    }

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
