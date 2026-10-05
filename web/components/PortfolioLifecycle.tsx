"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { usePortfolio } from "@/lib/portfolioClient";

type Archive = {
  id: string;
  name: string;
  started_at: string | null;
  ended_at: string;
  start_capital: number | null;
  final_nav: number | null;
  realized_pl_sek: number | null;
  trade_count: number;
};

type Info = {
  name: string | null;
  cash: number | null;
  startedAt: string | null;
  trades: number;
  open: number;
  nav: number | null;
};

const TZ = "Europe/Stockholm";
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("sv-SE", { timeZone: TZ }) : "–");
const fmtDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("sv-SE", { timeZone: TZ, dateStyle: "short", timeStyle: "short" } as Intl.DateTimeFormatOptions) : "";
// Whole calendar days between two timestamps, counted on Stockholm dates.
const durationLabel = (start: string | null, end: string | null) => {
  if (!start || !end) return "–";
  const d = (iso: string) => {
    const [y, m, day] = new Date(iso).toLocaleDateString("sv-SE", { timeZone: TZ }).split("-").map(Number);
    return Date.UTC(y, m - 1, day);
  };
  const days = Math.round((d(end) - d(start)) / 86400000);
  return days <= 0 ? "Same day" : `${days} day${days === 1 ? "" : "s"}`;
};
const sek = (n: number | null) =>
  n == null ? "–" : `${n >= 0 ? "+" : ""}${Number(n).toLocaleString("sv-SE", { maximumFractionDigits: 0 })} SEK`;
const tone = (n: number | null) => (n == null || n === 0 ? "text-neutral-300" : n > 0 ? "text-emerald-400" : "text-red-400");

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "portfolio";

