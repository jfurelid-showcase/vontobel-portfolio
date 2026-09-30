"use client";

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
  current_price: number | null;
  exit_price: number | null;
  status: "open" | "closed";
  stop_loss: number | null;
  target_price: number | null;
};

function dirLabel(d: string | null | undefined) {
  if (!d) return "–";
  const v = d.toLowerCase();
  if (v === "long") return "Lång";
  if (v === "short") return "Kort";
  return d;
}

function cardMetrics(p: Position) {
  const price = p.status === "closed" ? p.exit_price ?? p.entry_price : p.current_price ?? p.entry_price;
  const change = ((price - p.entry_price) / p.entry_price) * 100;
  const value = p.quantity != null ? price * p.quantity : p.stake_sek * (price / p.entry_price);
  const pl = p.quantity != null ? (price - p.entry_price) * p.quantity : p.stake_sek * (change / 100);
  return { price, change, value, pl };
}

function drawCard(
  ctx: CanvasRenderingContext2D,
  p: Position,
  x: number,
  y: number,
  w: number,
  h: number
) {
  const isLong = p.direction?.toLowerCase() === "long";
  const isShort = p.direction?.toLowerCase() === "short";
  const borderColor = isLong ? "#10b981" : isShort ? "#ef4444" : "#3f3f46";
  const { price, change, value, pl } = cardMetrics(p);
  const isUp = change >= 0;
  const changeColor = isUp ? "#34d399" : "#f87171";

  ctx.fillStyle = "#171717";
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 10);
    ctx.fill();
  } else {
    ctx.fillRect(x, y, w, h);
  }
  ctx.fillStyle = borderColor;
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(x, y, 3, h, [10, 0, 0, 10]);
    ctx.fill();
  } else {
    ctx.fillRect(x, y, 3, h);
  }

  const padX = 16;
  const leverageOrType = p.leverage ? `${p.leverage}x` : p.instrument_type ?? "";

  ctx.textAlign = "left";
  ctx.fillStyle = "#f5f5f5";
  ctx.font = "600 14px system-ui, sans-serif";
  ctx.fillText(p.name, x + padX, y + 24);

  ctx.font = "400 11px system-ui, sans-serif";
  ctx.fillStyle = "#737373";
  const subParts = [p.underlying ?? "–", `${dirLabel(p.direction)} ${leverageOrType}`.trim()];
  if (p.quantity) subParts.push(`${p.quantity} kontrakt`);
  ctx.fillText(subParts.join(" · "), x + padX, y + 40);

  ctx.textAlign = "right";
  ctx.fillStyle = changeColor;
  ctx.font = "700 16px system-ui, sans-serif";
  ctx.fillText(`${isUp ? "+" : ""}${change.toFixed(2)}%`, x + w - padX, y + 24);
  ctx.font = "400 11px system-ui, sans-serif";
  ctx.fillText(
    `${pl >= 0 ? "+" : ""}${pl.toLocaleString("sv-SE", { maximumFractionDigits: 0 })} SEK`,
    x + w - padX,
    y + 40
  );

  const stats: [string, string][] = [
    ["Ingång", price != null ? p.entry_price.toFixed(2) : "–"],
    [p.status === "closed" ? "Utgång" : "Nu", price != null ? price.toFixed(2) : "–"],
    ["Värde", value.toLocaleString("sv-SE", { maximumFractionDigits: 0 })],
    ["Stop / Mål", `${p.stop_loss ?? "–"} / ${p.target_price ?? "–"}`],
  ];
  const colW = (w - padX * 2) / 4;
  stats.forEach(([label, val], i) => {
    const sx = x + padX + i * colW;
    ctx.textAlign = "left";
    ctx.fillStyle = "#737373";
    ctx.font = "400 10px system-ui, sans-serif";
    ctx.fillText(label, sx, y + 62);
    ctx.fillStyle = "#d4d4d8";
    ctx.font = "500 11px system-ui, sans-serif";
    ctx.fillText(val, sx, y + 76);
  });
}

