import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const BUCKET = "trader-photos";

// Body: multipart/form-data with optional "photo" (file), "name", and/or
// "level" ("noob" | "intermediate" | "pro"). Stored on the single
// portfolio_settings row (id=1) — per-portfolio, not per-position.
export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("photo") as File | null;
  const level = formData.get("level") as string | null;
  const name = formData.get("name") as string | null;

  if (level && !["noob", "intermediate", "pro"].includes(level)) {
    return NextResponse.json({ error: "Invalid level" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (level) updates.trader_level = level;
  if (name != null) updates.trader_name = name.trim() || null;

  if (file && file.size > 0) {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const ext = file.name.split(".").pop() || "jpg";
    const path = `trader.${ext}`;

    const { error: uploadErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: file.type, upsert: true });

    if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 });

    const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
    updates.trader_photo_url = `${pub.publicUrl}?t=${Date.now()}`;
  }

  const { data, error } = await supabaseAdmin
    .from("portfolio_settings")
    .update(updates)
    .eq("id", 1)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
