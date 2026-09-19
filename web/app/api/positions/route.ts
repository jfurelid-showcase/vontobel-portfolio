import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("portfolio_positions")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// Body: { isin, entry_price, stop_loss, target_price, stake_sek, note, podcast_episode }
// Everything else (name, direction, leverage, underlying) is copied over
// from certificates_full so the admin doesn't retype it.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { isin, entry_price, stop_loss, target_price, stake_sek, note, podcast_episode } = body;

  if (!isin || !entry_price) {
    return NextResponse.json({ error: "isin and entry_price are required" }, { status: 400 });
  }

  const { data: cert, error: certErr } = await supabaseAdmin
    .from("certificates_full")
    .select("name, direction, leverage, underlying, last_price")
    .eq("isin", isin)
    .single();

  if (certErr || !cert) {
    return NextResponse.json({ error: "ISIN not found in full list" }, { status: 404 });
  }

  const { data, error } = await supabaseAdmin
    .from("portfolio_positions")
    .insert({
      isin,
      name: cert.name,
      direction: cert.direction,
      leverage: cert.leverage,
      underlying: cert.underlying,
      entry_price,
      entry_time: new Date().toISOString(),
      stake_sek: stake_sek || 10000,
      stop_loss: stop_loss ?? null,
      target_price: target_price ?? null,
      current_price: cert.last_price ?? entry_price,
      current_updated_at: new Date().toISOString(),
      note: note ?? null,
      podcast_episode: podcast_episode ?? null,
      status: "open",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
