// The rules for automatic stop loss / take profit, in one place so the
// worker-side behaviour and the checks in the API agree.
//
// A position is the certificate itself, so its value moves with the
// certificate's price whatever the underlying direction ("Long"/"Short" only
// describes the product): a stop loss is a level BELOW the price and a target
// is a level ABOVE it.

export type AutoLevels = {
  stop_loss: number | null;
  target_price: number | null;
  auto_stop: boolean;
  auto_target: boolean;
};

export type Trigger = "stop_loss" | "take_profit" | null;

// Which automatic level (if any) has this price reached? If a nonsensical
// setup has both reached at once, the stop loss wins (the cautious choice).
export function triggerFor(level: AutoLevels, price: number | null | undefined): Trigger {
  if (price == null || !Number.isFinite(price)) return null;
  if (level.auto_stop && level.stop_loss != null && price <= level.stop_loss) return "stop_loss";
  if (level.auto_target && level.target_price != null && price >= level.target_price) return "take_profit";
  return null;
}

// Can these settings be switched on right now without the position closing at
// once? Returns a Swedish error message, or null if fine. `price` is the
// position's current price (its entry price if none yet).
export function validateAuto(level: AutoLevels, price: number): string | null {
  if (level.auto_stop) {
    if (level.stop_loss == null || !(level.stop_loss > 0)) return "Ange en stop loss för att kunna stänga automatiskt vid den.";
    if (level.stop_loss >= price) {
      return `Stop loss (${level.stop_loss}) ligger redan på eller över nuvarande kurs (${price}), så positionen skulle stängas direkt. Sänk nivån eller stäng av automatiken.`;
    }
  }
  if (level.auto_target) {
    if (level.target_price == null || !(level.target_price > 0)) return "Ange ett mål för att kunna stänga automatiskt vid det.";
    if (level.target_price <= price) {
      return `Målet (${level.target_price}) ligger redan på eller under nuvarande kurs (${price}), så positionen skulle stängas direkt. Höj nivån eller stäng av automatiken.`;
    }
  }
  return null;
}

export const REASON_LABEL: Record<string, string> = {
  stop_loss: "stop loss",
  take_profit: "mål",
  manual: "manuellt",
};
