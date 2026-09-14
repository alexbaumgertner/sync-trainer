import type { AuthStrategy } from "payload";
import { readSessionCookie, readToken } from "./session";

/**
 * Стратегия входа для Payload: читает ту же сессионную куку, что и приложение.
 *
 * Благодаря ей права доступа из коллекций применяются к запросам приложения
 * автоматически — не нужно второй раз объяснять Payload, кто пришёл.
 * Локальная стратегия Payload остаётся рядом: по ней входят в админку.
 */
export const otpCookieStrategy: AuthStrategy = {
  name: "otp-cookie",
  authenticate: async ({ headers, payload }) => {
    const userId = readToken(readSessionCookie(headers.get("cookie")));
    if (!userId) return { user: null };

    try {
      const user = await payload.findByID({
        collection: "users",
        id: userId,
        overrideAccess: true,
        depth: 0,
      });
      if (!user) return { user: null };
      return { user: { ...user, collection: "users", _strategy: "otp-cookie" } };
    } catch {
      // Пользователя удалили, а кука осталась — это не ошибка, а выход.
      return { user: null };
    }
  },
};
