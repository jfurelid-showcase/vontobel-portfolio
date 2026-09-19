import { NextRequest, NextResponse } from "next/server";

// Single shared password, cookie-based. Set SITE_PASSWORD in your Vercel
// project's environment variables (Settings -> Environment Variables).
// This is intentionally simple (matches "single shared password" you chose)
// — it is NOT per-user auth, anyone with the password sees everything,
// including the admin tool. If that ever needs to be split (e.g. viewers
// vs. an admin-only password), say so and I'll add a second cookie/route.

const COOKIE_NAME = "vontobel_site_auth";

async function sha256Hex(input: string) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always allow the login page and its API route, and Next's own assets.
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/login") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon")
  ) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get(COOKIE_NAME)?.value;
  const expected = process.env.SITE_PASSWORD ? await sha256Hex(process.env.SITE_PASSWORD) : null;
  if (cookie && expected && cookie === expected) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
