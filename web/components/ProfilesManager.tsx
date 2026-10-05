"use client";

import { useCallback, useEffect, useState } from "react";
import { EMBED_TABS, allEmbedCodes, embedCode, privateUrl, viewUrl } from "@/lib/embed";
import { usePortfolio } from "@/lib/portfolioClient";

type Row = {
  id: number;
  slug: string;
  kind: "owner" | "guest";
  trader_name: string | null;
  portfolio_name: string | null;
  cash_sek: number | null;
  edit_token: string | null;
};

const label = (r: Row) => r.trader_name || r.portfolio_name || r.slug;

// Owner-only: every profile in one list, with the links and embed codes for
// each, and the controls to add a guest, re-issue their private link, or
// remove them.
export default function ProfilesManager() {
  const { authFetch, slug: currentSlug } = usePortfolio();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");

  const [name, setName] = useState("");
  const [capital, setCapital] = useState("100000");
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<{ slug: string; name: string; token: string } | null>(null);

  useEffect(() => setOrigin(window.location.origin), []);

  const load = useCallback(async () => {
    try {
      const res = await authFetch("/api/admin/portfolios", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `Fel (${res.status})`);
      setRows(j as Row[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [authFetch]);

  useEffect(() => {
    load();
  }, [load]);

  async function copy(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {}
      document.body.removeChild(ta);
    }
    setCopied(id);
    setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const res = await authFetch("/api/admin/portfolios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, capital: Number(capital.replace(/[\s\u00a0]/g, "").replace(",", ".")) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `Fel (${res.status})`);
      setFresh({ slug: j.slug, name, token: j.edit_token });
      setName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  async function regenerate(r: Row) {
    if (!confirm(`Skapa en ny privat länk för ${label(r)}? Den gamla länken slutar fungera direkt.`)) return;
    const res = await authFetch(`/api/admin/portfolios/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "regenerate_token" }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return setError(j.error || `Fel (${res.status})`);
    setFresh({ slug: r.slug, name: label(r), token: j.edit_token });
    load();
  }

  async function remove(r: Row) {
    const typed = prompt(
      `Detta tar bort ${label(r)} och ALLA dess affärer och historik, permanent.\n\nSkriv portföljens adress för att bekräfta:\n${r.slug}`
    );
    if (typed == null) return;
    const res = await authFetch(`/api/admin/portfolios/${r.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: typed.trim() }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return setError(j.error || `Fel (${res.status})`);
    if (fresh?.slug === r.slug) setFresh(null);
    load();
  }

  const btn =
    "rounded-md border border-neutral-700 px-2.5 py-1 text-xs font-medium text-neutral-300 hover:bg-neutral-800 disabled:opacity-50";

  return (
    <section className="mb-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-medium">Profiler</h2>
        {rows && origin && (
          <button
            className={btn}
            onClick={() => copy(allEmbedCodes(origin, rows.map((r) => ({ slug: r.slug, name: label(r) }))), "all")}
          >
            {copied === "all" ? "Kopierat" : "Kopiera alla embed-koder"}
          </button>
        )}
      </div>

      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
      {!rows && !error && <p className="text-sm text-neutral-500">Laddar…</p>}

      {fresh && origin && (
        <div className="mb-4 rounded-xl border border-sky-500/30 bg-sky-500/10 p-3">
          <div className="mb-1 text-sm font-medium text-sky-200">Privat länk för {fresh.name}</div>
          <p className="mb-2 text-xs text-sky-200/70">
            Skicka den här länken till gästen. Den ger full kontroll över just den portföljen, så behandla den som ett lösenord.
          </p>
          <div className="flex gap-1.5">
            <input
              readOnly
              value={privateUrl(origin, fresh.slug, fresh.token)}
              onFocus={(e) => e.target.select()}
              className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-200 outline-none"
            />
            <button className={btn} onClick={() => copy(privateUrl(origin, fresh.slug, fresh.token), "fresh")}>
              {copied === "fresh" ? "Kopierad" : "Kopiera"}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {rows?.map((r) => {
          const here = r.slug === currentSlug;
          const open = r.kind === "owner" ? `${origin}/?tab=admin` : `${origin}/?p=${r.slug}&tab=admin`;
          return (
            <div key={r.id} className={`rounded-xl border p-3 ${here ? "border-neutral-600" : "border-neutral-800"}`}>
              <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium text-neutral-100">{label(r)}</span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    r.kind === "owner" ? "bg-neutral-100 text-neutral-900" : "bg-sky-500/20 text-sky-300"
                  }`}
                >
                  {r.kind === "owner" ? "Ägare" : "Gäst"}
                </span>
                <span className="text-xs text-neutral-500">{r.slug}</span>
                {here && <span className="text-xs text-neutral-400">· du hanterar den här nu</span>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {!here && (
                  <a href={open} className={btn}>
                    Hantera
                  </a>
                )}
                <button className={btn} onClick={() => copy(viewUrl(origin, r.slug), `v${r.id}`)}>
                  {copied === `v${r.id}` ? "Kopierad" : "Kopiera länk"}
                </button>
                {EMBED_TABS.map((t) => (
                  <button key={t.key} className={btn} onClick={() => copy(embedCode(origin, r.slug, t.key), `e${r.id}${t.key}`)}>
                    {copied === `e${r.id}${t.key}` ? "Kopierad" : `Embed ${t.label}`}
                  </button>
                ))}
                {r.kind === "guest" && r.edit_token && (
                  <>
                    <button className={btn} onClick={() => copy(privateUrl(origin, r.slug, r.edit_token!), `p${r.id}`)}>
                      {copied === `p${r.id}` ? "Kopierad" : "Kopiera privat länk"}
                    </button>
                    <button className={btn} onClick={() => regenerate(r)}>
                      Ny privat länk
                    </button>
                    <button className={`${btn} !border-red-500/40 !text-red-300 hover:!bg-red-500/10`} onClick={() => remove(r)}>
                      Ta bort
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <form onSubmit={create} className="mt-5 border-t border-neutral-800 pt-4">
        <div className="mb-2 text-sm font-medium text-neutral-300">Lägg till gäst</div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-[10rem] flex-1">
            <span className="mb-1 block text-xs text-neutral-500">Namn</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="T.ex. Anna Svensson"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm outline-none focus:border-neutral-500"
            />
          </label>
          <label className="w-36">
            <span className="mb-1 block text-xs text-neutral-500">Startkapital (SEK)</span>
            <input
              value={capital}
              onChange={(e) => setCapital(e.target.value)}
              inputMode="decimal"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm outline-none focus:border-neutral-500"
            />
          </label>
          <button
            type="submit"
            disabled={creating || !name.trim()}
            className="rounded-lg bg-neutral-100 px-4 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
          >
            {creating ? "Skapar…" : "Skapa"}
          </button>
        </div>
      </form>
    </section>
  );
}
