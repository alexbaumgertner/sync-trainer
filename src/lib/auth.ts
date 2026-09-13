import "server-only";
import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  authConfigured,
  cookieOptions,
  issueToken,
  readToken,
  NOT_CONFIGURED,
} from "./session";

export { authConfigured, NOT_CONFIGURED, SESSION_COOKIE };

export const UNAUTHORIZED = "Нужно войти.";

export async function currentUserId(): Promise<string | null> {
  if (!authConfigured()) return null;
  const store = await cookies();
  return readToken(store.get(SESSION_COOKIE)?.value);
}

/** Готовый отказ или null. Используется в маршрутах приложения. */
export async function guard(): Promise<Response | null> {
  if (!authConfigured()) {
    return Response.json({ error: NOT_CONFIGURED }, { status: 503 });
  }
  if (!(await currentUserId())) {
    return Response.json({ error: UNAUTHORIZED }, { status: 401 });
  }
  return null;
}

export async function setSession(userId: string | number): Promise<void> {
  const { token, maxAge } = issueToken(userId);
  (await cookies()).set(SESSION_COOKIE, token, cookieOptions(maxAge));
}

export async function clearSession(): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, "", cookieOptions(0));
}
