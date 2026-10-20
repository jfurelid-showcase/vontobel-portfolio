import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchVontobelLeverage } from "@/lib/vontobelLeverage";

// Hävstång för ett certifikat, som Vontobel visar den på sin produktsida.
// NGM:s data saknar hävstång för mini futures och turbos, och Vontobels sida går
// inte att läsa direkt från webbläsaren, så den hämtas här på servern.
//   GET /api/certificates/leverage?isin=DE000VG9Z2S7
//   -> { leverage: 1.72, source: "vontobel" } eller { leverage: null }
export async function GET(req: NextRequest) {
  const isin = req.nextUrl.searchParams.get("isin");
  if (!isin) return NextResponse.json({ error: "isin is required" }, { status: 400 });

  const { data: cert } = await supabaseAdmin
    .from("certificates_full")
    .select("name, leverage")
    .eq("isin", isin)
    .maybeSingle();
  const name = cert?.name ?? req.nextUrl.searchParams.get("name") ?? "";

  const leverage = await fetchVontobelLeverage(name, isin);
  if (leverage != null) return NextResponse.json({ leverage, source: "vontobel" });
  // Reserv: hävstången i den dagliga produktlistan (finns för Bull/Bear).
  const fallback = cert?.leverage != null ? Number(cert.leverage) : null;
  return NextResponse.json({ leverage: fallback, source: fallback != null ? "ngm" : null });
}
