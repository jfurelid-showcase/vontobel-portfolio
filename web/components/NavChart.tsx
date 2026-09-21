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
    if (inRange.length < 2) return history.slice(-2);
    return inRange;
  }, [history, range]);

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
  const height = 220;
  const padding = { top: 16, right: 12, bottom: 24, left: 52 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const navValues = points.map((p) => p.nav);
  const rawMin = Math.min(...navValues);
  const rawMax = Math.max(...navValues);
  // Pad the range a bit so the line never touches the very top/bottom edge.
  const pad = (rawMax - rawMin) * 0.08 || 1;
  const min = rawMin - pad;
  const max = rawMax + pad;
  const spread = max - min || 1;

  const x = (i: number) => padding.left + (i / (points.length - 1)) * plotW;
  const y = (nav: number) => padding.top + plotH - ((nav - min) / spread) * plotH;

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.nav).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L ${x(points.length - 1).toFixed(1)} ${padding.top + plotH} L ${x(0).toFixed(1)} ${padding.top + plotH} Z`;

  const isUp = points[points.length - 1].nav >= points[0].nav;
  const color = isUp ? "#34d399" : "#f87171";
  const gradientId = `nav-gradient-${isUp ? "up" : "down"}`;

  // 4 evenly spaced y-axis gridlines/labels.
  const Y_TICKS = 4;
  const yTicks = Array.from({ length: Y_TICKS + 1 }, (_, i) => min + (spread * i) / Y_TICKS);

  // A handful of x-axis date labels, evenly spaced across the points.
  const X_TICKS = 5;
  const xTickIdxs = Array.from({ length: X_TICKS }, (_, i) => Math.round((i / (X_TICKS - 1)) * (points.length - 1)));
  const dedupedXTicks = [...new Set(xTickIdxs)];

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

        {/* y-axis gridlines + labels */}
        {yTicks.map((v, i) => (
          <g key={i}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={y(v)}
              y2={y(v)}
              stroke="#27272a"
              strokeWidth="1"
              strokeDasharray={i === 0 ? undefined : "3 3"}
            />
            <text x={padding.left - 8} y={y(v)} textAnchor="end" dominantBaseline="middle" fontSize="11" fill="#737373">
              {v.toFixed(2)}
            </text>
          </g>
        ))}

        <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
        <path d={linePath} fill="none" stroke={color} strokeWidth="1.5" />

        {/* x-axis date labels */}
        {dedupedXTicks.map((idx) => (
          <text
            key={idx}
            x={x(idx)}
            y={height - 6}
            textAnchor={idx === 0 ? "start" : idx === points.length - 1 ? "end" : "middle"}
            fontSize="11"
            fill="#737373"
          >
            {new Date(points[idx].ts).toLocaleDateString("sv-SE", { month: "short", day: "numeric" })}
          </text>
        ))}
      </svg>
    </div>
  );
}
