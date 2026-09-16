import * as Sentry from "@sentry/nextjs";
import { commonOptions } from "@/lib/sentry-options";

/**
 * Серверная часть сбора ошибок. Next зовёт `register` один раз при старте.
 */
export function register(): void {
  Sentry.init(commonOptions);
}

/**
 * Ошибки серверной отрисовки Next отдаёт сюда. Без этого крючка страницы,
 * упавшие при рендере, до Sentry не доходят вовсе — а это как раз те ошибки,
 * которые человек видит как «что-то пошло не так».
 */
export const onRequestError = Sentry.captureRequestError;
