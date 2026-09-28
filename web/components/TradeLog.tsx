"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Position = {
  id: string;
  isin: string;
  name: string;
  underlying: string | null;
  direction: string | null;
  leverage: number | null;
  instrument_type: string | null;
  quantity: number | null;
  stake_sek: number;
  entry_price: number;
  entry_time: string;
  current_price: number | null;
  exit_price: number | null;
  exit_time: string | null;
  status: "open" | "closed";
};

type TradeEvent = { key: string; ts: string; kind: "open" | "close"; p: Position };

const TZ = "Europe/Stockholm";

// Same P/L rule as the dashboard: exact SEK when quantity is known, otherwise
// the stake-based estimate for older positions.
function plOf(p: Position, price: number) {
  return p.quantity != null
    ? (price - p.entry_price) * p.quantity
    : p.stake_sek * ((price - p.entry_price) / p.entry_price);
}
const livePrice = (p: Position) => p.current_price ?? p.entry_price;
const closePrice = (p: Position) => p.exit_price ?? p.entry_price;

const dayKey = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: TZ });
const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const dayLabel = (key: string) =>
  new Date(`${key}T12:00:00`).toLocaleDateString("sv-SE", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const sek = (n: number) => `${n >= 0 ? "+" : ""}${n.toLocaleString("sv-SE", { maximumFractionDigits: 0 })} SEK`;
const pctStr = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
const tone = (n: number) => (n > 0 ? "text-emerald-400" : n < 0 ? "text-red-400" : "text-neutral-300");
function dirLabel(d: string | null | undefined) {
  if (!d) return "–";
  const v = d.toLowerCase();
  if (v === "long") return "Lång";
  if (v === "short") return "Kort";
  return d;
}

export default function TradeLog() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [baseCapital, setBaseCapital] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    const { data } = await supabase
      .from("portfolio_positions")
      .select("*")
      .order("entry_time", { ascending: false });
    setPositions((data as Position[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    supabase
      .from("portfolio_settings")
      .select("cash_sek")
      .single()
      .then(({ data }) => setBaseCapital(data?.cash_sek ?? null));
    const channel = supabase
      .channel("trade-log-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "portfolio_positions" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const summary = useMemo(() => {
    const closed = positions.filter((p) => p.status === "closed");
    const open = positions.filter((p) => p.status === "open");
    const realized = closed.reduce((s, p) => s + plOf(p, closePrice(p)), 0);
    const unrealized = open.reduce((s, p) => s + plOf(p, livePrice(p)), 0);
    const wins = closed.filter((p) => plOf(p, closePrice(p)) > 0).length;
    return {
      closedCount: closed.length,
      openCount: open.length,
      realized,
      unrealized,
      total: realized + unrealized,
      winRate: closed.length > 0 ? (wins / closed.length) * 100 : null,
    };
  }, [positions]);

  const days = useMemo(() => {
    const events: TradeEvent[] = [];
    for (const p of positions) {
      events.push({ key: `${p.id}-open`, ts: p.entry_time, kind: "open", p });
      if (p.status === "closed") {
        events.push({ key: `${p.id}-close`, ts: p.exit_time ?? p.entry_time, kind: "close", p });
      }
    }

    const byDay = new Map<string, TradeEvent[]>();
    for (const ev of events) {
      const k = dayKey(ev.ts);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k)!.push(ev);
    }

    // Cumulative realized P/L is built oldest -> newest, then shown newest first.
    const ascending = [...byDay.keys()].sort();
    let cumulative = 0;
    const built = ascending.map((day) => {
      const evs = byDay.get(day)!;
      const realized = evs
        .filter((e) => e.kind === "close")
        .reduce((s, e) => s + plOf(e.p, closePrice(e.p)), 0);
      cumulative += realized;
      return {
        day,
        events: evs.slice().sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime()),
        realized,
        cumulative,
        opened: evs.filter((e) => e.kind === "open").length,
        closed: evs.filter((e) => e.kind === "close").length,
      };
    });
    return built.reverse();
  }, [positions]);

  const totalPct = baseCapital ? (summary.total / baseCapital) * 100 : null;

  return (
    <>
      <section className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <SummaryCard
          label="Realiserat P/L (stängda)"
          value={sek(summary.realized)}
          valueClass={tone(summary.realized)}
          sub={
            summary.closedCount > 0
              ? `${summary.closedCount} stängda${summary.winRate != null ? ` · ${summary.winRate.toFixed(0)}% vinnare` : ""}`
              : "Inga stängda affärer än"
          }
        />
        <SummaryCard
          label="Orealiserat P/L (öppna)"
          value={sek(summary.unrealized)}
          valueClass={tone(summary.unrealized)}
          sub={`${summary.openCount} ${summary.openCount === 1 ? "öppen position" : "öppna positioner"}`}
        />
        <SummaryCard
          label="Totalt P/L"
          value={sek(summary.total)}
          valueClass={tone(summary.total)}
          sub={totalPct != null ? `${pctStr(totalPct)} av startkapitalet` : undefined}
        />
        <SummaryCard
          label="Affärer"
          value={String(summary.openCount + summary.closedCount)}
          valueClass="text-neutral-100"
          sub={`${summary.openCount} öppna · ${summary.closedCount} stängda`}
        />
      </section>

      {loading && <p className="text-neutral-500">Laddar…</p>}
      {!loading && days.length === 0 && (
        <p className="text-neutral-500">Inga affärer än — lägg till en position under Admin-fliken.</p>
      )}

      <div className="space-y-4">
        {days.map((d) => (
          <section key={d.day} className="overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 bg-neutral-800/40 px-4 py-3">
              <div className="font-medium text-neutral-200">{dayLabel(d.day)}</div>
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 text-xs text-neutral-500">
                <span>
                  {d.opened} öppnade · {d.closed} stängda
                </span>
                {d.closed > 0 && (
                  <span>
                    Realiserat <span className={`font-medium ${tone(d.realized)}`}>{sek(d.realized)}</span>
                  </span>
                )}
                <span>
                  Ackumulerat realiserat <span className={tone(d.cumulative)}>{sek(d.cumulative)}</span>
                </span>
              </div>
            </div>

            {d.events.map((ev) => (
              <EventRow key={ev.key} ev={ev} />
            ))}
          </section>
        ))}
      </div>
    </>
  );
}

