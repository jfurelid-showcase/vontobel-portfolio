import { supabase } from "@/lib/supabaseClient";

export type TraderRow = {
  trader_photo_url?: string | null;
  trader_name?: string | null;
  trader_level?: string | null;
  trader_style?: string | null;
  trader_country?: string | null;
};

// New columns (trader_style, trader_country) are added by SQL that has to be
// run by hand in Supabase. Try the full column list first and fall back to
// narrower ones, so the app keeps working if code is deployed before the SQL
// has been run (or the API schema cache hasn't picked it up yet).
const COLUMN_SETS = [
  "trader_photo_url, trader_name, trader_level, trader_style, trader_country",
  "trader_photo_url, trader_name, trader_level, trader_style",
  "trader_photo_url, trader_name, trader_level, trader_country",
  "trader_photo_url, trader_name, trader_level",
];

export async function fetchTraderRow(portfolioId: number): Promise<TraderRow | null> {
  for (const cols of COLUMN_SETS) {
    const res = await supabase.from("portfolio_settings").select(cols).eq("id", portfolioId).maybeSingle();
    if (!res.error) return (res.data as TraderRow | null) ?? null;
  }
  return null;
}
