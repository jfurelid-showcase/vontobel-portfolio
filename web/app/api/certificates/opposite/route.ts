import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchVontobelLeverage } from "@/lib/vontobelLeverage";

// Produkt i motsatt riktning för ett certifikat, vald på Vontobels hävstång:
// samma underliggande, samma produkttyp, motsatt riktning (MFS<->MFL,
// BEAR<->BULL, TLNG<->TSRT/TSHO). Den vars hävstång ligger närmast
// certifikatets egen väljs.
//
// Hur kandidaterna väljs ut (hävstång måste hämtas från Vontobel en i taget):
// för mini futures/turbos gäller hävstång ≈ k / kurs, där k = underliggande /
// kvot är samma för alla produkter med samma kvot. Steg 1 kontrollerar de 20
// närmast i kurs plus ett jämnt urval över hela kursintervallet och räknar ut k. Steg 2: för varje k (kvotgrupp) räknas
// den kurs fram som ger samma hävstång som positionen, och de 8 kandidater som
// ligger närmast den kursen kontrolleras. På så vis hittas rätt produkt även
// när Vontobel använder olika kvoter för samma underliggande.
//   GET /api/certificates/opposite?isin=DE000VG9Z2S7
//   GET /api/certificates/opposite?name=MFS%20MSFT%20VT259
//   -> { name, isin, leverage, ownLeverage }
// Felsökning: lägg till &debug=1 för att se alla kandidater med kurs och
// hävstång, och &expect=MFL%20MSFT%20VT291 för att se var en viss produkt hamnar.

export const maxDuration = 30;

const OPP: Record<string, string[]> = {
  MFS: ["MFL"], MFL: ["MFS"], BEAR: ["BULL"], BULL: ["BEAR"],
  TLNG: ["TSRT", "TSHO"], TSRT: ["TLNG"], TSHO: ["TLNG"],
};
const STAGE1 = 20;
const STAGE2_PER_GROUP = 8;
const prefixOf = (n: string) => String(n || "").trim().split(/\s+/)[0].toUpperCase();
type Row = { isin: string; name: string; underlying: string | null; last_price: number | null; buy_price: number | null; sell_price: number | null; turnover: number | null };
const px = (r?: Partial<Row> | null) => {
  if (!r) return null;
  const v = r.last_price ?? (r.buy_price != null && r.sell_price != null ? (Number(r.buy_price) + Number(r.sell_price)) / 2 : r.sell_price ?? r.buy_price);
  return v != null && Number(v) > 0 ? Number(v) : null;
};

