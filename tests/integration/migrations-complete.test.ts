import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { Client } from "pg";

/**
 * Миграции строят ту же схему, что и `push`.
 *
 * Найдено живым использованием 15 сентября: добавив коллекцию `engagements`,
 * я создал её таблицы, но забыл про служебную `payload_locked_documents_rels`,
 * где Payload держит по колонке на каждую коллекцию и опрашивает их ВСЕ при
 * любой записи. Локально это незаметно: схему держит `push`, и колонку он
 * дописывает сам. В проде идут только миграции — и сохранение профиля падало
 * с «column ... engagements_id does not exist».
 *
 * Прежняя проверка смотрела, что появилась таблица новой коллекции. Этого
 * мало: сравнивать надо схемы целиком, включая служебные таблицы. Тогда
 * следующая коллекция не повторит историю.
 */

const SOURCE = process.env.DATABASE_URI!;
const MIGRATED_DB = "sync_trainer_migration_check";

const migratedUrl = (() => {
  const url = new URL(SOURCE);
  url.pathname = `/${MIGRATED_DB}`;
  return url.toString();
})();

const adminUrl = (() => {
  const url = new URL(SOURCE);
  url.pathname = "/postgres";
  return url.toString();
})();

const query = async (connectionString: string, sql: string) => {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return (await client.query(sql)).rows;
  } finally {
    await client.end();
  }
};

/** Колонки всех таблиц: имя таблицы, имя колонки, тип. */
const COLUMNS = `
  SELECT table_name || '.' || column_name || ' ' || data_type AS col
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name <> 'payload_migrations'
  ORDER BY 1`;

const shapeOf = async (url: string): Promise<Set<string>> =>
  new Set((await query(url, COLUMNS)).map((r) => r.col as string));

beforeAll(async () => {
  await query(adminUrl, `DROP DATABASE IF EXISTS ${MIGRATED_DB}`);
  await query(adminUrl, `CREATE DATABASE ${MIGRATED_DB}`);

  execSync("npx payload migrate", {
    env: { ...process.env, DATABASE_URI: migratedUrl },
    stdio: "pipe",
    timeout: 180_000,
  });
}, 200_000);

afterAll(async () => {
  await query(adminUrl, `DROP DATABASE IF EXISTS ${MIGRATED_DB}`).catch(() => {});
});

describe("схема из миграций", () => {
  it("совпадает с той, что держит push, — колонка за колонкой", async () => {
    const [fromPush, fromMigrations] = await Promise.all([
      shapeOf(SOURCE),
      shapeOf(migratedUrl),
    ]);

    // Чего не хватает в миграциях — это и есть поломка прода: локально
    // всё работает, а там колонки нет.
    const missing = [...fromPush].filter((c) => !fromMigrations.has(c)).sort();
    expect(missing, `миграции не создают: ${missing.join(", ")}`).toEqual([]);
  });

  it("служебные таблицы Payload знают про каждую коллекцию", async () => {
    // Ровно то, на чём споткнулись: Payload опрашивает эти колонки при любой
    // записи, даже если правят совсем другую коллекцию.
    const columns = new Set(
      (
        await query(
          migratedUrl,
          `SELECT column_name FROM information_schema.columns
            WHERE table_name = 'payload_locked_documents_rels'`,
        )
      ).map((r) => r.column_name as string),
    );

    // Только свои коллекции: служебные коллекции самого Payload колонок
    // в этой таблице не получают.
    const { collections } = await import("@/collections");
    const slugs = collections.map((c) => c.slug);

    for (const slug of slugs) {
      expect(columns, `нет колонки для коллекции ${slug}`).toContain(
        `${slug.replace(/-/g, "_")}_id`,
      );
    }
  });
});
