import "server-only";
import { NextResponse } from "next/server";
import { MARKET_CLOSED_MESSAGE, isMarketOpen } from "@/lib/marketHours";

// Trades (a new position, buying more, selling part, closing) are only accepted while
// the market is open. Checked on the server, so it can't be bypassed from the browser.
//
// ENFORCE_TRADING_HOURS=false (a Vercel environment variable) switches the check off,
// e.g. for testing outside hours. Anything else, or nothing at all, means it is on.
export function marketClosedResponse(now: Date = new Date()): NextResponse | null {
  if (process.env.ENFORCE_TRADING_HOURS === "false") return null;
  if (isMarketOpen(now)) return null;
  return NextResponse.json({ error: MARKET_CLOSED_MESSAGE, marketClosed: true }, { status: 409 });
}
