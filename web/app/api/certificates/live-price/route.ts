import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchNgmQuote } from "@/lib/quote";

// The quote for one instrument right now, fetched live from NGM the same way
// the quote worker does it. `price` is what you would PAY to buy it: the ask.
// Nothing else is ever used as an entry price, so if there is no live ask
// (NGM unreachable, or the contract has no sell quote at the moment) `price`
// is null rather than a stale or last-traded number.
export async function GET(req: NextRequest) {
  const isin = req.nextUrl.searchParams.get("isin");
  if (!isin) return NextResponse.json({ error: "isin is required" }, { status: 400 });

  const { data: cert } = await supabaseAdmin.from("certificates_full").select("insref").eq("isin", isin).maybeSingle();
  const headers = { "Cache-Control": "no-store" };
  if (!cert?.insref) return NextResponse.json({ price: null, ask: null, bid: null, last: null, live: false }, { headers });

  const q = await fetchNgmQuote(cert.insref);
  if (!q) return NextResponse.json({ price: null, ask: null, bid: null, last: null, live: false }, { headers });
  return NextResponse.json({ price: q.ask, ask: q.ask, bid: q.bid, last: q.last, live: true }, { headers });
}
