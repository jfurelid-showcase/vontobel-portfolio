"use client";

import { useEffect, useState } from "react";

// Mirrors the quote worker's trading-hours window (quote-worker/worker.mjs:
// MARKET_OPEN_MIN / MARKET_CLOSE_MIN). Keep these two numbers in sync if you
// change the worker's hours — this is a separate, purely client-side check
// so the badge doesn't need a server round trip.
const OPEN_MIN = 8 * 60; // 08:00
const CLOSE_MIN = 22 * 60 + 15; // 22:15

function isMarketOpen(d: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Stockholm",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const weekday = get("weekday");
  if (weekday === "Sat" || weekday === "Sun") return false;
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  return minutes >= OPEN_MIN && minutes <= CLOSE_MIN;
}

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
