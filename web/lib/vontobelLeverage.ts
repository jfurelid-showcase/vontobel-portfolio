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
  if (fetched.length) {
    try { await supabaseAdmin.from("vontobel_leverage_cache").upsert(fetched, { onConflict: "isin" }); } catch {}
  }
  return out;
}
