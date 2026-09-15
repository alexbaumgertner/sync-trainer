import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Разделение стенда и боевого (Б3 аудита, в исправленной формулировке).
 *
 * В отчёте было написано, что превью работает с боевой базой. Это оказалось
 * неверно: Neon подставляет превью-развёртыванию свою ветку, отпечатки
 * соединений в логах разные. Настоящих проблем нашлось две, и обе тоньше —
 * общее хранилище файлов при разошедшихся счётчиках идентификаторов и
 * кроновый маршрут, который без секрета открывался, а не закрывался.
 */

const reload = async () => {
  vi.resetModules();
  return import("@/lib/artifact-path");
};

const withEnv = async <T>(vars: Record<string, string | undefined>, fn: () => Promise<T>) => {
  const saved = { ...process.env };
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    process.env = saved;
  }
};

afterEach(() => vi.resetModules());

describe("пути файлов разведены по окружениям", () => {
  it("боевое пишет без приставки — пути уже в базе", async () => {
    await withEnv({ VERCEL_ENV: "production" }, async () => {
      const { artifactPath } = await reload();
      expect(artifactPath(4, "script.md")).toBe("projects/4/script.md");
    });
  });

  it("превью пишет со своей приставкой", async () => {
    await withEnv({ VERCEL_ENV: "preview" }, async () => {
      const { artifactPath } = await reload();
      expect(artifactPath(4, "script.md")).toBe("preview/projects/4/script.md");
    });
  });

  it("одинаковый проект в разных окружениях даёт разные пути", async () => {
    // Хранилище Blob одно на оба окружения, а базы разные: счётчики
    // идентификаторов разошлись, и без приставки стенд переписал бы
    // человеку скрипт, по которому тот готовится к мероприятию.
    const prod = await withEnv({ VERCEL_ENV: "production" }, async () =>
      (await reload()).artifactPath(4, "audio.mp3"),
    );
    const preview = await withEnv({ VERCEL_ENV: "preview" }, async () =>
      (await reload()).artifactPath(4, "audio.mp3"),
    );
    expect(prod).not.toBe(preview);
  });

  it("вне облака приставки нет: локально файлы на диске", async () => {
    await withEnv({ VERCEL_ENV: undefined }, async () => {
      const { artifactPath } = await reload();
      expect(artifactPath(4, "script.md")).toBe("projects/4/script.md");
    });
  });

  it("стенд не отдаёт боевой файл: он вне его каталога", async () => {
    await withEnv({ VERCEL_ENV: "preview" }, async () => {
      const { insideProject } = await reload();
      expect(insideProject("projects/4/script.md", 4)).toBe(false);
      expect(insideProject("preview/projects/4/script.md", 4)).toBe(true);
    });
  });

  it("боевое не отдаёт файл стенда", async () => {
    await withEnv({ VERCEL_ENV: "production" }, async () => {
      const { insideProject } = await reload();
      expect(insideProject("preview/projects/4/script.md", 4)).toBe(false);
    });
  });
});

describe("допуск к кроновым маршрутам", () => {
  const ask = async (headers: Record<string, string> = {}) => {
    vi.resetModules();
    const { cronAuthorized } = await import("@/lib/cron-auth");
    return cronAuthorized(new Request("http://localhost/api/cron/backup", { headers }));
  };

  it("в облаке без секрета — запрет, а не разрешение", async () => {
    // Так было наоборот: `!secret ||` открывало маршрут. На превью секрета
    // нет, а база там — ветка от боевой, с настоящими данными людей.
    await withEnv({ VERCEL_ENV: "preview", CRON_SECRET: undefined }, async () => {
      expect(await ask()).toBe(false);
    });
  });

  it("с верным секретом — пускаем", async () => {
    await withEnv({ VERCEL_ENV: "production", CRON_SECRET: "s3cret" }, async () => {
      expect(await ask({ authorization: "Bearer s3cret" })).toBe(true);
    });
  });

  it("с чужим секретом и без заголовка — нет", async () => {
      // Заголовки HTTP — только латиница, кириллица в них не кодируется.
    await withEnv({ VERCEL_ENV: "production", CRON_SECRET: "s3cret" }, async () => {
      expect(await ask({ authorization: "Bearer wrong-secret" })).toBe(false);
      expect(await ask()).toBe(false);
    });
  });

  it("локально без секрета — можно: задавать его здесь незачем", async () => {
    await withEnv({ VERCEL_ENV: undefined, CRON_SECRET: undefined }, async () => {
      expect(await ask()).toBe(true);
    });
  });
});
