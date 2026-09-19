import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() || "";
  if (q.length < 2) return NextResponse.json([]);

  const { data, error } = await supabaseAdmin
    .from("certificates_full")
    .select(
      "isin, name, underlying, direction, leverage, last_price, buy_price, sell_price, daily_change_pct"
    )
    .or(`isin.ilike.%${q}%,name.ilike.%${q}%,underlying.ilike.%${q}%`)
    .limit(25);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
