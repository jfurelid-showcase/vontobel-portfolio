import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getLatestLeverages, isIsin, type LevInfo } from "@/lib/vontobelLeverage";
import { isMarketOpen } from "@/lib/marketHours";

export const dynamic = "force-dynamic";
export const maxDuration = 30; // en omgång om 40 kontrakt tar några sekunder

const MAX_BATCH = 40;

// Enkel broms per adress, så att rutten inte kan användas för att belasta Vontobel i onödan.
// (I minnet, alltså per serverinstans. Varje kontrakt hämtas ändå högst en gång per 30 minuter.)
const hits = new Map<string, number[]>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_CALLS = 300;
function tooMany(req: NextRequest): boolean {
  const key = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > MAX_CALLS;
}

// POST { isins: ["DE000...", ...] }  (högst 40)
// -> { marketOpen, results: { [isin]: { leverage, at, src, fresh, status } }, deferred: [isin, ...] }
//    status: null = värde finns, "none" = Vontobel visar ingen hävstång, "error" = kunde inte hämta just nu
//
// Hävstången för kontrakten i sökresultatet i admin. Den senast kända visas alltid:
//   marknaden öppen   värden äldre än 30 minuter hämtas om från Vontobel
//   marknaden stängd  ett känt värde används som det är, bara kontrakt utan värde hämtas
// `deferred` är kontrakt som inte hanns med eller som det blev tillfälligt fel för; be om dem igen.
export async function POST(req: NextRequest) {
  if (tooMany(req)) return NextResponse.json({ error: "För många anrop. Vänta en stund." }, { status: 429 });

  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.isins)) return NextResponse.json({ error: "isins must be a list" }, { status: 400 });
  const isins = [...new Set((body.isins as unknown[]).filter(isIsin))];
  if (!isins.length) return NextResponse.json({ error: "no valid ISIN" }, { status: 400 });
  if (isins.length > MAX_BATCH) return NextResponse.json({ error: `at most ${MAX_BATCH} at a time` }, { status: 400 });

  // Bara kontrakt som finns i listan hämtas, och sidan som läses byggs av det sparade namnet: rutten kan
  // alltså inte användas för att hämta andra adresser.
  const { data: certs, error } = await supabaseAdmin.from("certificates_full").select("isin, name, leverage").in("isin", isins);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const byIsin = new Map((certs ?? []).map((c: { isin: string; name: string; leverage: number | string | null }) => [c.isin, c]));

  const marketOpen = isMarketOpen();
  const results: Record<string, LevInfo> = {};
  const toFetch: { isin: string; name: string }[] = [];
  for (const isin of isins) {
    const c = byIsin.get(isin);
    if (!c) results[isin] = { leverage: null, at: null, src: null, fresh: false, status: "none" };
    else if (c.leverage != null) results[isin] = { leverage: Math.abs(Number(c.leverage)), at: null, src: "ngm", fresh: true, status: null }; // Bull/Bear: fast hävstång i NGM:s lista (bear är negativ där: vi visar storleken)
    else toFetch.push({ isin, name: c.name });
  }

  const { results: got, deferred } = await getLatestLeverages(toFetch, { marketOpen });
  got.forEach((v, k) => { results[k] = v; });
  return NextResponse.json({ marketOpen, results, deferred }, { headers: { "Cache-Control": "no-store" } });
}
