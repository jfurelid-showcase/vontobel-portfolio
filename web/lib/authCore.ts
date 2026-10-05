// Pure helpers for the admin password session and for edit tokens. Kept free
// of Next.js / Supabase imports so they can be unit-tested on their own;
// lib/auth.ts wires them to requests.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";

export const SESSION_SECONDS = 14 * 24 * 3600;

// Compare two strings in constant time (by hashing first so lengths match).
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

// A session token is "<expiry unix seconds>.<hmac of the expiry>". It carries
// no user data; it only proves the holder logged in with the admin password
// recently. Changing ADMIN_PASSWORD (or SESSION_SECRET) invalidates every
// existing session.
function mac(secret: string, exp: string): string {
  return createHmac("sha256", secret).update(`admin-session:${exp}`).digest("base64url");
}

export function createSessionToken(secret: string, nowMs = Date.now(), ttlSeconds = SESSION_SECONDS): string {
  const exp = String(Math.floor(nowMs / 1000) + ttlSeconds);
  return `${exp}.${mac(secret, exp)}`;
}

export function verifySessionToken(secret: string | null, token: string | null | undefined, nowMs = Date.now()): boolean {
  if (!secret || !token) return false;
  const dot = token.indexOf(".");
  if (dot < 1) return false;
  const exp = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d{9,12}$/.test(exp)) return false;
  if (Number(exp) * 1000 < nowMs) return false;
  return safeEqual(sig, mac(secret, exp));
}

// 32 random bytes -> 43 url-safe characters.
export function newEditToken(): string {
  return randomBytes(32).toString("base64url");
}

// "Anna Svensson" -> "anna-svensson-k3x9"; always matches the database's slug
// rule (3-40 chars, a-z 0-9 and dashes, no leading/trailing dash).
export function makeSlug(name: string, rand: string = randomBytes(3).toString("hex").slice(0, 4)): string {
  const base =
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 28)
      .replace(/-+$/g, "") || "gast";
  return `${base}-${rand}`;
}

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export function parsePortfolioId(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isInteger(n) && n > 0 && n < 2_000_000_000 ? n : null;
}

// Cookie-authenticated writes must come from our own pages. Browsers send an
// Origin header on cross-site POSTs; if it's there it has to match our host.
export function originAllowed(origin: string | null, host: string | null): boolean {
  if (!origin) return true; // non-browser clients / same-origin GETs don't send it
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
