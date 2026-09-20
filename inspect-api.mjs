// inspect-api.mjs
//
// ONE-OFF DIAGNOSTIC — not part of the daily job. Run manually once to find
// out whether NGM's list/detail pages fetch their data from a JSON API
// under the hood. If so, we can call that API directly (fast, cheap, easy
// to run concurrently) instead of visiting one detail page per instrument
// (which doesn't scale to ~25,000 Vontobel instruments).
//
// Usage: node inspect-api.mjs

import { chromium } from "playwright";

const LIST_URL = "https://www.ngm.se/market/etp?issuers=vontobel&page=1";
const ISIN_RE = /\b([A-Z]{2}[A-Z0-9]{9}\d)\b/;

function looksInteresting(url, contentType) {
  return (
    (contentType && contentType.includes("json")) ||
    /\/api\/|graphql|\/data\//i.test(url)
  );
}

async function sniff(page, label, url) {
  const seen = [];
  const onResponse = async (response) => {
    try {
      const req = response.request();
      if (!["fetch", "xhr"].includes(req.resourceType())) return;
      const contentType = response.headers()["content-type"] || "";
      if (!looksInteresting(response.url(), contentType)) return;

      let bodySnippet = "";
      let containsIsin = false;
      try {
        const text = await response.text();
        containsIsin = ISIN_RE.test(text);
        bodySnippet = text.slice(0, 1500);
      } catch {
        bodySnippet = "(could not read body)";
      }

      seen.push({
        url: response.url(),
        status: response.status(),
        contentType,
        containsIsin,
        bodySnippet,
      });
    } catch {
      // ignore individual response errors
    }
  };

  page.on("response", onResponse);
  console.log(`\n=== ${label}: navigating to ${url} ===`);
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  // give any late XHRs a moment to resolve
  await page.waitForTimeout(1500);
  page.off("response", onResponse);

  console.log(`=== ${label}: ${seen.length} interesting network call(s) ===`);
  for (const s of seen) {
    console.log(`\n--- ${s.url}`);
    console.log(`status=${s.status} content-type=${s.contentType} containsIsin=${s.containsIsin}`);
    console.log(s.bodySnippet);
  }
  return seen;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ locale: "sv-SE" });

  const listCalls = await sniff(page, "LIST PAGE", LIST_URL);

  // Grab the first row's detail-page link the same way the real scraper
  // does, then sniff that page's network traffic too.
  const href = await page
    .$eval("a[href*='/market/instrument/']", (a) => a.getAttribute("href"))
    .catch(() => null);

  if (href) {
    const detailUrl = new URL(href, "https://www.ngm.se").toString();
    await sniff(page, "DETAIL PAGE", detailUrl);
  } else {
    console.log("\nCould not find a detail-page link on the list page to follow.");
  }

  const anyIsinFound = listCalls.some((c) => c.containsIsin);
  console.log(
    `\n\nSUMMARY: ${anyIsinFound ? "The LIST page's own API call already contains an ISIN — huge win, no detail-page visits needed at all." : "No ISIN found in the list page's API calls — check the DETAIL PAGE section above for a fast JSON endpoint instead."}`
  );

  await browser.close();
}

main();
