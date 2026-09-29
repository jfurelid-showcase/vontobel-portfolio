"use client";

import { useEffect, useRef, useState } from "react";

type TabKey = "dashboard" | "trades" | "admin";

const TABS: [TabKey, string][] = [
  ["dashboard", "Dashboard"],
  ["trades", "Trades"],
  ["admin", "Admin"],
];

export default function TabMenu({ tab, setTab }: { tab: TabKey; setTab: (t: TabKey) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = TABS.find(([key]) => key === tab)?.[1] ?? "Dashboard";

  // Only rendered on narrow screens — see sm:hidden below and the matching
  // hidden sm:flex on the full pill-button group in page.tsx.
  return (
    <div ref={ref} className="relative sm:hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-sm font-medium text-neutral-200"
      >
        {current}
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none" className={open ? "rotate-180" : ""}>
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-36 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 shadow-xl">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              onClick={() => {
                setTab(key);
                setOpen(false);
              }}
              className={`block w-full px-3 py-2 text-left text-sm ${
                tab === key ? "bg-neutral-100 font-medium text-neutral-900" : "text-neutral-300 hover:bg-neutral-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
