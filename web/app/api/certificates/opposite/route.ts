import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getLeverages } from "@/lib/vontobelLeverage";

// Produkt i motsatt riktning för ett certifikat, vald på Vontobels hävstång:
// samma underliggande, samma produkttyp, motsatt riktning (MFS<->MFL,
// BEAR<->BULL, TLNG<->TSRT/TSHO). Hävstången hämtas för ALLA kandidater
// (kurserna i produktlistan är ofta tomma eller gamla, så de duger inte till
// förurval), med cache i 30 minuter. Den vars hävstång ligger närmast
// certifikatets egen väljs.
//   GET /api/certificates/opposite?isin=DE000VG9Z2S7
//   GET /api/certificates/opposite?name=MFS%20MSFT%20VT259
//   -> { name, isin, leverage, ownLeverage }
// Felsökning: &debug=1 visar alla kandidater med hävstång, och
// &expect=MFL%20MSFT%20VT291 visar var en viss produkt hamnar.

export const maxDuration = 60;

const OPP: Record<string, string[]> = {
  MFS: ["MFL"], MFL: ["MFS"], BEAR: ["BULL"], BULL: ["BEAR"],
  TLNG: ["TSRT", "TSHO"], TSRT: ["TLNG"], TSHO: ["TLNG"],
};
const MAX_CANDIDATES = 400;
const prefixOf = (n: string) => String(n || "").trim().split(/\s+/)[0].toUpperCase();
type Row = { isin: string; name: string; underlying: string | null; turnover: number | null };

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const isinParam = sp.get("isin");
  const nameParam = sp.get("name");
  const debug = sp.get("debug") === "1";
  const expect = (sp.get("expect") || "").trim().toUpperCase();
  if (!isinParam && !nameParam) return NextResponse.json({ error: "isin or name is required" }, { status: 400 });

  const cols = "isin, name, underlying, turnover";
  const selfQ = supabaseAdmin.from("certificates_full").select(cols);
  const { data: self } = await (isinParam ? selfQ.eq("isin", isinParam) : selfQ.ilike("name", nameParam as string)).maybeSingle();
  if (!self) return NextResponse.json({ name: null, reason: "certifikatet finns inte i produktlistan" });
  const prefixes = OPP[prefixOf(self.name)];
  if (!prefixes) return NextResponse.json({ name: null, reason: "ingen motsvarande produkttyp" });

  let q = supabaseAdmin.from("certificates_full").select(cols).neq("isin", self.isin);
  q = self.underlying ? q.ilike("underlying", self.underlying) : q.ilike("name", `% ${self.name.split(/\s+/)[1] ?? ""} %`);
  const { data: all } = await q.limit(2000);
  const cands = ((all ?? []) as Row[])
    .filter((c) => prefixes.includes(prefixOf(c.name)))
    .sort((a, b) => (b.turnover ?? 0) - (a.turnover ?? 0))
    .slice(0, MAX_CANDIDATES);
  if (!cands.length) return NextResponse.json({ name: null, reason: "inga kandidater" });

  const levs = await getLeverages([self as Row, ...cands]);
  const ownLeverage = levs.get(self.isin) ?? null;

  let best: Row | null = null;
  if (ownLeverage != null) {
    for (const c of cands) {
      const l = levs.get(c.isin);
      if (l == null) continue;
      if (!best || Math.abs(l - ownLeverage) < Math.abs((levs.get(best.isin) as number) - ownLeverage)) best = c;
    }
  }
  const chosen = best ?? cands[0];
  const result: Record<string, unknown> = {
    name: chosen.name,
    isin: chosen.isin,
    leverage: best ? levs.get(best.isin) : null,
    ownLeverage,
    method: best ? "leverage" : "fallback-most-traded",
    candidatesTotal: cands.length,
    withLeverage: cands.filter((c) => levs.get(c.isin) != null).length,
  };
  if (debug) {
    result.self = { name: self.name, isin: self.isin, underlying: self.underlying, leverage: ownLeverage };
    result.closest = cands
      .map((c) => ({ name: c.name, isin: c.isin, leverage: levs.get(c.isin) ?? null }))
      .map((x) => ({ ...x, leverageDiff: x.leverage != null && ownLeverage != null ? Number(Math.abs(x.leverage - ownLeverage).toFixed(3)) : null }))
      .sort((a, b) => (a.leverageDiff ?? 1e9) - (b.leverageDiff ?? 1e9))
      .slice(0, 15);
    result.noLeverage = cands.filter((c) => levs.get(c.isin) == null).map((c) => c.name);
    if (expect) {
      const ex = cands.find((c) => c.name.toUpperCase() === expect);
      result.expected = ex ? { name: ex.name, leverage: levs.get(ex.isin) ?? null } : { name: expect, found: false };
    }
  }
  return NextResponse.json(result);
}
