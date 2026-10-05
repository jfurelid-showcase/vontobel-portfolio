import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { portfolioIdFrom, requireAccess } from "@/lib/auth";

// Sets (or clears) the name of the CURRENT portfolio.
// Body: { name: string }   — blank clears it.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const portfolioId = portfolioIdFrom(body.portfolio_id);
  if (portfolioId == null) return NextResponse.json({ error: "Ogiltigt portfolio_id" }, { status: 400 });
  const access = await requireAccess(req, portfolioId);
  if (!access.ok) return access.res;

  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (name.length > 80) {
    return NextResponse.json({ error: "The name can be at most 80 characters." }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("portfolio_settings")
    .update({ portfolio_name: name || null })
    .eq("id", portfolioId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ name: name || null });
}
