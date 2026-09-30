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

function dirLabel(d: string | null | undefined) {
  if (!d) return "–";
  const v = d.toLowerCase();
  if (v === "long") return "Lång";
  if (v === "short") return "Kort";
  return d;
}

function computeValueAndPl(p: Position, price: number) {
  // No stake_sek on this type (older code path), so fall back to a plain
  // quantity*price value when quantity is missing rather than guessing.
  const value = p.quantity != null ? price * p.quantity : null;
  const pl = p.quantity != null ? (price - p.entry_price) * p.quantity : null;
  return { value, pl };
}

function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "position"
  );
}

function exportPositionCard(p: Position) {
  const price = p.status === "closed" ? p.exit_price! : p.current_price ?? p.entry_price;
  const change = pct(p.entry_price, price);
  const isUp = change >= 0;
  const toTarget = p.target_price ? pct(price, p.target_price) : null;
  const toStop = p.stop_loss ? pct(price, p.stop_loss) : null;
  const leverageOrType = p.leverage ? `${p.leverage}x` : p.instrument_type ?? "";
  const { value, pl } = computeValueAndPl(p, price);
  const changeColor = isUp ? "#34d399" : "#f87171";

  const SCALE = 2;
  const W = 520;
  const padOut = 22;
  let h = 180; // header + stats grid baseline height
  if (p.note || p.podcast_episode) h += 70;
  const H = h;

  const canvas = document.createElement("canvas");
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(SCALE, SCALE);

  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#171717";
  ctx.strokeStyle = "#262626";
  ctx.lineWidth = 1;
  const cx = 4,
    cy = 4,
    cw = W - 8,
    ch = H - 8;
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(cx, cy, cw, ch, 14);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillRect(cx, cy, cw, ch);
    ctx.strokeRect(cx, cy, cw, ch);
  }
  // direction-colored left accent, matching the position list's convention
  const isLong = p.direction?.toLowerCase() === "long";
  const isShort = p.direction?.toLowerCase() === "short";
  ctx.fillStyle = isLong ? "#10b981" : isShort ? "#ef4444" : "#3f3f46";
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(cx, cy, 3, ch, [14, 0, 0, 14]);
    ctx.fill();
  }

  const x = padOut + 6;
  let y = padOut;

  ctx.fillStyle = "#71717a";
  ctx.font = "500 11px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("Vontobel Portfolio", x, y + 10);
  y += 24;

  ctx.fillStyle = "#f5f5f5";
  ctx.font = "700 17px system-ui, sans-serif";
  ctx.fillText(p.name, x, y + 12);
  ctx.fillStyle = "#71717a";
  ctx.font = "400 11px system-ui, sans-serif";
  ctx.fillText(p.isin, x, y + 28);

  ctx.textAlign = "right";
  ctx.fillStyle = changeColor;
  ctx.font = "700 22px system-ui, sans-serif";
  ctx.fillText(`${isUp ? "+" : ""}${change.toFixed(2)}%`, x + W - padOut * 2 - 12, y + 16);
  if (pl != null) {
    ctx.font = "600 12px system-ui, sans-serif";
    ctx.fillText(`${pl >= 0 ? "+" : ""}${pl.toLocaleString("sv-SE", { maximumFractionDigits: 0 })} SEK`, x + W - padOut * 2 - 12, y + 32);
  }
  ctx.textAlign = "left";
  y += 44;

  ctx.fillStyle = "#a1a1aa";
  ctx.font = "400 12px system-ui, sans-serif";
  const subParts = [p.underlying ?? "–", `${dirLabel(p.direction)} ${leverageOrType}`.trim()];
  if (p.quantity) subParts.push(`${p.quantity} kontrakt`);
  ctx.fillText(subParts.join(" · "), x, y + 10);
  y += 28;

  const stats: [string, string, string?][] = [
    ["Ingångspris", fmt2(p.entry_price)],
    ["Stop loss", fmt2(p.stop_loss), toStop != null ? `${toStop.toFixed(2)}%` : undefined],
    [p.status === "closed" ? "Utgångspris" : "Pris", fmt2(price)],
    ["Mål", fmt2(p.target_price), toTarget != null ? `+${toTarget.toFixed(2)}%` : undefined],
  ];
  const colW = (W - padOut * 2 - 12) / 2;
  stats.forEach(([label, val, sub], i) => {
    const sx = x + (i % 2) * colW;
    const sy = y + Math.floor(i / 2) * 42;
    ctx.fillStyle = "#71717a";
    ctx.font = "400 11px system-ui, sans-serif";
    ctx.fillText(label, sx, sy);
    ctx.fillStyle = "#f5f5f5";
    ctx.font = "600 14px system-ui, sans-serif";
    ctx.fillText(val + (sub ? `  (${sub})` : ""), sx, sy + 18);
  });
  y += 42 * 2 + 8;

  if (value != null) {
    ctx.fillStyle = "#71717a";
    ctx.font = "400 11px system-ui, sans-serif";
    ctx.fillText("Värde", x, y);
    ctx.fillStyle = "#f5f5f5";
    ctx.font = "600 14px system-ui, sans-serif";
    ctx.fillText(`${value.toLocaleString("sv-SE", { maximumFractionDigits: 0 })} SEK`, x, y + 18);
    y += 34;
  }

  ctx.fillStyle = "#52525b";
  ctx.font = "400 10px system-ui, sans-serif";
  let timeLine = `Ingång ${new Date(p.entry_time).toLocaleString("sv-SE")}`;
  if (p.current_updated_at && p.status === "open") {
    timeLine += ` · uppdaterad ${new Date(p.current_updated_at).toLocaleTimeString("sv-SE")}`;
  }
  ctx.fillText(timeLine, x, y + 8);
  y += 22;

  if (p.note || p.podcast_episode) {
    ctx.fillStyle = "#2a2410";
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(x, y, W - padOut * 2 - 12, 46, 6);
      ctx.fill();
    }
    let ny = y + 16;
    ctx.fillStyle = "#e7c66b";
    ctx.font = "500 11px system-ui, sans-serif";
    if (p.note) {
      ctx.fillText(p.note.length > 60 ? p.note.slice(0, 59) + "…" : p.note, x + 10, ny);
      ny += 16;
    }
    if (p.podcast_episode) {
      ctx.font = "400 10px system-ui, sans-serif";
      ctx.fillText(`🎙️ ${p.podcast_episode}`, x + 10, ny);
    }
  }

  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `position-${slugify(p.name)}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, "image/png");
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
            {p.underlying} · {dirLabel(p.direction)} {leverageOrType}
            {p.quantity ? ` · ${p.quantity} kontrakt` : ""}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => exportPositionCard(p)}
            title="Exportera position som PNG"
            className="rounded-md p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
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
          </button>
          <span
            className={`rounded-full px-2 py-1 text-xs font-medium ${
              isUp ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
            }`}
          >
            {isUp ? "+" : ""}
            {change.toFixed(2)}%
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-y-3 text-sm">
        <Stat label="Ingångspris" value={p.entry_price} />
        <Stat label="Stop loss" value={p.stop_loss} sub={toStop != null ? `${toStop.toFixed(2)}%` : undefined} />
        <Stat label={p.status === "closed" ? "Utgångspris" : "Pris"} value={price} />
        <Stat
          label="Mål"
          value={p.target_price}
          sub={toTarget != null ? `+${toTarget.toFixed(2)}%` : undefined}
        />
      </div>

      <div className="mt-3 text-xs text-neutral-500">
        Ingång {new Date(p.entry_time).toLocaleString("sv-SE")}
        {p.current_updated_at && p.status === "open" && (
          <> · uppdaterad {new Date(p.current_updated_at).toLocaleTimeString("sv-SE")}</>
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
