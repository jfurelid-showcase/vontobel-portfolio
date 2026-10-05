import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { portfolioIdFrom, requireAccess } from "@/lib/auth";
import { isCountryCode } from "@/lib/countries";
import { MAX_VISIBLE_LENGTH, RAW_MAX_LENGTH, visibleLength } from "@/lib/traderStyle";

const BUCKET = "trader-photos";
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

// Body: multipart/form-data with optional "photo" (file), "name", and/or
// "level" ("noob" | "intermediate" | "pro"), and/or "style" (short free-text
// description of the trader's trading style, max 160 visible chars, may contain
// links). Stored on the single
// portfolio_settings row (id=1) — per-portfolio, not per-position.
export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const portfolioId = portfolioIdFrom(formData.get("portfolio_id") as string | null);
  if (portfolioId == null) return NextResponse.json({ error: "Ogiltigt portfolio_id" }, { status: 400 });
  const access = await requireAccess(req, portfolioId);
  if (!access.ok) return access.res;

  const file = formData.get("photo") as File | null;
  const level = formData.get("level") as string | null;
  const name = formData.get("name") as string | null;
  const style = formData.get("style") as string | null;
  const country = formData.get("country") as string | null;

  if (level && !["noob", "intermediate", "pro"].includes(level)) {
    return NextResponse.json({ error: "Invalid level" }, { status: 400 });
  }

  if (style != null) {
    const trimmed = style.trim();
    if (trimmed.length > RAW_MAX_LENGTH) {
      return NextResponse.json({ error: "Tradingstil är för lång" }, { status: 400 });
    }
    // Links count as their visible label, not their URL.
    if (visibleLength(trimmed) > MAX_VISIBLE_LENGTH) {
      return NextResponse.json({ error: `Tradingstil får vara max ${MAX_VISIBLE_LENGTH} synliga tecken` }, { status: 400 });
    }
  }

  // "" clears the country; anything else must be a real ISO 3166-1 alpha-2 code.
  const countryCode = country != null ? country.trim().toUpperCase() : null;
  if (countryCode && !isCountryCode(countryCode)) {
    return NextResponse.json({ error: "Ogiltigt land" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (level) updates.trader_level = level;
  if (name != null) updates.trader_name = name.trim() || null;
  if (style != null) updates.trader_style = style.trim() || null;
  if (countryCode != null) updates.trader_country = countryCode || null;

  if (file && file.size > 0) {
    // Guests can upload too, into a public bucket: accept real image types
    // only, cap the size, and build the storage name from a fixed list rather
    // than from whatever the uploaded file happens to be called.
    const ext = IMAGE_TYPES[file.type];
    if (!ext) {
      return NextResponse.json({ error: "Bilden måste vara JPG, PNG, WebP eller GIF." }, { status: 400 });
    }
    if (file.size > MAX_PHOTO_BYTES) {
      return NextResponse.json({ error: "Bilden får vara max 5 MB." }, { status: 400 });
    }
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    // Each portfolio has its own photo file (the owner keeps the original name).
    const path = portfolioId === 1 ? `trader.${ext}` : `trader-${portfolioId}.${ext}`;

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
    .eq("id", portfolioId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
