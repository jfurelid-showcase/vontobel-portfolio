"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { usePortfolio } from "@/lib/portfolioClient";
import { useResync } from "@/lib/useResync";

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
  close_reason?: string | null; // "stop_loss" | "take_profit" when closed automatically, "trim" for a part-sale
  adds?: number | null;
  parent_position_id?: string | null; // set on the closed row a part-sale creates
  note?: string | null; // gästens kommentar till affären
  podcast_episode?: string | null;
  opposite_isin?: string | null; // produkt i motsatt riktning (väljs automatiskt)
  opposite_name?: string | null;
  opposite_leverage?: number | null; // hävstång enligt Vontobel
  own_leverage?: number | null;
};

const levFmt = (v: number | null | undefined) =>
  v == null || !isFinite(Number(v)) ? null
    : Number(v).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Länk till produktsidan hos Vontobel (svenska sidan), utifrån namnets prefix.
function vontobelUrl(name: string, isin?: string | null) {
  const pre = name.trim().split(/\s+/)[0].toUpperCase();
  const type = pre === "BULL" || pre === "BEAR" ? "bull-bear-certifikat"
    : pre === "MFL" || pre === "MFS" ? "mini-futures"
    : pre === "TLNG" || pre === "TSRT" || pre === "TSHO" ? "knock-out-warrants-open-end" : "";
  return type && isin
    ? `https://markets.vontobel.com/sv-se/produkter/leverage/${type}/${encodeURIComponent(isin)}`
    : "https://markets.vontobel.com/sv-se/produkter";
}

// One entry in the journal of a position that has been added to or partly sold
// (position_fills): the opening, each "Köp mer" and each "Sälj del".
type Fill = {
  id: number;
  position_id: string;
  ts: string;
  kind: "open" | "add" | "trim";
  quantity: number;
  price: number;
  avg_cost: number; // the GAV right after this event
  realized_pl_sek: number | null; // part-sales only
};

