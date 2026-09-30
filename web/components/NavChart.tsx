"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type NavPoint = { ts: string; nav: number };

// Data comes from the nav_series() database function (see nav_series.sql):
//   1D  = every tick since Stockholm midnight (10-second resolution)
//   MTD / YTD / All = one closing point per day
const RANGES = [
  { label: "1D", key: "1D" },
  { label: "Månad", key: "MTD" },
  { label: "År", key: "YTD" },
  { label: "Allt", key: "ALL" },
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
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
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
    setRaw([]); // clear the previous range's data immediately, or it briefly
    // renders under the new range's color logic (e.g. the whole 1D line
    // flashing solid red right as you switch to Month, before Month's own
    // data has arrived).
    setHoverIdx(null);
    fullLoad();
    const t = setInterval(key === "1D" ? pollNew : fullLoad, key === "1D" ? 10_000 : 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [range]);

  const points = useMemo(() => {
    const p = downsample(raw, MAX_DRAW_POINTS);
    // Reset every range to start at 100, so 1D/Month/Year/All each show
    // performance relative to their own starting point rather than the
    // portfolio's absolute NAV (which only means "started at 100" for the
    // very first day ever).
    if (p.length === 0) return p;
    const first = p[0].nav;
    if (!first) return p;
    return p.map((pt) => ({ ts: pt.ts, nav: (pt.nav / first) * 100 }));
  }, [raw]);

  const header = (
    <div className="mb-3 flex justify-end">
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

    const isDaily = range === "1D";
    const navValues = points.map((p) => p.nav);
    const rawMin = Math.min(...navValues);
    const rawMax = Math.max(...navValues);

    // Ticks are exact multiples of a fixed step *from* 100 (so spacing is
    // perfectly even and 100.00 always lands on one), sized to the day's
    // actual raw movement. The chart's min/max are then taken from the
    // ticks themselves — not padded independently — so the outermost
    // gridline always sits right at the top/bottom of the chart instead of
    // leaving empty space above or below it.
    const rawSpread = rawMax - rawMin || 0.02;
    const step = rawSpread / 3 || 0.01;
    const yTicks: number[] = [];
    for (let k = -60; k <= 60; k++) {
      const v = 100 + k * step;
      if (v >= rawMin - step && v <= rawMax + step) yTicks.push(v);
    }
    if (yTicks.length === 0) yTicks.push(100);
    const min = yTicks[0] - step * 0.15;
    const max = yTicks[yTicks.length - 1] + step * 0.15;
    const spread = max - min || 1;

    const x = (i: number) => padding.left + (i / (points.length - 1)) * plotW;
    const y = (nav: number) => padding.top + plotH - ((nav - min) / spread) * plotH;

    const linePixels = points.map((p, i) => ({ x: x(i), nav: p.nav }));

    // Split the series into runs that are entirely at-or-above 100 or
    // entirely below it, inserting an exact interpolated point wherever the
    // line crosses the baseline, so each run can be colored solidly without
    // a color ever being wrong for part of a run. Only done for 1D — the
    // longer ranges use one color for the whole line, like before.
    type Seg = { up: boolean; pts: { x: number; nav: number }[] };
    const segments: Seg[] = [];
    if (isDaily) {
      let run: { x: number; nav: number }[] = [linePixels[0]];
      let runUp = linePixels[0].nav >= 100;
      for (let i = 1; i < linePixels.length; i++) {
        const prev = linePixels[i - 1];
        const curr = linePixels[i];
        const currUp = curr.nav >= 100;
        if (currUp === runUp) {
          run.push(curr);
        } else {
          const t = (100 - prev.nav) / (curr.nav - prev.nav);
          const cross = { x: prev.x + t * (curr.x - prev.x), nav: 100 };
          run.push(cross);
          segments.push({ up: runUp, pts: run });
          run = [cross, curr];
          runUp = currUp;
        }
      }
      segments.push({ up: runUp, pts: run });
    }

    const UP_COLOR = "#34d399";
    const DOWN_COLOR = "#f87171";
    const yBase = y(100);

    const first = points[0].nav;
    const last = points[points.length - 1].nav;
    const isUp = last >= first;
    const overallColor = isUp ? UP_COLOR : DOWN_COLOR;
    const gradientId = `nav-gradient-${isUp ? "up" : "down"}`;
    const periodChange = first !== 0 ? ((last - first) / first) * 100 : null;

    const singleLinePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.nav).toFixed(1)}`).join(" ");
    const singleAreaPath = `${singleLinePath} L ${x(points.length - 1).toFixed(1)} ${padding.top + plotH} L ${x(0).toFixed(1)} ${padding.top + plotH} Z`;

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

    // Hover tooltip: snaps to the nearest of the already-downsampled
    // `points` (capped at MAX_DRAW_POINTS), so on a busy trading day this
    // is naturally a manageable number of stops rather than every 10s tick.
    const hoverPt = hoverIdx != null ? points[hoverIdx] : null;
    let hover: { hx: number; hy: number; color: string; timeLabel: string; changePct: number } | null = null;
    if (hoverPt) {
      const hx = x(hoverIdx!);
      const hy = y(hoverPt.nav);
      const color = isDaily ? (hoverPt.nav >= 100 ? UP_COLOR : DOWN_COLOR) : overallColor;
      const timeLabel =
        range === "1D"
          ? new Date(hoverPt.ts).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Stockholm" })
          : new Date(hoverPt.ts).toLocaleDateString("sv-SE", {
              day: "numeric",
              month: "short",
              year: "numeric",
              timeZone: "Europe/Stockholm",
            });
      const changePct = hoverPt.nav - 100; // points are indexed to 100, so this *is* the % change since the period start
      hover = { hx, hy, color, timeLabel, changePct };
    }

    function handlePointer(clientX: number, target: SVGRectElement) {
      const rect = target.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const svgX = frac * width;
      const idx = Math.round(((svgX - padding.left) / plotW) * (points.length - 1));
      setHoverIdx(Math.min(points.length - 1, Math.max(0, idx)));
    }

    return (
      <>
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="none">
          {!isDaily && (
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={overallColor} stopOpacity="0.25" />
                <stop offset="100%" stopColor={overallColor} stopOpacity="0" />
              </linearGradient>
            </defs>
          )}

          {yTicks.map((v, i) => {
            const isBaseline = v === 100;
            return (
              <g key={i}>
                <line
                  x1={padding.left}
                  x2={width - padding.right}
                  y1={y(v)}
                  y2={y(v)}
                  stroke={isBaseline ? "#52525b" : "#27272a"}
                  strokeWidth={isBaseline ? "1.25" : "1"}
                  strokeDasharray={isBaseline || i === 0 ? undefined : "3 3"}
                />
                <text
                  x={padding.left - 8}
                  y={y(v)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fontSize="11"
                  fontWeight={isBaseline ? 600 : 400}
                  fill={isBaseline ? "#a1a1aa" : "#737373"}
                >
                  {v.toFixed(2)}
                </text>
              </g>
            );
          })}

          {isDaily ? (
            <>
              {segments.map((seg, i) => {
                const color = seg.up ? UP_COLOR : DOWN_COLOR;
                const linePath = seg.pts.map((p, j) => `${j === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${y(p.nav).toFixed(1)}`).join(" ");
                const lastPt = seg.pts[seg.pts.length - 1];
                const firstPt = seg.pts[0];
                const areaPath = `${linePath} L ${lastPt.x.toFixed(1)} ${yBase.toFixed(1)} L ${firstPt.x.toFixed(1)} ${yBase.toFixed(1)} Z`;
                return (
                  <g key={i}>
                    <path d={areaPath} fill={color} fillOpacity="0.15" stroke="none" />
                    <path d={linePath} fill="none" stroke={color} strokeWidth="1.5" />
                  </g>
                );
              })}
              {points.length <= 60 &&
                points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.nav)} r="2.5" fill={p.nav >= 100 ? UP_COLOR : DOWN_COLOR} />)}
            </>
          ) : (
            <>
              <path d={singleAreaPath} fill={`url(#${gradientId})`} stroke="none" />
              <path d={singleLinePath} fill="none" stroke={overallColor} strokeWidth="1.5" />
              {points.length <= 60 && points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.nav)} r="2.5" fill={overallColor} />)}
            </>
          )}

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

          {hover && (
            <g>
              <line x1={hover.hx} x2={hover.hx} y1={padding.top} y2={padding.top + plotH} stroke="#52525b" strokeWidth="1" strokeDasharray="3 3" />
              <circle cx={hover.hx} cy={hover.hy} r="3.5" fill={hover.color} stroke="#171717" strokeWidth="1.5" />
              {(() => {
                const boxW = 108;
                const boxH = 40;
                const boxX = Math.min(Math.max(hover.hx - boxW / 2, padding.left), width - padding.right - boxW);
                const boxY = hover.hy < padding.top + plotH / 2 ? hover.hy + 10 : hover.hy - boxH - 10;
                return (
                  <g pointerEvents="none">
                    <rect x={boxX} y={boxY} width={boxW} height={boxH} rx="6" fill="#171717" stroke="#3f3f46" />
                    <text x={boxX + boxW / 2} y={boxY + 15} textAnchor="middle" fontSize="10" fill="#a1a1aa">
                      {hover.timeLabel}
                    </text>
                    <text x={boxX + boxW / 2} y={boxY + 29} textAnchor="middle" fontSize="12" fontWeight={600} fill={hover.color}>
                      {hoverPt!.nav.toFixed(2)} ({hover.changePct >= 0 ? "+" : ""}
                      {hover.changePct.toFixed(2)}%)
                    </text>
                  </g>
                );
              })()}
            </g>
          )}

          <rect
            x={padding.left}
            y={padding.top}
            width={plotW}
            height={plotH}
            fill="transparent"
            onMouseMove={(e) => handlePointer(e.clientX, e.currentTarget)}
            onMouseLeave={() => setHoverIdx(null)}
            onTouchStart={(e) => handlePointer(e.touches[0].clientX, e.currentTarget)}
            onTouchMove={(e) => handlePointer(e.touches[0].clientX, e.currentTarget)}
            onTouchEnd={() => setHoverIdx(null)}
            style={{ cursor: "crosshair" }}
          />
        </svg>
        {periodChange != null && (
          <div className={`mt-1 text-right text-xs ${isUp ? "text-emerald-400" : "text-red-400"}`}>
            {isUp ? "+" : ""}
            {periodChange.toFixed(2)}% under perioden
          </div>
        )}
      </>
    );
  }, [points, range, hoverIdx]);

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
      {header}
      {chart ?? (
        <div className="flex h-48 items-center justify-center text-sm text-neutral-500">
          {loading ? "Laddar…" : "Inte tillräckligt med historik för det här intervallet."}
        </div>
      )}
    </div>
  );
}
