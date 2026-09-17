import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Перемотка звука: диапазоны в выдаче файла.
 *
 * Найдено живым использованием. Проигрыватель играл, скорость менялась,
 * ползунок двигался — а звук шёл с прежнего места. Причина оказалась
 * не в проигрывателе: маршрут не поддерживал `Range`, отвечал на запрос
 * куска целым файлом с кодом 200, и браузер делал единственный доступный
 * вывод — перематывать нельзя.
 *
 * Проверяется поэтому не «файл отдаётся», а именно поведение с диапазонами:
 * то, что человек видит как работающую или неработающую перемотку.
 */

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: sessionToken }) }),
  headers: async () => new Headers(),
}));

const { payloadClient } = await import("@/lib/payload");
const { issueToken } = await import("@/lib/session");
const { artifactPath, putArtifact } = await import("@/lib/artifacts");
const { GET } = await import("@/app/api/projects/[id]/files/[fileId]/route");
const { parseRange } = await import("@/lib/http-range");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const BODY = Buffer.from("0123456789".repeat(100), "utf8"); // 1000 байт
let payload: Awaited<ReturnType<typeof payloadClient>>;
let sessionToken = "";
let userId: number;
let projectId: number;
let fileId: number;

const ask = (headers?: Record<string, string>) =>
  GET(new Request("http://localhost/x", { headers }), {
    params: Promise.resolve({ id: String(projectId), fileId: String(fileId) }),
  });

beforeAll(async () => {
  payload = await payloadClient();
  userId = (
    await payload.create({
      collection: "users",
      data: { email: `rng-${stamp}@example.test`, role: "interpreter" },
      overrideAccess: true,
    })
  ).id as number;

  projectId = (
    await payload.create({
      collection: "projects",
      data: {
        title: `Диапазоны ${stamp}`,
        owner: userId,
        sourceLang: "en",
        targetLang: "ru",
        stylePreset: "un",
        status: "draft",
      },
      overrideAccess: true,
    })
  ).id as number;

  const blobPath = artifactPath(projectId, "audio.mp3");
  await putArtifact(blobPath, BODY, "audio/mpeg");
  fileId = (
    await payload.create({
      collection: "artifacts",
      data: { project: projectId, kind: "audio", blobPath, bytes: BODY.byteLength },
      overrideAccess: true,
    })
  ).id as number;

  sessionToken = issueToken(userId).token;
});

afterAll(async () => {
  await payload.delete({ collection: "projects", id: projectId, overrideAccess: true }).catch(() => {});
  await payload.delete({ collection: "users", id: userId, overrideAccess: true }).catch(() => {});
});

describe("выдача файла", () => {
  it("объявляет, что умеет отдавать кусками", async () => {
    // Без этого заголовка браузер даже не попробует перемотать.
    const response = await ask();
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(response.status).toBe(200);
  });

  it("без запроса диапазона отдаёт файл целиком", async () => {
    const response = await ask();
    expect(response.headers.get("Content-Length")).toBe(String(BODY.byteLength));
    expect(Buffer.from(await response.arrayBuffer())).toEqual(BODY);
  });
});

describe("кусок из середины", () => {
  it("отдаётся с кодом 206 и правильными границами", async () => {
    const response = await ask({ range: "bytes=100-199" });

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe(`bytes 100-199/${BODY.byteLength}`);
    expect(response.headers.get("Content-Length")).toBe("100");

    const chunk = Buffer.from(await response.arrayBuffer());
    expect(chunk).toEqual(BODY.subarray(100, 200));
  });

  it("открытый справа диапазон доходит до конца файла", async () => {
    // `bytes=900-` — именно так браузер просит хвост при перемотке в конец.
    const response = await ask({ range: "bytes=900-" });

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe(`bytes 900-999/${BODY.byteLength}`);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(BODY.subarray(900));
  });

  it("запрос за концом файла — 416, а не «держи всё»", async () => {
    const response = await ask({ range: "bytes=5000-6000" });
    expect(response.status).toBe(416);
    expect(response.headers.get("Content-Range")).toBe(`bytes */${BODY.byteLength}`);
  });
});

describe("разбор заголовка", () => {
  it("понимает обычные виды", () => {
    expect(parseRange("bytes=0-99", 1000)).toEqual({ kind: "partial", start: 0, end: 99 });
    expect(parseRange("bytes=500-", 1000)).toEqual({ kind: "partial", start: 500, end: 999 });
    // Хвост: последние сто байт.
    expect(parseRange("bytes=-100", 1000)).toEqual({ kind: "partial", start: 900, end: 999 });
  });

  it("обрезает конец по размеру файла", () => {
    expect(parseRange("bytes=900-99999", 1000)).toEqual({ kind: "partial", start: 900, end: 999 });
  });

  it("на непонятное отвечает целым файлом, а не ошибкой", () => {
    // Несколько диапазонов браузеры для медиа не шлют; отдать целое —
    // разрешено спецификацией и честнее, чем собирать multipart.
    expect(parseRange("bytes=0-99,200-299", 1000)).toEqual({ kind: "full" });
    expect(parseRange("страницы=1-2", 1000)).toEqual({ kind: "full" });
    expect(parseRange(null, 1000)).toEqual({ kind: "full" });
  });

  it("невыполнимое остаётся невыполнимым", () => {
    expect(parseRange("bytes=1000-", 1000)).toEqual({ kind: "unsatisfiable" });
    expect(parseRange("bytes=800-700", 1000)).toEqual({ kind: "unsatisfiable" });
  });
});
