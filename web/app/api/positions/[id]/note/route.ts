import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { note, podcast_episode } = await req.json();

  const { data, error } = await supabaseAdmin
    .from("portfolio_positions")
    .update({ note, podcast_episode })
    .eq("id", params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
