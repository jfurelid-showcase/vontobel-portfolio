import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { portfolioOfPosition, requireAccess } from "@/lib/auth";
import { validateAuto } from "@/lib/autoClose";
import { isMissingColumn } from "@/lib/optionalColumns";

// Equal as numbers (an unset value equals another unset value).
function sameNumber(a: unknown, b: unknown): boolean {
  const na = a == null || a === "" ? null : Number(a);
  const nb = b == null || b === "" ? null : Number(b);
  if (na == null || nb == null) return na == null && nb == null;
  return Number.isFinite(na) && Number.isFinite(nb) && Math.abs(na - nb) < 1e-9;
}

// PATCH: edit a position's editable fields (works for open or closed
// positions — adjusting stop/target, the note ...).
// Body: any subset of { stop_loss, target_price, note,
//                        podcast_episode, auto_stop, auto_target }
//
// The QUANTITY can't be edited either: it changes only by buying more (Köp mer) or
// selling part (Sälj del), which keep the GAV and the profit/loss correct.
//
// The ENTRY and EXIT prices can't be edited: the entry is always the ask at
// the moment the position was added, the exit always the bid at the moment it
// was closed. A request that tries to change either is refused (one that
// merely repeats the stored value is accepted and ignored).
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

  // Entry price, exit price and quantity are locked (see above).
  if ("entry_price" in updates || "exit_price" in updates || "quantity" in updates) {
    const { data: stored, error: storedErr } = await supabaseAdmin
      .from("portfolio_positions")
      .select("entry_price, exit_price, quantity")
      .eq("id", params.id)
      .single();
    if (storedErr || !stored) return NextResponse.json({ error: "Position not found" }, { status: 404 });
    if ("quantity" in updates) {
      if (!sameNumber(updates.quantity, stored.quantity)) {
        return NextResponse.json(
          { error: "Antalet kan inte ändras här. Använd Köp mer eller Sälj del, så räknas GAV och resultat rätt." },
          { status: 400 }
        );
      }
      delete updates.quantity;
    }
    if ("entry_price" in updates) {
      if (!sameNumber(updates.entry_price, stored.entry_price)) {
        return NextResponse.json(
          { error: "Ingångskursen kan inte ändras. Den sätts alltid till köpkursen (ask) när positionen läggs till." },
          { status: 400 }
        );
      }
      delete updates.entry_price;
    }
    if ("exit_price" in updates) {
      if (!sameNumber(updates.exit_price, stored.exit_price)) {
        return NextResponse.json(
          { error: "Utgångskursen kan inte ändras. Den sätts alltid till säljkursen (bid) när positionen stängs." },
          { status: 400 }
        );
      }
      delete updates.exit_price;
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

  // Nothing left to change (the request only repeated locked values that are unchanged):
  // that is not an error, the position is simply as it should be.
  if (Object.keys(updates).length === 0) {
    const { data: current } = await supabaseAdmin.from("portfolio_positions").select("*").eq("id", params.id).single();
    if (!current) return NextResponse.json({ error: "Position not found" }, { status: 404 });
    return NextResponse.json(current);
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
