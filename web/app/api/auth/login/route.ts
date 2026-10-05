import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, adminPassword, adminSecret } from "@/lib/auth";
import { SESSION_SECONDS, createSessionToken, originAllowed, safeEqual } from "@/lib/authCore";

// Simple brute-force brake: after 5 wrong passwords from one address, wait
// 10 minutes. (In-memory, so per server instance — a speed bump, not a vault;
// the password itself is what protects you, so make it long.)
const attempts = new Map<string, { n: number; first: number }>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILS = 5;

function clientKey(req: NextRequest): string {
  return (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
}

export async function POST(req: NextRequest) {
  if (!originAllowed(req.headers.get("origin"), req.headers.get("x-forwarded-host") ?? req.headers.get("host"))) {
    return NextResponse.json({ error: "Ogiltigt ursprung." }, { status: 403 });
  }
  const pw = adminPassword();
  if (!pw) return NextResponse.json({ error: "ADMIN_PASSWORD är inte inställt på servern." }, { status: 503 });

  const key = clientKey(req);
  const now = Date.now();
  const rec = attempts.get(key);
  if (rec && now - rec.first < WINDOW_MS && rec.n >= MAX_FAILS) {
    return NextResponse.json({ error: "För många försök. Vänta en stund och försök igen." }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const given = typeof body.password === "string" ? body.password : "";

  if (!given || !safeEqual(given, pw)) {
    const fresh = rec && now - rec.first < WINDOW_MS ? rec : { n: 0, first: now };
    fresh.n += 1;
    attempts.set(key, fresh);
    await new Promise((r) => setTimeout(r, 400));
    return NextResponse.json({ error: "Fel lösenord." }, { status: 401 });
  }

  attempts.delete(key);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, createSessionToken(adminSecret()!), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
  return res;
}
