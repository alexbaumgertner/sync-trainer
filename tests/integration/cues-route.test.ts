import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Маршрут карты времени.
 *
 * Два источника, и разница между ними существенная для человека:
 * точная карта снята при синтезе, приблизительная собрана из скрипта
 * и общей длительности. Вторая нужна озвучкам, сделанным до появления
 * этой возможности, и её нельзя подавать как точную — отсюда заголовок.
 */

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: sessionToken }) }),
  headers: async () => new Headers(),
}));

const { payloadClient } = await import("@/lib/payload");
const { issueToken } = await import("@/lib/session");
const { artifactPath, putArtifact } = await import("@/lib/artifacts");
const { GET } = await import("@/app/api/projects/[id]/files/[fileId]/cues/route");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let payload: Awaited<ReturnType<typeof payloadClient>>;
let sessionToken = "";
let userId: number;
let projectId: number;
let audioId: number;

const SSML = `<speak><p>Moderator: First sentence here. Second sentence follows.</p><break time="2s"/><p>Speaker A: A reply in one sentence.</p></speak>`;

const ask = (fileId: number) =>
  GET(new Request("http://localhost/x"), {
    params: Promise.resolve({ id: String(projectId), fileId: String(fileId) }),
  });

beforeAll(async () => {
  payload = await payloadClient();
  userId = (
    await payload.create({
      collection: "users",
      data: { email: `cr-${stamp}@example.test`, role: "interpreter" },
      overrideAccess: true,
    })
  ).id as number;

  projectId = (
    await payload.create({
      collection: "projects",
      data: {
        title: `Карта ${stamp}`,
        owner: userId,
        sourceLang: "en",
        targetLang: "ru",
        stylePreset: "un",
        status: "draft",
      },
      overrideAccess: true,
    })
  ).id as number;

  const ssmlPath = artifactPath(projectId, "ssml.ssml");
  await putArtifact(ssmlPath, SSML, "application/ssml+xml");
  await payload.create({
    collection: "artifacts",
    data: { project: projectId, kind: "ssml", blobPath: ssmlPath, bytes: SSML.length },
    overrideAccess: true,
  });

  const audioPath = artifactPath(projectId, "audio.mp3");
  await putArtifact(audioPath, Buffer.from([0xff, 0xf3, 0x48, 0xc4]), "audio/mpeg");
  audioId = (
    await payload.create({
      collection: "artifacts",
      data: { project: projectId, kind: "audio", blobPath: audioPath, bytes: 4, durationSec: 60 },
      overrideAccess: true,
    })
  ).id as number;

  sessionToken = issueToken(userId).token;
});

afterAll(async () => {
  await payload.delete({ collection: "projects", id: projectId, overrideAccess: true }).catch(() => {});
  await payload.delete({ collection: "users", id: userId, overrideAccess: true }).catch(() => {});
});

describe("приблизительная карта", () => {
  it("собирается из скрипта, когда точной нет", async () => {
    const response = await ask(audioId);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/vtt");
    // Ответ обязан честно говорить, что подсветка приблизительна.
    expect(response.headers.get("X-Cues-Precision")).toBe("estimated");

    const vtt = await response.text();
    expect(vtt.startsWith("WEBVTT")).toBe(true);
    expect(vtt).toContain("First sentence here.");
    expect(vtt).toContain("<v Moderator>");
    expect(vtt).toContain("<v Speaker A>");
  });

  it("укладывается в известную длительность файла", async () => {
    const vtt = await (await ask(audioId)).text();
    const times = [...vtt.matchAll(/--> (\d\d):(\d\d):(\d\d)\.(\d\d\d)/g)].map(
      (m) => Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000,
    );
    // Последняя фраза не должна кончаться позже файла: щелчок по ней
    // отправил бы человека за конец записи.
    expect(Math.max(...times)).toBeLessThanOrEqual(60.001);
  });

  it("двухсекундная пауза из скрипта учтена точно", async () => {
    // Паузы — единственное, что у старых озвучек известно наверняка,
    // и раскладка обязана их сохранить.
    const vtt = await (await ask(audioId)).text();
    const blocks = vtt.split("\n\n").filter((b) => b.includes("-->"));
    const parse = (t: string) => {
      const m = /(\d\d):(\d\d):(\d\d)\.(\d\d\d) --> (\d\d):(\d\d):(\d\d)\.(\d\d\d)/.exec(t)!;
      return {
        start: Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000,
        end: Number(m[5]) * 3600 + Number(m[6]) * 60 + Number(m[7]) + Number(m[8]) / 1000,
      };
    };
    const parsed = blocks.map(parse);
    const gap = parsed[2].start - parsed[1].end;
    expect(gap).toBeCloseTo(2, 1);
  });
});

describe("точная карта", () => {
  it("отдаётся как есть и помечена точной", async () => {
    const stored = "WEBVTT\n\n1\n00:00:00.000 --> 00:00:03.000\n<v X>Точная фраза.</v>\n";
    await payload.update({
      collection: "artifacts",
      id: audioId,
      data: { cuesVtt: stored },
      overrideAccess: true,
    });

    const response = await ask(audioId);
    expect(response.headers.get("X-Cues-Precision")).toBe("exact");
    expect(await response.text()).toBe(stored);

    await payload.update({
      collection: "artifacts",
      id: audioId,
      // Пустая строка, а не null: Payload на null у текстового поля
      // значение не стирает, и следующая проверка шла бы по точному пути.
      data: { cuesVtt: "" },
      overrideAccess: true,
    });
  });
});

describe("границы", () => {
  it("посторонний карты не получает", async () => {
    const outsider = (
      await payload.create({
        collection: "users",
        data: { email: `cr-out-${stamp}@example.test`, role: "interpreter" },
        overrideAccess: true,
      })
    ).id as number;

    sessionToken = issueToken(outsider).token;
    expect((await ask(audioId)).status).toBe(404);

    sessionToken = issueToken(userId).token;
    await payload.delete({ collection: "users", id: outsider, overrideAccess: true });
  });

  it("у не-аудио карты нет", async () => {
    const ssml = await payload.find({
      collection: "artifacts",
      where: { and: [{ project: { equals: projectId } }, { kind: { equals: "ssml" } }] },
      limit: 1,
      overrideAccess: true,
    });
    expect((await ask(ssml.docs[0].id as number)).status).toBe(404);
  });

  it("без известной длительности приблизительную не выдумываем", async () => {
    // Без длительности раскладывать нечего, и «примерно ноль» было бы
    // хуже отсутствия: щелчки отправляли бы в начало файла.
    await payload.update({
      collection: "artifacts",
      id: audioId,
      data: { durationSec: null },
      overrideAccess: true,
    });
    expect((await ask(audioId)).status).toBe(404);

    await payload.update({
      collection: "artifacts",
      id: audioId,
      data: { durationSec: 60 },
      overrideAccess: true,
    });
  });
});
