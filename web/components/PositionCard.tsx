"use client";

import TradeNote from "./TradeNote";

type Position = {
  id: string;
  isin: string;
  name: string;
  underlying: string | null;
  direction: string;
  leverage: number | null;
  instrument_type: string | null;
  quantity: number | null;
  entry_price: number;
  entry_time: string;
  current_price: number | null;
  current_updated_at: string | null;
  stop_loss: number | null;
  target_price: number | null;
  status: "open" | "closed";
  exit_price: number | null;
  note: string | null;
  podcast_episode: string | null;
};

function pct(from: number, to: number) {
  return ((to - from) / from) * 100;
}

function fmt2(n: number | null | undefined) {
  return n == null ? "–" : n.toFixed(2);
}

export default function PositionCard({ p }: { p: Position }) {
  const price = p.status === "closed" ? p.exit_price! : p.current_price ?? p.entry_price;
  const change = pct(p.entry_price, price);
  const isUp = change >= 0;
  const toTarget = p.target_price ? pct(price, p.target_price) : null;
  const toStop = p.stop_loss ? pct(price, p.stop_loss) : null;
  // Turbo warrants don't have a fixed leverage (NGM reports null for them —
  // it changes continuously with distance to the barrier), so fall back to
  // showing the instrument type instead of a made-up number.
  const leverageOrType = p.leverage ? `${p.leverage}x` : p.instrument_type ?? "";

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="font-semibold text-neutral-100">{p.name}</div>
          <div className="text-xs text-neutral-500">
            {p.underlying} · {p.direction} {leverageOrType}
            {p.quantity ? ` · ${p.quantity} contracts` : ""}
          </div>
        </div>
        <span
          className={`rounded-full px-2 py-1 text-xs font-medium ${
            isUp ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
          }`}
        >
          {isUp ? "+" : ""}
          {change.toFixed(2)}%
        </span>
      </div>

      <div className="grid grid-cols-2 gap-y-3 text-sm">
        <Stat label="Entry price" value={p.entry_price} />
        <Stat label="Stop loss" value={p.stop_loss} sub={toStop != null ? `${toStop.toFixed(2)}%` : undefined} />
        <Stat label={p.status === "closed" ? "Exit price" : "Price"} value={price} />
        <Stat
          label="Target"
          value={p.target_price}
          sub={toTarget != null ? `+${toTarget.toFixed(2)}%` : undefined}
        />
      </div>

      <div className="mt-3 text-xs text-neutral-500">
        Entry {new Date(p.entry_time).toLocaleString("sv-SE")}
        {p.current_updated_at && p.status === "open" && (
          <> · updated {new Date(p.current_updated_at).toLocaleTimeString("sv-SE")}</>
        )}
      </div>

      <TradeNote note={p.note} podcastEpisode={p.podcast_episode} />
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: number | null; sub?: string }) {
  return (
    <div>
      <div className="text-neutral-500">{label}</div>
      <div className="font-medium text-neutral-100">
        {fmt2(value)} {sub && <span className="ml-1 text-xs text-neutral-500">({sub})</span>}
      </div>
    </div>
  );
}
