import { NextRequest, NextResponse } from "next/server";
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

  const { data, error } = await updatePositionWithOptional(
    params.id,
    { status: "open", exit_price: null, exit_time: null },
    { close_reason: null, auto_stop: false, auto_target: false }
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
