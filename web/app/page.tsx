"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { pctChangeSince, startOfDayStockholm, startOfMonth, startOfYear } from "@/lib/nav";
import PositionCard from "@/components/PositionCard";

type Position = Parameters<typeof PositionCard>[0]["p"];
type NavPoint = { ts: string; nav: number };

export default function Dashboard() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [navHistory, setNavHistory] = useState<NavPoint[]>([]);

  async function loadAll() {
    const [{ data: pos }, { data: nav }] = await Promise.all([
      supabase.from("portfolio_positions").select("*").order("created_at", { ascending: false }),
      supabase.from("nav_history").select("ts, nav").order("ts", { ascending: true }).limit(20000),
    ]);
    setPositions((pos as Position[]) || []);
    setNavHistory((nav as NavPoint[]) || []);
  }

  useEffect(() => {
    loadAll();

    // Live updates via Supabase Realtime — no polling needed. The worker
    // writes to these tables and every open browser tab gets pushed the
    // change immediately.
    const channel = supabase
      .channel("portfolio-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "portfolio_positions" }, loadAll)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "nav_history" }, loadAll)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const latestNav = navHistory.at(-1)?.nav ?? 100;
  const dailyPct = useMemo(() => pctChangeSince(navHistory, latestNav, startOfDayStockholm()), [navHistory, latestNav]);
  const monthlyPct = useMemo(() => pctChangeSince(navHistory, latestNav, startOfMonth()), [navHistory, latestNav]);
  const ytdPct = useMemo(() => pctChangeSince(navHistory, latestNav, startOfYear()), [navHistory, latestNav]);

  const open = positions.filter((p) => p.status === "open");
  const closed = positions.filter((p) => p.status === "closed");

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 text-neutral-100">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Vontobel Portfolio</h1>
        <Link href="/admin" className="text-sm text-neutral-400 hover:text-neutral-100">
          Admin →
        </Link>
      </div>

      <section className="mb-10 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <NavStat label="NAV" value={latestNav.toFixed(2)} />
        <NavStat label="Today" value={fmtPct(dailyPct)} isPct pctValue={dailyPct} />
        <NavStat label="This month" value={fmtPct(monthlyPct)} isPct pctValue={monthlyPct} />
        <NavStat label="YTD" value={fmtPct(ytdPct)} isPct pctValue={ytdPct} />
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-medium text-neutral-300">Open positions ({open.length})</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {open.map((p) => (
            <PositionCard key={p.id} p={p} />
          ))}
          {open.length === 0 && <p className="text-neutral-500">No open positions yet.</p>}
        </div>
      </section>

      {closed.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-medium text-neutral-300">Closed positions ({closed.length})</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {closed.map((p) => (
              <PositionCard key={p.id} p={p} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function fmtPct(v: number | null) {
  if (v == null) return "–";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function NavStat({
  label,
  value,
  isPct,
  pctValue,
}: {
  label: string;
  value: string;
  isPct?: boolean;
  pctValue?: number | null;
}) {
  const color = isPct ? (pctValue == null ? "text-neutral-100" : pctValue >= 0 ? "text-emerald-400" : "text-red-400") : "text-neutral-100";
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}
