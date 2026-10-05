import { NextRequest, NextResponse } from "next/server";
import { adminPassword, isAdminRequest } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Tells the page whether this browser holds a valid admin session, and
// whether an admin password has been configured on the server at all.
export async function GET(req: NextRequest) {
  return NextResponse.json({ admin: isAdminRequest(req), configured: !!adminPassword() }, { headers: { "Cache-Control": "no-store" } });
}
