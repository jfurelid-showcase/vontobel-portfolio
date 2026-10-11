import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { portfolioOfPosition, requireAccess } from "@/lib/auth";
import { marketClosedResponse } from "@/lib/tradingHours";
import { isMissingFunction, resolveSellPrice } from "@/lib/tradePrice";

// POST /api/positions/<id>/trim   body: { quantity }
//
// Sell part of an open position. The contracts are sold at the live BID, fetched
// here (the same rules as closing: see lib/tradePrice.ts). The sold part becomes its
// own closed trade at the position's GAV, so its profit or loss is counted like any
// closed trade; the rest stays open at the same GAV. To sell everything, use Close.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const portfolioId = await portfolioOfPosition(params.id);
  if (portfolioId == null) return NextResponse.json({ error: "Position not found" }, { status: 404 });
  const access = await requireAccess(req, portfolioId);
  if (!access.ok) return access.res;

  // Trades only while the market is open.
  const closed = marketClosedResponse();
  if (closed) return closed;

  const body = await req.json().catch(() => ({}));
  const quantity = Number(body.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100_000_000) {
    return NextResponse.json({ error: "Ange hur många kontrakt du vill sälja (mer än 0)." }, { status: 400 });
  }

  const { data: pos } = await supabaseAdmin.from("portfolio_positions").select("*").eq("id", params.id).maybeSingle();
  if (!pos) return NextResponse.json({ error: "Position not found" }, { status: 404 });
  if (pos.status !== "open") return NextResponse.json({ error: "Positionen är stängd." }, { status: 409 });
  if (pos.quantity != null && quantity >= Number(pos.quantity)) {
    return NextResponse.json(
      { error: `Du håller ${pos.quantity} kontrakt. Sälj färre än så, eller använd Stäng för att sälja allt.` },
      { status: 400 }
    );
  }

  const sell = await resolveSellPrice(pos, access.role, body);
  if (!sell.ok) return NextResponse.json({ error: sell.error }, { status: sell.status });

  const { data, error } = await supabaseAdmin.rpc("trim_position", {
    p_position: params.id,
    p_quantity: quantity,
    p_price: sell.price,
  });
  if (error) {
    if (isMissingFunction(error)) {
      return NextResponse.json({ error: "Sälj del kräver att 0006_add_trim.sql har körts i Supabase." }, { status: 500 });
    }
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  return NextResponse.json({ ...(data as object), price: sell.price, quantity });
}
