import "server-only";
import { createClient } from "@supabase/supabase-js";

// SERVICE ROLE key — never import this file from a "use client" component.
// It bypasses Row Level Security, which is exactly what the admin API
// routes (creating/closing positions) need to do.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
