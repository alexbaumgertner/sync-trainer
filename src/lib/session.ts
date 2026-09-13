import crypto from "node:crypto";

/**
 * Подпись и проверка сессионной куки. Без зависимостей от Next и без
 * `server-only`: этот модуль грузит и стратегия Payload, а её конфиг
 * читается CLI вне контекста запроса.
 */

export const SESSION_COOKIE = "sync_trainer_session";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export const NOT_CONFIGURED =
  "AUTH_SECRET не задан. Вход отключён: без ключа подписи сессию подделает кто угодно.";

const signingKeyRaw = (): string | undefined =>
  process.env.AUTH_SECRET?.trim() || process.env.PAYLOAD_SECRET?.trim();

export const authConfigured = (): boolean => Boolean(signingKeyRaw());

const signingKey = (): Buffer =>
  crypto.createHash("sha256").update(`sync-trainer:${signingKeyRaw() ?? ""}`).digest();

const sign = (payload: string): string =>
  crypto.createHmac("sha256", signingKey()).update(payload).digest("base64url");

/** Сравнение без утечки длины и позиции первого расхождения. */
export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = crypto.createHash("sha256").update(a).digest();
  const bufB = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(bufA, bufB);
}

export function issueToken(
  userId: string | number,
  now = Date.now(),
): { token: string; maxAge: number } {
  const exp = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  const body = `${userId}.${exp}`;
  return { token: `${body}.${sign(body)}`, maxAge: SESSION_TTL_SECONDS };
}

/** Идентификатор пользователя или null. */
export function readToken(token: string | undefined, now = Date.now()): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [userId, exp, signature] = parts;
  if (!userId || !/^\d+$/.test(exp)) return null;
  if (Number(exp) * 1000 < now) return null;
  if (!timingSafeEqual(signature, sign(`${userId}.${exp}`))) return null;

  return userId;
}

export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

/** Достаёт значение куки из заголовка. Нужна стратегии Payload. */
export function readSessionCookie(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined;
  const raw = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  return raw ? decodeURIComponent(raw) : undefined;
}
