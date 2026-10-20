"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { pctChangeSince, startOfDayStockholm, startOfMonth, startOfYear } from "@/lib/nav";
import PositionCard from "@/components/PositionCard";
import TradeNote from "@/components/TradeNote";
import NavChart from "@/components/NavChart";
import TraderBadge from "@/components/TraderBadge";
import TraderSettings from "@/components/TraderSettings";
import TradeLog from "@/components/TradeLog";
import PortfolioLifecycle from "@/components/PortfolioLifecycle";
import ShareButton from "@/components/ShareButton";
import MarketStatus from "@/components/MarketStatus";
import TabMenu from "@/components/TabMenu";
import PositionsExportButton from "@/components/PositionsExport";
import AdminTab from "@/components/AdminTab";
import GuestDisclaimer from "@/components/GuestDisclaimer";
import LeverageInfo from "@/components/LeverageInfo";
import { PortfolioProvider, usePortfolio } from "@/lib/portfolioClient";
import { useResync } from "@/lib/useResync";
import { useMarketOpen } from "@/lib/useMarketOpen";
import { MARKET_CLOSED_MESSAGE, isMarketOpen } from "@/lib/marketHours";
import { gavAfterAdd, realizedOnTrim, soldPartsByPosition } from "@/lib/tradeMath";
type Position = Parameters<typeof PositionCard>[0]["p"] & {
  stake_sek: number;
  quantity: number | null;
  exit_time: string | null;
  prev_close_price: number | null;
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
  return (
    <PortfolioProvider>
      <HomeInner />
    </PortfolioProvider>
  );
}