export default function PositionsExportButton({
  open,
  closed,
  closedAllCount,
  totalOpenPl,
  portfolioName,
}: {
  open: Position[];
  closed: Position[];
  closedAllCount: number;
  totalOpenPl: number;
  portfolioName: string | null;
}) {
  function handleExport() {
    const SCALE = 2;
    const outerPad = 20;
    const width = 640;
    const cardH = 92;
    const cardGap = 10;
    const headerH = 44;
    const sectionHeaderH = 30;
    const footerH = 24;

    const hasClosed = closed.length > 0;
    const openBlockH = open.length > 0 ? open.length * (cardH + cardGap) : 28;
    const closedBlockH = hasClosed ? sectionHeaderH + closed.length * (cardH + cardGap) : 0;
    const contentH = headerH + openBlockH + closedBlockH + footerH;
    const cardOuterW = width + outerPad * 2;
    const cardOuterH = contentH + outerPad * 2;

    const canvas = document.createElement("canvas");
    canvas.width = cardOuterW * SCALE;
    canvas.height = cardOuterH * SCALE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(SCALE, SCALE);

    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, cardOuterW, cardOuterH);
    ctx.fillStyle = "#171717";
    ctx.strokeStyle = "#262626";
    ctx.lineWidth = 1;
    const cx = 4,
      cy = 4,
      cw = cardOuterW - 8,
      chh = cardOuterH - 8;
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(cx, cy, cw, chh, 14);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(cx, cy, cw, chh);
      ctx.strokeRect(cx, cy, cw, chh);
    }

    let y = outerPad;
    const x = outerPad;

    ctx.textAlign = "left";
    ctx.fillStyle = "#a1a1aa";
    ctx.font = "500 12px system-ui, sans-serif";
    ctx.fillText(portfolioName ? `Vontobel Portfolio · ${portfolioName}` : "Vontobel Portfolio", x, y + 14);

    ctx.fillStyle = "#e4e4e7";
    ctx.font = "600 15px system-ui, sans-serif";
    ctx.fillText(`Öppna positioner (${open.length})`, x, y + 34);
    if (open.length > 0) {
      ctx.textAlign = "right";
      ctx.fillStyle = totalOpenPl >= 0 ? "#34d399" : "#f87171";
      ctx.font = "600 13px system-ui, sans-serif";
      ctx.fillText(
        `${totalOpenPl >= 0 ? "+" : ""}${totalOpenPl.toLocaleString("sv-SE", { maximumFractionDigits: 0 })} SEK öppet P/L`,
        x + width,
        y + 34
      );
      ctx.textAlign = "left";
    }
    y += headerH;

    if (open.length === 0) {
      ctx.fillStyle = "#71717a";
      ctx.font = "400 12px system-ui, sans-serif";
      ctx.fillText("Inga öppna positioner.", x, y + 18);
      y += 28;
    } else {
      open.forEach((p) => {
        drawCard(ctx, p, x, y, width, cardH);
        y += cardH + cardGap;
      });
    }

    if (hasClosed) {
      ctx.fillStyle = "#e4e4e7";
      ctx.font = "600 15px system-ui, sans-serif";
      ctx.fillText(
        `Nyligen stängda (${closed.length}${closedAllCount > closed.length ? ` av ${closedAllCount}` : ""})`,
        x,
        y + 16
      );
      y += sectionHeaderH;
      closed.forEach((p) => {
        drawCard(ctx, p, x, y, width, cardH);
        y += cardH + cardGap;
      });
    }

    ctx.fillStyle = "#52525b";
    ctx.font = "400 11px system-ui, sans-serif";
    ctx.fillText(`Exporterad ${new Date().toLocaleString("sv-SE")}`, x, cy + chh - 10);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "positioner.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }, "image/png");
  }

  return (
    <button
      onClick={handleExport}
      title="Exportera positioner som PNG"
      className="flex items-center gap-1 rounded-lg border border-neutral-800 bg-neutral-900 px-2.5 py-1 text-xs font-medium text-neutral-400 hover:text-neutral-100"
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
  );
}
