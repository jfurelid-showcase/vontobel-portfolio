"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { pctChangeSince, startOfDayStockholm, startOfMonth, startOfYear } from "@/lib/nav";
import PositionCard from "@/components/PositionCard";
import TradeNote from "@/components/TradeNote";
import NavChart from "@/components/NavChart";
import TraderBadge from "@/components/TraderBadge";
import TraderSettings from "@/components/TraderSettings";
type Position = Parameters<typeof PositionCard>[0]["p"] & {
  stake_sek: number;
  quantity: number | null;
  exit_time: string | null;
};
type NavPoint = { ts: string; nav: number };
type Cert = {
  isin: string;
  name: string;
  underlying: string | null;
  direction: string | null;
  leverage: number | null;
  instrument_type: string | null;
  last_price: number | null;
  buy_price: number | null;
  sell_price: number | null;
  daily_change_pct: number | null;
};

// ---------------------------------------------------------------------------
// Single page, no login: a tab switch between the live dashboard and the
// admin tool used to build the portfolio. Everything here talks to the same
// /api/positions, /api/certificates/search etc. routes as before — only the
// page layout changed, not the backend.
// ---------------------------------------------------------------------------

export default function Home() {
  const [tab, setTab] = useState<"dashboard" | "admin">("dashboard");

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 text-neutral-100">
      <div className="mb-8 flex items-center justify-between">
        <div className="flex items-baseline gap-2.5">
          <img src="/vontobel-logo.png" alt="Vontobel" className="h-4 w-auto translate-y-[1px] opacity-60" />
          <span className="text-lg font-medium leading-none text-neutral-300">Portfolio</span>
        </div>
        <div className="flex gap-2 rounded-lg border border-neutral-800 bg-neutral-900 p-1">
          <button
            onClick={() => setTab("dashboard")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              tab === "dashboard" ? "bg-neutral-100 text-neutral-900" : "text-neutral-400 hover:text-neutral-100"
            }`}
          >
            Dashboard
          </button>
          <button
            onClick={() => setTab("admin")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              tab === "admin" ? "bg-neutral-100 text-neutral-900" : "text-neutral-400 hover:text-neutral-100"
            }`}
          >
            Admin
          </button>
        </div>
      </div>

      {tab === "dashboard" ? <Dashboard /> : <Admin />}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Dashboard tab
// ---------------------------------------------------------------------------

