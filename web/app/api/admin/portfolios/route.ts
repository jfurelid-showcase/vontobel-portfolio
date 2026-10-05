import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/auth";
import { makeSlug, newEditToken } from "@/lib/authCore";

export const dynamic = "force-dynamic";

// GET: every portfolio, with each guest's private edit token. Owner only —
// this is the one place the tokens are ever sent to a browser.
export async function GET(req: NextRequest) {
  const access = requireAdmin(req);
  if (!access.ok) return access.res;

  const { data: portfolios, error } = await supabaseAdmin
    .from("portfolio_settings")
    .select("id, slug, kind, trader_name, portfolio_name, cash_sek, started_at, created_at")
    .order("id", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: tokens } = await supabaseAdmin.from("portfolio_access").select("portfolio_id, edit_token");
  const tokenById = new Map((tokens ?? []).map((t) => [t.portfolio_id as number, t.edit_token as string]));

  return NextResponse.json(
    (portfolios ?? []).map((p) => ({ ...p, edit_token: p.kind === "guest" ? tokenById.get(p.id) ?? null : null })),
    { headers: { "Cache-Control": "no-store" } }
  );
}

// POST { name, capital }: create a guest portfolio with its own private link.
export async function POST(req: NextRequest) {
  const access = requireAdmin(req);
  if (!access.ok) return access.res;

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const capital = body.capital == null || body.capital === "" ? 100000 : Number(body.capital);

  if (!name) return NextResponse.json({ error: "Ange ett namn." }, { status: 400 });
  if (name.length > 80) return NextResponse.json({ error: "Namnet får vara max 80 tecken." }, { status: 400 });
  if (!Number.isFinite(capital) || capital <= 0) {
    return NextResponse.json({ error: "Startkapitalet måste vara ett positivt tal." }, { status: 400 });
  }

  // The slug includes a short random part; on the (unlikely) clash, try again.
  for (let attempt = 0; attempt < 4; attempt++) {
    const slug = makeSlug(name);
    const token = newEditToken();
    const { data, error } = await supabaseAdmin.rpc("create_guest_portfolio", {
      p_name: name,
      p_slug: slug,
      p_capital: capital,
      p_token: token,
    });
    if (!error) return NextResponse.json({ id: (data as { id: number }).id, slug, edit_token: token });
    if (error.code !== "23505") return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ error: "Kunde inte skapa en unik adress, försök igen." }, { status: 409 });
}
