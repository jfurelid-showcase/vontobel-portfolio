import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { portfolioOfPosition, requireAccess } from "@/lib/auth";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const portfolioId = await portfolioOfPosition(params.id);
  if (portfolioId == null) return NextResponse.json({ error: "Position not found" }, { status: 404 });
  const access = await requireAccess(req, portfolioId);
  if (!access.ok) return access.res;

  const body = await req.json().catch(() => ({}));

  const { data: pos, error: findErr } = await supabaseAdmin
    .from("portfolio_positions")
    .select("current_price")
    .eq("id", params.id)
    .single();
  if (findErr || !pos) return NextResponse.json({ error: "Position not found" }, { status: 404 });

  const exitPrice = body.exit_price ?? pos.current_price;

  const { data, error } = await supabaseAdmin
    .from("portfolio_positions")
    .update({
      status: "closed",
      exit_price: exitPrice,
      exit_time: new Date().toISOString(),
    })
    .eq("id", params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
