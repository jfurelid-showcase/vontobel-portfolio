export type NavPoint = { ts: string; nav: number };

// Given the full nav_history (ascending by ts) and the latest nav, find the
// % change since the closest snapshot at/after a given cutoff time.
export function pctChangeSince(history: NavPoint[], latestNav: number, cutoff: Date): number | null {
  const ref = history.find((p) => new Date(p.ts) >= cutoff);
  if (!ref || ref.nav === 0) return null;
  return ((latestNav - ref.nav) / ref.nav) * 100;
}

export function startOfDayStockholm(d = new Date()): Date {
  // Approximate Europe/Stockholm midnight by formatting in that timezone
  // and reparsing — avoids pulling in a date library for one calculation.
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const day = parts.find((p) => p.type === "day")!.value;
  return new Date(`${y}-${m}-${day}T00:00:00+01:00`); // close enough across DST for a "start of day" cutoff
}

export function startOfMonth(d = new Date()): Date {
  const s = startOfDayStockholm(d);
  return new Date(s.getFullYear(), s.getMonth(), 1);
}

export function startOfYear(d = new Date()): Date {
  const s = startOfDayStockholm(d);
  return new Date(s.getFullYear(), 0, 1);
}