export default function PortfolioLifecycle() {
  const { id: portfolioId, authFetch } = usePortfolio();
  const [info, setInfo] = useState<Info | null>(null);
  const [archives, setArchives] = useState<Archive[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState("");
  const [newName, setNewName] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameMsg, setNameMsg] = useState<string | null>(null);
  const [capital, setCapital] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [navBusy, setNavBusy] = useState<string | null>(null);
  const [navProgress, setNavProgress] = useState(0);

  async function loadInfo() {
    const [{ data: settings }, { data: pos }, { data: firstNav }, { data: lastNav }] = await Promise.all([
      supabase.from("portfolio_settings").select("cash_sek, started_at, portfolio_name").eq("id", portfolioId).single(),
      supabase.from("portfolio_positions").select("id, status").eq("portfolio_id", portfolioId),
      supabase.from("nav_history").select("ts").eq("portfolio_id", portfolioId).order("ts", { ascending: true }).limit(1),
      supabase.from("nav_history").select("nav").eq("portfolio_id", portfolioId).order("ts", { ascending: false }).limit(1),
    ]);
    const positions = (pos as { id: string; status: string }[]) ?? [];
    const currentName: string | null = settings?.portfolio_name ?? null;
    setNameDraft((prev) => (prev === "" ? currentName ?? "" : prev));
    setInfo({
      name: currentName,
      cash: settings?.cash_sek != null ? Number(settings.cash_sek) : null,
      startedAt: firstNav?.[0]?.ts ?? settings?.started_at ?? null,
      trades: positions.length,
      open: positions.filter((p) => p.status === "open").length,
      nav: lastNav?.[0]?.nav != null ? Number(lastNav[0].nav) : null,
    });
  }

  async function loadArchives() {
    const { data } = await supabase
      .from("portfolio_archives")
      .select("id, name, started_at, ended_at, start_capital, final_nav, realized_pl_sek, trade_count")
      .eq("portfolio_id", portfolioId)
      .order("ended_at", { ascending: false });
    setArchives((data as Archive[]) ?? []);
  }

  useEffect(() => {
    loadInfo();
    loadArchives();
  }, [portfolioId]);

  async function saveName() {
    setSavingName(true);
    setNameMsg(null);
    try {
      const res = await authFetch("/api/portfolio/name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ portfolio_id: portfolioId, name: nameDraft }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      setInfo((prev) => (prev ? { ...prev, name: json.name } : prev));
      setNameDraft(json.name ?? "");
      setNameMsg(json.name ? "Saved" : "Name cleared");
    } catch (e) {
      setNameMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingName(false);
    }
  }

  function openPanel() {
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: TZ });
    setName(info?.name || `Portfolio ${fmtDate(info?.startedAt ?? null)} – ${today}`);
    setNewName("");
    setCapital(info?.cash != null ? String(info.cash) : "100000");
    setConfirmText("");
    setError(null);
    setExpanded(true);
  }

  async function endPortfolio() {
    setBusy(true);
    setError(null);
    try {
      const parsed = capital.trim() === "" ? null : Number(capital.replace(/[\s\u00a0]/g, "").replace(",", "."));
      if (parsed != null && (!Number.isFinite(parsed) || parsed <= 0)) {
        throw new Error("Enter a positive number for the new start capital.");
      }
      const res = await authFetch("/api/portfolio/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ portfolio_id: portfolioId, name, new_name: newName, new_capital: parsed, confirm: confirmText }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      setExpanded(false);
      setDone(
        `Saved “${json.name}” — ${json.trade_count} trades and ${Number(json.nav_rows_saved).toLocaleString("sv-SE")} NAV points. A new portfolio${json.new_portfolio_name ? ` “${json.new_portfolio_name}”` : ""} has started. Reloading…`
      );
      loadArchives();
      setTimeout(() => window.location.reload(), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // The NAV history can be hundreds of thousands of rows, so it is pulled in
  // parallel pages straight from the database and assembled in the browser.
  async function downloadNav(a: Archive) {
    setNavBusy(a.id);
    setNavProgress(0);
    try {
      const PAGE = 1000;
      const PARALLEL = 4;
      const rows: { ts: string; nav: number }[] = [];
      let start = 0;
      let finished = false;
      while (!finished) {
        const batch = await Promise.all(
          Array.from({ length: PARALLEL }, (_, i) => {
            const from = start + i * PAGE;
            return supabase
              .from("portfolio_archive_nav")
              .select("ts, nav")
              .eq("archive_id", a.id)
              .order("ts", { ascending: true })
              .range(from, from + PAGE - 1);
          })
        );
        for (const r of batch) {
          if (r.error) throw new Error(r.error.message);
          const got = (r.data as { ts: string; nav: number }[]) ?? [];
          rows.push(...got);
          if (got.length < PAGE) finished = true;
        }
        setNavProgress(rows.length);
        start += PARALLEL * PAGE;
      }
      const csv = "ts,nav\r\n" + rows.map((r) => `${r.ts},${r.nav}`).join("\r\n") + "\r\n";
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `nav-history-${slugify(a.name)}_${fmtDate(a.started_at)}_${fmtDate(a.ended_at)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(`Could not download the NAV history: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setNavBusy(null);
    }
  }

  const canSubmit = confirmText === "END" && !busy && (info?.trades ?? 0) > 0;

  return (
    <section className="mt-10 rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
      <h2 className="mb-1 text-lg font-medium">Portfolio lifecycle</h2>
      <p className="mb-4 text-sm text-neutral-500">
        {info
          ? `Current portfolio${info.name ? ` “${info.name}”` : ""}: started ${fmtDate(info.startedAt)} · ${info.trades} trade${info.trades === 1 ? "" : "s"} (${info.open} open)${
              info.nav != null ? ` · NAV ${info.nav.toFixed(2)}` : ""
            }`
          : "Loading…"}
      </p>

      <div className="mb-5 flex flex-wrap items-end gap-2">
        <label className="block min-w-[14rem] flex-1 text-sm text-neutral-400">
          Portfolio name
          <input
            value={nameDraft}
            onChange={(e) => {
              setNameDraft(e.target.value);
              setNameMsg(null);
            }}
            maxLength={80}
            placeholder="e.g. Swing 2026"
            className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-neutral-100 outline-none focus:border-neutral-500"
          />
        </label>
        <button
          onClick={saveName}
          disabled={savingName || nameDraft.trim() === (info?.name ?? "")}
          className="rounded-lg bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {savingName ? "Saving…" : "Save name"}
        </button>
        {nameMsg && <span className="pb-2 text-xs text-neutral-500">{nameMsg}</span>}
      </div>

      {done && (
        <div className="mb-4 rounded-lg border border-emerald-900/60 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-300">
          {done}
        </div>
      )}

      {!expanded && (
        <button
          onClick={openPanel}
          disabled={!info || info.trades === 0}
          className="rounded-lg border border-red-900/60 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-950/40 disabled:cursor-not-allowed disabled:opacity-40"
        >
          End portfolio &amp; create new portfolio
        </button>
      )}
      {!expanded && info && info.trades === 0 && (
        <p className="mt-2 text-xs text-neutral-600">There are no trades to archive yet.</p>
      )}

      {expanded && (
        <div className="rounded-xl border border-red-900/40 bg-neutral-950/40 p-4">
          <p className="mb-3 text-sm text-neutral-300">This will, in one step:</p>
          <ul className="mb-4 list-disc space-y-1 pl-5 text-sm text-neutral-400">
            <li>
              close {info?.open ?? 0} open position{info?.open === 1 ? "" : "s"} at the latest price,
            </li>
            <li>save a permanent copy of all {info?.trades ?? 0} trades and the full NAV history,</li>
            <li>start a new portfolio: no positions, NAV back to 100.00, start date today.</li>
          </ul>

          <div className="mb-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-neutral-400">
              Name for the saved copy (the portfolio you are ending)
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-neutral-100 outline-none focus:border-neutral-500"
              />
            </label>
            <label className="block text-sm text-neutral-400">
              Start capital for the new portfolio (SEK)
              <input
                value={capital}
                onChange={(e) => setCapital(e.target.value)}
                inputMode="decimal"
                className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-neutral-100 outline-none focus:border-neutral-500"
              />
            </label>
          </div>

          <label className="mb-3 block text-sm text-neutral-400">
            Name for the new portfolio <span className="text-neutral-600">(optional)</span>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={80}
              placeholder="e.g. Swing Q4 2026"
              className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-neutral-100 outline-none focus:border-neutral-500"
            />
          </label>

          <label className="mb-4 block text-sm text-neutral-400">
            Type <span className="font-mono font-semibold text-neutral-200">END</span> to confirm
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
              className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 font-mono text-neutral-100 outline-none focus:border-neutral-500 sm:w-48"
            />
          </label>

          {error && (
            <div className="mb-3 rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">{error}</div>
          )}

          <div className="flex gap-2">
            <button
              onClick={endPortfolio}
              disabled={!canSubmit}
              className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "Saving…" : "End & create new portfolio"}
            </button>
            <button
              onClick={() => setExpanded(false)}
              disabled={busy}
              className="rounded-lg border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-800 disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {archives.length > 0 && (
        <div className="mt-8">
          <h3 className="mb-3 text-sm font-medium text-neutral-300">Saved portfolios</h3>
          <div className="space-y-3">
            {archives.map((a) => (
              <div key={a.id} className="rounded-xl border border-neutral-800 bg-neutral-950/40 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <div className="font-medium text-neutral-100">{a.name}</div>
                  <div className="text-xs text-neutral-500">
                    {a.trade_count} trade{a.trade_count === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                  <Field label="Start date" title={fmtDateTime(a.started_at)}>
                    {fmtDate(a.started_at)}
                  </Field>
                  <Field label="End date" title={fmtDateTime(a.ended_at)}>
                    {fmtDate(a.ended_at)}
                  </Field>
                  <Field label="Duration">{durationLabel(a.started_at, a.ended_at)}</Field>
                  <Field label="Final NAV">{a.final_nav != null ? Number(a.final_nav).toFixed(2) : "–"}</Field>
                  <Field label="Realized P/L" valueClass={`font-medium ${tone(a.realized_pl_sek)}`}>
                    {sek(a.realized_pl_sek != null ? Number(a.realized_pl_sek) : null)}
                  </Field>
                  <Field label="Start capital">
                    {a.start_capital != null ? `${Number(a.start_capital).toLocaleString("sv-SE")} SEK` : "–"}
                  </Field>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <a
                    href={`/api/portfolio/export?id=${a.id}&type=trades`}
                    className="rounded-lg border border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-800"
                  >
                    Download trades (CSV)
                  </a>
                  <button
                    onClick={() => downloadNav(a)}
                    disabled={navBusy !== null}
                    className="rounded-lg border border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-800 disabled:opacity-50"
                  >
                    {navBusy === a.id
                      ? `Preparing… ${navProgress.toLocaleString("sv-SE")} rows`
                      : "Download NAV history (CSV)"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Field({
  label,
  children,
  title,
  valueClass = "text-neutral-100",
}: {
  label: string;
  children: React.ReactNode;
  title?: string;
  valueClass?: string;
}) {
  return (
    <div title={title}>
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`text-sm ${valueClass}`}>{children}</div>
    </div>
  );
}
