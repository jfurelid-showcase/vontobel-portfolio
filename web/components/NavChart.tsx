"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type NavPoint = { ts: string; nav: number };

// Data comes from the nav_series() database function (see nav_series.sql):
//   1D  = every tick since Stockholm midnight (10-second resolution)
//   MTD / YTD / All = one closing point per day
const RANGES = [
  { label: "1D", key: "1D" },
  { label: "MTD", key: "MTD" },
  { label: "YTD", key: "YTD" },
  { label: "All", key: "ALL" },
] as const;

type RangeLabel = (typeof RANGES)[number]["label"];

const PAGE = 1000; // Supabase caps rows per request, so 1D is fetched in pages
const MAX_DRAW_POINTS = 600; // drawing every tick adds no visible detail

const stockholmDay = (iso: string) =>
  new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });

function downsample(points: NavPoint[], max: number): NavPoint[] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  const out: NavPoint[] = [];
  for (let i = 0; i < max - 1; i++) out.push(points[Math.round(i * step)]);
  out.push(points[points.length - 1]);
  return out;
}

async function fetchSeries(key: string): Promise<NavPoint[]> {
  const all: NavPoint[] = [];
  for (let page = 0; page < 40; page++) {
    const from = page * PAGE;
    const { data, error } = await supabase.rpc("nav_series", { p_range: key }).range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data as NavPoint[]) ?? [];
    all.push(...rows.map((r) => ({ ts: r.ts, nav: Number(r.nav) })));
    if (rows.length < PAGE) break;
  }
  return all;
}

// `history` is accepted (and ignored) so existing <NavChart history={...} />
// calls in page.tsx keep compiling — the chart now loads its own data.
export default function NavChart(_props: { history?: NavPoint[] }) {
  const [range, setRange] = useState<RangeLabel>("1D");
  const [raw, setRaw] = useState<NavPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const lastTsRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const key = RANGES.find((r) => r.label === range)!.key;

    async function fullLoad() {
      try {
        const rows = await fetchSeries(key);
        if (cancelled) return;
        lastTsRef.current = rows.length ? rows[rows.length - 1].ts : null;
        setRaw(rows);
      } catch (e) {
        console.error("nav_series failed:", e);
        if (!cancelled) setRaw([]);
      }
      if (!cancelled) setLoading(false);
    }

    // 1D: only fetch ticks newer than what we already have (every 10s).
    async function pollNew() {
      const last = lastTsRef.current;
      if (!last) return fullLoad();
      const { data, error } = await supabase
        .from("nav_history")
        .select("ts, nav")
        .gt("ts", last)
        .order("ts", { ascending: true })
        .limit(PAGE);
      if (cancelled || error || !data || data.length === 0) return;
      const fresh = data.map((r: any) => ({ ts: r.ts as string, nav: Number(r.nav) }));
      lastTsRef.current = fresh[fresh.length - 1].ts;
      setRaw((prev) => {
        // Past Stockholm midnight the "day" changes — start over cleanly.
        if (prev.length && stockholmDay(prev[0].ts) !== stockholmDay(fresh[fresh.length - 1].ts)) {
          fullLoad();
          return prev;
        }
        return [...prev, ...fresh];
      });
    }

    setLoading(true);
    fullLoad();
    const t = setInterval(key === "1D" ? pollNew : fullLoad, key === "1D" ? 10_000 : 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [range]);

  const points = useMemo(() => downsample(raw, MAX_DRAW_POINTS), [raw]);

  const header = (
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
  );

  const chart = useMemo(() => {
    if (points.length < 2) return null;

    const width = 800;
    const height = 220;
    const padding = { top: 16, right: 12, bottom: 24, left: 52 };
    const plotW = width - padding.left - padding.right;
    const plotH = height - padding.top - padding.bottom;

    const navValues = points.map((p) => p.nav);
    const rawMin = Math.min(...navValues);
    const rawMax = Math.max(...navValues);
    const pad = (rawMax - rawMin) * 0.08 || 0.05;
    const min = rawMin - pad;
    const max = rawMax + pad;
    const spread = max - min || 1;

    const x = (i: number) => padding.left + (i / (points.length - 1)) * plotW;
    const y = (nav: number) => padding.top + plotH - ((nav - min) / spread) * plotH;

    const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.nav).toFixed(1)}`).join(" ");
    const areaPath = `${linePath} L ${x(points.length - 1).toFixed(1)} ${padding.top + plotH} L ${x(0).toFixed(1)} ${padding.top + plotH} Z`;

    const first = points[0].nav;
    const last = points[points.length - 1].nav;
    const isUp = last >= first;
    const color = isUp ? "#34d399" : "#f87171";
    const gradientId = `nav-gradient-${isUp ? "up" : "down"}`;
    const periodChange = first !== 0 ? ((last - first) / first) * 100 : null;

    const Y_TICKS = 4;
    const yTicks = Array.from({ length: Y_TICKS + 1 }, (_, i) => min + (spread * i) / Y_TICKS);

    const fmtX = (iso: string) =>
      range === "1D"
        ? new Date(iso).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Stockholm" })
        : new Date(iso).toLocaleDateString("sv-SE", { month: "short", day: "numeric", timeZone: "Europe/Stockholm" });

    const X_TICKS = 5;
    const seen = new Set<string>();
    const xTicks: { idx: number; label: string }[] = [];
    for (let i = 0; i < X_TICKS; i++) {
      const idx = Math.round((i / (X_TICKS - 1)) * (points.length - 1));
      const label = fmtX(points[idx].ts);
      if (!seen.has(label)) {
        seen.add(label);
        xTicks.push({ idx, label });
      }
    }

    return (
      <>
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.25" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>

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
          {points.length <= 60 && points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.nav)} r="2.5" fill={color} />)}

          {xTicks.map(({ idx, label }) => (
            <text
              key={idx}
              x={x(idx)}
              y={height - 6}
              textAnchor={idx === 0 ? "start" : idx === points.length - 1 ? "end" : "middle"}
              fontSize="11"
              fill="#737373"
            >
              {label}
            </text>
          ))}
        </svg>
        {periodChange != null && (
          <div className={`mt-1 text-right text-xs ${isUp ? "text-emerald-400" : "text-red-400"}`}>
            {isUp ? "+" : ""}
            {periodChange.toFixed(2)}% over period
          </div>
        )}
      </>
    );
  }, [points, range]);

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
      {header}
      {chart ?? (
        <div className="flex h-48 items-center justify-center text-sm text-neutral-500">
          {loading ? "Loading…" : "Not enough history yet for this range."}
        </div>
      )}
    </div>
  );
}
