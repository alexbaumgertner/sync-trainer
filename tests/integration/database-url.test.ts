import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Порядок выбора строки подключения — не вкусовщина, а защита от молчаливой
 * записи в боевую базу: интеграция Neon подставляет ветку превью в
 * DATABASE_URL, а POSTGRES_URL может остаться от продакшена.
 */

const PROD = "postgresql://u:p@ep-prod-main.eu-central-1.aws.neon.tech/neondb";
const PREVIEW = "postgresql://u:p@ep-preview-feat.eu-central-1.aws.neon.tech/neondb";
const LOCAL = "postgresql://dev:devpass@localhost:5434/sync_trainer";

import crypto from "node:crypto";

const hostPrint = (url: string): string =>
  crypto.createHash("sha256").update(new URL(url).hostname).digest("hex").slice(0, 8);

let databaseUrl: typeof import("@/lib/database-url").databaseUrl;
const saved = { ...process.env };

beforeEach(async () => {
  vi.resetModules();
  for (const key of ["DATABASE_URI", "DATABASE_URL", "POSTGRES_URL"]) delete process.env[key];
  ({ databaseUrl } = await import("@/lib/database-url"));
});

afterEach(() => {
  process.env = { ...saved };
});

describe("выбор базы", () => {
  it("ветка превью побеждает общую строку от интеграции", () => {
    process.env.DATABASE_URL = PREVIEW;
    process.env.POSTGRES_URL = PROD;
    expect(databaseUrl()).toBe(PREVIEW);
  });

  it("заданная руками строка побеждает обе", () => {
    process.env.DATABASE_URI = LOCAL;
    process.env.DATABASE_URL = PREVIEW;
    process.env.POSTGRES_URL = PROD;
    expect(databaseUrl()).toBe(LOCAL);
  });

  it("одна только POSTGRES_URL тоже работает", () => {
    process.env.POSTGRES_URL = PROD;
    expect(databaseUrl()).toBe(PROD);
  });

  it("без переменных возвращает пустую строку, а не падает", () => {
    expect(databaseUrl()).toBe("");
  });

  it("в лог попадает узел, но не пароль", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    process.env.DATABASE_URL = PREVIEW;
    databaseUrl();

    const line = info.mock.calls[0]?.[0] as string;
    expect(line).toContain("ep-preview-feat");
    expect(line).toContain("DATABASE_URL");
    expect(line).not.toContain("p@");
    info.mockRestore();
  });

  it("отпечаток различает базы и переживает вырезание секретов", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    process.env.DATABASE_URL = PREVIEW;
    databaseUrl();
    const previewLine = info.mock.calls[0][0] as string;
    const previewPrint = previewLine.match(/отпечаток ([0-9a-f]{8})/)?.[1];

    info.mockClear();
    vi.resetModules();
    info.mockRestore();
    expect(previewPrint).toMatch(/^[0-9a-f]{8}$/);

    // Тот же узел даёт тот же отпечаток, другой — другой
    const sameHost = PREVIEW.replace("/neondb", "/other");
    expect(hostPrint(sameHost)).toBe(previewPrint);
    expect(hostPrint(PROD)).not.toBe(previewPrint);
  });

  it("сообщает один раз, а не на каждое обращение", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    process.env.DATABASE_URL = PREVIEW;
    databaseUrl();
    databaseUrl();
    databaseUrl();
    expect(info).toHaveBeenCalledTimes(1);
    info.mockRestore();
  });
});

describe("режим TLS", () => {
  it("слабые режимы переписываются в verify-full", async () => {
    // Драйвер pg сегодня и так трактует их как verify-full, но предупреждает,
    // что в следующей мажорной версии перестанет: соединение останется
    // зашифрованным, а защиты от подмены узла не будет.
    for (const weak of ["require", "prefer", "verify-ca"]) {
      process.env.DATABASE_URI = `postgresql://u:p@db.neon.tech/main?sslmode=${weak}`;
      expect(databaseUrl()).toContain("sslmode=verify-full");
    }
  });

  it("строгие режимы не трогаем", async () => {
    for (const strict of ["verify-full", "disable", "no-verify"]) {
      process.env.DATABASE_URI = `postgresql://u:p@db.neon.tech/main?sslmode=${strict}`;
      expect(databaseUrl()).toContain(`sslmode=${strict}`);
    }
  });

  it("строку без sslmode оставляем как есть — локальная база без TLS", () => {
    process.env.DATABASE_URI = "postgresql://dev:pw@localhost:5434/sync_trainer";
    expect(databaseUrl()).toBe("postgresql://dev:pw@localhost:5434/sync_trainer");
  });

  it("остальные параметры не теряются", () => {
    process.env.DATABASE_URI =
      "postgresql://u:p@db.neon.tech/main?sslmode=require&channel_binding=require";
    const url = databaseUrl();
    expect(url).toContain("channel_binding=require");
    expect(url).toContain("sslmode=verify-full");
  });
});
