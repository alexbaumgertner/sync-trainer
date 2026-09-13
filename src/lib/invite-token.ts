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

export function inviteLink(token: string): string {
  const base =
    process.env.APP_URL?.replace(/\/$/, "") ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000");
  return `${base}/invite/${token}`;
}
