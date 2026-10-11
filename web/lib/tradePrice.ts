import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchNgmQuote, type Quote } from "@/lib/quote";

// The price a trade happens at is decided here, on the server, never by the browser:
//   buying (a new position, or buying more)  ->  the live ASK
//   selling (closing, or selling part)       ->  the live BID

// How old a stored bid may be and still be used when NGM can't be reached.
const STORED_BID_MAX_AGE_MS = 15 * 60 * 1000;

export type PriceResult = { ok: true; price: number; quote: Quote | null } | { ok: false; status: number; error: string };

async function quoteFor(isin: string): Promise<Quote | null> {
  const { data: cert } = await supabaseAdmin.from("certificates_full").select("insref").eq("isin", isin).maybeSingle();
  return cert?.insref ? fetchNgmQuote(cert.insref) : null;
}

// What you pay for more of a contract: the live ask. No ask, no purchase.
// There must be a live BID as well: the holding is valued at the bid, so without one the
// purchase could not be valued, and the small loss equal to the spread (bought at the ask,
// worth the bid) could not be recorded from the start.
export async function resolveBuyPrice(isin: string): Promise<PriceResult> {
  const quote = await quoteFor(isin);
  if (!quote || quote.ask == null) {
    return { ok: false, status: 409, error: "Ingen köpkurs (ask) finns just nu för kontraktet. Försök igen om en stund." };
  }
  if (quote.bid == null) {
    return { ok: false, status: 409, error: NO_BID_ON_BUY };
  }
  return { ok: true, price: quote.ask, quote };
}

export const NO_BID_ON_BUY = "Ingen säljkurs (bid) finns just nu för kontraktet, så köpet kan inte värderas. Försök igen om en stund.";

// What you get for selling: the live bid; if NGM can't be reached, the bid the quote
// worker stored in the last 15 minutes. With no bid at all a guest can't sell, but
// the owner (admin login) may then give a price by hand, e.g. for a knocked-out contract.
export async function resolveSellPrice(
  pos: { isin: string; current_bid?: number | null; quote_updated_at?: string | null },
  role: "admin" | "guest",
  body: { exit_price?: unknown }
): Promise<PriceResult> {
  const quote = await quoteFor(pos.isin);
  if (quote?.bid != null) return { ok: true, price: quote.bid, quote };

  if (pos.current_bid != null && pos.quote_updated_at) {
    const age = Date.now() - new Date(pos.quote_updated_at).getTime();
    if (age >= 0 && age <= STORED_BID_MAX_AGE_MS) return { ok: true, price: Number(pos.current_bid), quote };
  }

  const manual = Number(body?.exit_price);
  if (role === "admin" && Number.isFinite(manual) && manual > 0) return { ok: true, price: manual, quote };
  return { ok: false, status: 409, error: "Ingen säljkurs (bid) finns just nu för kontraktet. Försök igen om en stund." };
}

// A function in the database that has not been installed yet (0006_add_trim.sql not run).
export function isMissingFunction(err: { code?: string; message?: string } | null | undefined): boolean {
  return !!err && (err.code === "PGRST202" || err.code === "42883" || /could not find the function|does not exist/i.test(err.message ?? ""));
}
