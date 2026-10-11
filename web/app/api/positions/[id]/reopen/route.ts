import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { portfolioOfPosition, requireAccess } from "@/lib/auth";
import { updatePositionWithOptional } from "@/lib/optionalColumns";

// Undo a close: puts the position back to "open" and clears its exit
// price/time. The quote worker will pick it back up on its next tick.
// Automatic stop loss / target are switched off again: if the position was
// closed by one of them, its price is still past that level and it would just
// be closed again straight away. Switch them back on after adjusting the level.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const portfolioId = await portfolioOfPosition(params.id);
  if (portfolioId == null) return NextResponse.json({ error: "Position not found" }, { status: 404 });
  const access = await requireAccess(req, portfolioId);
  if (!access.ok) return access.res;

  // A part-sale (the closed row made when you sell part of a position) can't be
  // reopened: it would count the same contracts twice. Buy more of the position instead.
  const { data: pos } = await supabaseAdmin.from("portfolio_positions").select("*").eq("id", params.id).maybeSingle();
  if (pos?.parent_position_id) {
    return NextResponse.json(
      { error: "En delförsäljning kan inte öppnas igen. Använd Köp mer i den kvarvarande positionen." },
      { status: 409 }
    );
  }

  const { data, error } = await updatePositionWithOptional(
    params.id,
    { status: "open", exit_price: null, exit_time: null },
    { close_reason: null, auto_stop: false, auto_target: false }
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
