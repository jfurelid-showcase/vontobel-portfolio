"use client";

type Position = {
  id: string;
  isin: string;
  name: string;
  underlying: string | null;
  direction: string;
  leverage: number | null;
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

export default function PositionCard({ p }: { p: Position }) {
  const price = p.status === "closed" ? p.exit_price! : p.current_price ?? p.entry_price;
  const change = pct(p.entry_price, price);
  const isUp = change >= 0;
  const toTarget = p.target_price ? pct(price, p.target_price) : null;
  const toStop = p.stop_loss ? pct(price, p.stop_loss) : null;

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="font-semibold text-neutral-100">{p.name}</div>
          <div className="text-xs text-neutral-500">
            {p.underlying} · {p.direction} {p.leverage ? `${p.leverage}x` : ""}
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

      {(p.note || p.podcast_episode) && (
        <div className="mt-3 rounded-lg bg-neutral-800/60 p-3 text-sm text-neutral-300">
          {p.note && <p>{p.note}</p>}
          {p.podcast_episode && <p className="mt-1 text-xs text-neutral-500">🎙️ {p.podcast_episode}</p>}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: number | null; sub?: string }) {
  return (
    <div>
      <div className="text-neutral-500">{label}</div>
      <div className="font-medium text-neutral-100">
        {value ?? "–"} {sub && <span className="ml-1 text-xs text-neutral-500">({sub})</span>}
      </div>
    </div>
  );
}
