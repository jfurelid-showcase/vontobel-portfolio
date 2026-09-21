import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// The daily full-list scrape's last_price can be up to ~24h stale. This
// route fetches a genuinely live price for one instrument at the moment
// it's actually needed (e.g. right when the admin selects it to add a
// position), the same way quote-worker does — a plain JSON GET to NGM's
// public backend API, keyed by insref (looked up from certificates_full).
export async function GET(req: NextRequest) {
  const isin = req.nextUrl.searchParams.get("isin");
  if (!isin) return NextResponse.json({ error: "isin is required" }, { status: 400 });

  const { data: cert, error: certErr } = await supabaseAdmin
    .from("certificates_full")
    .select("insref, last_price")
    .eq("isin", isin)
    .single();

  if (certErr || !cert?.insref) {
    return NextResponse.json({ price: cert?.last_price ?? null, live: false });
  }

  try {
    const res = await fetch(`https://ngm-api-prod.vmate.se/instrument/${cert.insref}`, {
      headers: {
        "Content-Type": "application/json",
        Referer: "https://www.ngm.se/",
        Origin: "https://www.ngm.se",
      },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    const price =
      json.lastprice ??
      (json.bidprice != null && json.askprice != null ? (json.bidprice + json.askprice) / 2 : null) ??
      json.askprice ??
      json.bidprice ??
      cert.last_price ??
      null;

    return NextResponse.json({ price, live: true });
  } catch {
    // NGM unreachable/blocked from a serverless function for some reason —
    // fall back to the scraped value rather than fail the whole selection.
    return NextResponse.json({ price: cert.last_price ?? null, live: false });
  }
}
