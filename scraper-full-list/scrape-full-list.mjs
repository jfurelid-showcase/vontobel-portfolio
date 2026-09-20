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
          // Empirically: [0] = name, [1] = underlying, [2] = direction — see
          // scraper README notes. Kept separate from `cells` because the
          // name/underlying divs sit inside one <td> and their text runs
          // together when read via textContent.
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

  // ISIN doesn't appear anywhere in the list row's HTML (confirmed via
  // debug dump) — it will need to come from the instrument's detail page.
  // This regex match is left in as a harmless fallback in case some rows
  // *do* carry it (e.g. via a tooltip on hover).
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
    isin, // usually null here — filled in from the detail page in main()
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
    _href: href, // internal only — stripped before writing to Supabase
  };
}

async function fetchIsin(browser, href) {
  const detailUrl = new URL(href, BASE_URL).toString();
  const detailPage = await browser.newPage({ locale: "sv-SE" });
  try {
    await detailPage.goto(detailUrl, { waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS });
    const bodyText = await detailPage.evaluate(() => document.body.innerText);
    const match = bodyText.match(ISIN_RE);
    return match ? match[1] : null;
  } catch (e) {
    console.log(`  ISIN lookup failed for ${detailUrl}: ${e.message}`);
    return null;
  } finally {
    await detailPage.close();
  }
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
    // Pass 1: walk every /market/etp page, keep only Vontobel-issued rows.
    for (let p = 1; p <= MAX_PAGES; p++) {
      const { headers, rows, isLastPage } = await scrapePage(page, p);
      const mapped = rows
        .map((r) => mapRowToCertificate(headers, r, p))
        .filter(Boolean);
      console.log(`page ${p}: ${rows.length} rows seen, ${mapped.length} Vontobel rows kept`);
      all = all.concat(mapped);
      if (isLastPage || rows.length === 0) break;
    }

    console.log(`Found ${all.length} Vontobel instruments across all pages. Fetching ISINs…`);

    // Pass 2: visit each matched instrument's own detail page to read its
    // ISIN (it isn't present anywhere in the list view — confirmed via
    // debug run). Sequential on purpose: this is a once/day job, not
    // latency-sensitive, and going one at a time is gentler on NGM's site.
    for (let i = 0; i < all.length; i++) {
      const cert = all[i];
      if (!cert._href) continue;
      cert.isin = await fetchIsin(browser, cert._href);
      if ((i + 1) % 25 === 0 || i === all.length - 1) {
        console.log(`  ISIN lookup progress: ${i + 1}/${all.length}`);
      }
    }

    const finalRows = [];
    const byIsin = new Map();
    for (const cert of all) {
      const { _href, ...rest } = cert; // strip internal-only field before writing
      if (!rest.isin) continue; // couldn't resolve this one — skip rather than fail the whole run
      byIsin.set(rest.isin, rest); // de-dupe by ISIN in case of pagination overlap
    }
    finalRows.push(...byIsin.values());

    const skipped = all.length - finalRows.length;
    if (skipped > 0) {
      console.log(`Skipped ${skipped} Vontobel row(s) whose ISIN could not be resolved.`);
    }

    if (finalRows.length === 0) {
      throw new Error(
        "0 Vontobel rows scraped with a resolvable ISIN — selectors most likely need adjusting against the live DOM (see comments at top of this file)."
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
