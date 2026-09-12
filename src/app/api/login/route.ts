import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  authConfigured,
  cookieOptions,
  issueToken,
  passwordMatches,
  NO_PASSWORD_CONFIGURED,
} from "@/lib/auth";

export const runtime = "nodejs";

/**
 * Простое торможение перебора. В serverless счётчик живёт в пределах
 * инстанса, так что это не полноценная защита, а способ сделать перебор
 * неудобным. Настоящий барьер — длина пароля.
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const attempts = new Map<string, { count: number; first: number }>();

function tooManyAttempts(ip: string): boolean {
  const now = Date.now();
  const record = attempts.get(ip);
  if (!record || now - record.first > WINDOW_MS) return false;
  return record.count >= MAX_ATTEMPTS;
}

function registerFailure(ip: string): void {
  const now = Date.now();
  const record = attempts.get(ip);
  if (!record || now - record.first > WINDOW_MS) attempts.set(ip, { count: 1, first: now });
  else record.count += 1;
}

export async function POST(request: Request) {
  if (!authConfigured()) {
    return NextResponse.json({ error: NO_PASSWORD_CONFIGURED }, { status: 503 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  if (tooManyAttempts(ip)) {
    return NextResponse.json(
      { error: "Слишком много попыток. Попробуйте через 15 минут." },
      { status: 429 },
    );
  }

  let password = "";
  try {
    password = String(((await request.json()) as { password?: unknown }).password ?? "");
  } catch {
    return NextResponse.json({ error: "Ожидался JSON в теле запроса" }, { status: 400 });
  }

  if (!passwordMatches(password)) {
    registerFailure(ip);
    return NextResponse.json({ error: "Неверный пароль" }, { status: 401 });
  }

  attempts.delete(ip);
  const { token, maxAge } = issueToken();
  (await cookies()).set(SESSION_COOKIE, token, cookieOptions(maxAge));
  return NextResponse.json({ ok: true });
}
