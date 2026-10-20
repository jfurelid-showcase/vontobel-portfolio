import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchVontobelLeverage } from "@/lib/vontobelLeverage";

// Produkt i motsatt riktning för ett certifikat, vald på Vontobels hävstång:
// samma underliggande, samma produkttyp, motsatt riktning (MFS<->MFL,
// BEAR<->BULL, TLNG<->TSRT/TSHO). Förurval på kurs (15 närmast), sedan väljs
// den vars hävstång ligger närmast certifikatets egen.
//   GET /api/certificates/opposite?isin=DE000VG9Z2S7
//   -> { name, isin, leverage, ownLeverage } eller { name: null }

const OPP: Record<string, string[]> = {
  MFS: ["MFL"], MFL: ["MFS"], BEAR: ["BULL"], BULL: ["BEAR"],
  TLNG: ["TSRT", "TSHO"], TSRT: ["TLNG"], TSHO: ["TLNG"],
};
const prefixOf = (n: string) => String(n || "").trim().split(/\s+/)[0].toUpperCase();
type Row = { isin: string; name: string; underlying: string | null; last_price: number | null; buy_price: number | null; sell_price: number | null; turnover: number | null };
const px = (r?: Partial<Row> | null) => {
  if (!r) return null;
  const v = r.last_price ?? (r.buy_price != null && r.sell_price != null ? (Number(r.buy_price) + Number(r.sell_price)) / 2 : r.sell_price ?? r.buy_price);
  return v != null && Number(v) > 0 ? Number(v) : null;
};

export async function GET(req: NextRequest) {
  const isin = req.nextUrl.searchParams.get("isin");
  if (!isin) return NextResponse.json({ error: "isin is required" }, { status: 400 });

  const { data: self } = await supabaseAdmin
    .from("certificates_full")
    .select("isin, name, underlying, last_price, buy_price, sell_price, turnover")
    .eq("isin", isin)
    .maybeSingle();
  if (!self) return NextResponse.json({ name: null });
  const prefixes = OPP[prefixOf(self.name)];
  if (!prefixes) return NextResponse.json({ name: null });

  let q = supabaseAdmin
    .from("certificates_full")
    .select("isin, name, underlying, last_price, buy_price, sell_price, turnover")
    .neq("isin", isin);
  q = self.underlying ? q.ilike("underlying", self.underlying) : q.ilike("name", `% ${self.name.split(/\s+/)[1] ?? ""} %`);
  const { data: all } = await q.limit(1000);
  const cands = ((all ?? []) as Row[]).filter((c) => prefixes.includes(prefixOf(c.name)));
  if (!cands.length) return NextResponse.json({ name: null });

  const selfPx = px(self as Row);
  const ranked = cands
    .map((c) => ({ c, d: selfPx && px(c) ? Math.abs(Math.log((px(c) as number) / selfPx)) : Infinity }))
    .sort((a, b) => a.d - b.d || (b.c.turnover ?? 0) - (a.c.turnover ?? 0))
    .slice(0, 15)
    .map((x) => x.c);

  const [ownLeverage, ...levs] = await Promise.all([
    fetchVontobelLeverage(self.name, self.isin),
    ...ranked.map((c) => fetchVontobelLeverage(c.name, c.isin)),
  ]);

  let best: { c: Row; lev: number } | null = null;
  if (ownLeverage != null) {
    ranked.forEach((c, i) => {
      const lev = levs[i];
      if (lev == null) return;
      if (!best || Math.abs(lev - ownLeverage) < Math.abs(best.lev - ownLeverage)) best = { c, lev };
    });
  }
  const chosen: Row = best ? (best as { c: Row; lev: number }).c : ranked[0];
  return NextResponse.json({
    name: chosen.name,
    isin: chosen.isin,
    leverage: best ? (best as { c: Row; lev: number }).lev : null,
    ownLeverage,
  });
}
