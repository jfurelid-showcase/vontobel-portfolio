"use client";

import { useMemo, useState } from "react";

type NavPoint = { ts: string; nav: number };

const RANGES = [
  { label: "1D", ms: 24 * 60 * 60 * 1000 },
  { label: "1W", ms: 7 * 24 * 60 * 60 * 1000 },
  { label: "1M", ms: 30 * 24 * 60 * 60 * 1000 },
  { label: "All", ms: null },
] as const;

export default function NavChart({ history }: { history: NavPoint[] }) {
  const [range, setRange] = useState<(typeof RANGES)[number]["label"]>("1M");

  const filtered = useMemo(() => {
    const activeRange = RANGES.find((r) => r.label === range);
    if (!activeRange?.ms || history.length === 0) return history;
    const cutoff = Date.now() - activeRange.ms;
    const inRange = history.filter((p) => new Date(p.ts).getTime() >= cutoff);
    // Always keep at least one point before the cutoff so the line has a
    // sensible starting point instead of looking flat/empty for a young
    // portfolio with no history that old yet.
    if (inRange.length < 2) return history.slice(-2);
    return inRange;
  }, [history, range]);

  // Downsample so the SVG path never gets absurdly long (the worker ticks
  // every ~10s, so "All" history can accumulate tens of thousands of rows).
  const points = useMemo(() => {
    const MAX_POINTS = 400;
    if (filtered.length <= MAX_POINTS) return filtered;
    const step = filtered.length / MAX_POINTS;
    const out: NavPoint[] = [];
    for (let i = 0; i < MAX_POINTS; i++) out.push(filtered[Math.floor(i * step)]);
    out.push(filtered[filtered.length - 1]);
    return out;
  }, [filtered]);

  if (points.length < 2) {
    return (
      <div className="flex h-48 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-900 text-sm text-neutral-500">
        Not enough history yet to draw a chart.
      </div>
    );
  }

  const width = 800;
  const height = 200;
  const padding = 8;

  const navValues = points.map((p) => p.nav);
  const min = Math.min(...navValues);
  const max = Math.max(...navValues);
  const spread = max - min || 1;

  const x = (i: number) => padding + (i / (points.length - 1)) * (width - padding * 2);
  const y = (nav: number) => height - padding - ((nav - min) / spread) * (height - padding * 2);

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.nav).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L ${x(points.length - 1).toFixed(1)} ${height - padding} L ${x(0).toFixed(1)} ${height - padding} Z`;

  const isUp = points[points.length - 1].nav >= points[0].nav;
  const color = isUp ? "#34d399" : "#f87171"; // emerald-400 / red-400
  const gradientId = `nav-gradient-${isUp ? "up" : "down"}`;

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-neutral-400">Performance</div>
        <div className="flex gap-1 rounded-lg border border-neutral-800 bg-neutral-950 p-1">
          {RANGES.map((r) => (
            <button
              key={r.label}
              onClick={() => setRange(r.label)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                range === r.label ? "bg-neutral-100 text-neutral-900" : "text-neutral-400 hover:text-neutral-100"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
        <path d={linePath} fill="none" stroke={color} strokeWidth="1.5" />
      </svg>

      <div className="mt-1 flex justify-between text-xs text-neutral-500">
        <span>{new Date(points[0].ts).toLocaleDateString("sv-SE")}</span>
        <span>
          {min.toFixed(2)} – {max.toFixed(2)}
        </span>
        <span>{new Date(points[points.length - 1].ts).toLocaleDateString("sv-SE")}</span>
      </div>
    </div>
  );
}
