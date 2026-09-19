"use client";

import { useEffect, useState } from "react";

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

type Position = {
  id: string;
  isin: string;
  name: string;
  direction: string;
  entry_price: number;
  current_price: number | null;
  stop_loss: number | null;
  target_price: number | null;
  stake_sek: number;
  status: "open" | "closed";
  note: string | null;
  podcast_episode: string | null;
};

export default function AdminPage() {
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
    <main className="mx-auto max-w-3xl px-4 py-10 text-neutral-100">
      <h1 className="mb-6 text-2xl font-semibold">Admin — build the portfolio</h1>

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
    </main>
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