type TradeEvent = { key: string; ts: string; kind: "open" | "close"; p: Position; fill?: Fill };

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
  const { id: portfolioId } = usePortfolio();
  const [positions, setPositions] = useState<Position[]>([]);
  const [fills, setFills] = useState<Fill[]>([]);
  const [baseCapital, setBaseCapital] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    const { data } = await supabase
      .from("portfolio_positions")
      .select("*")
      .eq("portfolio_id", portfolioId)
      .order("entry_time", { ascending: false });
    setPositions((data as Position[]) ?? []);
    // The journal of buys and part-sales. If the table doesn't exist yet (0006_add_trim.sql
    // not run) the log simply works from the positions alone, as before.
    const { data: f, error: fErr } = await supabase
      .from("position_fills")
      .select("id, position_id, ts, kind, quantity, price, avg_cost, realized_pl_sek")
      .eq("portfolio_id", portfolioId)
      .order("ts", { ascending: true })
      .order("id", { ascending: true });
    setFills(fErr ? [] : ((f as Fill[]) ?? []));
    setLoading(false);
  }

  // Back on the page after it was in the background: the live-update
  // connection may have been paused, so reload instead of waiting for an event.
  useResync(load);

  useEffect(() => {
    load();
    supabase
      .from("portfolio_settings")
      .select("cash_sek")
      .eq("id", portfolioId)
      .single()
      .then(({ data }) => setBaseCapital(data?.cash_sek ?? null));
    const channel = supabase
      .channel(`trade-log-live-${portfolioId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "portfolio_positions", filter: `portfolio_id=eq.${portfolioId}` },
        load
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [portfolioId]);

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
    // A position with a journal shows each buy and part-sale as its own event (at the time and
    // price it really happened); the sold parts' own closed rows are skipped, since the
    // part-sale event already covers them. Other positions show open/close as before.
    const fillsBy = new Map<string, Fill[]>();
    for (const f of fills) fillsBy.set(f.position_id, [...(fillsBy.get(f.position_id) ?? []), f]);

    const events: TradeEvent[] = [];
    for (const p of positions) {
      // (Only when the journal is there to show the part-sale; otherwise it stays a closed trade.)
      if (p.parent_position_id && fillsBy.has(p.parent_position_id)) continue;
      const fl = fillsBy.get(p.id);
      if (fl && fl.length > 0) {
        for (const f of fl) {
          events.push({ key: `fill-${f.id}`, ts: f.ts, kind: f.kind === "trim" ? "close" : "open", p, fill: f });
        }
      } else {
        events.push({ key: `${p.id}-open`, ts: p.entry_time, kind: "open", p });
      }
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
        .reduce((s, e) => s + (e.fill ? Number(e.fill.realized_pl_sek ?? 0) : plOf(e.p, closePrice(e.p))), 0);
      cumulative += realized;
      return {
        day,
        events: evs.slice().sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime()),
        realized,
        cumulative,
        // new positions and full closes (buying more / selling part are not counted as either)
        opened: evs.filter((e) => e.kind === "open" && e.fill?.kind !== "add").length,
        closed: evs.filter((e) => e.kind === "close" && e.fill?.kind !== "trim").length,
      };
    });
    return built.reverse();
  }, [positions, fills]);

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

// Tar bort raden "Produkt i motsatt riktning: …" och rader med bara den
// produktens namn (med eller utan hävstång inom parentes) ur kommentaren.
function stripOpposite(note: string, name: string): string {
  const target = name.trim().toUpperCase();
  return note
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      if (/^(produkt i )?motsatt riktning:/i.test(t)) return false;
      return t.replace(/\s*\(.*\)\s*$/, "").toUpperCase() !== target;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function EventRow({ ev }: { ev: TradeEvent }) {
  const { p, kind, fill } = ev;
  // Kommentaren hör till när positionen tas, så den visas (hopfälld) på öppningsraden.
  const isOpening = kind === "open" && (!fill || fill.kind === "open");
  const opposite = isOpening && p.opposite_name ? p.opposite_name.trim() : "";
  // Står produkten redan i kommentarens text tas den raden bort där; den visas
  // i stället som en länk under kommentaren (som på skininthegame.se).
  const rawNote = isOpening ? (p.note ?? "").trim() : "";
  // Raden kan stå var som helst i kommentaren (även först), så alla sådana rader tas bort.
  // Tas också bort: en rad med bara produktnamnet (t.ex. "MFL APPLE VT307"), eftersom
  // den redan visas som länk under kommentaren.
  const comment = opposite ? stripOpposite(rawNote, opposite) : rawNote;
  const hasComment = !!comment || !!opposite || (isOpening && !!p.podcast_episode);
  const [showComment, setShowComment] = useState(false);
  const isLong = p.direction?.toLowerCase() === "long";
  const isShort = p.direction?.toLowerCase() === "short";
  // A journal event carries its own price and quantity; otherwise it is the position's own.
  const price = fill ? Number(fill.price) : kind === "open" ? p.entry_price : closePrice(p);
  const qty = fill ? Number(fill.quantity) : p.quantity;
  const label = fill?.kind === "add" ? "KÖPT TILL" : fill?.kind === "trim" ? "SÅLD DEL" : kind === "open" ? "ÖPPNAD" : "STÄNGD";
  const leverage = p.leverage ? `${p.leverage}x` : p.instrument_type ?? "";

  // Close rows carry the realized result. An open row for a position that is
  // still open shows its running (unrealized) result; for one that has since
  // been closed the result lives on its close row, so it shows a dash.
  let plCell: React.ReactNode = <span className="text-neutral-600">–</span>;
  if (fill?.kind === "trim") {
    const pl = Number(fill.realized_pl_sek ?? 0);
    const change = ((price - Number(fill.avg_cost)) / Number(fill.avg_cost)) * 100;
    plCell = (
      <>
        <div className={`text-sm font-semibold ${tone(pl)}`}>{sek(pl)}</div>
        <div className={`text-xs ${tone(pl)}`}>{pctStr(change)}</div>
      </>
    );
  } else if (fill && p.status === "open") {
    // A buy: how that purchase is doing now.
    const pl = fill.quantity * (livePrice(p) - fill.price);
    const change = ((livePrice(p) - fill.price) / fill.price) * 100;
    plCell = (
      <>
        <div className={`text-sm font-medium opacity-80 ${tone(pl)}`}>{sek(pl)}</div>
        <div className="text-[11px] text-neutral-500">orealiserat · {pctStr(change)}</div>
      </>
    );
  } else if (fill) {
    plCell = <span className="text-neutral-600">–</span>;
  } else if (kind === "close") {
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
    <div className="border-t border-neutral-800">
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="w-11 shrink-0 text-xs tabular-nums text-neutral-500">{timeOf(ev.ts)}</div>
      <span
        className={`w-[4.9rem] shrink-0 whitespace-nowrap rounded-md px-2 py-0.5 text-center text-[11px] font-medium tracking-wide ${
          kind === "open" ? "bg-sky-500/15 text-sky-300" : "bg-neutral-100/10 text-neutral-200"
        }`}
      >
        {label}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-neutral-100">{p.name}</div>
        <div className="truncate text-xs text-neutral-500">
          {p.underlying ? `${p.underlying} · ` : ""}
          <span className={isLong ? "text-emerald-400" : isShort ? "text-red-400" : ""}>{dirLabel(p.direction)}</span>
          {leverage ? ` ${leverage}` : ""}
          {qty != null ? ` · ${qty} @ ${price.toFixed(2)}` : ` · @ ${price.toFixed(2)}`}
          {fill?.kind === "add" && <span className="text-neutral-400"> · GAV nu {Number(fill.avg_cost).toFixed(2)}</span>}
          {fill?.kind === "trim" && <span className="text-neutral-400"> · GAV {Number(fill.avg_cost).toFixed(2)}</span>}
          {kind === "close" && !fill && p.close_reason === "stop_loss" && <span className="text-amber-300"> · automatisk stop loss</span>}
          {kind === "close" && !fill && p.close_reason === "take_profit" && <span className="text-amber-300"> · automatiskt mål</span>}
        </div>
        {hasComment && (
          <button
            type="button"
            onClick={() => setShowComment((v) => !v)}
            aria-expanded={showComment}
            className="mt-1 inline-flex items-center gap-1 rounded-md bg-amber-400/10 px-2 py-0.5 text-[11px] font-medium text-amber-300 hover:bg-amber-400/20"
          >
            <span aria-hidden="true" className={`inline-block transition-transform ${showComment ? "rotate-90" : ""}`}>▸</span>
            {showComment ? "Dölj kommentar" : "Visa kommentar"}
          </button>
        )}
      </div>
      <div className="shrink-0 text-right">{plCell}</div>
    </div>
    {hasComment && showComment && (
      <div className="mx-4 mb-3 whitespace-pre-line rounded-lg border-l-2 border-amber-400 bg-amber-400/10 px-3 py-2 text-sm leading-relaxed text-neutral-200">
        {comment}
        {opposite && (
          <div className={`${comment ? "mt-2" : ""} text-xs text-neutral-400`}>
            Produkt i motsatt riktning:{" "}
            <a
              href={vontobelUrl(opposite, p.opposite_isin)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-amber-300 underline underline-offset-2 hover:text-amber-200"
            >
              {opposite} ↗
            </a>
            {(levFmt(p.opposite_leverage) || levFmt(p.own_leverage)) && (
              <div className="mt-0.5 text-[11px] text-neutral-500">
                {levFmt(p.opposite_leverage) && `hävstång ${levFmt(p.opposite_leverage)}`}
                {levFmt(p.opposite_leverage) && levFmt(p.own_leverage) && " · "}
                {levFmt(p.own_leverage) && `positionens hävstång ${levFmt(p.own_leverage)}`}
              </div>
            )}
          </div>
        )}
        {/* Avsnittet sist i kommentaren. */}
        {isOpening && p.podcast_episode && (
          <div className={`${comment || opposite ? "mt-2" : ""} text-xs text-amber-300`}>🎙 {p.podcast_episode}</div>
        )}
      </div>
    )}
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
