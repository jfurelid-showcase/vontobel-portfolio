import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { portfolioOfPosition, requireAccess } from "@/lib/auth";
import { isMissingFunction, resolveBuyPrice } from "@/lib/tradePrice";

// POST /api/positions/<id>/add   body: { quantity }
//
// Buy more of an open position. The contracts are bought at the live ASK, fetched
// here; a price sent by the browser is ignored. The position's entry price becomes
// the GAV, the average price paid weighted by quantity:
//     new GAV = (old quantity x old GAV + added quantity x ask) / new quantity
// The calculation and the update happen together in one database function, so two
// buys at the same moment can't overwrite each other.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const portfolioId = await portfolioOfPosition(params.id);
  if (portfolioId == null) return NextResponse.json({ error: "Position not found" }, { status: 404 });
  const access = await requireAccess(req, portfolioId);
  if (!access.ok) return access.res;

  const body = await req.json().catch(() => ({}));
  const quantity = Number(body.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100_000_000) {
    return NextResponse.json({ error: "Ange hur många kontrakt du vill köpa till (mer än 0)." }, { status: 400 });
  }

  const { data: pos } = await supabaseAdmin.from("portfolio_positions").select("isin, status").eq("id", params.id).maybeSingle();
  if (!pos) return NextResponse.json({ error: "Position not found" }, { status: 404 });
  if (pos.status !== "open") return NextResponse.json({ error: "Positionen är stängd." }, { status: 409 });

  const buy = await resolveBuyPrice(pos.isin);
  if (!buy.ok) return NextResponse.json({ error: buy.error }, { status: buy.status });

  const { data, error } = await supabaseAdmin.rpc("add_to_position", {
    p_position: params.id,
    p_quantity: quantity,
    p_price: buy.price,
  });
  if (error) {
    if (isMissingFunction(error)) {
      return NextResponse.json({ error: "Köp mer kräver att 0006_add_trim.sql har körts i Supabase." }, { status: 500 });
    }
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  return NextResponse.json({ position: data, price: buy.price, quantity });
}
