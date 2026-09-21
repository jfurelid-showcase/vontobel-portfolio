import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Undo a close: puts the position back to "open" and clears its exit
// price/time. The quote worker will pick it back up on its next tick.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { data, error } = await supabaseAdmin
    .from("portfolio_positions")
    .update({ status: "open", exit_price: null, exit_time: null })
    .eq("id", params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
