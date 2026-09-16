import * as Sentry from "@sentry/nextjs";
import { commonOptions } from "@/lib/sentry-options";

/** Браузерная часть: ошибки в клиентских компонентах и обработчиках. */
Sentry.init({
  ...commonOptions,
  // Повтор навигации для воспроизведения не пишем: это запись экрана
  // человека, то есть ровно те материалы, ради которых всё и затевалось.
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
