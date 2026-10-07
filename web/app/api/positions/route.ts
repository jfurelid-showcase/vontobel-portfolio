import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { portfolioIdFrom, requireAccess } from "@/lib/auth";
import { validateAuto } from "@/lib/autoClose";

// GET /api/positions?portfolio_id=<id>   (public read, like the dashboards)
export async function GET(req: NextRequest) {
  const portfolioId = portfolioIdFrom(req.nextUrl.searchParams.get("portfolio_id"));
  if (portfolioId == null) return NextResponse.json({ error: "Ogiltigt portfolio_id" }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from("portfolio_positions")
    .select("*")
    .eq("portfolio_id", portfolioId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Attach each certificate's own previous-close price, so daily change can
  // be computed live against the position's own current_price (refreshed
  // every ~10s by the quote worker) instead of a once-daily stat.
  const isins = [...new Set((data ?? []).map((p) => p.isin))];
  let prevCloseByIsin = new Map<string, number | null>();
  if (isins.length > 0) {
    const { data: certs } = await supabaseAdmin
      .from("certificates_full")
      .select("isin, prev_close_price")
      .in("isin", isins);
    prevCloseByIsin = new Map((certs ?? []).map((c) => [c.isin, c.prev_close_price]));
  }

  const enriched = (data ?? []).map((p) => ({
    ...p,
    prev_close_price: prevCloseByIsin.get(p.isin) ?? null,
  }));

  return NextResponse.json(enriched);
}

// Body: { isin, entry_price, stop_loss, target_price, quantity, note, podcast_episode,
//         auto_stop?, auto_target? }   (auto_* = close automatically at that level)
// Everything else (name, direction, leverage, underlying) is copied over
// from certificates_full so the admin doesn't retype it. stake_sek (used by
// the NAV worker's weighted-return calculation) is derived automatically
// as quantity * entry_price, so the worker needs no changes.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { isin, entry_price, stop_loss, target_price, quantity, note, podcast_episode } = body;

  const portfolioId = portfolioIdFrom(body.portfolio_id);
  if (portfolioId == null) return NextResponse.json({ error: "Ogiltigt portfolio_id" }, { status: 400 });
  const access = await requireAccess(req, portfolioId);
  if (!access.ok) return access.res;

  if (!isin || !entry_price || !quantity) {
    return NextResponse.json({ error: "isin, entry_price and quantity are required" }, { status: 400 });
  }

  // Automatic stop loss / target: only if the level is set and still ahead of
  // the price (otherwise the position would close the moment it is created).
  const autoStop = body.auto_stop === true;
  const autoTarget = body.auto_target === true;
  if (autoStop || autoTarget) {
    const problem = validateAuto(
      { stop_loss: stop_loss ?? null, target_price: target_price ?? null, auto_stop: autoStop, auto_target: autoTarget },
      Number(entry_price)
    );
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  }

  const { data: cert, error: certErr } = await supabaseAdmin
    .from("certificates_full")
    .select("name, direction, leverage, underlying, last_price, instrument_type")
    .eq("isin", isin)
    .single();

  if (certErr || !cert) {
    return NextResponse.json({ error: "ISIN not found in full list" }, { status: 404 });
  }

  const { data, error } = await supabaseAdmin
    .from("portfolio_positions")
    .insert({
      portfolio_id: portfolioId,
      isin,
      name: cert.name,
      direction: cert.direction,
      leverage: cert.leverage,
      underlying: cert.underlying,
      instrument_type: cert.instrument_type,
      entry_price,
      entry_time: new Date().toISOString(),
      quantity,
      stake_sek: quantity * entry_price,
      stop_loss: stop_loss ?? null,
      target_price: target_price ?? null,
      // Only sent when switched on, so adding an ordinary position keeps
      // working even before the database has the auto-close columns.
      ...(autoStop ? { auto_stop: true } : {}),
      ...(autoTarget ? { auto_target: true } : {}),
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