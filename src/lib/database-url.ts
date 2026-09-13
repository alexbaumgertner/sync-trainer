/**
 * Выбор строки подключения к базе.
 *
 * Тонкость, из-за которой это отдельный модуль с логом: интеграция Neon
 * в Vercel заводит отдельную ветку базы на каждый preview-деплой и
 * подставляет её в `DATABASE_URL`. При этом `POSTGRES_URL` может остаться
 * от боевой базы. Если брать `POSTGRES_URL` раньше, стенд будет молча
 * писать в продакшен — самая опасная разновидность ошибки, потому что
 * ничего не падает.
 *
 * Поэтому: `DATABASE_URI` (задан руками) → `DATABASE_URL` (ветка превью)
 * → `POSTGRES_URL` (общий от интеграции), и выбранный узел всегда пишется
 * в лог, чтобы промах было видно в логе сборки, а не через неделю в данных.
 */

const SOURCES = ["DATABASE_URI", "DATABASE_URL", "POSTGRES_URL"] as const;

let announced = false;

export function databaseUrl(): string {
  for (const name of SOURCES) {
    const value = process.env[name]?.trim();
    if (!value) continue;

    if (!announced) {
      announced = true;
      console.info(`[db] подключение из ${name}: ${describe(value)}`);
    }
    return value;
  }

  return "";
}

/** Только узел и имя базы. Пароль в лог не попадает. */
function describe(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return "строка подключения не разбирается";
  }
}
