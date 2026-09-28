import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const num = (v: unknown) => (v == null || v === "" ? null : Number(v));

// GET /api/portfolio/export?id=<archive id>&type=trades
// Returns every trade of an archived portfolio as a CSV file.
// (The NAV history is exported from the browser — it can be hundreds of
// thousands of rows, more than a single serverless response can carry.)
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const type = req.nextUrl.searchParams.get("type") ?? "trades";
  if (!UUID.test(id) || type !== "trades") {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("portfolio_archives")
    .select("name, positions, started_at, ended_at")
    .eq("id", id)
    .single();
  if (error || !data) return NextResponse.json({ error: "Archive not found" }, { status: 404 });

  const header = [
    "entry_time",
    "exit_time",
    "name",
    "isin",
    "underlying",
    "direction",
    "leverage",
    "quantity",
    "entry_price",
    "exit_price",
    "stop_loss",
    "target_price",
    "pl_sek",
    "pl_pct",
    "note",
    "podcast_episode",
  ];

  const rows = ((data.positions as any[]) ?? []).map((p) => {
    const entry = num(p.entry_price);
    const exit = num(p.exit_price);
    const qty = num(p.quantity);
    const stake = num(p.stake_sek);
    let pl: number | null = null;
    let plPct: number | null = null;
    if (entry != null && exit != null) {
      pl = qty != null ? (exit - entry) * qty : stake != null ? stake * ((exit - entry) / entry) : null;
      plPct = ((exit - entry) / entry) * 100;
    }
    return [
      p.entry_time,
      p.exit_time,
      p.name,
      p.isin,
      p.underlying,
      p.direction,
      p.leverage,
      qty,
      entry,
      exit,
      p.stop_loss,
      p.target_price,
      pl != null ? pl.toFixed(2) : "",
      plPct != null ? plPct.toFixed(2) : "",
      p.note,
      p.podcast_episode,
    ]
      .map(csvCell)
      .join(",");
  });

  const slug =
    String(data.name)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "portfolio";

  const day = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" }) : "unknown";

  // BOM so Excel reads åäö correctly.
  const csv = "\ufeff" + [header.join(","), ...rows].join("\r\n") + "\r\n";
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="trades-${slug}_${day(data.started_at)}_${day(data.ended_at)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
