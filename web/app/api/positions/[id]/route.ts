import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { portfolioOfPosition, requireAccess } from "@/lib/auth";
import { validateAuto } from "@/lib/autoClose";
import { isMissingColumn } from "@/lib/optionalColumns";

// PATCH: edit any of a position's editable fields (works for open or closed
// positions — e.g. fixing a typo'd entry price, adjusting stop/target,
// correcting the note, or even the exit price on a closed trade).
// Body: any subset of { entry_price, quantity, stop_loss, target_price,
//                        exit_price, note, podcast_episode, auto_stop, auto_target }
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const portfolioId = await portfolioOfPosition(params.id);
  if (portfolioId == null) return NextResponse.json({ error: "Position not found" }, { status: 404 });
  const access = await requireAccess(req, portfolioId);
  if (!access.ok) return access.res;

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

  // Automatic stop loss / target. The effective settings (what is stored,
  // with this request's changes on top) must make sense together, so the
  // position can't be switched to "close automatically" at a level the price
  // has already passed — it would close at once.
  const touchesAuto = "auto_stop" in body || "auto_target" in body || "stop_loss" in body || "target_price" in body;
  if (touchesAuto) {
    const { data: cur, error: curErr } = await supabaseAdmin
      .from("portfolio_positions")
      .select("*")
      .eq("id", params.id)
      .single();
    if (curErr || !cur) return NextResponse.json({ error: "Position not found" }, { status: 404 });

    const stop = "stop_loss" in updates ? (updates.stop_loss as number | null) : cur.stop_loss ?? null;
    const target = "target_price" in updates ? (updates.target_price as number | null) : cur.target_price ?? null;
    let autoStop = "auto_stop" in body ? body.auto_stop === true : cur.auto_stop === true;
    let autoTarget = "auto_target" in body ? body.auto_target === true : cur.auto_target === true;

    // Removing a level removes the automation that depended on it. But asking
    // to switch automation ON with no level set is a mistake worth telling
    // you about (validateAuto below), not something to ignore silently.
    if (stop == null && body.auto_stop !== true) autoStop = false;
    if (target == null && body.auto_target !== true) autoTarget = false;

    const wantsOn = (body.auto_stop === true && cur.auto_stop !== true) || (body.auto_target === true && cur.auto_target !== true);
    if (cur.status !== "open" && wantsOn) {
      return NextResponse.json({ error: "Positionen är redan stängd, automatik kan bara slås på för öppna positioner." }, { status: 400 });
    }
    if (cur.status === "open" && (autoStop || autoTarget)) {
      const ref = Number(cur.current_price ?? updates.entry_price ?? cur.entry_price);
      const problem = validateAuto({ stop_loss: stop, target_price: target, auto_stop: autoStop, auto_target: autoTarget }, ref);
      if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    }

    // Only send the flags when they change, so ordinary edits keep working
    // before the database has the auto-close columns.
    if (autoStop !== (cur.auto_stop === true)) updates.auto_stop = autoStop;
    if (autoTarget !== (cur.auto_target === true)) updates.auto_target = autoTarget;
  }

  const { data, error } = await supabaseAdmin
    .from("portfolio_positions")
    .update(updates)
    .eq("id", params.id)
    .select()
    .single();

  if (error) {
    if (isMissingColumn(error)) {
      return NextResponse.json(
        { error: "Databasen saknar kolumnerna för automatisk stängning. Kör 0003_auto_close.sql i Supabase först." },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

// DELETE: permanently remove a position — for ones added by mistake.
// This also cascades to delete its price_ticks (see the foreign key in
// 0001_init.sql), so it cleanly disappears from history entirely, not just
// from the current view.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const portfolioId = await portfolioOfPosition(params.id);
  if (portfolioId == null) return NextResponse.json({ error: "Position not found" }, { status: 404 });
  const access = await requireAccess(req, portfolioId);
  if (!access.ok) return access.res;

  const { error } = await supabaseAdmin.from("portfolio_positions").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
