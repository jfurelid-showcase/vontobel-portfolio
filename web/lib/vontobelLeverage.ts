// Hävstång från Vontobels produktsida ("Hävstång" under nyckeltalen).
// Används av /api/certificates/leverage och /api/certificates/opposite.

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

export async function fetchVontobelLeverage(name: string, isin: string): Promise<number | null> {
  try {
    const res = await fetch(vontobelProductUrl(name, isin), {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SITG-portfolio/1.0)", "Accept-Language": "sv-SE,sv;q=0.9" },
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    return parseLeverage(await res.text());
  } catch {
    return null;
  }
}
