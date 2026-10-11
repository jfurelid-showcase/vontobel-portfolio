// When can trades be made? The same window the dashboard's "Marknad öppen/stängd"
// badge and the quote worker use: Monday to Friday, 08:00-22:00 Swedish time (summer
// and winter time are handled automatically). Used both in the browser (to show the
// state and disable buttons) and on the server (the part that actually enforces it).
//
// Public holidays are not known to this check. On such a day the market is closed but
// the clock says open; the requirement of a live ask/bid price is what stops a trade then.

export const OPEN_MIN = 8 * 60; // 08:00
export const CLOSE_MIN = 22 * 60; // 22:00 (the 22:00 minute still counts, as in the worker)

export const MARKET_CLOSED_MESSAGE = "Marknaden är stängd. Affärer går bara att lägga vardagar kl 08:00–22:00 (svensk tid).";

export function isMarketOpen(d: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Stockholm",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const weekday = get("weekday");
  if (weekday === "Sat" || weekday === "Sun") return false;
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  return minutes >= OPEN_MIN && minutes <= CLOSE_MIN;
}