function EventRow({ ev }: { ev: TradeEvent }) {
  const { p, kind } = ev;
  const isLong = p.direction?.toLowerCase() === "long";
  const isShort = p.direction?.toLowerCase() === "short";
  const price = kind === "open" ? p.entry_price : closePrice(p);
  const leverage = p.leverage ? `${p.leverage}x` : p.instrument_type ?? "";

  // Close rows carry the realized result. An open row for a position that is
  // still open shows its running (unrealized) result; for one that has since
  // been closed the result lives on its close row, so it shows a dash.
  let plCell: React.ReactNode = <span className="text-neutral-600">–</span>;
  if (kind === "close") {
    const pl = plOf(p, closePrice(p));
    const change = ((closePrice(p) - p.entry_price) / p.entry_price) * 100;
    plCell = (
      <>
        <div className={`text-sm font-semibold ${tone(pl)}`}>{sek(pl)}</div>
        <div className={`text-xs ${tone(pl)}`}>{pctStr(change)}</div>
      </>
    );
  } else if (p.status === "open") {
    const pl = plOf(p, livePrice(p));
    const change = ((livePrice(p) - p.entry_price) / p.entry_price) * 100;
    plCell = (
      <>
        <div className={`text-sm font-medium opacity-80 ${tone(pl)}`}>{sek(pl)}</div>
        <div className="text-[11px] text-neutral-500">
          orealiserat · {pctStr(change)}
        </div>
      </>
    );
  }

  return (
    <div className="flex items-center gap-3 border-t border-neutral-800 px-4 py-3">
      <div className="w-11 shrink-0 text-xs tabular-nums text-neutral-500">{timeOf(ev.ts)}</div>
      <span
        className={`w-14 shrink-0 rounded-md px-2 py-0.5 text-center text-[11px] font-medium tracking-wide ${
          kind === "open" ? "bg-sky-500/15 text-sky-300" : "bg-neutral-100/10 text-neutral-200"
        }`}
      >
        {kind === "open" ? "ÖPPNAD" : "STÄNGD"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-neutral-100">{p.name}</div>
        <div className="truncate text-xs text-neutral-500">
          {p.underlying ? `${p.underlying} · ` : ""}
          <span className={isLong ? "text-emerald-400" : isShort ? "text-red-400" : ""}>{dirLabel(p.direction)}</span>
          {leverage ? ` ${leverage}` : ""}
          {p.quantity != null ? ` · ${p.quantity} @ ${price.toFixed(2)}` : ` · @ ${price.toFixed(2)}`}
        </div>
      </div>
      <div className="shrink-0 text-right">{plCell}</div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  valueClass,
  sub,
}: {
  label: string;
  value: string;
  valueClass: string;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`mt-1 whitespace-nowrap text-xl font-semibold ${valueClass}`}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-neutral-500">{sub}</div>}
    </div>
  );
}
