// Länk till ett certifikats produktsida hos Vontobel (svenska sidan).
// Typen avgörs av namnets prefix: BULL/BEAR, MFL/MFS (mini futures),
// TLNG/TSRT/TSHO (turbos). Utan ISIN används Vontobels sökning på namnet.
export function vontobelUrl(name: string, isin?: string | null) {
  const pre = String(name || "").trim().split(/\s+/)[0].toUpperCase();
  const type =
    pre === "BULL" || pre === "BEAR" ? "bull-bear-certifikat"
    : pre === "MFL" || pre === "MFS" ? "mini-futures"
    : pre === "TLNG" || pre === "TSRT" || pre === "TSHO" ? "knock-out-warrants-open-end"
    : "";
  if (type && isin) return `https://markets.vontobel.com/sv-se/produkter/leverage/${type}/${encodeURIComponent(isin)}`;
  return `https://markets.vontobel.com/sv-se/sok-resultat?q=${encodeURIComponent(String(name || "").trim())}`;
}
