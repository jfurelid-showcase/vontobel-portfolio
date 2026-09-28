"use client";

import { useEffect, useRef, useState } from "react";

type TabKey = "dashboard" | "trades";

const OPTIONS: { key: TabKey; label: string; height: number }[] = [
  { key: "dashboard", label: "Dashboard", height: 900 },
  { key: "trades", label: "Trades", height: 800 },
];

function urlFor(origin: string, key: TabKey) {
  return `${origin}/?tab=${key}&embed=1`;
}

function embedCodeFor(origin: string, key: TabKey, height: number) {
  return `<iframe
  src="${urlFor(origin, key)}"
  width="100%"
  height="${height}"
  style="border: none;"
  loading="lazy"
></iframe>`;
}

export default function ShareButton() {
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
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

  async function copy(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API can be unavailable (e.g. non-HTTPS); fall back to a
      // manual select so the person can still copy with Ctrl/Cmd+C.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {}
      document.body.removeChild(ta);
    }
    setCopied(id);
    setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm font-medium text-neutral-300 hover:bg-neutral-800"
      >
        Share
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-xl border border-neutral-800 bg-neutral-900 p-4 shadow-xl sm:w-96">
          <div className="mb-3 text-sm font-medium text-neutral-200">Share or embed</div>

          <div className="space-y-4">
            {OPTIONS.map(({ key, label, height }) => {
              const link = origin ? urlFor(origin, key) : "";
              const code = origin ? embedCodeFor(origin, key, height) : "";
              return (
                <div key={key}>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</div>
                  <div className="flex gap-1.5">
                    <input
                      readOnly
                      value={link}
                      onFocus={(e) => e.target.select()}
                      className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-xs text-neutral-300 outline-none"
                    />
                    <button
                      onClick={() => copy(link, `${key}-link`)}
                      className="shrink-0 rounded-md border border-neutral-700 px-2.5 py-1.5 text-xs font-medium text-neutral-300 hover:bg-neutral-800"
                    >
                      {copied === `${key}-link` ? "Copied" : "Copy link"}
                    </button>
                  </div>
                  <button
                    onClick={() => copy(code, `${key}-embed`)}
                    className="mt-1.5 w-full rounded-md border border-neutral-700 px-2.5 py-1.5 text-left text-xs font-medium text-neutral-300 hover:bg-neutral-800"
                  >
                    {copied === `${key}-embed` ? "Embed code copied" : "Copy embed code (<iframe>)"}
                  </button>
                </div>
              );
            })}
          </div>

          <p className="mt-3 text-[11px] leading-snug text-neutral-600">
            Embedded pages show only this tab, live-updating — no Admin access is ever included.
          </p>
        </div>
      )}
    </div>
  );
}
