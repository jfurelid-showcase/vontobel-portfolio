import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// PATCH: edit any of a position's editable fields (works for open or closed
// positions — e.g. fixing a typo'd entry price, adjusting stop/target,
// correcting the note, or even the exit price on a closed trade).
// Body: any subset of { entry_price, quantity, stop_loss, target_price,
//                        exit_price, note, podcast_episode }
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const allowed = [
    "entry_price",
    "quantity",
    "stop_loss",
    "target_price",
    "exit_price",
    "note",
    "podcast_episode",
  ] as const;

  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }

  // Keep stake_sek (used by the NAV worker) consistent whenever entry_price
  // or quantity changes.
  if (updates.entry_price != null || updates.quantity != null) {
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from("portfolio_positions")
      .select("entry_price, quantity")
      .eq("id", params.id)
      .single();
    if (fetchErr || !existing) {
      return NextResponse.json({ error: "Position not found" }, { status: 404 });
    }
    const entryPrice = (updates.entry_price as number) ?? existing.entry_price;
    const quantity = (updates.quantity as number) ?? existing.quantity;
    if (entryPrice != null && quantity != null) {
      updates.stake_sek = entryPrice * quantity;
    }
  }

  const { data, error } = await supabaseAdmin
    .from("portfolio_positions")
    .update(updates)
    .eq("id", params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// DELETE: permanently remove a position — for ones added by mistake.
// This also cascades to delete its price_ticks (see the foreign key in
// 0001_init.sql), so it cleanly disappears from history entirely, not just
// from the current view.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await supabaseAdmin.from("portfolio_positions").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
