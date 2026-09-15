import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Миграции знают про каждую коллекцию.
 *
 * Найдено живым использованием 15 сентября: добавив коллекцию `engagements`,
 * я создал её таблицы, но забыл про служебную `payload_locked_documents_rels`,
 * где Payload держит по колонке на каждую коллекцию и опрашивает их ВСЕ при
 * любой записи. Сохранение профиля падало с «column ... engagements_id does
 * not exist» — при правке пользователя, а не записи о работе.
 *
 * Почему это не поймалось раньше и почему проверка именно такая.
 *
 * Первым делом я написал тест, сравнивающий схему из миграций со схемой,
 * которую держит `push`. Он не упал даже с выломанной починкой — и это само
 * по себе оказалось находкой: **`payload migrate` локально сначала
 * синхронизирует схему через `push`, а потом применяет миграции**. То есть
 * все мои прежние проверки «на чистой базе» молча чинились push'ем и
 * миграции не проверяли вовсе.
 *
 * Поэтому проверка статическая — по тексту самих миграций. Она не зависит
 * ни от базы, ни от того, что Payload делает при инициализации.
 */

const DIR = path.join(process.cwd(), "migrations");

const migrationSql = (): string =>
  readdirSync(DIR)
    .filter((f) => f.endsWith(".ts") && f !== "index.ts")
    .map((f) => readFileSync(path.join(DIR, f), "utf8"))
    .join("\n");

describe("служебные таблицы Payload", () => {
  it("получают колонку для каждой коллекции", async () => {
    const { collections } = await import("@/collections");
    const sql = migrationSql();

    for (const collection of collections) {
      const column = `${collection.slug.replace(/-/g, "_")}_id`;
      expect(
        sql,
        `в миграциях нет "${column}" для коллекции ${collection.slug}: ` +
          "Payload опрашивает эту колонку при любой записи, и без неё падает всё",
      ).toContain(column);
    }
  });

  it("каждая коллекция вообще заведена миграцией", async () => {
    const { collections } = await import("@/collections");
    const sql = migrationSql();

    for (const collection of collections) {
      const table = collection.slug.replace(/-/g, "_");
      expect(sql, `таблицы ${table} нет ни в одной миграции`).toContain(`"${table}"`);
    }
  });
});

describe("порядок миграций", () => {
  it("совпадает с алфавитным — Payload применяет их именно так", async () => {
    // На этом уже спотыкались: `engagement_team` встал раньше `engagements`,
    // потому что подчёркивание меньше буквы «s», и таблица создавалась
    // до той, на которую ссылается.
    const { migrations } = await import("../../migrations/index");
    const names = migrations.map((m) => m.name);
    expect(names).toEqual([...names].sort());
  });

  it("все файлы каталога перечислены в index", () => {
    const files = readdirSync(DIR)
      .filter((f) => f.endsWith(".ts") && f !== "index.ts")
      .map((f) => f.replace(/\.ts$/, ""))
      .sort();

    const listed = readFileSync(path.join(DIR, "index.ts"), "utf8");
    for (const file of files) {
      // Миграция, забытая в index, просто не применится — и разойдётся
      // с локальной базой, где схему держит push.
      expect(listed, `миграция ${file} не подключена в index.ts`).toContain(file);
    }
  });
});
