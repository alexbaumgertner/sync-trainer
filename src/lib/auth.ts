import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";

/**
 * Пароль на генерацию.
 *
 * Приложение публичное, а каждая генерация стоит денег, поэтому доступ
 * закрыт общим паролем. Сессия — подписанная HttpOnly-кука, чтобы пароль
 * не приходилось вводить на каждый запрос и чтобы он не лежал в браузере.
 *
 * Middleware сознательно не используется: в Next 16 он переименован в
 * proxy.js, а проверки в серверном компоненте страницы и в роутах хватает
 * и она не зависит от этого переименования.
 */

export const SESSION_COOKIE = "sync_trainer_session";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export function authConfigured(): boolean {
  return Boolean(process.env.APP_PASSWORD?.trim());
}

/**
 * Ключ подписи. Отдельный AUTH_SECRET лучше, но если его нет — выводим
 * ключ из пароля, чтобы в проде требовалась ровно одна переменная.
 * Побочный эффект полезный: смена пароля инвалидирует все сессии.
 */
function signingKey(): Buffer {
  const explicit = process.env.AUTH_SECRET?.trim();
  if (explicit) return Buffer.from(explicit, "utf8");
  const password = process.env.APP_PASSWORD?.trim() ?? "";
  return crypto.createHash("sha256").update(`sync-trainer:${password}`).digest();
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

export function issueToken(now = Date.now()): { token: string; maxAge: number } {
  const exp = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  return { token: `${exp}.${sign(String(exp))}`, maxAge: SESSION_TTL_SECONDS };
}

export function verifyToken(token: string | undefined, now = Date.now()): boolean {
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;

  const exp = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!/^\d+$/.test(exp) || Number(exp) * 1000 < now) return false;

  return timingSafeEqual(signature, sign(exp));
}

/** Сравнение без утечки длины и позиции первого расхождения. */
export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = crypto.createHash("sha256").update(a).digest();
  const bufB = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(bufA, bufB);
}

export function passwordMatches(candidate: string): boolean {
  const expected = process.env.APP_PASSWORD?.trim();
  if (!expected) return false;
  return timingSafeEqual(candidate, expected);
}

/** Для серверных компонентов и роутов. */
export async function isAuthenticated(): Promise<boolean> {
  if (!authConfigured()) return false;
  const store = await cookies();
  return verifyToken(store.get(SESSION_COOKIE)?.value);
}

export const UNAUTHORIZED = "Нужно войти с паролем.";
export const NO_PASSWORD_CONFIGURED =
  "APP_PASSWORD не задан. Генерация закрыта: без пароля публичное приложение тратило бы бюджет кому угодно.";

/** Возвращает готовый отказ или null, если всё в порядке. */
export async function guard(): Promise<Response | null> {
  if (!authConfigured()) {
    return Response.json({ error: NO_PASSWORD_CONFIGURED }, { status: 503 });
  }
  if (!(await isAuthenticated())) {
    return Response.json({ error: UNAUTHORIZED }, { status: 401 });
  }
  return null;
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
