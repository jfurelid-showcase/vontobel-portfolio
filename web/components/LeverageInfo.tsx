"use client";

import { useEffect, useState } from "react";

// Visar hävstången för det valda certifikatet (enligt Vontobel) när en
// position läggs till. Användning: <LeverageInfo isin={selected?.isin} />
export default function LeverageInfo({ isin }: { isin?: string | null }) {
  const [state, setState] = useState<{ loading: boolean; value: number | null; source: string | null }>({
    loading: false, value: null, source: null,
  });

  useEffect(() => {
    if (!isin) { setState({ loading: false, value: null, source: null }); return; }
    let cancelled = false;
    setState({ loading: true, value: null, source: null });
    fetch(`/api/certificates/leverage?isin=${encodeURIComponent(isin)}`)
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setState({ loading: false, value: j.leverage ?? null, source: j.source ?? null }); })
      .catch(() => { if (!cancelled) setState({ loading: false, value: null, source: null }); });
    return () => { cancelled = true; };
  }, [isin]);

  if (!isin) return null;
  const txt = state.loading
    ? "hämtar…"
    : state.value != null
      ? state.value.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : "okänd";
  return (
    <span className="ml-2 inline-flex items-center gap-1 rounded-md bg-amber-400/10 px-2 py-0.5 text-xs font-medium text-amber-300">
      Hävstång: <span className="tabular-nums">{txt}</span>
      {state.source === "vontobel" && <span className="font-normal text-neutral-500">(Vontobel)</span>}
    </span>
  );
}
