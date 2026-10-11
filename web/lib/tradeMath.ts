// The arithmetic behind "Köp mer" (buy more) and "Sälj del" (sell part). The database
// does the real calculation (add_to_position / trim_position); these are the same
// formulas, used to show a preview before you confirm.

// GAV: the average price paid, weighted by quantity.
//   new GAV = (old quantity x old GAV + added quantity x price) / new quantity
export function gavAfterAdd(qty: number, gav: number, addQty: number, price: number): number {
  return (qty * gav + addQty * price) / (qty + addQty);
}

// What a part-sale earns or loses: sold quantity x (sale price - GAV).
export function realizedOnTrim(gav: number, soldQty: number, price: number): number {
  return soldQty * (price - gav);
}

// The sum of the part-sales already made from each open position
// (their closed rows point back at it through parent_position_id).
export type SoldPart = { quantity: number; realized: number };
export function soldPartsByPosition(
  rows: { id: string; parent_position_id?: string | null; quantity: number | null; entry_price: number; exit_price: number | null }[]
): Map<string, SoldPart> {
  const m = new Map<string, SoldPart>();
  for (const r of rows) {
    if (!r.parent_position_id || r.quantity == null || r.exit_price == null) continue;
    const cur = m.get(r.parent_position_id) ?? { quantity: 0, realized: 0 };
    cur.quantity += Number(r.quantity);
    cur.realized += Number(r.quantity) * (Number(r.exit_price) - Number(r.entry_price));
    m.set(r.parent_position_id, cur);
  }
  return m;
}
