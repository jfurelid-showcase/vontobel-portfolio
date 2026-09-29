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

  return (
    <div ref={ref} className="relative sm:hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Menu"
        className="flex h-9 w-9 items-center justify-center rounded-md border border-neutral-700 bg-neutral-900 text-neutral-200"
      >
        <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
          <path d="M0 1h16M0 6h16M0 11h16" stroke="currentColor" strokeWidth="1.5" />
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
