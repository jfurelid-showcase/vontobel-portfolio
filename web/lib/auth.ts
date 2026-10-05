import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { originAllowed, parsePortfolioId, safeEqual, verifySessionToken } from "@/lib/authCore";

export const ADMIN_COOKIE = "pt_admin";
export const EDIT_TOKEN_HEADER = "x-edit-token";

// The admin password lives in the ADMIN_PASSWORD environment variable
// (Vercel -> Settings -> Environment Variables). If it isn't set, admin
// actions are refused outright instead of silently being open to everyone.
export function adminSecret(): string | null {
  return process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || null;
}
export function adminPassword(): string | null {
  return process.env.ADMIN_PASSWORD || null;
}

export function isAdminRequest(req: NextRequest): boolean {
  return verifySessionToken(adminSecret(), req.cookies.get(ADMIN_COOKIE)?.value);
}

export type Access = { ok: true; role: "admin" | "guest" } | { ok: false; res: NextResponse };

function deny(status: number, error: string): Access {
  return { ok: false, res: NextResponse.json({ error }, { status }) };
}

function sameOrigin(req: NextRequest): boolean {
  return originAllowed(req.headers.get("origin"), req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
}

// Only the owner (admin password). Used for managing all profiles.
export function requireAdmin(req: NextRequest): Access {
  if (!adminPassword()) return deny(503, "ADMIN_PASSWORD är inte inställt på servern.");
  if (!sameOrigin(req)) return deny(403, "Ogiltigt ursprung.");
  if (!isAdminRequest(req)) return deny(401, "Inte inloggad.");
  return { ok: true, role: "admin" };
}

// May this request change the given portfolio? Yes if it carries a valid
// admin session, or the portfolio's own private edit token. A token for one
// portfolio never works on another.
export async function requireAccess(req: NextRequest, portfolioId: number): Promise<Access> {
  if (!sameOrigin(req)) return deny(403, "Ogiltigt ursprung.");

  if (isAdminRequest(req)) return { ok: true, role: "admin" };

  const token = req.headers.get(EDIT_TOKEN_HEADER);
  if (token) {
    const { data } = await supabaseAdmin
      .from("portfolio_access")
      .select("edit_token")
      .eq("portfolio_id", portfolioId)
      .maybeSingle();
    if (data?.edit_token && safeEqual(token, data.edit_token)) return { ok: true, role: "guest" };
    return deny(403, "Ogiltig redigeringslänk för den här portföljen.");
  }

  if (!adminPassword()) return deny(503, "ADMIN_PASSWORD är inte inställt på servern.");
  return deny(401, "Inte inloggad.");
}

// Look up which portfolio a position belongs to (so a request that only
// names a position id can still be authorised against the right portfolio).
export async function portfolioOfPosition(positionId: string): Promise<number | null> {
  const { data } = await supabaseAdmin.from("portfolio_positions").select("portfolio_id").eq("id", positionId).maybeSingle();
  return parsePortfolioId(data?.portfolio_id);
}

export function portfolioIdFrom(v: unknown, fallback: number | null = 1): number | null {
  if (v == null || v === "") return fallback;
  return parsePortfolioId(v);
}
