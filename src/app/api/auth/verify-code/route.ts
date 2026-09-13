import { NextResponse } from "next/server";
import { authConfigured, NOT_CONFIGURED, setSession } from "@/lib/auth";
import { verifyCode } from "@/lib/otp";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!authConfigured()) {
    return NextResponse.json({ error: NOT_CONFIGURED }, { status: 503 });
  }

  let email = "";
  let code = "";
  try {
    const body = (await request.json()) as { email?: unknown; code?: unknown };
    email = String(body.email ?? "");
    code = String(body.code ?? "");
  } catch {
    return NextResponse.json({ error: "Ожидался JSON в теле запроса" }, { status: 400 });
  }

  const result = await verifyCode(email, code);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 401 });

  await setSession(result.userId);
  return NextResponse.json({ ok: true });
}
