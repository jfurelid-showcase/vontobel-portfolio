"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type NavPoint = { ts: string; nav: number };
type TradeEvent = {
  ts: string;
  kind: "open" | "close";
  name: string;
  direction: string | null;
  price: number;
  quantity: number | null;
  pl: number | null; // only set for "close"
};

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
  // Bucket by TIME SPAN, not by index position. Index-based striding picks
  // "every Nth point" based on the CURRENT total count — as new ticks keep
  // arriving every ~10s, that total keeps changing, so the exact same
  // moment in history can land on a different sampled point on every
  // refetch. A brief few-tick price excursion can then flicker in and out
  // of the drawn line purely because of when you happened to load the
  // chart, which looks like a rendering bug even though the underlying
  // data never changed. Bucketing by time instead means each bucket's
  // boundaries barely shift as the day goes on, so the same historical
  // moment reliably lands in the same bucket (and shows the same value)
  // on every load.
  const firstTs = new Date(points[0].ts).getTime();
  const lastTs = new Date(points[points.length - 1].ts).getTime();
  const span = lastTs - firstTs || 1;
  const bucketMs = span / (max - 1);
  const out: NavPoint[] = [points[0]];
  let bucketIdx = 0;
  let lastInBucket = points[0];
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const t = new Date(p.ts).getTime();
    const thisBucket = Math.min(max - 2, Math.floor((t - firstTs) / bucketMs));
    if (thisBucket !== bucketIdx) {
      out.push(lastInBucket);
      bucketIdx = thisBucket;
    }
    lastInBucket = p;
  }
  out.push(lastInBucket);
  return out;
}

async function fetchSeries(key: string): Promise<NavPoint[]> {
  if (key !== "1D") {
    // MTD/YTD/ALL are small, aggregated results (one closing point per
    // day) — comfortably under a page, so a single call is enough.
    const { data, error } = await supabase.rpc("nav_series", { p_range: key });
    if (error) throw new Error(error.message);
    return ((data as NavPoint[]) ?? []).map((r) => ({ ts: r.ts, nav: Number(r.nav) }));
  }

  // 1D returns every raw tick of the trading day — thousands of rows on a
  // busy day, too many for one request. We used to page through this with
  // .range(offset, offset+999), but that's OFFSET pagination against a
  // table the quote worker keeps inserting into every ~10s: while a
  // multi-page fetch is still in flight, newly inserted rows can shift
  // which rows land at which offset, silently dropping or duplicating a
  // whole chunk of the day depending on timing (this is what caused the
  // chart to sometimes render a much flatter, incomplete version of the
  // day). Keyset pagination — asking for "everything after the last
  // timestamp I've already got" instead of a numeric position — is immune
  // to that, since each page is anchored to a real value rather than a
  // position that can move underneath it.
  const { data: seed, error: seedErr } = await supabase.rpc("nav_series", { p_range: "1D" });
  if (seedErr) throw new Error(seedErr.message);
  const all: NavPoint[] = ((seed as NavPoint[]) ?? []).map((r) => ({ ts: r.ts, nav: Number(r.nav) }));
  if (all.length === 0) return all;

  let cursor = all[all.length - 1].ts;
  for (let page = 0; page < 60; page++) {
    const { data, error } = await supabase
      .from("nav_history")
      .select("ts, nav")
      .gt("ts", cursor)
      .order("ts", { ascending: true })
      .limit(PAGE);
    if (error) throw new Error(error.message);
    const rows = ((data as { ts: string; nav: number }[]) ?? []).map((r) => ({ ts: r.ts, nav: Number(r.nav) }));
    if (rows.length === 0) break;
    all.push(...rows);
    cursor = rows[rows.length - 1].ts;
    if (rows.length < PAGE) break;
  }
  return all;
}

