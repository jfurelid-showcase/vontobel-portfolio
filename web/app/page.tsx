"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { pctChangeSince, startOfDayStockholm, startOfMonth, startOfYear } from "@/lib/nav";
import PositionCard from "@/components/PositionCard";

type Position = Parameters<typeof PositionCard>[0]["p"] & {
  stake_sek: number;
};
type NavPoint = { ts: string; nav: number };
type Cert = {
  isin: string;
  name: string;
  underlying: string | null;
  direction: string | null;
  leverage: number | null;
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
        <h1 className="text-2xl font-semibold">Vontobel Portfolio</h1>
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
    <>
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
          {open.length === 0 && <p className="text-neutral-500">No open positions yet — add one from the Admin tab.</p>}
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
    </>
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

// ---------------------------------------------------------------------------
// Admin tab
// ---------------------------------------------------------------------------

function Admin() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Cert[]>([]);
  const [selected, setSelected] = useState<Cert | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [form, setForm] = useState({
    entry_price: "",
    stop_loss: "",
    target_price: "",
    stake_sek: "10000",
    note: "",
    podcast_episode: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadPositions();
  }, []);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (query.trim().length < 2) return setResults([]);
      const res = await fetch(`/api/certificates/search?q=${encodeURIComponent(query)}`);
      setResults(await res.json());
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  async function loadPositions() {
    const res = await fetch("/api/positions");
    setPositions(await res.json());
  }

  function selectCert(c: Cert) {
    setSelected(c);
    setForm((f) => ({ ...f, entry_price: String(c.last_price ?? "") }));
    setResults([]);
    setQuery(c.name);
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
        stake_sek: parseFloat(form.stake_sek) || 10000,
        note: form.note || null,
        podcast_episode: form.podcast_episode || null,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setSelected(null);
      setQuery("");
      setForm({ entry_price: "", stop_loss: "", target_price: "", stake_sek: "10000", note: "", podcast_episode: "" });
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

  return (
    <>
      <section className="mb-10 rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
        <h2 className="mb-3 text-lg font-medium">Add a position</h2>
        <div className="relative mb-4">
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(null);
            }}
            placeholder="Search ISIN or name…"
            className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 outline-none focus:border-neutral-500"
          />
          {results.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-800 shadow-xl">
              {results.map((c) => (
                <li
                  key={c.isin}
                  onClick={() => selectCert(c)}
                  className="cursor-pointer px-3 py-2 hover:bg-neutral-700"
                >
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-neutral-400">
                    {c.isin} · {c.underlying} · {c.direction} {c.leverage}x · last {c.last_price}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {selected && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Entry price">
              <input
                value={form.entry_price}
                onChange={(e) => setForm({ ...form, entry_price: e.target.value })}
                className="input"
              />
            </Field>
            <Field label="Stake (SEK)">
              <input
                value={form.stake_sek}
                onChange={(e) => setForm({ ...form, stake_sek: e.target.value })}
                className="input"
              />
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
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">
                    {p.name}{" "}
                    <span className="text-xs text-neutral-400">
                      ({p.isin}) · {p.status}
                    </span>
                  </div>
                  <div className="text-sm text-neutral-400">
                    Entry {p.entry_price} → Now {p.current_price ?? "–"} · SL {p.stop_loss ?? "–"} · Target{" "}
                    {p.target_price ?? "–"}
                  </div>
                  {p.note && <div className="mt-1 text-sm text-neutral-300">📝 {p.note}</div>}
                  {p.podcast_episode && (
                    <div className="text-xs text-neutral-500">🎙️ {p.podcast_episode}</div>
                  )}
                </div>
                {p.status === "open" && (
                  <button
                    onClick={() => closePosition(p.id)}
                    className="rounded-lg border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-800"
                  >
                    Close
                  </button>
                )}
              </div>
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
