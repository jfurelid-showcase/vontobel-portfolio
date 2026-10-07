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
export async function updatePositionWithOptional(id: string, base: Record<string, unknown>, optional: Record<string, unknown>) {
  const run = (values: Record<string, unknown>) =>
    supabaseAdmin.from("portfolio_positions").update(values).eq("id", id).select().single();
  const first = await run({ ...base, ...optional });
  if (first.error && isMissingColumn(first.error)) return run(base);
  return first;
}
