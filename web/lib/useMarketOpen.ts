"use client";

import { useEffect, useState } from "react";
import { isMarketOpen } from "@/lib/marketHours";

// Whether the market is open right now, re-checked every 30 seconds. Starts as `true`
// so nothing flashes "closed" on the first render; the server is what really decides.
export function useMarketOpen(): boolean {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    const check = () => setOpen(isMarketOpen(new Date()));
    check();
    const t = setInterval(check, 30_000);
    return () => clearInterval(t);
  }, []);
  return open;
}
