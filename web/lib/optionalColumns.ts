import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// "column ... does not exist" from PostgREST (Postgres 42703), or a missing
// column in its schema cache (PGRST204).
export function isMissingColumn(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === "42703" || err.code === "PGRST204" || /does not exist|schema cache/i.test(err.message ?? "");
}

// Update a position, trying the new optional columns (added by a SQL file
// that is run by hand) first and falling back to the plain update if the
// database doesn't have them yet — so close/reopen keep working if the app is
// deployed before the SQL has been run.
// `onlyIfOpen` makes the update apply only while the position is still open, so
// a position the quote worker closed a moment ago can't be closed a second time
// at a different price.
export async function updatePositionWithOptional(
  id: string,
  base: Record<string, unknown>,
  optional: Record<string, unknown>,
  opts: { onlyIfOpen?: boolean } = {}
) {
  const run = (values: Record<string, unknown>) => {
    let q = supabaseAdmin.from("portfolio_positions").update(values).eq("id", id);
    if (opts.onlyIfOpen) q = q.eq("status", "open");
    return q.select().single();
  };
  const first = await run({ ...base, ...optional });
  if (first.error && isMissingColumn(first.error)) return run(base);
  return first;
}

// Same idea for creating a position.
export async function insertPositionWithOptional(base: Record<string, unknown>, optional: Record<string, unknown>) {
  const run = (values: Record<string, unknown>) => supabaseAdmin.from("portfolio_positions").insert(values).select().single();
  const first = await run({ ...base, ...optional });
  if (first.error && isMissingColumn(first.error) && Object.keys(optional).length > 0) return run(base);
  return first;
}
