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
// dates like "2026-09-19 09:45". Normalize