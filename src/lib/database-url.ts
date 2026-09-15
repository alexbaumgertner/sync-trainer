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

import crypto from "node:crypto";

const SOURCES = ["DATABASE_URI", "DATABASE_URL", "POSTGRES_URL"] as const;

let announced = false;

export function databaseUrl(): string {
  for (const name of SOURCES) {
    const value = process.env[name]?.trim();
    if (!value) continue;

    const url = withStrictSsl(value);

    if (!announced) {
      announced = true;
      console.info(`[db] подключение из ${name}: ${describe(url)} · отпечаток ${fingerprint(url)}`);
    }
    return url;
  }

  return "";
}

/**
 * Явный `sslmode=verify-full`.
 *
 * Neon отдаёт строку с `sslmode=require`, и драйвер `pg` сегодня трактует
 * это как `verify-full` — то есть проверяет и цепочку, и имя узла. Но он же
 * предупреждает, что в следующей мажорной версии `require` получит семантику
 * libpq, где сертификат не проверяется вовсе: соединение останется
 * зашифрованным, но защиты от подмены узла не будет.
 *
 * Пишем то, что и так происходит, явно. Поведение сегодня не меняется,
 * зато оно перестаёт зависеть от версии драйвера, а предупреждение уходит.
 *
 * `prefer` и `verify-ca` в этом списке по той же причине: драйвер трактует
 * их так же и предупреждает о них так же.
 */
const WEAKER_MODES = new Set(["prefer", "require", "verify-ca"]);

function withStrictSsl(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    const mode = url.searchParams.get("sslmode");

    // Локальная база без TLS: навязывать ей проверку сертификата незачем
    // и нечем — там его попросту нет.
    if (!mode) return connectionString;
    if (!WEAKER_MODES.has(mode)) return connectionString;

    url.searchParams.set("sslmode", "verify-full");
    return url.toString();
  } catch {
    // Строка не разбирается — не наше дело её чинить: пусть падает там,
    // где это будет видно, а не молча здесь.
    return connectionString;
  }
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

/**
 * Короткий отпечаток узла.
 *
 * Нужен потому, что Vercel вырезает из логов значения, похожие на секреты, —
 * и узел базы там превращается в [REDACTED]. Отпечаток на секрет не похож,
 * поэтому выживает: сравнив его у боевого и preview-деплоя, видно, разные
 * базы или одна. Совпал — стенд пишет в продакшен.
 */
function fingerprint(connectionString: string): string {
  try {
    const host = new URL(connectionString).hostname;
    return crypto.createHash("sha256").update(host).digest("hex").slice(0, 8);
  } catch {
    return "—";
  }
}
