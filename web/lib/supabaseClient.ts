import { createClient } from "@supabase/supabase-js";

// Anon key only — safe to ship to the browser. RLS policies in
// 0001_init.sql make this key read-only (no insert/update/delete policies
// exist for the anon role).
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
