import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/auth";
import { newEditToken, parsePortfolioId } from "@/lib/authCore";

// PATCH { action: "regenerate_token" }: issue a new private link for a guest;
// the old link stops working immediately.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const access = requireAdmin(req);
  if (!access.ok) return access.res;

  const id = parsePortfolioId(params.id);
  if (id == null) return NextResponse.json({ error: "Ogiltigt id" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  if (body.action !== "regenerate_token") return NextResponse.json({ error: "Okänd åtgärd" }, { status: 400 });

  const { data: p } = await supabaseAdmin.from("portfolio_settings").select("kind").eq("id", id).maybeSingle();
  if (!p) return NextResponse.json({ error: "Portföljen finns inte." }, { status: 404 });
  if (p.kind !== "guest") return NextResponse.json({ error: "Ägarens portfölj har ingen redigeringslänk." }, { status: 400 });

  const token = newEditToken();
  const { error } = await supabaseAdmin.from("portfolio_access").upsert({ portfolio_id: id, edit_token: token });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ edit_token: token });
}

// DELETE { confirm: "<slug>" }: permanently delete a guest portfolio and ALL
// of its data (positions, history, archives). The owner's can't be deleted.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const access = requireAdmin(req);
  if (!access.ok) return access.res;

  const id = parsePortfolioId(params.id);
  if (id == null) return NextResponse.json({ error: "Ogiltigt id" }, { status: 400 });
  const body = await req.json().catch(() => ({}));

  const { data: p } = await supabaseAdmin.from("portfolio_settings").select("slug, kind").eq("id", id).maybeSingle();
  if (!p) return NextResponse.json({ error: "Portföljen finns inte." }, { status: 404 });
  if (p.kind !== "guest") return NextResponse.json({ error: "Ägarens portfölj kan inte tas bort." }, { status: 400 });
  if (body.confirm !== p.slug) {
    return NextResponse.json({ error: "Bekräftelsen stämmer inte med portföljens adress." }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from("portfolio_settings").delete().eq("id", id).eq("kind", "guest");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
