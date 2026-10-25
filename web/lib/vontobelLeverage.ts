import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Hävstång från Vontobels produktsida ("Hävstång" under nyckeltalen).
// Används av /api/certificates/leverage och /api/certificates/opposite.
// Resultaten sparas i tabellen vontobel_leverage_cache (0013) i 30 minuter, så
// att samma sidor inte hämtas om och om igen.

export function vontobelProductUrl(name: string, isin: string) {
  const pre = name.trim().split(/\s+/)[0].toUpperCase();
  const type =
    pre === "BULL" || pre === "BEAR" ? "bull-bear-certifikat"
    : pre === "MFL" || pre === "MFS" ? "mini-futures"
    : "knock-out-warrants-open-end";
  return `https://markets.vontobel.com/sv-se/produkter/leverage/${type}/${encodeURIComponent(isin)}`;
}

export function parseLeverage(html: string): number | null {
  const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  const m = text.match(/Hävstång:?\s+(\d{1,3}(?:[ .]\d{3})*(?:,\d+)?|\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const v = Number(m[1].replace(/[ .](?=\d{3}\b)/g, "").replace(",", "."));
  return isFinite(v) && v > 0 ? v : null;
}

export async function fetchVontobelLeverage(name: string, isin: string, attempt = 1): Promise<number | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(vontobelProductUrl(name, isin), {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SITG-portfolio/1.0)", "Accept-Language": "sv-SE,sv;q=0.9" },
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseLeverage(await res.text());
  } catch {
    // Ett nytt försök vid tillfälligt fel (t.ex. för många samtidiga anrop).
    if (attempt < 2) { await new Promise((r) => setTimeout(r, 600)); return fetchVontobelLeverage(name, isin, attempt + 1); }
    return null;
  }
}

// Hävstång för många produkter: först från cachetabellen, resten hämtas från
// Vontobel (högst `concurrency` åt gången) och sparas i cachen.
export async function getLeverages(
  rows: { isin: string; name: string }[],
  { maxAgeMin = 30, concurrency = 6 }: { maxAgeMin?: number; concurrency?: number } = {},
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  if (!rows.length) return out;
  const since = new Date(Date.now() - maxAgeMin * 60_000).toISOString();
  try {
    const { data } = await supabaseAdmin
      .from("vontobel_leverage_cache")
      .select("isin, leverage")
      .in("isin", rows.map((r) => r.isin))
      .gte("fetched_at", since)
      .not("leverage", "is", null);
    (data ?? []).forEach((r: { isin: string; leverage: number | null }) => out.set(r.isin, r.leverage != null ? Number(r.leverage) : null));
  } catch {
    // utan cachetabell fungerar det ändå, bara långsammare
  }
  const todo = rows.filter((r) => !out.has(r.isin));
  let i = 0;
  const fetched: { isin: string; leverage: number | null; fetched_at: string }[] = [];
  const worker = async () => {
    while (i < todo.length) {
      const r = todo[i++];
      const lev = await fetchVontobelLeverage(r.name, r.isin);
      out.set(r.isin, lev);
      fetched.push({ isin: r.isin, leverage: lev, fetched_at: new Date().toISOString() });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
  // Bara riktiga värden sparas: ett misslyckat försök (null) får inte skriva över en hävstång som redan är känd.
  const toSave = fetched.filter((f) => f.leverage != null);
  if (toSave.length) {
    try { await supabaseAdmin.from("vontobel_leverage_cache").upsert(toSave, { onConflict: "isin" }); } catch {}
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hävstång i kontraktslistan i admin
//
// NGM:s lista har hävstång bara för Bull/Bear. För mini futures och turbos läses den
// från Vontobels produktsida och sparas i vontobel_leverage_cache. Listan visar alltid
// den SENAST KÄNDA hävstången:
//   marknaden öppen   värden äldre än 30 minuter hämtas om
//   marknaden stängd  ett känt värde används som det är (oavsett hur gammalt) och
//                     hämtas inte om; bara kontrakt utan något känt värde hämtas
// Ett misslyckat försök skriver aldrig över ett känt värde.
// ---------------------------------------------------------------------------

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;
export const isIsin = (s: unknown): s is string => typeof s === "string" && ISIN_RE.test(s);

export type LevSource = "ngm" | "vontobel" | null;
export type LevInfo = { leverage: number | null; at: string | null; src: LevSource; fresh: boolean };
export type CachedLeverage = { isin: string; leverage: number | null; fetched_at: string };

// Allt som finns sparat för de här ISIN-numren, oavsett ålder. Utan cachetabellen blir svaret tomt.
export async function readCachedLeverages(isins: string[]): Promise<Map<string, CachedLeverage>> {
  const out = new Map<string, CachedLeverage>();
  const chunks: string[][] = [];
  for (let i = 0; i < isins.length; i += 100) chunks.push(isins.slice(i, i + 100)); // korta adresser
  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const { data, error } = await supabaseAdmin.from("vontobel_leverage_cache").select("isin, leverage, fetched_at").in("isin", chunk);
        if (error) return;
        (data ?? []).forEach((r: { isin: string; leverage: number | string | null; fetched_at: string }) =>
          out.set(r.isin, { isin: r.isin, leverage: r.leverage != null ? Number(r.leverage) : null, fetched_at: r.fetched_at }),
        );
      } catch {
        // utan cachetabell fungerar det ändå
      }
    }),
  );
  return out;
}

export type LatestOptions = {
  marketOpen: boolean;
  maxAgeMin?: number;    // öppen marknad: äldre värden hämtas om
  concurrency?: number;
  budgetMs?: number;     // efter så här lång tid startas inga fler hämtningar (resten lämnas till nästa anrop)
  now?: number;
  fetcher?: (name: string, isin: string) => Promise<number | null>;
};

export async function getLatestLeverages(
  rows: { isin: string; name: string }[],
  { marketOpen, maxAgeMin = 30, concurrency = 6, budgetMs = 20_000, now = Date.now(), fetcher = fetchVontobelLeverage }: LatestOptions,
): Promise<{ results: Map<string, LevInfo>; deferred: string[] }> {
  const results = new Map<string, LevInfo>();
  const cached = await readCachedLeverages(rows.map((r) => r.isin));
  const ageMin = (iso: string) => (now - new Date(iso).getTime()) / 60_000;
  const nullRetryMin = marketOpen ? 10 : 360; // hur länge ett försök som inte gav något räknas
  const todo: { isin: string; name: string }[] = [];

  for (const r of rows) {
    const c = cached.get(r.isin);
    if (c && c.leverage != null) {
      const fresh = !marketOpen || ageMin(c.fetched_at) <= maxAgeMin;
      results.set(r.isin, { leverage: c.leverage, at: c.fetched_at, src: "vontobel", fresh });
      if (!fresh) todo.push(r); // bara när marknaden är öppen kan ett värde vara "gammalt"
    } else {
      results.set(r.isin, { leverage: null, at: null, src: null, fresh: false });
      if (!(c && ageMin(c.fetched_at) < nullRetryMin)) todo.push(r); // inget känt värde: försök, om inte nyss prövat
    }
  }

  const deadline = Date.now() + budgetMs;
  const save: CachedLeverage[] = [];
  const nowIso = new Date(now).toISOString();
  const deferred: string[] = [];
  let i = 0;
  const worker = async () => {
    while (i < todo.length) {
      const r = todo[i++];
      if (Date.now() > deadline) { deferred.push(r.isin); continue; }
      const lev = await fetcher(r.name, r.isin);
      const had = results.get(r.isin)!;
      if (lev != null) {
        results.set(r.isin, { leverage: lev, at: nowIso, src: "vontobel", fresh: true });
        save.push({ isin: r.isin, leverage: lev, fetched_at: nowIso });
      } else if (had.leverage == null) {
        save.push({ isin: r.isin, leverage: null, fetched_at: nowIso }); // "provade, hittade inget"
      } // annars: behåll det kända värdet, orört
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));

  if (save.length) {
    try { await supabaseAdmin.from("vontobel_leverage_cache").upsert(save, { onConflict: "isin" }); } catch {}
  }
  return { results, deferred };
}

// Lägger den hävstång som redan är känd (NGM:s lista eller cachen) på sökresultatet.
export async function withKnownLeverage<T extends { isin: string; leverage: number | null }>(
  rows: T[],
): Promise<(T & { leverage_at: string | null; leverage_src: LevSource })[]> {
  const cache = await readCachedLeverages(rows.filter((r) => r.leverage == null).map((r) => r.isin));
  return rows.map((r) => {
    if (r.leverage != null) return { ...r, leverage_at: null, leverage_src: "ngm" as const };
    const c = cache.get(r.isin);
    if (c && c.leverage != null) return { ...r, leverage: c.leverage, leverage_at: c.fetched_at, leverage_src: "vontobel" as const };
    return { ...r, leverage_at: null, leverage_src: null };
  });
}
