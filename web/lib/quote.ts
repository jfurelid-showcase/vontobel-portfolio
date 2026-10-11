import "server-only";

// A contract is quoted with a BID (the price you can sell at) and an ASK (the
// price you buy at). Every entry in the portfolio is made at the ask and every
// exit at the bid, so these are fetched on the server at the moment you act,
// never taken from the browser.
//
// normalizeQuote is the same validation the quote worker applies, so the two
// always agree on what counts as a usable price.

export type Quote = { bid: number | null; ask: number | null; last: number | null };

function positive(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

// A price must be a positive number. A bid above the ask is a broken quote, so
// both sides of it are discarded rather than trusting either one.
export function normalizeQuote(json: any): Quote {
  let bid = positive(json?.bidprice);
  let ask = positive(json?.askprice);
  const last = positive(json?.lastprice);
  if (bid != null && ask != null && bid > ask) {
    bid = null;
    ask = null;
  }
  return { bid, ask, last };
}

// Live quote for one instrument from NGM's public backend (the same request
// the quote worker makes). Returns null if NGM can't be reached.
export async function fetchNgmQuote(insref: number | string): Promise<Quote | null> {
  try {
    const res = await fetch(`https://ngm-api-prod.vmate.se/instrument/${insref}`, {
      headers: { "Content-Type": "application/json", Referer: "https://www.ngm.se/", Origin: "https://www.ngm.se" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return normalizeQuote(await res.json());
  } catch {
    return null;
  }
}

// The extra position columns that record the quote (added by 0004_bid_ask.sql).
// Only a consistent bid/ask pair is stored.
export function quoteColumns(q: Quote | null, now: string): Record<string, unknown> {
  return q && q.bid != null && q.ask != null ? { current_bid: q.bid, current_ask: q.ask, quote_updated_at: now } : {};
}
