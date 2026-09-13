import { NextResponse } from "next/server";
import { authConfigured, NOT_CONFIGURED } from "@/lib/auth";
import { MAIL_BROKEN, requestCode } from "@/lib/otp";

export const runtime = "nodejs";

const clientIp = (request: Request): string =>
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";

export async function POST(request: Request) {
  if (!authConfigured()) {
    return NextResponse.json({ error: NOT_CONFIGURED }, { status: 503 });
  }

  let email = "";
  try {
    email = String(((await request.json()) as { email?: unknown }).email ?? "");
  } catch {
    return NextResponse.json({ error: "Ожидался JSON в теле запроса" }, { status: 400 });
  }

  const result = await requestCode(email, clientIp(request));
  if (!result.ok) {
    // Предел частоты — вина обратившегося, сбой почты — наша.
    const status = result.error === MAIL_BROKEN ? 502 : 429;
    return NextResponse.json({ error: result.error }, { status });
  }

  // Ответ одинаков и для приглашённого, и для незнакомого адреса (A4).
  return NextResponse.json({ ok: true });
}
