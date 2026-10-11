// Saving the contract list, and keeping it clean.
//
// Kept apart from scrape-full-list.mjs (which needs a browser and secrets) so it
// can be tested on its own.

// Postgres 42703 / PostgREST PGRST204: a column that doesn't exist (yet).
export function isMissingColumn(err) {
  return !!err && (err.code === "42703" || err.code === "PGRST204" || /does not exist|schema cache/i.test(err.message || ""));
}

// Safety rails for hiding contracts. A list that came back truncated (a broken
// request, an NGM hiccup) must never be allowed to hide thousands of good contracts.
const MIN_LIST_SIZE = 1000; // a Vontobel list is ~25 000; anything below this is suspect
const MIN_RATIO_OF_PREVIOUS = 0.9; // and it may not be much smaller than the previous successful run

// Upsert the whole list; then hide every contract that was NOT in it.
//
//   rows   the contracts from this run, already mapped (each has an isin)
//
// Every contract in this run gets the SAME scraped_at stamp, so "not in this run" is
// simply "has an older stamp". No clocks from two different machines are compared.
//
// Returns { written, statusColumns, delisted: [{isin,name}], delistingSkipped: string|null }.
export async function persistList(supabase, rows, { batch = 500, log = console.log, warn = console.warn, delist = true, now = new Date() } = {}) {
  const stamp = now.toISOString();
  // Do the status columns exist? (They come from 0005_contract_status.sql, run by hand.)
  const probe = await supabase.from("certificates_full").select("listed").limit(1);
  if (probe.error && !isMissingColumn(probe.error)) throw probe.error;
  const statusColumns = !probe.error;
  if (!statusColumns) warn("The listed/knocked_out columns are missing (run 0005_contract_status.sql): contracts are saved, but none are hidden.");

  // How big was the previous successful run? (Taken BEFORE this run is recorded as finished.)
  let previousSize = null;
  if (statusColumns) {
    const { data: prev } = await supabase
      .from("scrape_runs")
      .select("rows_written")
      .eq("job", "full_list")
      .eq("ok", true)
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    previousSize = prev?.rows_written ?? null;
  }

  // A contract in the list is, by definition, listed. (knocked_out is deliberately NOT in this payload.)
  const payload = rows.map((r) => ({ ...r, scraped_at: stamp, ...(statusColumns ? { listed: true } : {}) }));
  for (let i = 0; i < payload.length; i += batch) {
    const { error } = await supabase.from("certificates_full").upsert(payload.slice(i, i + batch), { onConflict: "isin" });
    if (error) throw error;
  }

  const result = { written: rows.length, statusColumns, delisted: [], delistingSkipped: null };
  if (!statusColumns) return result;

  // Decide whether it is safe to hide what is missing.
  const skip = (why) => {
    result.delistingSkipped = why;
    warn(`Delisting skipped: ${why}`);
    return result;
  };
  if (!delist) return skip("switched off (DELIST=false)");
  if (rows.length < MIN_LIST_SIZE) return skip(`the list is unusually small (${rows.length} contracts)`);
  if (previousSize != null && rows.length < previousSize * MIN_RATIO_OF_PREVIOUS) {
    return skip(`the list shrank from ${previousSize} to ${rows.length} contracts, which looks like an incomplete download`);
  }

  const { data: hidden, error } = await supabase
    .from("certificates_full")
    .update({ listed: false })
    .eq("listed", true)
    .lt("scraped_at", stamp)
    .select("isin, name");
  if (error) throw error;
  result.delisted = hidden ?? [];
  log(`Delisted ${result.delisted.length} contract(s) that are no longer in NGM's list${result.delisted.length ? `, e.g. ${result.delisted.slice(0, 5).map((r) => r.name).join(", ")}` : ""}.`);
  return result;
}

// A look at which fields in NGM's list say something about a contract's state, so
// that knocked-out contracts can be recognised automatically if NGM flags them.
// Printed in the run log; changes nothing.
export function summarizeStatusFields(items, { maxValues = 10 } = {}) {
  const pattern = /status|state|active|halt|stop|knock|barrier|expir|delist|suspend|tradable|trading/i;
  const counts = new Map();
  for (const item of items) {
    for (const [key, value] of Object.entries(item)) {
      if (!pattern.test(key) || (value !== null && typeof value === "object")) continue;
      const m = counts.get(key) ?? new Map();
      const v = String(value);
      m.set(v, (m.get(v) ?? 0) + 1);
      counts.set(key, m);
    }
  }
  const lines = [...counts.entries()].map(([key, m]) => {
    const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxValues);
    return `  ${key}: ${top.map(([v, n]) => `${v}×${n}`).join(", ")}${m.size > maxValues ? ", …" : ""}`;
  });
  const noQuote = items.filter((i) => !(Number(i.askprice) > 0) && !(Number(i.bidprice) > 0)).length;
  lines.push(`  items with neither a bid nor an ask: ${noQuote} of ${items.length}`);
  return lines;
}
