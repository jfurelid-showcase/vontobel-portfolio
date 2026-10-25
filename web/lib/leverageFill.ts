// Fyller i hävstången i kontraktslistan i admin medan man tittar på den.
//
// Sökningen levererar det som redan är känt (NGM:s lista för Bull/Bear, annars den senast sparade
// hävstången från Vontobel). Resten hämtas här i omgångar om 40 via /api/certificates/leverages och
// läggs in i listan allt eftersom, så att listan går att använda direkt och sortera på hävstång.
//
//   marknaden öppen   saknade och gamla (över 30 minuter) värden hämtas
//   marknaden stängd  det senast kända värdet används; bara kontrakt utan värde hämtas

export type LevSource = "ngm" | "vontobel" | null;
// status: "none" = Vontobel visar ingen hävstång för kontraktet, "error" = det gick inte att hämta just nu
export type LevStatus = "none" | "error" | null;
export type LevRow = { isin: string; leverage: number | null; leverage_at?: string | null; leverage_src?: LevSource; leverage_status?: LevStatus };
export type LevAnswer = { leverage: number | null; at: string | null; src: LevSource; fresh: boolean; status?: LevStatus };
export type LevReply = { results: Record<string, LevAnswer>; deferred?: string[] };

export const LEV_BATCH = 40;
export const LEV_FRESH_MIN = 30;

// Behöver kontraktet hämtas?
export function needsLeverage(r: LevRow, marketOpen: boolean, nowMs = Date.now()): boolean {
  if (r.leverage_src === "ngm") return false; // fast hävstång (Bull/Bear): ändras aldrig
  if (r.leverage == null) return true;
  if (!marketOpen) return false; // stängd marknad: det senast kända räcker
  if (!r.leverage_at) return false;
  return (nowMs - Date.parse(r.leverage_at)) / 60_000 > LEV_FRESH_MIN;
}

// Gammalt värde medan marknaden är öppen: visas dämpat tills det uppdaterats.
export function levIsStale(r: LevRow, marketOpen: boolean | null, nowMs = Date.now()): boolean {
  return marketOpen === true && r.leverage != null && needsLeverage(r, true, nowMs);
}

// 4.05x, 5x (högst två decimaler, punkt som i resten av tabellen). Alltid storleken: NGM anger hävstången
// för bear som negativ (−4), men riktningen står redan i kolumnen Dir.
export function fmtLev(v: number): string {
  return `${Number(Math.abs(v).toFixed(2))}x`;
}

export function levTitle(r: LevRow, marketOpen: boolean | null, pending: boolean): string {
  if (r.leverage != null) {
    if (r.leverage_src === "ngm") return "Hävstång enligt NGM:s produktlista.";
    const at = r.leverage_at
      ? new Date(r.leverage_at).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Stockholm" })
      : null;
    const base = `Hävstång enligt Vontobel${at ? `, hämtad ${at}` : ""}.`;
    if (marketOpen === false) return `${base} Marknaden är stängd: senast kända värde.`;
    if (levIsStale(r, marketOpen)) return `${base} Äldre än ${LEV_FRESH_MIN} minuter, uppdateras.`;
    return base;
  }
  if (pending) return "Hämtar hävstång…";
  if (r.leverage_status === "error") return "Det gick inte att hämta hävstången just nu. Sök igen om en stund.";
  if (r.leverage_status === "none") return "Vontobel visar ingen hävstång för det här kontraktet just nu (det kan vara utslaget eller sakna kurs).";
  return "Hävstång saknas.";
}

export type FillOptions = {
  isins: string[]; // i den ordning de ska hämtas (mest handlade först)
  post: (isins: string[]) => Promise<LevReply | null>;
  isCurrent: () => boolean; // false när en nyare sökning tagit över: då slutar vi utan att röra något
  onStart?: (isins: string[]) => void;
  onResult: (answers: Record<string, LevAnswer>) => void;
  onSettled: (isins: string[], failed: boolean) => void;
  batch?: number;
  maxDeferrals?: number; // hur många gånger ett kontrakt som inte hanns med (eller fick ett tillfälligt fel) frågas om
  retryDelayMs?: number; // paus innan de som ska frågas om tas, efter att resten är klart
};

export async function fillLeverage({ isins, post, isCurrent, onStart, onResult, onSettled, batch = LEV_BATCH, maxDeferrals = 3, retryDelayMs = 2000 }: FillOptions): Promise<void> {
  if (!isins.length) return;
  let queue = [...isins];
  let again: string[] = []; // de som ska frågas om: tas sist, efter en paus, så att ett tillfälligt fel hinner gå över
  const deferrals = new Map<string, number>();
  let failures = 0;
  onStart?.(isins);
  while (queue.length || again.length) {
    if (!queue.length) {
      await new Promise((r) => setTimeout(r, retryDelayMs));
      queue = again;
      again = [];
    }
    if (!isCurrent()) return;
    const chunk = queue.splice(0, batch);
    let reply: LevReply | null = null;
    try {
      reply = await post(chunk);
    } catch {
      reply = null;
    }
    if (!isCurrent()) return;
    if (!reply || typeof reply.results !== "object") {
      // Misslyckad omgång. Efter två i rad ger vi upp med resten (servern kan vara nere eller bromsa oss).
      failures++;
      onSettled(chunk, true);
      if (failures >= 2) {
        onSettled(queue.splice(0), true);
        return;
      }
      continue;
    }
    failures = 0;
    if (Object.keys(reply.results).length) onResult(reply.results);
    const deferred = new Set(reply.deferred ?? []);
    const retry: string[] = [];
    const done: string[] = [];
    for (const isin of chunk) {
      if (!deferred.has(isin)) { done.push(isin); continue; }
      const n = (deferrals.get(isin) ?? 0) + 1;
      deferrals.set(isin, n);
      if (n <= maxDeferrals) retry.push(isin); else done.push(isin);
    }
    onSettled(done, false);
    again.push(...retry);
  }
}
