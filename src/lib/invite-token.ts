import crypto from "node:crypto";

/**
 * Токены приглашений. Модуль чистый, без зависимостей от Next: его читает
 * конфигурация Payload, которая грузится в том числе вне контекста запроса.
 */

export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export const generateInviteToken = (): string => crypto.randomBytes(32).toString("base64url");

export function hashInviteToken(token: string): string {
  const key = process.env.AUTH_SECRET?.trim() || process.env.PAYLOAD_SECRET?.trim() || "";
  return crypto.createHmac("sha256", key).update(token).digest("hex");
}

/**
 * Адрес, на который приглашённый вернётся по ссылке из письма.
 *
 * Порядок важен: на стенде `VERCEL_PROJECT_PRODUCTION_URL` тоже задан, и если
 * брать его первым, приглашение, выписанное на стенде, уводит человека
 * в продакшен — ссылка там не сработает, а проверка выглядит пройденной.
 * Поэтому вне продакшена сначала берётся адрес самого развёртывания.
 */
export function appBaseUrl(): string {
  const explicit = process.env.APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const host =
    process.env.VERCEL_ENV === "production"
      ? process.env.VERCEL_PROJECT_PRODUCTION_URL
      : (process.env.VERCEL_BRANCH_URL ?? process.env.VERCEL_URL);

  return host ? `https://${host}` : "http://localhost:3000";
}

export function inviteLink(token: string): string {
  return `${appBaseUrl()}/invite/${token}`;
}
