import { loadEnv } from "vite";

/**
 * Переменные из `.env.local` для тестовых прогонов.
 *
 * Ни vitest, ни playwright не читают `.env.local` сами: первый — потому что
 * Vite намеренно не читает его в режиме test, второй — потому что переменные
 * приложения его не касаются, он лишь поднимает сервер. Между тем оба прогона
 * ходят в настоящую базу своим кодом, и без адреса просто падают.
 *
 * Сквозные проверки падали из-за этого шестью файлами сразу — с
 * `ECONNREFUSED :5432` при живой базе на 5434 и «missing secret key».
 * Симптом совпадает с ловушкой со схемой из CLAUDE.md, а причина другая,
 * и диагноз уводит не туда. Поэтому чтение живёт здесь, одно на оба прогона.
 */
export function loadLocalEnv(rootDir: string): Record<string, string> {
  // Режим development и пустой префикс: нужны все переменные, а не только VITE_*.
  const env = loadEnv("development", rootDir, "");
  assertLocalDatabase(env);
  return env;
}

/**
 * Остановка, если база не локальная.
 *
 * Тесты создают и удаляют записи. Окажись в окружении боевая строка
 * подключения — они вычистят боевые данные, поэтому чужая база
 * останавливает запуск здесь, а не после первого `delete`.
 */
export function assertLocalDatabase(env: Record<string, string | undefined>): void {
  const url = env.DATABASE_URI ?? env.DATABASE_URL ?? env.POSTGRES_URL;
  let host = "";
  try {
    host = url ? new URL(url).hostname : "";
  } catch {
    host = "";
  }
  if (host && !["localhost", "127.0.0.1", "::1", "postgres"].includes(host)) {
    throw new Error(
      `Тесты пишут в базу и запускаются только на локальной: указан узел ${host}`,
    );
  }
}
