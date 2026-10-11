import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { cleanDirection, parseOffset, searchTokens } from "@/lib/certSearch";
import { isMissingColumn } from "@/lib/optionalColumns";

const COLS = "isin, name, underlying, direction, leverage, last_price, buy_price, sell_price, daily_change_pct";
const PAGE = 500;

// GET /api/certificates/search?q=<words>[&direction=Long|Short][&offset=<n>]
//
// Every word you type must appear somewhere in the contract's name, ISIN or
// underlying, in any order, so "AMZN MFL" finds "MFL AMZN VT927" and extra
// spaces don't matter. A full name or ISIN is always listed first.
//
// Knocked-out and delisted contracts are left out (see 0005_contract_status.sql).
//
// A broad search can match thousands of contracts (every Amazon mini future ever
// issued). They come back in pages of 500, most traded first; `hasMore` says
// there are more and `nextOffset` is where the next page starts. Without paging,
// the thinly traded contracts at the bottom of a broad search could never be
// reached.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const tokens = searchTokens(sp.get("q") ?? "");
  const direction = cleanDirection(sp.get("direction"));
  const offset = parseOffset(sp.get("offset"));

  if (tokens.join("").length < 2) {
    return NextResponse.json({ results: [], totalCount: 0, offset: 0, nextOffset: 0, hasMore: false });
  }

  // Only contracts that can still be chosen: still in NGM's list (listed) and not
  // knocked out. The two columns come from 0005_contract_status.sql; until that has
  // been run the filter is left out, so the search keeps working.
  const build = (withStatus: boolean) => {
    let q = supabaseAdmin.from("certificates_full").select(COLS, { count: "exact" });
    // Repeated .or() calls are ANDed: (word 1 matches somewhere) AND (word 2 matches somewhere) ...
    for (const t of tokens) {
      q = q.or(`isin.ilike.%${t}%,name.ilike.%${t}%,underlying.ilike.%${t}%`);
    }
    if (direction) q = q.ilike("direction", direction);
    if (withStatus) q = q.eq("listed", true).eq("knocked_out", false);
    return (
      q
        // Most traded first; ISIN as tie-breaker so paging is stable (many contracts
        // have no turnover at all, and an unstable order would repeat or skip rows).
        .order("turnover", { ascending: false, nullsFirst: false })
        .order("isin", { ascending: true })
        .range(offset, offset + PAGE - 1)
    );
  };
  let withStatus = true;
  let { data, error, count } = await build(true);
  if (error && isMissingColumn(error)) {
    withStatus = false;
    ({ data, error, count } = await build(false));
  }

  // An offset beyond the last match is "range not satisfiable" (PGRST103): that
  // is just an empty page, not a failure.
  if (error?.code === "PGRST103") {
    return NextResponse.json({ results: [], totalCount: 0, offset, nextOffset: offset, hasMore: false });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let results = data ?? [];
  const total = count ?? results.length;
  const nextOffset = offset + results.length;

  let listUpdatedAt: string | null = null;
  if (offset === 0) {
    // A full name or ISIN typed in goes first, however little the contract trades.
    const phrase = tokens.join(" ");
    let exactQ = supabaseAdmin.from("certificates_full").select(COLS).or(`name.ilike.${phrase},isin.eq.${phrase.toUpperCase()}`);
    if (direction) exactQ = exactQ.ilike("direction", direction);
    if (withStatus) exactQ = exactQ.eq("listed", true).eq("knocked_out", false);
    const { data: exact } = await exactQ.limit(5);
    if (exact && exact.length > 0) {
      const ids = new Set(exact.map((r) => r.isin));
      results = [...exact, ...results.filter((r) => !ids.has(r.isin))];
    }

    // When the contract list was last refreshed from NGM (once a day).
    const { data: run } = await supabaseAdmin
      .from("scrape_runs")
      .select("finished_at")
      .eq("job", "full_list")
      .eq("ok", true)
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    listUpdatedAt = run?.finished_at ?? null;
  }

  return NextResponse.json({ results, totalCount: total, offset, nextOffset, hasMore: nextOffset < total, listUpdatedAt });
}