function HomeInner() {
  const portfolio = usePortfolio();
  const [tab, setTab] = useState<"dashboard" | "trades" | "admin">("dashboard");
  // Set once, synchronously, from the URL before first paint — an embedded
  // iframe (?tab=trades&embed=1) must never flash the Admin/full chrome
  // before settling on the right view.
  const [embed, setEmbed] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("embed") === "1";
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("tab");
    const isEmbed = params.get("embed") === "1";
    setEmbed(isEmbed);
    // Admin is never allowed inside an embed, even if the URL is hand-edited
    // — it has destructive, unauthenticated actions that must not be one
    // click away in someone else's page.
    if (t === "trades" || (t === "admin" && !isEmbed)) setTab(t);
  }, []);

  // Keep the address bar in step with the tab you're on, so a reload (or a
  // copied link) opens the same tab again. Without this the tab only lived in
  // memory, and a private link that ends in "&tab=admin" sent you back to the
  // admin tab on every reload no matter where you had navigated. The
  // dashboard is the default, so it carries no "tab" at all.
  function changeTab(next: "dashboard" | "trades" | "admin") {
    setTab(next);
    const params = new URLSearchParams(window.location.search);
    if (next === "dashboard") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash);
  }

  // Until we know which portfolio this link points at, show nothing that
  // could flash another portfolio's data.
  if (!portfolio.ready) {
    return <main className="mx-auto max-w-5xl px-4 py-10 text-sm text-neutral-500">Laddar…</main>;
  }
  if (portfolio.error || portfolio.notFound) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-16 text-center text-neutral-300">
        <p className="text-lg font-medium">{portfolio.notFound ? "Portföljen hittades inte" : "Något gick fel"}</p>
        <p className="mt-2 text-sm text-neutral-500">
          {portfolio.notFound ? "Länken kan vara felaktig, eller så har portföljen tagits bort." : portfolio.error}
        </p>
      </main>
    );
  }

  const adminLabel = portfolio.admin ? "Admin" : portfolio.token ? "Min portfölj" : "Admin";
        const content =
        tab === "dashboard" ? (
          <>
            <Dashboard />
            {!portfolio.isOwner && <GuestDisclaimer />}
          </>
        ) : tab === "trades" ? (
          <>
            <TradeLog />
            {!portfolio.isOwner && <GuestDisclaimer />}
          </>
        ) : (
      <AdminTab>
        <PortfolioAdmin />
      </AdminTab>
    );

  if (embed) {
    return <main className="mx-auto max-w-5xl px-4 py-4 text-neutral-100">{content}</main>;
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 text-neutral-100">
      <div className="mb-8">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-2.5">
            <img src="/vontobel-logo.png" alt="Vontobel" className="h-4 w-auto shrink-0 translate-y-[1px] opacity-60" />
            <span className="text-lg font-medium leading-none text-neutral-300">Portfolio Tracker</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden gap-1 rounded-lg border border-neutral-800 bg-neutral-900 p-1 sm:flex">
              {(
                [
                  ["dashboard", "Dashboard"],
                  ["trades", "Trades"],
                  ["admin", adminLabel],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => changeTab(key)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    tab === key ? "bg-neutral-100 text-neutral-900" : "text-neutral-400 hover:text-neutral-100"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <TabMenu tab={tab} setTab={changeTab} adminLabel={adminLabel} />
            {/* Desktop: Share sits in this same row. Mobile: it's hidden here
                and shown instead on its own row below, so the hamburger can
                share the header row with the title. */}
            <div className="hidden sm:block">
              <ShareButton />
            </div>
          </div>
        </div>
        <div className="mt-2 flex justify-start sm:hidden">
          <ShareButton />
        </div>
      </div>

      {content}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Dashboard tab
// ---------------------------------------------------------------------------

function Dashboard() {
  const { id: portfolioId } = usePortfolio();
  const [positions, setPositions] = useState<Position[]>([]);
  const [navHistory, setNavHistory] = useState<NavPoint[]>([]);
  const [baseCapital, setBaseCapital] = useState<number | null>(null);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [portfolioName, setPortfolioName] = useState<string | null>(null);

  const [refNavs, setRefNavs] = useState<{
    today: number | null;
    month: number | null;
    year: number | null;
    inception: number | null;
  }>({ today: null, month: null, year: null, inception: null });

  useEffect(() => {
    supabase.from("portfolio_settings").select("cash_sek, portfolio_name").eq("id", portfolioId).single()
      .then(({ data }) => {
        setBaseCapital(data?.cash_sek ?? null);
        setPortfolioName(data?.portfolio_name ?? null);
      });
    supabase.from("nav_history").select("ts").eq("portfolio_id", portfolioId).order("ts", { ascending: true }).limit(1)
      .then(({ data }) => setStartDate(data?.[0]?.ts ?? null));
  }, [portfolioId]);

  async function loadAll() {
    // Supabase caps a single query's rows (default 1000) regardless of any
    // date filter. With a tick every ~10s, "last 60 days" can silently be
    // capped at the OLDEST rows in that window rather than the newest — so
    // we fetch a bounded recent slice here (enough for the chart's longest
    // view) and get each stat's reference point separately below, via its
    // own tiny single-row query. That keeps every stat correct regardless
    // of how much history has piled up.
    const [{ data: pos }, { data: nav }] = await Promise.all([
      supabase.from("portfolio_positions").select("*").eq("portfolio_id", portfolioId).order("created_at", { ascending: false }),
      supabase.from("nav_history").select("ts, nav").eq("portfolio_id", portfolioId).order("ts", { ascending: false }).limit(8000),
    ]);
    setPositions((pos as Position[]) || []);
    setNavHistory(((nav as NavPoint[]) || []).slice().reverse());
  }

  async function loadReferenceNavs() {
    async function firstNavAtOrAfter(cutoff: Date | null) {
      let q = supabase.from("nav_history").select("nav").eq("portfolio_id", portfolioId).order("ts", { ascending: true }).limit(1);
      if (cutoff) q = q.gte("ts", cutoff.toISOString());
      const { data } = await q.maybeSingle();
      return data?.nav ?? null;
    }
    const [today, month, year, inception] = await Promise.all([
      firstNavAtOrAfter(startOfDayStockholm()),
      firstNavAtOrAfter(startOfMonth()),
      firstNavAtOrAfter(startOfYear()),
      firstNavAtOrAfter(null),
    ]);
    setRefNavs({ today, month, year, inception });
  }

  // Back on the page after it was in the background: prices, positions and the
  // statistics may be minutes old, and the live-update connection may have been
  // paused, so refresh everything now instead of waiting for the next event.
  useResync(() => {
    loadAll();
    loadReferenceNavs();
  });

  useEffect(() => {
    loadAll();
    loadReferenceNavs();
    const channel = supabase
      .channel(`portfolio-live-${portfolioId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "portfolio_positions", filter: `portfolio_id=eq.${portfolioId}` },
        loadAll
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "nav_history", filter: `portfolio_id=eq.${portfolioId}` },
        () => {
          loadAll();
          loadReferenceNavs();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [portfolioId]);

  const latestNav = navHistory.at(-1)?.nav ?? 100;
  function pctFrom(ref: number | null) {
    if (ref == null || ref === 0) return null;
    return ((latestNav - ref) / ref) * 100;
  }
  const dailyPct = useMemo(() => pctFrom(refNavs.today), [refNavs.today, latestNav]);
  const monthlyPct = useMemo(() => pctFrom(refNavs.month), [refNavs.month, latestNav]);
  const ytdPct = useMemo(() => pctFrom(refNavs.year), [refNavs.year, latestNav]);
  const inceptionPct = useMemo(() => pctFrom(refNavs.inception), [refNavs.inception, latestNav]);

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
  // What has already been sold off each open position (Sälj del), shown on its card.
  const soldBy = useMemo(() => soldPartsByPosition(positions as any), [positions]);

  return (
    <>
      <div className="mb-4">
        <TraderBadge />
      </div>
      {portfolioName && (
        <div className="mb-4 text-sm text-neutral-500">
          Portfölj: <span className="font-medium text-neutral-200">{portfolioName}</span>
        </div>
      )}

      <MarketStatus className="mb-3" />

      <div className="mb-6">
        <section className="flex-1 space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <NavStat label="Startkapital" value={baseCapital != null ? `${baseCapital.toLocaleString("sv-SE")} SEK` : "–"} compact />
            <NavStat label="Startdatum" value={startDate ? new Date(startDate).toLocaleDateString("sv-SE") : "–"} compact />
            <NavStat
              label="NAV"
              value={latestNav.toFixed(2)}
              sub={baseCapital != null ? `${(baseCapital * (latestNav / 100)).toLocaleString("sv-SE", { maximumFractionDigits: 0 })} SEK` : undefined}
              compact
            />
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <NavStat
              label="Idag"
              value={fmtPct(dailyPct)}
              isPct
              pctValue={dailyPct}
              sub={sekDelta(dailyPct, baseCapital)}
            />
            <NavStat
              label="Denna månad"
              value={fmtPct(monthlyPct)}
              isPct
              pctValue={monthlyPct}
              sub={sekDelta(monthlyPct, baseCapital)}
            />
            <NavStat
              label="I år"
              value={fmtPct(ytdPct)}
              isPct
              pctValue={ytdPct}
              sub={sekDelta(ytdPct, baseCapital)}
            />
            <NavStat
              label="Sedan start"
              value={fmtPct(inceptionPct)}
              isPct
              pctValue={inceptionPct}
              sub={sekDelta(inceptionPct, baseCapital)}
            />
          </div>
        </section>
      </div>

      <div className="mb-6">
        <NavChart history={navHistory} portfolioName={portfolioName} />
      </div>

      <div className="mb-3 flex justify-end gap-2">
        <PositionsExportButton
          open={open}
          closed={closed}
          closedAllCount={closedAll.length}
          totalOpenPl={totalOpenPl}
          portfolioName={portfolioName}
        />
        <div className="flex gap-1 rounded-lg border border-neutral-800 bg-neutral-900 p-1">
          {(
            [
              ["cards", "Kort"],
              ["list", "Lista"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                view === v ? "bg-neutral-100 text-neutral-900" : "text-neutral-400 hover:text-neutral-100"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <section className="mb-10">
        <div className="mb-3 flex items-baseline gap-3">
          <h2 className="text-lg font-medium text-neutral-300">Öppna positioner ({open.length})</h2>
          {open.length > 0 && (
            <span className={`text-sm font-medium ${totalOpenPl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {totalOpenPl >= 0 ? "+" : ""}
              {totalOpenPl.toLocaleString("sv-SE", { maximumFractionDigits: 0 })} SEK öppet P/L
            </span>
          )}
        </div>
        {open.length === 0 && <p className="text-neutral-500">Inga öppna positioner än — lägg till en under Admin-fliken.</p>}
        {open.length > 0 && view === "cards" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {open.map((p) => (
              <PositionCard key={p.id} p={p} sold={soldBy.get(p.id)} />
            ))}
          </div>
        )}
        {open.length > 0 && view === "list" && <PositionListView items={open} />}
      </section>

      {closedAll.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-medium text-neutral-300">
            Nyligen stängda ({closed.length}{closedAll.length > closed.length ? ` av ${closedAll.length}` : ""})
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
      <table className="w-full min-w-[820px] text-left text-sm">
        <thead className="bg-neutral-800/60 text-xs uppercase tracking-wide text-neutral-500">
          <tr>
            <th className="px-3 py-2">Namn</th>
            <th className="px-3 py-2">Underliggande</th>
            <th className="px-3 py-2">Riktning</th>
            <th className="px-3 py-2">Antal</th>
            <th className="px-3 py-2">Ingång / GAV</th>
            <th className="px-3 py-2">{items[0]?.status === "closed" ? "Utgång" : "Nu"}</th>
            <th className="px-3 py-2">Värde (SEK)</th>
            <th className="px-3 py-2">Förändring</th>
            <th className="px-3 py-2">P/L (SEK)</th>
            <th className="px-3 py-2">Stop loss</th>
            <th className="px-3 py-2">Mål</th>
            <th className="px-3 py-2">{items[0]?.status === "closed" ? "Stängd" : "Uppdaterad"}</th>
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
                <td className={`px-3 py-2 ${isLong ? "text-emerald-400" : isShort ? "text-red-400" : ""}`}>
                  {dirLabel(p.direction)}
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
function dirLabel(d: string | null | undefined) {
  if (!d) return "–";
  const v = d.toLowerCase();
  if (v === "long") return "Lång";
  if (v === "short") return "Kort";
  return d;
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
  compact,
  extra,
}: {
  label: string;
  value: string;
  isPct?: boolean;
  pctValue?: number | null;
  sub?: string;
  compact?: boolean;
  extra?: React.ReactNode;
}) {
  const color = isPct ? (pctValue == null ? "text-neutral-100" : pctValue >= 0 ? "text-emerald-400" : "text-red-400") : "text-neutral-100";
  return (
    <div className={`rounded-2xl border border-neutral-800 bg-neutral-900 ${compact ? "p-3" : "p-4"}`}>
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`mt-1 whitespace-nowrap font-semibold ${color} ${compact ? "text-base sm:text-lg" : "text-xl"}`}>
        {value}
      </div>
      {sub && <div className={`mt-0.5 truncate text-xs ${color}`}>{sub}</div>}
      {extra}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin tab
// ---------------------------------------------------------------------------

function PortfolioAdmin() {
  const { id: portfolioId, authFetch } = usePortfolio();
  const [query, setQuery] = useState("");
  const [directionFilter, setDirectionFilter] = useState<"" | "Long" | "Short">("");
  const [results, setResults] = useState<Cert[]>([]);
  const [selected, setSelected] = useState<Cert | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchedFor, setSearchedFor] = useState<string | null>(null); // the query the shown result belongs to
  const [listUpdatedAt, setListUpdatedAt] = useState<string | null>(null);
  const searchSeq = useRef(0); // only the newest search may write its result
  const [fullListCount, setFullListCount] = useState<number | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [sortKey, setSortKey] = useState<keyof Cert>("last_price");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [form, setForm] = useState({
    entry_price: "",
    stop_loss: "",
    target_price: "",
    auto_stop: false,
    auto_target: false,
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
  }, [portfolioId]);

  const suppressNextSearch = useRef(false);

  useEffect(() => {
    if (suppressNextSearch.current) {
      suppressNextSearch.current = false;
      return;
    }
    const t = setTimeout(async () => {
      const mine = ++searchSeq.current;
      if (query.trim().length < 2) {
        setResults([]);
        setTotalCount(0);
        setHasMore(false);
        setSearchError(null);
        setSearchedFor(null);
        return;
      }
      const params = new URLSearchParams({ q: query });
      if (directionFilter) params.set("direction", directionFilter);
      try {
        const res = await fetch(`/api/certificates/search?${params}`);
        const body = await res.json().catch(() => ({}));
        if (mine !== searchSeq.current) return; // a newer search has started: ignore this answer
        if (!res.ok) {
          setSearchError(body.error ? `Sökningen misslyckades: ${body.error}` : "Sökningen misslyckades. Försök igen om en stund.");
          setResults([]);
          setTotalCount(0);
          setHasMore(false);
          setSearchedFor(null);
          return;
        }
        setSearchError(null);
        setResults(body.results || []);
        setTotalCount(body.totalCount || 0);
        setHasMore(!!body.hasMore);
        setNextOffset(body.nextOffset || 0);
        if (body.listUpdatedAt) setListUpdatedAt(body.listUpdatedAt);
        setSearchedFor(query.trim());
      } catch {
        if (mine === searchSeq.current) setSearchError("Kunde inte nå servern. Kontrollera uppkopplingen och försök igen.");
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, directionFilter]);

  // A broad search can match more contracts than fit in one answer; fetch the next batch.
  async function loadMore() {
    if (loadingMore || !hasMore) return;
    const mine = searchSeq.current;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ q: query, offset: String(nextOffset) });
      if (directionFilter) params.set("direction", directionFilter);
      const res = await fetch(`/api/certificates/search?${params}`);
      const body = await res.json().catch(() => ({}));
      if (mine !== searchSeq.current) return; // the search changed while this was loading
      if (!res.ok) {
        setSearchError(body.error ? `Sökningen misslyckades: ${body.error}` : "Sökningen misslyckades. Försök igen om en stund.");
        return;
      }
      setResults((prev) => {
        const have = new Set(prev.map((r) => r.isin));
        return [...prev, ...(body.results || []).filter((r: Cert) => !have.has(r.isin))];
      });
      setHasMore(!!body.hasMore);
      setNextOffset(body.nextOffset || nextOffset);
    } catch {
      setSearchError("Kunde inte nå servern. Kontrollera uppkopplingen och försök igen.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function loadPositions() {
    const res = await authFetch(`/api/positions?portfolio_id=${portfolioId}`);
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

  // The live buy price (ask) and sell price (bid) of the selected contract.
  // The entry price is ALWAYS the ask, fetched live; it is shown here but can't
  // be typed in, and the server fetches it again itself at the moment you add.
  const [liveQuote, setLiveQuote] = useState<{ ask: number | null; bid: number | null; loaded: boolean }>({
    ask: null,
    bid: null,
    loaded: false,
  });

  function selectCert(c: Cert) {
    setSelected(c);
    setForm((f) => ({ ...f, entry_price: "" })); // never the stale daily value
    setLiveQuote({ ask: null, bid: null, loaded: false });
    setResults([]);
    suppressNextSearch.current = true; // selecting shouldn't immediately re-search and reopen the list
    setQuery(c.name);
  }

  // While a contract is selected, keep its live ask/bid fresh.
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    const load = () =>
      fetch(`/api/certificates/live-price?isin=${selected.isin}`, { cache: "no-store" })
        .then((r) => r.json())
        .then(({ ask, bid }) => {
          if (cancelled) return;
          setLiveQuote({ ask: ask ?? null, bid: bid ?? null, loaded: true });
          setForm((f) => ({ ...f, entry_price: ask != null ? String(ask) : "" }));
        })
        .catch(() => {
          if (!cancelled) setLiveQuote({ ask: null, bid: null, loaded: true });
        });
    load();
    const t = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [selected?.isin]);

  async function addPosition() {
    if (!selected) return;
    // (The button is already disabled when closed; this covers a click right at the closing minute.)
    if (!isMarketOpen(new Date())) {
      alert(MARKET_CLOSED_MESSAGE);
      return;
    }
    setSaving(true);
    const res = await authFetch("/api/positions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        portfolio_id: portfolioId,
        isin: selected.isin,
        // No entry price: the server uses the live ask.
        stop_loss: form.stop_loss ? parseFloat(form.stop_loss) : null,
        target_price: form.target_price ? parseFloat(form.target_price) : null,
        // Automatic closing only makes sense with a level to close at.
        auto_stop: form.auto_stop && parseFloat(form.stop_loss) > 0,
        auto_target: form.auto_target && parseFloat(form.target_price) > 0,
        quantity: parseFloat(form.quantity) || 0,
        note: form.note || null,
        podcast_episode: form.podcast_episode || null,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setSelected(null);
      setLiveQuote({ ask: null, bid: null, loaded: false });
      setQuery("");
      setForm({
        entry_price: "",
        stop_loss: "",
        target_price: "",
        auto_stop: false,
        auto_target: false,
        quantity: "100",
        note: "",
        podcast_episode: "",
      });
      loadPositions();
    } else {
      alert((await res.json()).error || "Failed to add position");
    }
  }

  async function closePosition(id: string) {
    if (!isMarketOpen(new Date())) {
      alert(MARKET_CLOSED_MESSAGE);
      return;
    }
    if (!confirm("Stäng positionen? Den säljs till aktuell säljkurs (bid).")) return;
    const res = await authFetch(`/api/positions/${id}/close`, { method: "POST" });
    if (!res.ok) alert((await res.json().catch(() => ({}))).error || "Det gick inte att stänga positionen.");
    loadPositions();
  }

  async function reopenPosition(id: string) {
    if (!confirm("Reopen this position? Its exit will be cleared and the worker will resume tracking it.")) return;
    await authFetch(`/api/positions/${id}/reopen`, { method: "POST" });
    loadPositions();
  }

  async function deletePosition(id: string, name: string) {
    if (!confirm(`Permanently delete "${name}"? This can't be undone.`)) return;
    await authFetch(`/api/positions/${id}`, { method: "DELETE" });
    loadPositions();
  }

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    entry_price: "",
    quantity: "",
    stop_loss: "",
    target_price: "",
    auto_stop: false,
    auto_target: false,
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
      auto_stop: !!p.auto_stop,
      auto_target: !!p.auto_target,
      exit_price: String(p.exit_price ?? ""),
      note: p.note ?? "",
      podcast_episode: p.podcast_episode ?? "",
    });
  }

  async function saveEdit(id: string, status: "open" | "closed") {
    // Entry price, exit price and quantity are locked (the quantity changes through
    // Köp mer / Sälj del), so they are never sent.
    const payload: Record<string, unknown> = {
      stop_loss: editForm.stop_loss ? parseFloat(editForm.stop_loss) : null,
      target_price: editForm.target_price ? parseFloat(editForm.target_price) : null,
      note: editForm.note || null,
      podcast_episode: editForm.podcast_episode || null,
    };
    if (status === "open") {
      // Open positions only; the server writes these only if they changed.
      payload.auto_stop = editForm.auto_stop && parseFloat(editForm.stop_loss) > 0;
      payload.auto_target = editForm.auto_target && parseFloat(editForm.target_price) > 0;
    }
    const res = await authFetch(`/api/positions/${id}`, {
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

  // ---- Köp mer (buy more) / Sälj del (sell part) --------------------------------------
  // The price is always the live ask (buying) or bid (selling), fetched by the server at
  // the moment you confirm; what is shown here is only a preview.
  const marketOpen = useMarketOpen();
  const [trade, setTrade] = useState<{ id: string; isin: string; mode: "add" | "trim" } | null>(null);
  const [tradeQty, setTradeQty] = useState("");
  const [tradeQuote, setTradeQuote] = useState<{ ask: number | null; bid: number | null; loaded: boolean }>({ ask: null, bid: null, loaded: false });
  const [tradeBusy, setTradeBusy] = useState(false);
  const [tradeError, setTradeError] = useState<string | null>(null);

  function openTrade(p: Position, mode: "add" | "trim") {
    setEditingId(null);
    setTrade({ id: p.id, isin: p.isin, mode });
    setTradeQty("");
    setTradeError(null);
    setTradeQuote({ ask: null, bid: null, loaded: false });
  }

  useEffect(() => {
    if (!trade) return;
    let cancelled = false;
    const load = () =>
      fetch(`/api/certificates/live-price?isin=${trade.isin}`, { cache: "no-store" })
        .then((r) => r.json())
        .then(({ ask, bid }) => !cancelled && setTradeQuote({ ask: ask ?? null, bid: bid ?? null, loaded: true }))
        .catch(() => !cancelled && setTradeQuote({ ask: null, bid: null, loaded: true }));
    load();
    const t = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [trade?.id, trade?.mode]);

  async function submitTrade(p: Position) {
    if (!trade) return;
    if (!isMarketOpen(new Date())) {
      setTradeError(MARKET_CLOSED_MESSAGE);
      return;
    }
    setTradeBusy(true);
    setTradeError(null);
    try {
      const res = await authFetch(`/api/positions/${p.id}/${trade.mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: Number(tradeQty.replace(",", ".")) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTradeError(body.error || "Det gick inte att genomföra affären.");
        return;
      }
      setTrade(null);
      loadPositions();
    } catch {
      setTradeError("Kunde inte nå servern. Försök igen.");
    } finally {
      setTradeBusy(false);
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

      {searchError && (
        <div className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{searchError}</div>
      )}

      {!searchError && results.length === 0 && searchedFor !== null && searchedFor === query.trim() && (
        <section className="mb-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-6 text-sm text-neutral-400">
          <p className="mb-2 text-neutral-200">
            Inga kontrakt matchade ”{searchedFor}”{directionFilter ? ` (endast ${directionFilter})` : ""}.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Alla ord du skriver måste finnas i namn, underliggande tillgång eller ISIN. Prova färre ord, till exempel bara AMZN eller serienumret (VT927).</li>
            {directionFilter && <li>Riktningsfiltret ({directionFilter}) är på. Välj All för att se alla.</li>}
            <li>
              Nya kontrakt läggs till i listan en gång per dygn, kring kl 17:30 svensk tid. Ett kontrakt som börjat handlas i dag syns först i morgon.
              {listUpdatedAt ? ` Listan uppdaterades senast ${new Date(listUpdatedAt).toLocaleString("sv-SE")}.` : ""}
            </li>
          </ul>
        </section>
      )}

      {results.length > 0 && (
        <section className="mb-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
          <div className="mb-3 text-sm text-neutral-400">
            Visar {results.length} av {totalCount} kontrakt
            {directionFilter ? ` (endast ${directionFilter})` : ""}
            {hasMore ? ` — mest handlade först. Skriv fler ord (till exempel serienumret, VT927) eller klicka Visa fler längst ner.` : ""}
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
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500">
            <span>
              {listUpdatedAt ? `Kontraktslistan uppdaterades senast ${new Date(listUpdatedAt).toLocaleString("sv-SE")}.` : ""}
            </span>
            {hasMore && (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm font-medium text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
              >
                {loadingMore ? "Hämtar…" : `Visa fler (${Math.min(500, totalCount - results.length)} till)`}
              </button>
            )}
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
              <LeverageInfo isin={selected.isin} />
            </div>
            <Field label="Ingångskurs (köpkurs, ask)">
              <input
                value={form.entry_price}
                readOnly
                placeholder={liveQuote.loaded ? "–" : "Hämtar…"}
                title="Sätts alltid till köpkursen när du lägger till positionen"
                className="input cursor-not-allowed opacity-70"
              />
              {liveQuote.loaded && liveQuote.ask == null ? (
                <p className="mt-1 text-xs text-red-400">Ingen köpkurs (ask) finns just nu för kontraktet.</p>
              ) : liveQuote.loaded && liveQuote.bid == null ? (
                <p className="mt-1 text-xs text-red-400">
                  Ingen säljkurs (bid) finns just nu för kontraktet, så positionen kan inte värderas och läggs inte till.
                </p>
              ) : (
                <p className="mt-1 text-xs text-neutral-500">
                  Live, sätts alltid till köpkursen. Går inte att ändra.
                  {liveQuote.bid != null && liveQuote.ask != null && (
                    <>
                      {" "}
                      Säljkurs (bid) {liveQuote.bid} · spread {(((liveQuote.ask - liveQuote.bid) / liveQuote.ask) * 100).toFixed(2)}%
                    </>
                  )}
                </p>
              )}
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
            {!marketOpen && (
              <p className="col-span-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {MARKET_CLOSED_MESSAGE} Du kan förbereda positionen här, men inte lägga till den förrän marknaden öppnar.
              </p>
            )}
            <AutoCloseOptions
              stop={form.stop_loss}
              target={form.target_price}
              autoStop={form.auto_stop}
              autoTarget={form.auto_target}
              onChange={(patch) => setForm({ ...form, ...patch })}
            />
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
              disabled={saving || !form.entry_price || liveQuote.bid == null || !marketOpen}
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
                    <Field label={p.adds && p.adds > 0 ? "GAV (snittkurs)" : "Ingångskurs (ask)"}>
                      <input value={editForm.entry_price} readOnly title="Kan inte ändras" className="input cursor-not-allowed opacity-70" />
                    </Field>
                    <Field label="Antal (ändras med Köp mer / Sälj del)">
                      <input value={editForm.quantity} readOnly title="Kan inte ändras här" className="input cursor-not-allowed opacity-70" />
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
                    {p.status === "open" && (
                      <AutoCloseOptions
                        stop={editForm.stop_loss}
                        target={editForm.target_price}
                        autoStop={editForm.auto_stop}
                        autoTarget={editForm.auto_target}
                        onChange={(patch) => setEditForm({ ...editForm, ...patch })}
                      />
                    )}
                    {p.status === "closed" && (
                      <Field label="Utgångskurs (bid)">
                        <input value={editForm.exit_price} readOnly title="Kan inte ändras" className="input cursor-not-allowed opacity-70" />
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
                      {p.quantity ? `${p.quantity} contracts · ` : ""}{p.adds && p.adds > 0 ? "GAV" : "Entry"} {p.entry_price} → Now{" "}
                      {p.status === "closed" ? p.exit_price ?? "–" : p.current_price ?? "–"} · SL{" "}
                      {p.stop_loss ?? "–"}
                      {p.status === "open" && p.auto_stop ? " (auto)" : ""} · Target {p.target_price ?? "–"}
                      {p.status === "open" && p.auto_target ? " (auto)" : ""}
                      {p.status === "closed" && p.close_reason === "stop_loss" ? " · stängd automatiskt vid stop loss" : ""}
                      {p.status === "closed" && p.close_reason === "take_profit" ? " · stängd automatiskt vid målet" : ""}
                      {p.status === "closed" && p.close_reason === "trim" ? " · såld del av en position" : ""}
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
                    {p.status === "open" && p.quantity != null && (
                      <>
                        <button
                          onClick={() => openTrade(p, "add")}
                          className="rounded-lg border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-800"
                        >
                          Köp mer
                        </button>
                        {p.quantity > 1 && (
                          <button
                            onClick={() => openTrade(p, "trim")}
                            className="rounded-lg border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-800"
                          >
                            Sälj del
                          </button>
                        )}
                      </>
                    )}
                    {p.status === "open" && (
                      <button
                        onClick={() => closePosition(p.id)}
                        className="rounded-lg border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-800"
                      >
                        Close
                      </button>
                    )}
                    {p.status === "closed" && !p.parent_position_id && (
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
              {editingId !== p.id && trade?.id === p.id && p.status === "open" && p.quantity != null && (
                <TradePanel
                  position={p}
                  mode={trade.mode}
                  qty={tradeQty}
                  setQty={setTradeQty}
                  quote={tradeQuote}
                  marketOpen={marketOpen}
                  busy={tradeBusy}
                  error={tradeError}
                  onConfirm={() => submitTrade(p)}
                  onCancel={() => setTrade(null)}
                />
              )}
            </div>
          ))}
          {positions.length === 0 && <p className="text-neutral-500">No positions yet.</p>}
        </div>
      </section>

      <PortfolioLifecycle />

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

// "Köp mer" / "Sälj del": a quantity, the live price it would happen at, and a preview of what
// it does to the position. The real price and calculation are done by the server.
function TradePanel({
  position: p,
  mode,
  qty,
  setQty,
  quote,
  marketOpen,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  position: Position;
  mode: "add" | "trim";
  qty: string;
  setQty: (v: string) => void;
  quote: { ask: number | null; bid: number | null; loaded: boolean };
  marketOpen: boolean;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const held = Number(p.quantity);
  const gav = Number(p.entry_price);
  const n = Number(qty.replace(",", "."));
  const price = mode === "add" ? quote.ask : quote.bid;
  // Buying needs both sides: the holding is valued at the bid.
  const buyNeedsBid = mode === "add" && quote.loaded && quote.ask != null && quote.bid == null;
  const qtyOk = Number.isFinite(n) && n > 0 && (mode === "add" || n < held);
  const sek = (v: number) => `${v >= 0 ? "+" : ""}${v.toLocaleString("sv-SE", { maximumFractionDigits: 0 })} SEK`;
  const f2 = (v: number) => v.toFixed(2);

  let preview: React.ReactNode = null;
  if (qtyOk && price != null) {
    if (mode === "add") {
      const newGav = gavAfterAdd(held, gav, n, price);
      preview = (
        <>
          Efter köpet: {held + n} kontrakt, GAV {f2(newGav)} (nu {f2(gav)}). Kostar ca {(n * price).toLocaleString("sv-SE", { maximumFractionDigits: 0 })} SEK.
        </>
      );
    } else {
      const realized = realizedOnTrim(gav, n, price);
      preview = (
        <>
          Realiserat: <span className={realized >= 0 ? "text-emerald-400" : "text-red-400"}>{sek(realized)}</span>. Kvar: {held - n} kontrakt, GAV oförändrat {f2(gav)}.
        </>
      );
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-950/50 p-3">
      <div className="mb-2 text-sm font-medium text-neutral-200">
        {mode === "add" ? "Köp mer" : "Sälj del"} · {p.name}
        <span className="ml-2 font-normal text-neutral-500">
          Du håller {held} kontrakt, {p.adds && p.adds > 0 ? "GAV" : "ingångskurs"} {f2(gav)}
        </span>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="w-44">
          <span className="mb-1 block text-xs text-neutral-500">{mode === "add" ? "Antal att köpa till" : `Antal att sälja (högst ${held - 1})`}</span>
          <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" className="input" />
        </label>
        <div className="text-sm text-neutral-300">
          {!quote.loaded ? (
            <span className="text-neutral-500">Hämtar kurs…</span>
          ) : price == null ? (
            <span className="text-red-400">Ingen {mode === "add" ? "köpkurs (ask)" : "säljkurs (bid)"} finns just nu.</span>
          ) : buyNeedsBid ? (
            <span className="text-red-400">Ingen säljkurs (bid) finns just nu, så köpet kan inte värderas.</span>
          ) : (
            <>
              {mode === "add" ? "Köpkurs (ask)" : "Säljkurs (bid)"} <span className="font-medium text-neutral-100">{f2(price)}</span>
              <span className="ml-1 text-xs text-neutral-500">live, hämtas om när du bekräftar</span>
            </>
          )}
        </div>
      </div>
      {preview && <p className="mt-2 text-sm text-neutral-300">{preview}</p>}
      {qty.trim() !== "" && !qtyOk && (
        <p className="mt-2 text-sm text-red-400">
          {mode === "add" ? "Ange ett antal större än 0." : `Ange ett antal mellan 1 och ${held - 1}. Vill du sälja allt, använd Close.`}
        </p>
      )}
      {!marketOpen && <p className="mt-2 text-sm text-red-400">{MARKET_CLOSED_MESSAGE}</p>}
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button
          onClick={onConfirm}
          disabled={busy || !qtyOk || price == null || buyNeedsBid || !marketOpen}
          className="rounded-lg bg-neutral-100 px-4 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
        >
          {busy ? "Genomför…" : mode === "add" ? "Köp till" : "Sälj"}
        </button>
        <button onClick={onCancel} className="rounded-lg border border-neutral-700 px-4 py-1.5 text-sm hover:bg-neutral-800">
          Avbryt
        </button>
      </div>
    </div>
  );
}

// The two "close automatically" switches. Each only works together with a price
// in the matching field above, so it is disabled (and shown off) until there is one.
function AutoCloseOptions({
  stop,
  target,
  autoStop,
  autoTarget,
  onChange,
}: {
  stop: string;
  target: string;
  autoStop: boolean;
  autoTarget: boolean;
  onChange: (patch: { auto_stop?: boolean; auto_target?: boolean }) => void;
}) {
  const hasStop = parseFloat(stop) > 0;
  const hasTarget = parseFloat(target) > 0;
  const row = (enabled: boolean) => `flex items-center gap-2 text-sm ${enabled ? "text-neutral-200" : "text-neutral-600"}`;
  return (
    <div className="col-span-2 rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
      <div className="mb-2 text-sm font-medium text-neutral-300">Automatisk stängning</div>
      <div className="space-y-1.5">
        <label className={row(hasStop)}>
          <input
            type="checkbox"
            checked={autoStop && hasStop}
            disabled={!hasStop}
            onChange={(e) => onChange({ auto_stop: e.target.checked })}
          />
          Stäng automatiskt vid stop loss
        </label>
        <label className={row(hasTarget)}>
          <input
            type="checkbox"
            checked={autoTarget && hasTarget}
            disabled={!hasTarget}
            onChange={(e) => onChange({ auto_target: e.target.checked })}
          />
          Stäng automatiskt vid mål
        </label>
      </div>
      <p className="mt-2 text-xs text-neutral-500">
        Kontrolleras var tionde sekund när marknaden är öppen. Positionen stängs till den kurs som senast sågs, efter att nivån
        nåtts på två mätningar i rad.
      </p>
    </div>
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