// `history` is accepted (and ignored) so existing <NavChart history={...} />
// calls in page.tsx keep compiling — the chart now loads its own data.
export default function NavChart({ history: _history, portfolioName }: { history?: NavPoint[]; portfolioName?: string | null }) {
  const [range, setRange] = useState<RangeLabel>("1D");
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    setIsMobile(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [trades, setTrades] = useState<TradeEvent[]>([]);
  const [hoverTradeIdx, setHoverTradeIdx] = useState<number | null>(null);
  const [showTrades, setShowTrades] = useState(true);
  // What the chart (and its PNG export) actually shows — empty when the
  // user has switched position markers off.
  const visibleTrades = useMemo(() => (showTrades ? trades : []), [showTrades, trades]);

  useEffect(() => {
    try {
      if (window.localStorage.getItem("navchart:showTrades") === "0") setShowTrades(false);
    } catch {}
  }, []);

  function toggleShowTrades() {
    setShowTrades((v) => {
      const next = !v;
      try {
        window.localStorage.setItem("navchart:showTrades", next ? "1" : "0");
      } catch {}
      return next;
    });
    setHoverTradeIdx(null);
  }
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

  const dayKey = range === "1D" && points.length > 0 ? stockholmDay(points[0].ts) : null;
  useEffect(() => {
    if (!dayKey) {
      setTrades([]);
      return;
    }
    let cancelled = false;
    supabase
      .from("portfolio_positions")
      .select("id, name, direction, entry_time, exit_time, entry_price, exit_price, quantity, stake_sek")
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        const events: TradeEvent[] = [];
        for (const p of data as any[]) {
          if (p.entry_time && stockholmDay(p.entry_time) === dayKey) {
            events.push({
              ts: p.entry_time,
              kind: "open",
              name: p.name,
              direction: p.direction,
              price: Number(p.entry_price),
              quantity: p.quantity != null ? Number(p.quantity) : null,
              pl: null,
            });
          }
          if (p.exit_time && stockholmDay(p.exit_time) === dayKey) {
            const pl =
              p.quantity != null
                ? (p.exit_price - p.entry_price) * p.quantity
                : p.stake_sek * ((p.exit_price - p.entry_price) / p.entry_price);
            events.push({
              ts: p.exit_time,
              kind: "close",
              name: p.name,
              direction: p.direction,
              price: Number(p.exit_price),
              quantity: p.quantity != null ? Number(p.quantity) : null,
              pl,
            });
          }
        }
        events.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
        setTrades(events);
      });
    return () => {
      cancelled = true;
    };
  }, [dayKey]);

  function buildExportCanvas(): HTMLCanvasElement | null {
    if (points.length < 2) return null;
    const isDailyNow = range === "1D";

    // Recompute the exact same geometry the on-screen chart uses, so the
    // exported image is a faithful copy (gridlines, ticks, colors, trade
    // markers) rather than a redesigned summary graphic.
    const navValues = points.map((p) => p.nav);
    const rawMin = Math.min(...navValues);
    const rawMax = Math.max(...navValues);
    const rawSpread = rawMax - rawMin || 0.02;
    const step = rawSpread / 3 || 0.01;
    const ticks: number[] = [];
    for (let k = -60; k <= 60; k++) {
      const v = 100 + k * step;
      if (v >= rawMin - step && v <= rawMax + step) ticks.push(v);
    }
    if (ticks.length === 0) ticks.push(100);
    const min = ticks[0] - step * 0.15;
    const max = ticks[ticks.length - 1] + step * 0.15;
    const spread = max - min || 1;

    const hasMarkerRowNow = isDailyNow && visibleTrades.length > 0;
    const svgW = 800;
    const svgH = 220;
    const padding = { top: 16, right: 12, bottom: hasMarkerRowNow ? 46 : 24, left: 52 };
    const plotW = svgW - padding.left - padding.right;
    const plotH = svgH - padding.top - padding.bottom;
    const xx = (i: number) => padding.left + (i / (points.length - 1)) * plotW;
    const yy = (nav: number) => padding.top + plotH - ((nav - min) / spread) * plotH;

    const first = points[0].nav;
    const last = points[points.length - 1].nav;
    const isUp = last >= first;
    const periodChange = first !== 0 ? ((last - first) / first) * 100 : 0;
    const overallColor = isUp ? "#34d399" : "#f87171";

    // The chart can only show *when* a trade happened (the marker's
    // position) — the rest of what the on-screen hover shows (name, price,
    // value, result) goes in a numbered legend below, since a static image
    // can't be hovered.
    const dayTrades = isDailyNow ? visibleTrades : [];
    const legendLineH = 15;
    const legendH = dayTrades.length > 0 ? 10 + dayTrades.length * legendLineH + 6 : 0;

    const SCALE = 2; // export at 2x for a crisp image
    const outerPad = 20; // matches the card's own padding
    const headerH = 24;
    const footerH = 26;
    const cardW = svgW + outerPad * 2;
    const cardH = svgH + outerPad * 2 + headerH + footerH + legendH;

    const canvas = document.createElement("canvas");
    canvas.width = cardW * SCALE;
    canvas.height = cardH * SCALE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.scale(SCALE, SCALE);

    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, cardW, cardH);

    ctx.fillStyle = "#171717";
    ctx.strokeStyle = "#262626";
    ctx.lineWidth = 1;
    const cx = 4,
      cy = 4,
      cw = cardW - 8,
      ch = cardH - 8;
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(cx, cy, cw, ch, 14);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(cx, cy, cw, ch);
      ctx.strokeRect(cx, cy, cw, ch);
    }

    const originX = outerPad;
    const originY = outerPad + headerH;

    ctx.fillStyle = "#a1a1aa";
    ctx.font = "500 12px system-ui, sans-serif";
    ctx.textAlign = "left";
    const rangeLabel = RANGES.find((r) => r.label === range)?.label ?? range;
    ctx.fillText(
      portfolioName ? `Vontobel Portfolio · ${portfolioName} · ${rangeLabel}` : `Vontobel Portfolio · ${rangeLabel}`,
      originX,
      originY - 8
    );

    ctx.save();
    ctx.translate(originX, originY);

    ticks.forEach((v) => {
      const isBaseline = v === 100;
      ctx.strokeStyle = isBaseline ? "#52525b" : "#27272a";
      ctx.lineWidth = isBaseline ? 1.25 : 1;
      ctx.setLineDash(isBaseline ? [] : [3, 3]);
      ctx.beginPath();
      ctx.moveTo(padding.left, yy(v));
      ctx.lineTo(svgW - padding.right, yy(v));
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = isBaseline ? "#a1a1aa" : "#737373";
      ctx.font = `${isBaseline ? 600 : 400} 11px system-ui, sans-serif`;
      ctx.textAlign = "right";
      ctx.fillText(v.toFixed(2), padding.left - 8, yy(v) + 4);
    });
    ctx.textAlign = "left";

    const drawArea = (pts: { x: number; nav: number }[], color: string, baseY: number) => {
      ctx.globalAlpha = 0.15;
      ctx.fillStyle = color;
      ctx.beginPath();
      pts.forEach((p, j) => (j === 0 ? ctx.moveTo(p.x, yy(p.nav)) : ctx.lineTo(p.x, yy(p.nav))));
      ctx.lineTo(pts[pts.length - 1].x, baseY);
      ctx.lineTo(pts[0].x, baseY);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      pts.forEach((p, j) => (j === 0 ? ctx.moveTo(p.x, yy(p.nav)) : ctx.lineTo(p.x, yy(p.nav))));
      ctx.stroke();
    };

    if (isDailyNow) {
      const linePixels = points.map((p, i) => ({ x: xx(i), nav: p.nav }));
      let run: { x: number; nav: number }[] = [linePixels[0]];
      let runUp = linePixels[0].nav >= 100;
      const segs: { up: boolean; pts: { x: number; nav: number }[] }[] = [];
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
          segs.push({ up: runUp, pts: run });
          run = [cross, curr];
          runUp = currUp;
        }
      }
      segs.push({ up: runUp, pts: run });
      const yBase = yy(100);
      for (const seg of segs) drawArea(seg.pts, seg.up ? "#34d399" : "#f87171", yBase);
    } else {
      const pts = points.map((p, i) => ({ x: xx(i), nav: p.nav }));
      drawArea(pts, overallColor, padding.top + plotH);
    }

    const X_TICKS = 5;
    const seen = new Set<string>();
    const xLabels: { idx: number; label: string }[] = [];
    for (let i = 0; i < X_TICKS; i++) {
      const idx = Math.round((i / (X_TICKS - 1)) * (points.length - 1));
      const label = isDailyNow
        ? new Date(points[idx].ts).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Stockholm" })
        : new Date(points[idx].ts).toLocaleDateString("sv-SE", { month: "short", day: "numeric", timeZone: "Europe/Stockholm" });
      if (!seen.has(label)) {
        seen.add(label);
        xLabels.push({ idx, label });
      }
    }
    ctx.fillStyle = "#737373";
    ctx.font = "400 11px system-ui, sans-serif";
    xLabels.forEach(({ idx, label }) => {
      ctx.textAlign = idx === 0 ? "left" : idx === points.length - 1 ? "right" : "center";
      ctx.fillText(label, xx(idx), hasMarkerRowNow ? svgH - 35 : svgH - 6 + 4);
    });
    ctx.textAlign = "left";

    if (isDailyNow && visibleTrades.length > 0) {
      visibleTrades.forEach((t, i) => {
        const tTime = new Date(t.ts).getTime();
        let nearest = 0;
        let bestDiff = Infinity;
        points.forEach((p, idx) => {
          const diff = Math.abs(new Date(p.ts).getTime() - tTime);
          if (diff < bestDiff) {
            bestDiff = diff;
            nearest = idx;
          }
        });
        const mx = xx(nearest);
        const my = svgH - 9;
        const isOpen = t.kind === "open";
        const color = isOpen ? "#38bdf8" : t.pl != null && t.pl >= 0 ? "#34d399" : "#f87171";
        const size = 5;
        ctx.fillStyle = color;
        ctx.strokeStyle = "#171717";
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (isOpen) {
          ctx.moveTo(mx - size, my + size);
          ctx.lineTo(mx + size, my + size);
          ctx.lineTo(mx, my - size);
        } else {
          ctx.moveTo(mx - size, my - size);
          ctx.lineTo(mx + size, my - size);
          ctx.lineTo(mx, my + size);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#a1a1aa";
        ctx.font = "600 9px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(String(i + 1), mx, my - size - 7);
        ctx.textAlign = "left";
      });
    }

    ctx.restore();

    if (dayTrades.length > 0) {
      let ly = originY + svgH + 14;
      dayTrades.forEach((t, i) => {
        const timeLabel = new Date(t.ts).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Stockholm" });
        const kindLabel = t.kind === "open" ? "Öppnad" : "Stängd";
        const resultColor = t.kind === "open" ? "#38bdf8" : t.pl != null && t.pl >= 0 ? "#34d399" : "#f87171";
        const name = t.name.length > 20 ? t.name.slice(0, 19) + "…" : t.name;
        const value = t.quantity != null ? t.quantity * t.price : null;

        ctx.textAlign = "left";
        ctx.font = "600 10px system-ui, sans-serif";
        ctx.fillStyle = "#71717a";
        ctx.fillText(`${i + 1}.`, originX, ly);

        ctx.font = "400 10px system-ui, sans-serif";
        ctx.fillStyle = "#a1a1aa";
        ctx.fillText(`${timeLabel} ${kindLabel}`, originX + 16, ly);

        ctx.fillStyle = "#e4e4e7";
        ctx.fillText(name, originX + 96, ly);

        ctx.fillStyle = "#a1a1aa";
        const qtyPrice = t.quantity != null ? `${t.quantity} @ ${t.price.toFixed(2)}` : `@ ${t.price.toFixed(2)}`;
        ctx.fillText(qtyPrice, originX + 290, ly);

        if (value != null) {
          ctx.fillText(`Värde ${value.toLocaleString("sv-SE", { maximumFractionDigits: 0 })} SEK`, originX + 420, ly);
        }

        if (t.kind === "close" && t.pl != null) {
          ctx.textAlign = "right";
          ctx.fillStyle = resultColor;
          ctx.font = "600 10px system-ui, sans-serif";
          ctx.fillText(`${t.pl >= 0 ? "+" : ""}${t.pl.toLocaleString("sv-SE", { maximumFractionDigits: 0 })} SEK`, originX + svgW, ly);
          ctx.textAlign = "left";
        }
        ly += legendLineH;
      });
    }

    ctx.fillStyle = isUp ? "#34d399" : "#f87171";
    ctx.font = "600 13px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(`${periodChange >= 0 ? "+" : ""}${periodChange.toFixed(2)}% under perioden`, cx + cw - 14, cy + ch - 12);
    ctx.textAlign = "left";

    return canvas;
  }

  function handleExport() {
    const canvas = buildExportCanvas();
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const filename = `graf-${range === "1D" ? "dag" : range === "Månad" ? "manad" : range === "År" ? "ar" : "allt"}.png`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }, "image/png");
  }

  const header = (
    <div className="mb-3 flex flex-wrap justify-end gap-2">
      {range === "1D" && (
        <button
          onClick={toggleShowTrades}
          aria-pressed={showTrades}
          title={showTrades ? "Dölj affärer i grafen" : "Visa affärer i grafen"}
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
            showTrades
              ? "border-sky-500/50 bg-sky-500/10 text-sky-300"
              : "border-neutral-800 bg-neutral-950 text-neutral-500 hover:text-neutral-200"
          }`}
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor">
            <path d="M6 1 11 10H1z" />
          </svg>
          Affärer
        </button>
      )}
      <button
        onClick={handleExport}
        title="Exportera graf som PNG"
        className="flex items-center gap-1 rounded-lg border border-neutral-800 bg-neutral-950 px-2.5 py-1 text-xs font-medium text-neutral-400 hover:text-neutral-100"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 3v12m0 0 4-4m-4 4-4-4M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Exportera PNG
      </button>
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
    const height = isMobile ? 320 : 220;
    const hasMarkerRow = range === "1D" && visibleTrades.length > 0;
    const padding = { top: 16, right: 12, bottom: hasMarkerRow ? 40 : 24, left: 52 };
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

    // Trade markers: only meaningful on the 1D view. Each event snaps to
    // the x-position of the chart's nearest point in time (points are
    // already downsampled, so this stays a small, readable set of marks
    // rather than one per raw 10s tick).
    const tradeMarkers = isDaily
      ? visibleTrades.map((t) => {
          const tTime = new Date(t.ts).getTime();
          let nearest = 0;
          let bestDiff = Infinity;
          for (let i = 0; i < points.length; i++) {
            const diff = Math.abs(new Date(points[i].ts).getTime() - tTime);
            if (diff < bestDiff) {
              bestDiff = diff;
              nearest = i;
            }
          }
          return { ...t, mx: x(nearest), cy: y(points[nearest].nav) };
        })
      : [];

    function handlePointer(clientX: number, target: SVGRectElement) {
      const rect = target.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const svgX = frac * width;
      const idx = Math.round(((svgX - padding.left) / plotW) * (points.length - 1));
      setHoverIdx(Math.min(points.length - 1, Math.max(0, idx)));
      // Snap to a trade marker when the pointer is close to one in time, so
      // its guide line and details show up instantly while sweeping across
      // the chart — no need to find the tiny marker row first.
      if (tradeMarkers.length > 0) {
        let best = -1;
        let bestDx = 10; // svg units (~1% of the width)
        tradeMarkers.forEach((t, i) => {
          const dx = Math.abs(t.mx - svgX);
          if (dx < bestDx) {
            bestDx = dx;
            best = i;
          }
        });
        setHoverTradeIdx(best >= 0 ? best : null);
      }
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
              y={hasMarkerRow ? height - 24 : height - 6}
              textAnchor={idx === 0 ? "start" : idx === points.length - 1 ? "end" : "middle"}
              fontSize="11"
              fill="#737373"
            >
              {label}
            </text>
          ))}

          {hover && hoverTradeIdx == null && (
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

          {isDaily &&
            tradeMarkers.map((t, i) => {
              const my = height - 9;
              const isOpen = t.kind === "open";
              const color = isOpen ? "#38bdf8" : t.pl != null && t.pl >= 0 ? UP_COLOR : DOWN_COLOR;
              const size = 6;
              const points_ = isOpen
                ? `${t.mx - size},${my + size} ${t.mx + size},${my + size} ${t.mx},${my - size}` // up-triangle
                : `${t.mx - size},${my - size} ${t.mx + size},${my - size} ${t.mx},${my + size}`; // down-triangle
              const isHovered = hoverTradeIdx === i;
              return (
                <g
                  key={i}
                  onMouseEnter={() => setHoverTradeIdx(i)}
                  onMouseLeave={() => setHoverTradeIdx(null)}
                  onTouchStart={() => setHoverTradeIdx(i)}
                  onTouchEnd={() => setHoverTradeIdx(null)}
                  onTouchCancel={() => setHoverTradeIdx(null)}
                  style={{ cursor: "pointer" }}
                >
                  {/* Dotted guide from the curve point down to the marker —
                      always visible, so it's clear at a glance which moment
                      each marker belongs to; brighter while hovered. */}
                  <line
                    x1={t.mx}
                    x2={t.mx}
                    y1={t.cy}
                    y2={my - size - 1}
                    stroke={color}
                    strokeWidth={isHovered ? 1.5 : 1}
                    strokeDasharray="2 3"
                    opacity={isHovered ? 1 : 0.55}
                  />
                  {/* Ring on the curve itself where the trade happened */}
                  <circle cx={t.mx} cy={t.cy} r={isHovered ? 5 : 3.5} fill="#171717" stroke={color} strokeWidth="2" />
                  <circle cx={t.mx} cy={my} r="12" fill="transparent" />
                  <polygon
                    points={points_}
                    fill={color}
                    stroke={isHovered ? "#ffffff" : "#171717"}
                    strokeWidth={isHovered ? "1.5" : "1"}
                  />
                </g>
              );
            })}

          {isDaily &&
            hoverTradeIdx != null &&
            tradeMarkers[hoverTradeIdx] &&
            (() => {
              const t = tradeMarkers[hoverTradeIdx];
              const timeLabel = new Date(t.ts).toLocaleTimeString("sv-SE", {
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "Europe/Stockholm",
              });
              const kindLabel = t.kind === "open" ? "ÖPPNAD" : "STÄNGD";
              const color = t.kind === "open" ? "#38bdf8" : t.pl != null && t.pl >= 0 ? UP_COLOR : DOWN_COLOR;
              const value = t.quantity != null ? t.quantity * t.price : null;
              const boxW = 160;
              const boxH = (t.kind === "close" ? 54 : 40) + (value != null ? 13 : 0);
              const boxX = Math.min(Math.max(t.mx - boxW / 2, padding.left), width - padding.right - boxW);
              const boxY = padding.top + plotH - boxH - 14;
              return (
                <g pointerEvents="none">
                  <rect x={boxX} y={boxY} width={boxW} height={boxH} rx="6" fill="#171717" stroke="#3f3f46" />
                  <text x={boxX + boxW / 2} y={boxY + 14} textAnchor="middle" fontSize="10" fill="#a1a1aa">
                    {timeLabel} · {kindLabel}
                  </text>
                  <text x={boxX + boxW / 2} y={boxY + 28} textAnchor="middle" fontSize="11" fontWeight={600} fill="#e4e4e7">
                    {t.name.length > 20 ? t.name.slice(0, 19) + "…" : t.name}
                  </text>
                  <text x={boxX + boxW / 2} y={boxY + 41} textAnchor="middle" fontSize="10" fill="#a1a1aa">
                    {t.quantity != null ? `${t.quantity} @ ${t.price.toFixed(2)}` : `@ ${t.price.toFixed(2)}`}
                  </text>
                  {value != null && (
                    <text x={boxX + boxW / 2} y={boxY + 54} textAnchor="middle" fontSize="10" fill="#a1a1aa">
                      Värde {value.toLocaleString("sv-SE", { maximumFractionDigits: 0 })} SEK
                    </text>
                  )}
                  {t.kind === "close" && t.pl != null && (
                    <text
                      x={boxX + boxW / 2}
                      y={boxY + (value != null ? 65 : 52)}
                      textAnchor="middle"
                      fontSize="11"
                      fontWeight={600}
                      fill={color}
                    >
                      {t.pl >= 0 ? "+" : ""}
                      {t.pl.toLocaleString("sv-SE", { maximumFractionDigits: 0 })} SEK
                    </text>
                  )}
                </g>
              );
            })()}

          <rect
            x={padding.left}
            y={padding.top}
            width={plotW}
            height={plotH}
            fill="transparent"
            onMouseMove={(e) => handlePointer(e.clientX, e.currentTarget)}
            onMouseLeave={() => {
              setHoverIdx(null);
              setHoverTradeIdx(null);
            }}
            onTouchStart={(e) => handlePointer(e.touches[0].clientX, e.currentTarget)}
            onTouchMove={(e) => handlePointer(e.touches[0].clientX, e.currentTarget)}
            onTouchEnd={() => {
              setHoverIdx(null);
              setHoverTradeIdx(null);
            }}
            onTouchCancel={() => {
              setHoverIdx(null);
              setHoverTradeIdx(null);
            }}
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
  }, [points, range, hoverIdx, visibleTrades, hoverTradeIdx, isMobile]);

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