function Dashboard() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [navHistory, setNavHistory] = useState<NavPoint[]>([]);
    const [baseCapital, setBaseCapital] = useState<number | null>(null);
  const [startDate, setStartDate] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("portfolio_settings").select("cash_sek").single()
      .then(({ data }) => setBaseCapital(data?.cash_sek ?? null));
    supabase.from("nav_history").select("ts").order("ts", { ascending: true }).limit(1)
      .then(({ data }) => setStartDate(data?.[0]?.ts ?? null));
  }, []);

  async function loadAll() {
    const [{ data: pos }, { data: nav }] = await Promise.all([
      supabase.from("portfolio_positions").select("*").order("created_at", { ascending: false }),
        supabase.from("nav_history").select("ts, nav").order("ts", { ascending: false }).limit(2000),
    ]);
    setPositions((pos as Position[]) || []);
    setNavHistory(((nav as NavPoint[]) || []).slice().reverse());
  }

  useEffect(() => {
    loadAll();
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

  const [view, setView] = useState<"cards" | "list">("cards");

  const open = positions.filter((p) => p.status === "open");
  const totalOpenPl = open.reduce((sum, p) => {
    const price = p.current_price ?? p.entry_price;
    const pl = p.quantity != null ? (price - p.entry_price) * p.quantity : p.stake_sek * ((price - p.entry_price) / p.entry_price);
    return sum + pl;
  }, 0);
  const closedAll = positions
    .filter((p) => p.status === "closed")
    .sort((a, b) => new Date(b.exit_time ?? b.entry_time).getTime() - new Date(a.exit_time ?? a.entry_time).getTime());
  const RECENT_CLOSED_LIMIT = 10;
  const closed = closedAll.slice(0, RECENT_CLOSED_LIMIT);

   return (
    <>
      <div className="mb-4">
        <TraderBadge />
      </div>

      <div className="mb-6 flex items-center justify-between">
        <section className="grid flex-1 grid-cols-2 gap-4 sm:grid-cols-4">
          <NavStat
            label="NAV"
            value={latestNav.toFixed(2)}
            sub={baseCapital != null ? `${(baseCapital * (latestNav / 100)).toLocaleString("sv-SE", { maximumFractionDigits: 0 })} SEK` : undefined}
          />
          <NavStat
            label="Today"
            value={fmtPct(dailyPct)}
            isPct
            pctValue={dailyPct}
            sub={sekDelta(dailyPct, baseCapital)}
          />
          <NavStat
            label="This month"
            value={fmtPct(monthlyPct)}
            isPct
            pctValue={monthlyPct}
            sub={sekDelta(monthlyPct, baseCapital)}
          />
          <NavStat
            label="YTD"
            value={fmtPct(ytdPct)}
            isPct
            pctValue={ytdPct}
            sub={sekDelta(ytdPct, baseCapital)}
          />
                  <NavStat label="Startkapital" value={baseCapital != null ? `${baseCapital.toLocaleString("sv-SE")} SEK` : "–"} />
        <NavStat label="Startdatum" value={startDate ? new Date(startDate).toLocaleDateString("sv-SE") : "–"} />
        </section>
      </div>

      <div className="mb-6">
        <NavChart history={navHistory} />
      </div>

      <div className="mb-3 flex justify-end gap-2">
        <div className="flex gap-1 rounded-lg border border-neutral-800 bg-neutral-900 p-1">
          {(["cards", "list"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-md px-3 py-1 text-xs font-medium capitalize transition ${
                view === v ? "bg-neutral-100 text-neutral-900" : "text-neutral-400 hover:text-neutral-100"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <section className="mb-10">
        <div className="mb-3 flex items-baseline gap-3">
          <h2 className="text-lg font-medium text-neutral-300">Open positions ({open.length})</h2>
          {open.length > 0 && (
            <span className={`text-sm font-medium ${totalOpenPl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {totalOpenPl >= 0 ? "+" : ""}
              {totalOpenPl.toLocaleString("sv-SE", { maximumFractionDigits: 0 })} SEK open P/L
            </span>
          )}
        </div>
        {open.length === 0 && <p className="text-neutral-500">No open positions yet — add one from the Admin tab.</p>}
        {open.length > 0 && view === "cards" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {open.map((p) => (
              <PositionCard key={p.id} p={p} />
            ))}
          </div>
        )}
        {open.length > 0 && view === "list" && <PositionListView items={open} />}
      </section>

      {closedAll.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-medium text-neutral-300">
            Recently closed ({closed.length}{closedAll.length > closed.length ? ` of ${closedAll.length}` : ""})
          </h2>
          {view === "cards" && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {closed.map((p) => (
                <PositionCard key={p.id} p={p} />
              ))}
            </div>
          )}
          {view === "list" && <PositionListView items={closed} />}
        </section>
      )}
    </>
  );
}

function PositionListView({ items }: { items: Position[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-900">
      <table className="w-full min-w-[960px] text-left text-sm">
        <thead className="bg-neutral-800/60 text-xs uppercase tracking-wide text-neutral-500">
          <tr>
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Underlying</th>
            <th className="px-3 py-2">Daily %</th>
            <th className="px-3 py-2">Dir</th>
            <th className="px-3 py-2">Qty</th>
            <th className="px-3 py-2">Entry</th>
            <th className="px-3 py-2">{items[0]?.status === "closed" ? "Exit" : "Now"}</th>
            <th className="px-3 py-2">Value (SEK)</th>
            <th className="px-3 py-2">Change</th>
            <th className="px-3 py-2">P/L (SEK)</th>
            <th className="px-3 py-2">Stop loss</th>
            <th className="px-3 py-2">Target</th>
            <th className="px-3 py-2">{items[0]?.status === "closed" ? "Closed" : "Updated"}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => {
            const isClosed = p.status === "closed";
            const price = isClosed ? p.exit_price ?? p.entry_price : p.current_price ?? p.entry_price;
            const change = ((price - p.entry_price) / p.entry_price) * 100;
            const isUp = change >= 0;
            const isLong = p.direction?.toLowerCase() === "long";
            const isShort = p.direction?.toLowerCase() === "short";
            const timestamp = isClosed ? p.exit_time : p.current_updated_at;
            // Prefer quantity for an exact SEK figure; fall back to the
            // stake-based % return if quantity isn't set (older positions).
            const pl = p.quantity != null ? (price - p.entry_price) * p.quantity : p.stake_sek * (change / 100);
            const value = p.quantity != null ? price * p.quantity : null;
            const dailyChange =
              p.prev_close_price != null && price != null
                ? ((price - p.prev_close_price) / p.prev_close_price) * 100
                : null;
            return (
              <tr
                key={p.id}
                className={`border-t border-neutral-800 border-l-2 ${
                  isLong ? "border-l-emerald-500" : isShort ? "border-l-red-500" : "border-l-transparent"
                }`}
              >
                <td className="px-3 py-2 font-medium">
                  {p.name} <span className="text-xs text-neutral-500">({p.isin})</span>
                </td>
                <td className="px-3 py-2 text-neutral-300">{p.underlying ?? "–"}</td>
                <td
                  className={`px-3 py-2 ${
                    dailyChange == null ? "" : dailyChange >= 0 ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {dailyChange != null ? `${dailyChange >= 0 ? "+" : ""}${dailyChange.toFixed(2)}%` : "–"}
                </td>
                <td className={`px-3 py-2 ${isLong ? "text-emerald-400" : isShort ? "text-red-400" : ""}`}>
                  {p.direction ?? "–"}
                </td>
                <td className="px-3 py-2">{p.quantity ?? "–"}</td>
                <td className="px-3 py-2">{p.entry_price.toFixed(2)}</td>
                <td className="px-3 py-2">{price != null ? price.toFixed(2) : "–"}</td>
                <td className="px-3 py-2">
                  {value != null ? value.toLocaleString("sv-SE", { maximumFractionDigits: 0 }) : "–"}
                </td>
                <td className={`px-3 py-2 font-medium ${isUp ? "text-emerald-400" : "text-red-400"}`}>
                  {isUp ? "+" : ""}
                  {change.toFixed(2)}%
                </td>
                <td className={`px-3 py-2 font-medium ${pl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {pl >= 0 ? "+" : ""}
                  {pl.toLocaleString("sv-SE", { maximumFractionDigits: 0 })}
                </td>
                <td className="px-3 py-2 text-neutral-400">{p.stop_loss ?? "–"}</td>
                <td className="px-3 py-2 text-neutral-400">{p.target_price ?? "–"}</td>
                <td className="px-3 py-2 text-xs text-neutral-500">
                  {timestamp ? new Date(timestamp).toLocaleString("sv-SE") : "–"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
function sekDelta(pct: number | null, baseCapital: number | null): string | undefined {
  if (pct == null || baseCapital == null) return undefined;
  const sek = (pct / 100) * baseCapital;
  return `${sek >= 0 ? "+" : ""}${sek.toLocaleString("sv-SE", { maximumFractionDigits: 0 })} SEK`;
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
  sub,
}: {
  label: string;
  value: string;
  isPct?: boolean;
  pctValue?: number | null;
  sub?: string;
}) {
  const color = isPct ? (pctValue == null ? "text-neutral-100" : pctValue >= 0 ? "text-emerald-400" : "text-red-400") : "text-neutral-100";
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${color}`}>{value}</div>
      {sub && <div className={`mt-0.5 text-xs ${color}`}>{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin tab
// ---------------------------------------------------------------------------

function Admin() {
  const [query, setQuery] = useState("");
  const [directionFilter, setDirectionFilter] = useState<"" | "Long" | "Short">("");
  const [results, setResults] = useState<Cert[]>([]);
  const [selected, setSelected] = useState<Cert | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [fullListCount, setFullListCount] = useState<number | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [sortKey, setSortKey] = useState<keyof Cert>("last_price");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [form, setForm] = useState({
    entry_price: "",
    stop_loss: "",
    target_price: "",
    quantity: "100",
    note: "",
    podcast_episode: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadPositions();
    supabase
      .from("certificates_full")
      .select("*", { count: "exact", head: true })
      .then(({ count }) => setFullListCount(count ?? null));
  }, []);

  const suppressNextSearch = useRef(false);

  useEffect(() => {
    if (suppressNextSearch.current) {
      suppressNextSearch.current = false;
      return;
    }
    const t = setTimeout(async () => {
      if (query.trim().length < 2) {
        setResults([]);
        setTotalCount(0);
        return;
      }
      const params = new URLSearchParams({ q: query });
      if (directionFilter) params.set("direction", directionFilter);
      const res = await fetch(`/api/certificates/search?${params}`);
      const { results, totalCount } = await res.json();
      setResults(results || []);
      setTotalCount(totalCount || 0);
    }, 250);
    return () => clearTimeout(t);
  }, [query, directionFilter]);

  async function loadPositions() {
    const res = await fetch("/api/positions");
    setPositions(await res.json());
  }

  const sortedResults = useMemo(() => {
    const arr = [...results];
    arr.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // nulls always sort last, regardless of direction
      if (bv == null) return -1;
      let cmp: number;
      if (typeof av === "number" && typeof bv === "number") {
        cmp = av - bv;
      } else {
        cmp = String(av).localeCompare(String(bv));
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [results, sortKey, sortDir]);

  function toggleSort(key: keyof Cert) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

function selectCert(c: Cert) {
    setSelected(c);
    const fallbackPrice =
      c.last_price ??
      (c.buy_price != null && c.sell_price != null ? (c.buy_price + c.sell_price) / 2 : null) ??
      c.buy_price ??
      c.sell_price ??
      null;
    setForm((f) => ({ ...f, entry_price: fallbackPrice != null ? String(fallbackPrice) : "" }));
    setResults([]);
    suppressNextSearch.current = true; // selecting shouldn't immediately re-search and reopen the list
    setQuery(c.name);

    // The search result's price can be up to a day stale (once-daily
    // full-list scrape) — fetch a genuinely live price for this one
    // instrument and correct the field once it arrives.
    fetch(`/api/certificates/live-price?isin=${c.isin}`)
      .then((r) => r.json())
      .then(({ price }) => {
        if (price != null) setForm((f) => ({ ...f, entry_price: String(price) }));
      })
      .catch(() => {}); // keep the stale fallback if the live fetch fails
  }

  async function addPosition() {
    if (!selected) return;
    setSaving(true);
    const res = await fetch("/api/positions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        isin: selected.isin,
        entry_price: parseFloat(form.entry_price),
        stop_loss: form.stop_loss ? parseFloat(form.stop_loss) : null,
        target_price: form.target_price ? parseFloat(form.target_price) : null,
        quantity: parseFloat(form.quantity) || 0,
        note: form.note || null,
        podcast_episode: form.podcast_episode || null,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setSelected(null);
      setQuery("");
      setForm({ entry_price: "", stop_loss: "", target_price: "", quantity: "100", note: "", podcast_episode: "" });
      loadPositions();
    } else {
      alert((await res.json()).error || "Failed to add position");
    }
  }

  async function closePosition(id: string) {
    if (!confirm("Close this position at its current price?")) return;
    await fetch(`/api/positions/${id}/close`, { method: "POST" });
    loadPositions();
  }

  async function reopenPosition(id: string) {
    if (!confirm("Reopen this position? Its exit will be cleared and the worker will resume tracking it.")) return;
    await fetch(`/api/positions/${id}/reopen`, { method: "POST" });
    loadPositions();
  }

  async function deletePosition(id: string, name: string) {
    if (!confirm(`Permanently delete "${name}"? This can't be undone.`)) return;
    await fetch(`/api/positions/${id}`, { method: "DELETE" });
    loadPositions();
  }

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    entry_price: "",
    quantity: "",
    stop_loss: "",
    target_price: "",
    exit_price: "",
    note: "",
    podcast_episode: "",
  });

  function startEditing(p: Position) {
    setEditingId(p.id);
    setEditForm({
      entry_price: String(p.entry_price ?? ""),
      quantity: String(p.quantity ?? ""),
      stop_loss: String(p.stop_loss ?? ""),
      target_price: String(p.target_price ?? ""),
      exit_price: String(p.exit_price ?? ""),
      note: p.note ?? "",
      podcast_episode: p.podcast_episode ?? "",
    });
  }

  async function saveEdit(id: string, status: "open" | "closed") {
    const payload: Record<string, unknown> = {
      entry_price: parseFloat(editForm.entry_price),
      quantity: parseFloat(editForm.quantity),
      stop_loss: editForm.stop_loss ? parseFloat(editForm.stop_loss) : null,
      target_price: editForm.target_price ? parseFloat(editForm.target_price) : null,
      note: editForm.note || null,
      podcast_episode: editForm.podcast_episode || null,
    };
    if (status === "closed") {
      payload.exit_price = editForm.exit_price ? parseFloat(editForm.exit_price) : null;
    }
    const res = await fetch(`/api/positions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      setEditingId(null);
      loadPositions();
    } else {
      alert((await res.json()).error || "Failed to save changes");
    }
  }

  return (
    <>
            <TraderSettings />
            <section className="mb-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-medium">Search contracts</h2>
          <span className="text-xs text-neutral-500">
            {fullListCount != null ? `Searchable: ${fullListCount.toLocaleString("sv-SE")} contracts` : ""}
          </span>
        </div>

        <div className="mb-3 flex gap-1.5">
          {(["", "Long", "Short"] as const).map((d) => (
            <button
              key={d || "all"}
              onClick={() => setDirectionFilter(d)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                directionFilter === d
                  ? "bg-neutral-100 text-neutral-900"
                  : "border border-neutral-700 text-neutral-400 hover:text-neutral-100"
              }`}
            >
              {d || "All"}
            </button>
          ))}
        </div>

        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(null);
          }}
          placeholder="Search ISIN, name, or underlying (e.g. Tesla)…"
          className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 outline-none focus:border-neutral-500"
        />
      </section>

      {results.length > 0 && (
        <section className="mb-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
          <div className="mb-3 text-sm text-neutral-400">
            Showing {results.length} of {totalCount} contract{totalCount === 1 ? "" : "s"}
            {directionFilter ? ` (${directionFilter} only)` : ""}
            {totalCount > results.length ? ` — fetched sorted by turnover; click any column header below to re-sort` : ""}
          </div>
          <div className="max-h-[32rem] overflow-y-auto rounded-lg border border-neutral-800">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-neutral-800 text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-3 py-2"></th>
                  {(
                    [
                      ["name", "Name"],
                      ["underlying", "Underlying"],
                      ["isin", "ISIN"],
                      ["direction", "Dir"],
                      ["leverage", "Lev"],
                      ["buy_price", "Buy"],
                      ["sell_price", "Sell"],
                      ["last_price", "Last"],
                      ["daily_change_pct", "Daily %"],
                    ] as [keyof Cert, string][]
                  ).map(([key, label]) => (
                    <th key={key} className="px-3 py-2">
                      <button
                        onClick={() => toggleSort(key)}
                        className="flex items-center gap-1 hover:text-neutral-200"
                      >
                        {label}
                        {sortKey === key && <span>{sortDir === "asc" ? "▲" : "▼"}</span>}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedResults.map((c) => {
                  const isLong = c.direction?.toLowerCase() === "long";
                  const isShort = c.direction?.toLowerCase() === "short";
                  const isSelected = selected?.isin === c.isin;
                  return (
                    <tr
                      key={c.isin}
                      onClick={() => (isSelected ? setSelected(null) : selectCert(c))}
                      className={`cursor-pointer border-t border-neutral-800 border-l-2 transition ${
                        isLong ? "border-l-emerald-500 bg-emerald-500/[0.06]" : ""
                      } ${isShort ? "border-l-red-500 bg-red-500/[0.06]" : ""} ${
                        isSelected ? "outline outline-1 outline-neutral-400" : "hover:brightness-125"
                      }`}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => (isSelected ? setSelected(null) : selectCert(c))}
                          onClick={(e) => e.stopPropagation()}
                          className="h-4 w-4 accent-neutral-100"
                        />
                      </td>
                      <td className="px-3 py-2 font-medium">{c.name}</td>
                      <td className="px-3 py-2 text-neutral-300">{c.underlying ?? "–"}</td>
                      <td className="px-3 py-2 font-mono text-xs text-neutral-400">{c.isin}</td>
                      <td className={`px-3 py-2 font-medium ${isLong ? "text-emerald-400" : isShort ? "text-red-400" : ""}`}>
                        {c.direction ?? "–"}
                      </td>
                                            <td className="px-3 py-2">
                        {c.leverage ? `${c.leverage}x` : c.instrument_type ?? "–"}
                      </td>
                      <td className="px-3 py-2">{c.buy_price != null ? c.buy_price.toFixed(2) : "–"}</td>
                      <td className="px-3 py-2">{c.sell_price != null ? c.sell_price.toFixed(2) : "–"}</td>
                      <td className="px-3 py-2">{c.last_price != null ? c.last_price.toFixed(2) : "–"}</td>
                      <td className="px-3 py-2">
                        {c.daily_change_pct != null ? (
                          <span className={c.daily_change_pct >= 0 ? "text-emerald-400" : "text-red-400"}>
                            {c.daily_change_pct >= 0 ? "+" : ""}
                            {c.daily_change_pct.toFixed(2)}%
                          </span>
                        ) : (
                          "–"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="mb-10 rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
        <h2 className="mb-3 text-lg font-medium">Add a position</h2>

        {!selected && <p className="text-sm text-neutral-500">Select a contract from the search results above.</p>}

        {selected && (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 rounded-lg bg-neutral-800/60 px-3 py-2 text-sm text-neutral-300">
              Selected: <span className="font-medium text-neutral-100">{selected.name}</span> ({selected.isin})
            </div>
            <Field label="Entry price">
              <input
                value={form.entry_price}
                onChange={(e) => setForm({ ...form, entry_price: e.target.value })}
                className="input"
              />
            </Field>
            <Field label="Contract quantity">
              <input
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                className="input"
              />
              {form.entry_price && form.quantity && (
                <p className="mt-1 text-xs text-neutral-500">
                  ≈ {(parseFloat(form.quantity) * parseFloat(form.entry_price)).toLocaleString("sv-SE", {
                    maximumFractionDigits: 0,
                  })}{" "}
                  SEK at entry
                </p>
              )}
            </Field>
            <Field label="Stop loss">
              <input
                value={form.stop_loss}
                onChange={(e) => setForm({ ...form, stop_loss: e.target.value })}
                className="input"
              />
            </Field>
            <Field label="Target">
              <input
                value={form.target_price}
                onChange={(e) => setForm({ ...form, target_price: e.target.value })}
                className="input"
              />
            </Field>
            <Field label="Podcast episode" full>
              <input
                value={form.podcast_episode}
                onChange={(e) => setForm({ ...form, podcast_episode: e.target.value })}
                placeholder="e.g. Redaktionens Swingtrading #42"
                className="input"
              />
            </Field>
            <Field label="Rationale / note" full>
              <textarea
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                rows={3}
                className="input"
              />
            </Field>
            <button
              onClick={addPosition}
              disabled={saving}
              className="col-span-2 mt-2 rounded-lg bg-neutral-100 px-4 py-2 font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
            >
              {saving ? "Adding…" : `Add ${selected.name} to portfolio`}
            </button>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium">Positions</h2>
        <div className="space-y-3">
          {positions.map((p) => (
            <div key={p.id} className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
              {editingId === p.id ? (
                <div>
                  <div className="mb-2 font-medium">
                    Editing {p.name} <span className="text-xs text-neutral-400">({p.isin})</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <Field label="Entry price">
                      <input
                        value={editForm.entry_price}
                        onChange={(e) => setEditForm({ ...editForm, entry_price: e.target.value })}
                        className="input"
                      />
                    </Field>
                    <Field label="Quantity">
                      <input
                        value={editForm.quantity}
                        onChange={(e) => setEditForm({ ...editForm, quantity: e.target.value })}
                        className="input"
                      />
                    </Field>
                    <Field label="Stop loss">
                      <input
                        value={editForm.stop_loss}
                        onChange={(e) => setEditForm({ ...editForm, stop_loss: e.target.value })}
                        className="input"
                      />
                    </Field>
                    <Field label="Target">
                      <input
                        value={editForm.target_price}
                        onChange={(e) => setEditForm({ ...editForm, target_price: e.target.value })}
                        className="input"
                      />
                    </Field>
                    {p.status === "closed" && (
                      <Field label="Exit price">
                        <input
                          value={editForm.exit_price}
                          onChange={(e) => setEditForm({ ...editForm, exit_price: e.target.value })}
                          className="input"
                        />
                      </Field>
                    )}
                    <Field label="Podcast episode" full>
                      <input
                        value={editForm.podcast_episode}
                        onChange={(e) => setEditForm({ ...editForm, podcast_episode: e.target.value })}
                        className="input"
                      />
                    </Field>
                    <Field label="Rationale / note" full>
                      <textarea
                        value={editForm.note}
                        onChange={(e) => setEditForm({ ...editForm, note: e.target.value })}
                        rows={2}
                        className="input"
                      />
                    </Field>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => saveEdit(p.id, p.status)}
                      className="rounded-lg bg-neutral-100 px-4 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="rounded-lg border border-neutral-700 px-4 py-1.5 text-sm hover:bg-neutral-800"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium">
                      {p.name}{" "}
                      <span className="text-xs text-neutral-400">
                        ({p.isin}) · {p.status}
                      </span>
                    </div>
                    <div className="text-sm text-neutral-400">
                      {p.quantity ? `${p.quantity} contracts · ` : ""}Entry {p.entry_price} → Now{" "}
                      {p.status === "closed" ? p.exit_price ?? "–" : p.current_price ?? "–"} · SL{" "}
                      {p.stop_loss ?? "–"} · Target {p.target_price ?? "–"}
                    </div>
                    <TradeNote note={p.note} podcastEpisode={p.podcast_episode} />
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => startEditing(p)}
                      className="rounded-lg border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-800"
                    >
                      Edit
                    </button>
                    {p.status === "open" && (
                      <button
                        onClick={() => closePosition(p.id)}
                        className="rounded-lg border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-800"
                      >
                        Close
                      </button>
                    )}
                    {p.status === "closed" && (
                      <button
                        onClick={() => reopenPosition(p.id)}
                        className="rounded-lg border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-800"
                      >
                        Reopen
                      </button>
                    )}
                    <button
                      onClick={() => deletePosition(p.id, p.name)}
                      className="rounded-lg border border-red-900/60 px-3 py-1 text-sm text-red-400 hover:bg-red-950/40"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {positions.length === 0 && <p className="text-neutral-500">No positions yet.</p>}
        </div>
      </section>

      <style jsx global>{`
        .input {
          width: 100%;
          border-radius: 0.5rem;
          border: 1px solid #404040;
          background: #262626;
          padding: 0.5rem 0.75rem;
          color: #f5f5f5;
          outline: none;
        }
        .input:focus {
          border-color: #a3a3a3;
        }
      `}</style>
    </>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <label className={`block text-sm text-neutral-400 ${full ? "col-span-2" : ""}`}>
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}
