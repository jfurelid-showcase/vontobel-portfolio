"use client";

import { useEffect, useState } from "react";

// The window itself lives in lib/marketHours.ts, shared with the server-side check that
// refuses trades outside it. It mirrors the quote worker's hours (quote-worker/worker.mjs:
// MARKET_OPEN_MIN / MARKET_CLOSE_MIN); keep them in sync if you change one.
import { isMarketOpen } from "@/lib/marketHours";

export default function MarketStatus({ className = "" }: { className?: string }) {
  // Start as null so the very first render (before we know "now") shows
  // nothing rather than briefly flashing the wrong state.
  const [open, setOpen] = useState<boolean | null>(null);

  useEffect(() => {
    const check = () => setOpen(isMarketOpen(new Date()));
    check();
    const t = setInterval(check, 30_000);
    return () => clearInterval(t);
  }, []);

  if (open == null) return null;

  return (
    <div className={`flex items-center gap-1.5 text-xs ${open ? "text-emerald-400" : "text-red-400"} ${className}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${open ? "bg-emerald-400" : "bg-red-400"}`} />
      {open ? "Marknad öppen" : "Marknad stängd"}
    </div>
  );
}
