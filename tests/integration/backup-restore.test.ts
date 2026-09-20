import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { Client } from "pg";

/**
 * Резервное копирование и восстановление (D5, T16).
 *
 * Приёмка задачи: «копия разворачивается в пустую базу, приложение на ней
 * работает. Пока восстановление не проверено хотя бы раз, задача не закрыта».
 *
 * Поэтому тест делает именно это, а не проверяет форму JSON: заводит вторую
 * базу рядом, разворачивает в неё схему и копию, и сверяет данные построчно.
 * Копия, из которой ни разу не восстанавливались, — предположение, а не копия.
 */

const { createDump, encryptDump, decryptDump, summarize, DUMP_VERSION } =
  await import("@/lib/backup");
const { restoreDump } = await import("@/lib/restore");
const { databaseUrl } = await import("@/lib/database-url");
const { payloadClient } = await import("@/lib/payload");

const RESTORE_DB = "sync_trainer_restore_test";
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

const source = databaseUrl();
const restoreUrl = (() => {
  const url = new URL(source);
  url.pathname = `/${RESTORE_DB}`;
  return url.toString();
})();

const admin = (() => {
  const url = new URL(source);
  url.pathname = "/postgres";
  return url.toString();
})();

let userId: number;
let projectId: number;

const run = async (connectionString: string, sql: string, params: unknown[] = []) => {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await client.query(sql, params);
  } finally {
    await client.end();
  }
};

beforeAll(async () => {
  const payload = await payloadClient();

  // Данные, которые должны пережить восстановление: связанные записи,
  // кириллица, json-поле и внешние ключи.
  const user = await payload.create({
    collection: "users",
    data: { email: `backup-${stamp}@example.test`, role: "interpreter" },
    overrideAccess: true,
  });
  userId = user.id;

  const project = await payload.create({
    collection: "projects",
    data: {
      title: `Копия «${stamp}» — кириллица и кавычки`,
      owner: userId,
      sourceLang: "en",
      targetLang: "ru",
      stylePreset: "un",
      status: "ready",
    },
    overrideAccess: true,
  });
  projectId = project.id;

  await payload.create({
    collection: "generations",
    data: {
      project: projectId,
      kind: "script",
      status: "done",
      params: { traps: ["enumeration"], rate: "105%", вложенное: { да: true } },
    },
    overrideAccess: true,
  });

  // Массив в jsonb — отдельный случай: драйвер переводит его в синтаксис
  // массива Postgres, и без собственной сериализации восстановление падает.
  await payload.create({
    collection: "usage-events",
    data: {
      user: userId,
      project: projectId,
      kind: "audio",
      chars: 100,
      costUsd: 0.01,
      voices: ["en-GB-Chirp3-HD-Charon", "en-US-Chirp3-HD-Kore"],
    },
    overrideAccess: true,
  });

  await payload.create({
    collection: "glossary-terms",
    data: {
      scope: "project",
      project: projectId,
      sourceTerm: "headroom",
      targetTerm: "запас капитала",
      status: "from-practice",
      occurredAtEvent: true,
    },
    overrideAccess: true,
  });

  await run(admin, `DROP DATABASE IF EXISTS ${RESTORE_DB}`);
  await run(admin, `CREATE DATABASE ${RESTORE_DB}`);
});

afterAll(async () => {
  const payload = await payloadClient();
  await payload.delete({ collection: "projects", id: projectId, overrideAccess: true }).catch(() => {});
  await payload.delete({ collection: "users", id: userId, overrideAccess: true }).catch(() => {});
  await run(admin, `DROP DATABASE IF EXISTS ${RESTORE_DB}`).catch(() => {});
});

describe("выгрузка", () => {
  it("забирает данные, а служебные кэши пропускает", async () => {
    const dump = await createDump(source);

    expect(dump.version).toBe(DUMP_VERSION);
    const names = dump.tables.map((t) => t.name);
    expect(names).toContain("users");
    expect(names).toContain("projects");
    // Миграции нужны: без них восстановленная база считает себя непроверенной.
    expect(names).toContain("payload_migrations");
    // Кэши и блокировки восстанавливать нечего.
    expect(names).not.toContain("payload_kv");
    expect(names).not.toContain("payload_locked_documents");
  });

  it("порядок таблиц не рвёт внешние ключи", async () => {
    const dump = await createDump(source);
    const at = (name: string) => dump.tables.findIndex((t) => t.name === name);

    // Проект ссылается на пользователя, артефакт — на проект.
    expect(at("users")).toBeLessThan(at("projects"));
    expect(at("projects")).toBeLessThan(at("artifacts"));
    expect(at("projects")).toBeLessThan(at("glossary_terms"));
  });

  it("запоминает последовательности — иначе идентификаторы столкнутся", async () => {
    const dump = await createDump(source);
    expect(dump.sequences.length).toBeGreaterThan(0);
    expect(dump.sequences.some((s) => s.name.includes("users"))).toBe(true);
  });

  it("сводка называет таблицы и число строк", async () => {
    const text = summarize(await createDump(source));
    expect(text).toMatch(/Всего строк: \d+/);
    expect(text).toContain("users:");
  });
});