// Hämtar hävstång för många produkter, högst 10 åt gången.
async function leverages(rows: Row[]): Promise<(number | null)[]> {
  const out: (number | null)[] = new Array(rows.length).fill(null);
  let i = 0;
  const worker = async () => {
    while (i < rows.length) {
      const k = i++;
      out[k] = await fetchVontobelLeverage(rows[k].name, rows[k].isin);
    }
  };
  await Promise.all(Array.from({ length: Math.min(10, rows.length) }, worker));
  return out;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const isinParam = sp.get("isin");
  const nameParam = sp.get("name");
  const debug = sp.get("debug") === "1";
  const expect = (sp.get("expect") || "").trim().toUpperCase();
  if (!isinParam && !nameParam) return NextResponse.json({ error: "isin or name is required" }, { status: 400 });

  const cols = "isin, name, underlying, last_price, buy_price, sell_price, turnover";
  const selfQ = supabaseAdmin.from("certificates_full").select(cols);
  const { data: self } = await (isinParam ? selfQ.eq("isin", isinParam) : selfQ.ilike("name", nameParam as string)).maybeSingle();
  if (!self) return NextResponse.json({ name: null, reason: "certifikatet finns inte i produktlistan" });
  const prefixes = OPP[prefixOf(self.name)];
  if (!prefixes) return NextResponse.json({ name: null, reason: "ingen motsvarande produkttyp" });

  let q = supabaseAdmin.from("certificates_full").select(cols).neq("isin", self.isin);
  q = self.underlying ? q.ilike("underlying", self.underlying) : q.ilike("name", `% ${self.name.split(/\s+/)[1] ?? ""} %`);
  const { data: all } = await q.limit(1000);
  const cands = ((all ?? []) as Row[]).filter((c) => prefixes.includes(prefixOf(c.name)));
  if (!cands.length) return NextResponse.json({ name: null, reason: "inga kandidater" });

  const selfPx = px(self as Row);
  const sorted = cands
    .map((c) => ({ c, d: selfPx && px(c) ? Math.abs(Math.log((px(c) as number) / selfPx)) : Infinity }))
    .sort((a, b) => a.d - b.d || (b.c.turnover ?? 0) - (a.c.turnover ?? 0))
    .map((x) => x.c);

  const levOf = new Map<string, number | null>();
  const ownLeveragePromise = fetchVontobelLeverage(self.name, self.isin);
  const check = async (rows: Row[]) => {
    const todo = rows.filter((r) => !levOf.has(r.isin));
    const levs = await leverages(todo);
    todo.forEach((r, i) => levOf.set(r.isin, levs[i]));
  };

  // Steg 1: närmast i kurs, plus ett jämnt urval över hela kursintervallet så att
  // alla kvotgrupper upptäcks (och en förväntad produkt i felsökningsläget).
  const stage1 = sorted.slice(0, STAGE1);
  const byPrice = cands.filter((c) => px(c)).sort((a, b) => (px(a) as number) - (px(b) as number));
  const SPREAD = 10;
  for (let i = 0; i < SPREAD && byPrice.length; i++) {
    const c = byPrice[Math.round((i * (byPrice.length - 1)) / Math.max(1, SPREAD - 1))];
    if (!stage1.includes(c)) stage1.push(c);
  }
  if (debug && expect) {
    const ex = sorted.find((c) => c.name.toUpperCase() === expect);
    if (ex && !stage1.includes(ex)) stage1.push(ex);
  }
  const [ownLeverage] = await Promise.all([ownLeveragePromise, check(stage1)]);

  // Steg 2: en sökning per kvotgrupp (k = hävstång × kurs).
  if (ownLeverage != null) {
    const ks = stage1
      .map((c) => { const l = levOf.get(c.isin); const p = px(c); return l != null && p ? l * p : null; })
      .filter((k): k is number => k != null)
      .sort((a, b) => a - b);
    const groups: number[] = [];
    ks.forEach((k) => { if (!groups.length || k / groups[groups.length - 1] > 1.05) groups.push(k); });
    const extra: Row[] = [];
    for (const k of groups) {
      const target = k / ownLeverage; // kursen som ger samma hävstång i den gruppen
      sorted
        .filter((c) => !levOf.has(c.isin) && !extra.includes(c) && px(c))
        .map((c) => ({ c, d: Math.abs(Math.log((px(c) as number) / target)) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, STAGE2_PER_GROUP)
        .forEach((x) => extra.push(x.c));
    }
    await check(extra);
  }

  const ranked = sorted.filter((c) => levOf.has(c.isin));
  let bestIdx = -1;
  if (ownLeverage != null) {
    ranked.forEach((c, i) => {
      const lev = levOf.get(c.isin);
      if (lev == null) return;
      if (bestIdx < 0 || Math.abs(lev - ownLeverage) < Math.abs((levOf.get(ranked[bestIdx].isin) as number) - ownLeverage)) bestIdx = i;
    });
  }
  const levs = ranked.map((c) => levOf.get(c.isin) ?? null);
  const chosen = bestIdx >= 0 ? ranked[bestIdx] : sorted[0];
  const result: Record<string, unknown> = {
    name: chosen.name,
    isin: chosen.isin,
    leverage: bestIdx >= 0 ? levs[bestIdx] : null,
    ownLeverage,
    method: bestIdx >= 0 ? "leverage" : "price-fallback",
    checked: ranked.length,
  };

  if (debug) {
    result.self = { name: self.name, isin: self.isin, underlying: self.underlying, price: selfPx, leverage: ownLeverage };
    result.candidatesTotal = cands.length;
    result.checkedList = ranked.map((c, i) => ({
      name: c.name,
      isin: c.isin,
      price: px(c),
      leverage: levs[i],
      leverageDiff: levs[i] != null && ownLeverage != null ? Number(Math.abs((levs[i] as number) - ownLeverage).toFixed(3)) : null,
      priceRank: sorted.indexOf(c) + 1,
      chosen: c === chosen,
    })).sort((a, b) => (a.leverageDiff ?? 1e9) - (b.leverageDiff ?? 1e9));
    if (expect) {
      const ex = sorted.find((c) => c.name.toUpperCase() === expect);
      result.expected = ex
        ? { name: ex.name, priceRank: sorted.indexOf(ex) + 1, checked: levOf.has(ex.isin), leverage: levOf.get(ex.isin) ?? null }
        : { name: expect, found: false, note: "finns inte bland kandidaterna (fel underliggande eller saknas i produktlistan)" };
    }
  }
  return NextResponse.json(result);
}
