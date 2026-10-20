import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Hävstång för ett certifikat, som Vontobel visar den på sin produktsida
// ("Hävstång" under nyckeltalen). NGM:s data saknar hävstång för mini futures
// och turbos, och Vontobels sida går inte att läsa direkt från webbläsaren, så
// den hämtas här på servern. Svaret cachas i fem minuter.
//   GET /api/certificates/leverage?isin=DE000VG9Z2S7
//   -> { leverage: 1.72, source: "vontobel" } eller { leverage: null }

function productUrl(name: string, isin: string) {
  const pre = name.trim().split(/\s+/)[0].toUpperCase();
  const type =
    pre === "BULL" || pre === "BEAR" ? "bull-bear-certifikat"
    : pre === "MFL" || pre === "MFS" ? "mini-futures"
    : "knock-out-warrants-open-end";
  return `https://markets.vontobel.com/sv-se/produkter/leverage/${type}/${encodeURIComponent(isin)}`;
}

function parseLeverage(html: string): number | null {
  const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  const m = text.match(/Hävstång:?\s+(\d{1,3}(?:[ .]\d{3})*(?:,\d+)?|\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const v = Number(m[1].replace(/[ .](?=\d{3}\b)/g, "").replace(",", "."));
  return isFinite(v) && v > 0 ? v : null;
}

export async function GET(req: NextRequest) {
  const isin = req.nextUrl.searchParams.get("isin");
  if (!isin) return NextResponse.json({ error: "isin is required" }, { status: 400 });

  const { data: cert } = await supabaseAdmin
    .from("certificates_full")
    .select("name, leverage")
    .eq("isin", isin)
    .maybeSingle();
  const name = cert?.name ?? req.nextUrl.searchParams.get("name") ?? "";

  try {
    const res = await fetch(productUrl(name, isin), {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SITG-portfolio/1.0)", "Accept-Language": "sv-SE,sv;q=0.9" },
      next: { revalidate: 300 },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const leverage = parseLeverage(await res.text());
    if (leverage != null) return NextResponse.json({ leverage, source: "vontobel" });
  } catch {
    // faller tillbaka på produktlistan nedan
  }
  // Reserv: hävstången i den dagliga produktlistan (finns för Bull/Bear).
  const fallback = cert?.leverage != null ? Number(cert.leverage) : null;
  return NextResponse.json({ leverage: fallback, source: fallback != null ? "ngm" : null });
}