describe("восстановление в пустую базу — приёмка задачи", () => {
  it("разворачивает копию, и данные совпадают построчно", async () => {
    // 1. Схема: её создают миграции из репозитория, а не копия.
    const { execSync } = await import("node:child_process");
    execSync("npx payload migrate", {
      env: { ...process.env, DATABASE_URI: restoreUrl },
      stdio: "pipe",
      timeout: 180_000,
    });

    // 2. Копия — через шифрование и обратно, как она поедет в жизни.
    const dump = await createDump(source);
    const key = Buffer.alloc(32, 7);
    const packed = encryptDump(Buffer.from(JSON.stringify(dump), "utf8"), key);
    const restored = JSON.parse(decryptDump(packed, key).toString("utf8"));

    const report = await restoreDump(restored, restoreUrl);
    expect(report.sequences).toBeGreaterThan(0);

    // 3. Сверка: на месте ли ровно те записи, что были.
    const users = await run(restoreUrl, "SELECT email FROM users WHERE id = $1", [userId]);
    expect(users.rows[0]?.email).toBe(`backup-${stamp}@example.test`);

    const projects = await run(restoreUrl, "SELECT title, owner_id FROM projects WHERE id = $1", [
      projectId,
    ]);
    expect(projects.rows[0]?.title).toBe(`Копия «${stamp}» — кириллица и кавычки`);
    // Внешний ключ уцелел, а не обнулился.
    expect(projects.rows[0]?.owner_id).toBe(userId);

    const terms = await run(
      restoreUrl,
      "SELECT source_term, target_term, occurred_at_event FROM glossary_terms WHERE project_id = $1",
      [projectId],
    );
    expect(terms.rows[0]?.target_term).toBe("запас капитала");
    expect(terms.rows[0]?.occurred_at_event).toBe(true);

    // json-поле должно остаться объектом, а не строкой «[object Object]».
    const generations = await run(
      restoreUrl,
      "SELECT params FROM generations WHERE project_id = $1",
      [projectId],
    );
    expect(generations.rows[0]?.params).toMatchObject({ rate: "105%" });

    // Массив в jsonb — тот случай, на котором восстановление падает молча,
    // если сериализовать его не самим, а доверить драйверу.
    const usage = await run(
      restoreUrl,
      "SELECT voices FROM usage_events WHERE project_id = $1",
      [projectId],
    );
    expect(usage.rows[0]?.voices).toEqual([
      "en-GB-Chirp3-HD-Charon",
      "en-US-Chirp3-HD-Kore",
    ]);
  });

  it("после восстановления новая запись не сталкивается с существующей", async () => {
    // Ради этого и переносятся последовательности: без setval следующий
    // INSERT получил бы идентификатор, который уже занят.
    const inserted = await run(
      restoreUrl,
      `INSERT INTO users (email, role, updated_at, created_at)
       VALUES ($1, 'interpreter', now(), now()) RETURNING id`,
      [`after-restore-${stamp}@example.test`],
    );
    expect(inserted.rows[0].id).toBeGreaterThan(userId);
  });
});

describe("шифрование копии", () => {
  it("возвращает ровно то, что зашифровали", () => {
    const key = Buffer.alloc(32, 3);
    const plain = Buffer.from("копия с кириллицей и эмодзи 🎧", "utf8");
    expect(decryptDump(encryptDump(plain, key), key).toString("utf8")).toBe(plain.toString("utf8"));
  });

  it("чужой ключ не подходит", () => {
    const packed = encryptDump(Buffer.from("секрет"), Buffer.alloc(32, 1));
    expect(() => decryptDump(packed, Buffer.alloc(32, 2))).toThrow();
  });

  it("подделанный шифротекст отвергается, а не расшифровывается в мусор", () => {
    const key = Buffer.alloc(32, 5);
    const packed = encryptDump(Buffer.from("секрет"), key);
    packed[packed.length - 1] ^= 0xff;
    expect(() => decryptDump(packed, key)).toThrow();
  });
});
