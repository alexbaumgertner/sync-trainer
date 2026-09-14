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

export interface CurrentUser {
  id: number;
  email: string;
  role: string;
  isAdmin: boolean;
}

/** Пользователь сессии целиком. Нужен там, где важна роль и личные лимиты. */
export async function currentUser(): Promise<CurrentUser | null> {
  const id = await currentUserId();
  if (!id) return null;

  const { payloadClient } = await import("./payload");
  const payload = await payloadClient();

  try {
    const user = await payload.findByID({
      collection: "users",
      id,
      depth: 0,
      overrideAccess: true,
    });
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      role: user.role ?? "interpreter",
      isAdmin: user.role === "admin",
    };
  } catch {
    // Пользователя удалили, а кука осталась — это выход, а не ошибка.
    return null;
  }
}

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
