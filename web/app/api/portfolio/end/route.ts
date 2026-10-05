import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { portfolioIdFrom, requireAccess } from "@/lib/auth";

// Ends the current portfolio: the end_portfolio() database function closes
// open positions, saves a permanent copy of all trades + the full NAV
// history, and starts a fresh portfolio — all in one transaction.
//
// Body: { portfolio_id: number, name?: string, new_name?: string, new_capital?: number | null, confirm: "END" }
//   name     = name of the SAVED copy (blank = current portfolio's name, else a date range)
//   new_name = name of the NEW portfolio (blank = unnamed)
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  const portfolioId = portfolioIdFrom(body.portfolio_id);
  if (portfolioId == null) return NextResponse.json({ error: "Ogiltigt portfolio_id" }, { status: 400 });
  const access = await requireAccess(req, portfolioId);
  if (!access.ok) return access.res;

  if (body.confirm !== "END") {
    return NextResponse.json({ error: 'Confirmation missing — type "END" to confirm.' }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const newName = typeof body.new_name === "string" ? body.new_name.trim() : "";
  if (name.length > 80 || newName.length > 80) {
    return NextResponse.json({ error: "Portfolio names can be at most 80 characters." }, { status: 400 });
  }
  const capital = body.new_capital == null || body.new_capital === "" ? null : Number(body.new_capital);
  if (capital != null && (!Number.isFinite(capital) || capital <= 0)) {
    return NextResponse.json({ error: "The new start capital must be a positive number." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.rpc("end_portfolio", {
    p_name: name,
    p_new_capital: capital,
    p_new_name: newName,
    p_portfolio: portfolioId,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
