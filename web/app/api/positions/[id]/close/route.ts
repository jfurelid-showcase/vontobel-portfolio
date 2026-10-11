import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { portfolioOfPosition, requireAccess } from "@/lib/auth";
import { updatePositionWithOptional } from "@/lib/optionalColumns";
import { quoteColumns } from "@/lib/quote";
import { marketClosedResponse } from "@/lib/tradingHours";
import { resolveSellPrice } from "@/lib/tradePrice";

// Closing a position sells it at the BID: the live bid fetched here at this
// moment, never a price from the browser. If NGM can't be reached the bid the
// quote worker stored in the last 15 minutes is used. If there is no bid at
// all, the position can't be closed (try again in a moment) — except that the
// owner (admin login, not a guest) may then give an exit price by hand, e.g.
// for a contract that has been knocked out and is no longer quoted.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const portfolioId = await portfolioOfPosition(params.id);
  if (portfolioId == null) return NextResponse.json({ error: "Position not found" }, { status: 404 });
  const access = await requireAccess(req, portfolioId);
  if (!access.ok) return access.res;

  // Closing is a sale: only while the market is open.
  const closed = marketClosedResponse();
  if (closed) return closed;

  const body = await req.json().catch(() => ({}));

  const { data: pos, error: findErr } = await supabaseAdmin
    .from("portfolio_positions")
    .select("*")
    .eq("id", params.id)
    .single();
  if (findErr || !pos) return NextResponse.json({ error: "Position not found" }, { status: 404 });
  if (pos.status !== "open") {
    return NextResponse.json({ error: "Positionen är redan stängd." }, { status: 409 });
  }

  const nowIso = new Date().toISOString();
  const sell = await resolveSellPrice(pos, access.role, body);
  if (!sell.ok) return NextResponse.json({ error: sell.error }, { status: sell.status });
  const exitPrice = sell.price;
  const quote = sell.quote;

  const { data, error } = await updatePositionWithOptional(
    params.id,
    { status: "closed", exit_price: exitPrice, exit_time: nowIso, current_price: exitPrice, current_updated_at: nowIso },
    { close_reason: "manual", ...quoteColumns(quote, nowIso) },
    { onlyIfOpen: true }
  );

  if (error || !data) {
    // Most likely the quote worker (automatic stop loss / target) closed it first.
    return NextResponse.json({ error: "Positionen är redan stängd." }, { status: 409 });
  }
  return NextResponse.json(data);
}
