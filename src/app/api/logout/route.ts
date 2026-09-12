import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, cookieOptions } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  (await cookies()).set(SESSION_COOKIE, "", cookieOptions(0));
  return NextResponse.json({ ok: true });
}
