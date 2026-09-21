import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() || "";
  const direction = req.nextUrl.searchParams.get("direction")?.trim(); // "Long" | "Short" | undefined
  if (q.length < 2) return NextResponse.json({ results: [], totalCount: 0 });

  let query = supabaseAdmin
    .from("certificates_full")
    .select(
      "isin, name, underlying, direction, leverage, last_price, buy_price, sell_price, daily_change_pct",
      { count: "exact" }
    )
    .or(`isin.ilike.%${q}%,name.ilike.%${q}%,underlying.ilike.%${q}%`);

  if (direction) {
    query = query.ilike("direction", direction);
  }

  const { data, error, count } = await query
    // Show the most liquid/relevant matches first — turnover is a reasonable
    // proxy for "actively traded" when searching a broad term like an
    // underlying name that can match dozens of leverage/strike variants.
    .order("turnover", { ascending: false, nullsFirst: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ results: data, totalCount: count ?? data.length });
}
