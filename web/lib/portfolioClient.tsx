"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

// Which portfolio is this page showing, and what is the visitor allowed to do?
//
//   /                         -> the owner's portfolio ("main")
//   /?p=<slug>                -> a guest's portfolio, view only
//   /?p=<slug>&k=<token>      -> a guest's private link: the token is stored in
//                                this browser and removed from the address bar
//   admin password login      -> may manage every portfolio
//
// The server decides what is actually allowed on every change; this only
// decides what to show.

const TOKEN_KEY = (slug: string) => `pt_edit_token:${slug}`;

export type PortfolioCtx = {
  ready: boolean;
  notFound: boolean;
  error: string | null;
  id: number;
  slug: string;
  isOwner: boolean;
  admin: boolean;
  adminConfigured: boolean;
  token: string | null;
  canEdit: boolean;
  embed: boolean;
  authFetch: (input: string, init?: RequestInit) => Promise<Response>;
  refreshAuth: () => Promise<void>;
  logout: () => Promise<void>;
};

const Ctx = createContext<PortfolioCtx | null>(null);

export function usePortfolio(): PortfolioCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePortfolio must be used inside <PortfolioProvider>");
  return v;
}

function readToken(slug: string): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY(slug));
  } catch {
    return null;
  }
}

export function PortfolioProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState({
    ready: false,
    notFound: false,
    error: null as string | null,
    id: 0,
    slug: "main",
    isOwner: false,
    embed: false,
    token: null as string | null,
  });
  const [auth, setAuth] = useState({ admin: false, configured: true });

  const refreshAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/status", { cache: "no-store" });
      const j = await res.json();
      setAuth({ admin: !!j.admin, configured: j.configured !== false });
    } catch {
      setAuth({ admin: false, configured: true });
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const embed = params.get("embed") === "1";
    const slug = (params.get("p") ?? "main").toLowerCase();
    const incoming = params.get("k");

    // A private link: remember the token for this portfolio, then hide it.
    // (Never inside an embed — those are view-only.)
    if (incoming && !embed && /^[a-z0-9-]{2,40}$/.test(slug)) {
      try {
        window.localStorage.setItem(TOKEN_KEY(slug), incoming);
      } catch {}
    }
    if (incoming) {
      params.delete("k");
      const qs = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash);
    }
    const token = embed ? null : readToken(slug);

    (async () => {
      if (!/^[a-z0-9-]{2,40}$/.test(slug)) {
        setState((s) => ({ ...s, ready: true, notFound: true, slug, embed }));
        return;
      }
      const { data, error } = await supabase.from("portfolio_settings").select("id, kind").eq("slug", slug).maybeSingle();
      if (error) {
        setState((s) => ({
          ...s,
          ready: true,
          slug,
          embed,
          error: "Databasen är inte uppdaterad för flera portföljer ännu (kör migrationen 0002_multi_portfolio.sql).",
        }));
        return;
      }
      if (!data) {
        setState((s) => ({ ...s, ready: true, notFound: true, slug, embed }));
        return;
      }
      if (!embed) await refreshAuth();
      setState({ ready: true, notFound: false, error: null, id: data.id as number, slug, isOwner: data.kind === "owner", embed, token });
    })();
  }, [refreshAuth]);

  const authFetch = useCallback(
    (input: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      if (state.token) headers.set("x-edit-token", state.token);
      return fetch(input, { ...init, headers, credentials: "same-origin" });
    },
    [state.token]
  );

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    await refreshAuth();
  }, [refreshAuth]);

  const value = useMemo<PortfolioCtx>(
    () => ({
      ready: state.ready,
      notFound: state.notFound,
      error: state.error,
      id: state.id,
      slug: state.slug,
      isOwner: state.isOwner,
      admin: auth.admin,
      adminConfigured: auth.configured,
      token: state.token,
      canEdit: !state.embed && (auth.admin || !!state.token),
      embed: state.embed,
      authFetch,
      refreshAuth,
      logout,
    }),
    [state, auth, authFetch, refreshAuth, logout]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
