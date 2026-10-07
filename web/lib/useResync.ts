"use client";

import { useEffect, useRef } from "react";

// Call `callback` when the visitor comes back to the page after it has been
// out of sight for a while (switched app or tab on a phone, locked the
// screen) or when the connection returns.
//
// While a page is in the background, mobile browsers pause its timers and
// its live-update connection, so when you return the screen can be minutes
// out of date until the next tick happens to catch up — and ticks that were
// queued up meanwhile all fire at once. Refreshing on return makes the page
// correct immediately instead.
export function useResync(callback: () => void, minAwayMs = 8000) {
  const latest = useRef(callback);
  latest.current = callback;

  useEffect(() => {
    let hiddenAt: number | null = document.visibilityState === "hidden" ? Date.now() : null;

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt == null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      if (away >= minAwayMs) latest.current();
    };
    // Restored from the browser's back/forward cache: nothing has run since.
    const onPageShow = (e: Event) => {
      if ((e as PageTransitionEvent).persisted) latest.current();
    };
    const onOnline = () => latest.current();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("online", onOnline);
    };
  }, [minAwayMs]);
}
