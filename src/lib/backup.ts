import crypto from "node:crypto";
import { Client } from "pg";
import { databaseUrl } from "./database-url";

/**
 * Резервная копия базы (D5).
 *
 * Почему не `pg_dump`. На Vercel нет бинарников — только Node, — поэтому
 * выгрузка пишется здесь. Это не полноценный дамп схемы: схема живёт
 * миграциями в репозитории и восстанавливается ими. Здесь только данные,
 * и этого достаточно: без репозитория восстанавливать всё равно нечего.
 *
 * Зачем вообще. Восстановление на момент времени у Neon на бесплатном плане —
 * шесть часов. Это отмена последней ошибки, а не резервная копия: удаление,
 * замеченное на следующий день, ею уже не лечится.
 */

export const DUMP_VERSION = 1;

/** Служебные таблицы Payload, без которых восстановленная база не заведётся. */
const ALWAYS_INCLUDE = new Set(["payload_migrations"]);

/** Кэши и блокировки: восстанавливать нечего, а место занимают. */
const SKIP_TABLES = new Set([
  "payload_kv",
  "payload_locked_documents",
  "payload_locked_documents_rels",
]);

export interface Dump {
  version: number;
  createdAt: string;
  /** Отпечаток узла базы: видно, откуда копия, без раскрытия строки подключения. */
  source: string;
  /** Порядок важен: таблицы отсортированы так, что внешние ключи не рвутся. */
  tables: { name: string; rows: Record<string, unknown>[] }[];
  sequences: { name: string; value: string }[];
}

/**
 * Порядок таблиц с учётом внешних ключей.
 *
 * Без него вставка падает на первой же ссылке на ещё не созданную строку.
 * Отключить проверки на время вставки нельзя: для этого нужны права
 * суперпользователя, которых у нас на Neon нет.
 */
async function topologicalOrder(client: Client, tables: string[]): Promise<string[]> {
  const { rows } = await client.query<{ child: string; parent: string }>(`
    SELECT tc.table_name AS child, ccu.table_name AS parent
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
     AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
  `);

  const deps = new Map<string, Set<string>>(tables.map((t) => [t, new Set<string>()]));
  for (const { child, parent } of rows) {
    // Ссылка таблицы на саму себя порядку не мешает и циклом не считается.
    if (child === parent) continue;
    if (deps.has(child) && deps.has(parent)) deps.get(child)!.add(parent);
  }

  const done: string[] = [];
  const placed = new Set<string>();
  // Обычный обход в ширину: берём таблицы, все родители которых уже вставлены.
  while (placed.size < tables.length) {
    const ready = tables.filter(
      (t) => !placed.has(t) && [...deps.get(t)!].every((p) => placed.has(p)),
    );
    if (!ready.length) {
      // Кольцо внешних ключей. Не выдумываем порядок молча: остаток идёт как
      // есть, и восстановление скажет, на чём споткнулось.
      done.push(...tables.filter((t) => !placed.has(t)));
      break;
    }
    for (const table of ready) {
      done.push(table);
      placed.add(table);
    }
  }
  return done;
}

export async function createDump(connectionString?: string): Promise<Dump> {
  const url = connectionString ?? databaseUrl();
  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    const { rows: tableRows } = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name`,
    );

    const names = tableRows
      .map((r) => r.table_name)
      .filter((name) => ALWAYS_INCLUDE.has(name) || !SKIP_TABLES.has(name));

    const ordered = await topologicalOrder(client, names);

    const tables: Dump["tables"] = [];
    for (const name of ordered) {
      // Имя пришло из information_schema, а не извне, но экранируем всё равно:
      // цена одна кавычка, а цена ошибки — произвольный запрос.
      const { rows } = await client.query(`SELECT * FROM "${name.replace(/"/g, '""')}"`);
      tables.push({ name, rows });
    }

    // Последовательности: без них первая же вставка после восстановления
    // столкнётся с существующим идентификатором.
    const { rows: seqRows } = await client.query<{ name: string; value: string }>(
      `SELECT sequencename AS name, last_value::text AS value
         FROM pg_sequences WHERE schemaname = 'public' ORDER BY sequencename`,
    );

    return {
      version: DUMP_VERSION,
      createdAt: new Date().toISOString(),
      source: fingerprint(url),
      tables,
      sequences: seqRows.filter((s) => s.value !== null),
    };
  } finally {
    await client.end();
  }
}

const fingerprint = (url: string): string => {
  try {
    return crypto.createHash("sha256").update(new URL(url).hostname).digest("hex").slice(0, 8);
  } catch {
    return "неизвестно";
  }
};

/** Сводка для письма: что именно уехало в копию. */
export function summarize(dump: Dump): string {
  const lines = dump.tables
    .filter((t) => t.rows.length > 0)
    .map((t) => `  ${t.name}: ${t.rows.length}`);
  const total = dump.tables.reduce((sum, t) => sum + t.rows.length, 0);
  return [`Всего строк: ${total}`, ...lines].join("\n");
}

// ───────────────────────── шифрование ─────────────────────────

/**
 * AES-256-GCM. Ключ — 32 байта в base64 в `BACKUP_KEY`.
 *
 * Копия содержит адреса приглашённых и глоссарии, а глоссарии бывают привязаны
 * к конкретным клиентам. Это ровно то обещание конфиденциальности, которое мы
 * даём переводчикам, поэтому копия, покидающая приватное хранилище, обязана
 * быть зашифрованной. Потеря ключа означает потерю копии — он должен лежать
 * в менеджере паролей, а не в той же почте.
 */
export const backupKey = (): Buffer | null => {
  const raw = process.env.BACKUP_KEY?.trim();
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("BACKUP_KEY должен быть 32 байта в base64 (openssl rand -base64 32)");
  }
  return key;
};

export function encryptDump(plain: Buffer, key: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  // iv | tag | шифротекст — самодостаточный файл, расшифровке хватает ключа.
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function decryptDump(packed: Buffer, key: Buffer): Buffer {
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]);
}
