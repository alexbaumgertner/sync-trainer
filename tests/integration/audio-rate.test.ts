import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Дефект, найденный первым боевым прогоном: темп из <prosody rate> доезжал
 * только до голосов, понимающих SSML. У остальных разметка срезается, темп
 * пропадал вместе с ней, и человек молча получал 100% вместо заказанных 105%.
 *
 * Здесь проверяется ровно то, что тогда сломалось: что именно синтез получает
 * на вход в каждом из двух режимов.
 */

const calls: { speakingRate?: number; format?: string }[] = [];

vi.mock("@/lib/google-tts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/google-tts")>();
  return {
    ...actual,
    hasCredentials: () => true,
    synthesizePlan: async (
      plan: { type: string; format?: string }[],
      settings: { speakingRate?: number },
    ) => {
      calls.push({
        speakingRate: settings.speakingRate,
        format: plan.find((i) => i.type === "speech")?.format,
      });
      return Buffer.alloc(64);
    },
  };
});

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: sessionToken }) }),
  headers: async () => new Headers(),
}));

const { payloadClient } = await import("@/lib/payload");
const { issueToken } = await import("@/lib/session");
const { POST } = await import("@/app/api/projects/[id]/audio/route");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let sessionToken = "";
let userId: number;
let projectId: number;

const SSML =
  '<speak><prosody rate="105%">' +
  "<p>Moderator: Good morning, distinguished colleagues and welcome.</p>" +
  '<break time="1.5s"/>' +
  "<p>Researcher: Thank you, chair, for the kind introduction.</p>" +
  "</prosody></speak>";

const synthesize = (body: unknown) =>
  POST(
    new Request("http://localhost/api/projects/x/audio", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: String(projectId) }) },
  );

beforeAll(async () => {
  const payload = await payloadClient();
  const user = await payload.create({
    collection: "users",
    data: { email: `rate-${stamp}@example.test`, role: "interpreter" },
    overrideAccess: true,
  });
  userId = user.id;
  sessionToken = issueToken(userId).token;

  const project = await payload.create({
    collection: "projects",
    data: {
      title: `Темп ${stamp}`,
      owner: userId,
      sourceLang: "en",
      targetLang: "ru",
      stylePreset: "un",
      status: "draft",
    },
    overrideAccess: true,
  });
  projectId = project.id;
});

afterAll(async () => {
  const payload = await payloadClient();
  await payload.delete({ collection: "projects", id: projectId, overrideAccess: true }).catch(() => {});
  await payload.delete({ collection: "users", id: userId, overrideAccess: true }).catch(() => {});
});

beforeEach(async () => {
  // Предыдущий тест оставляет запись о генерации, и следующий запуск получил
  // бы 409 «синтез уже идёт» — в бою это защита от двойной оплаты, здесь помеха.
  const payload = await payloadClient();
  await payload.delete({
    collection: "generations",
    where: { project: { equals: projectId } },
    overrideAccess: true,
  });
});

describe("темп доезжает до синтеза", () => {
  it("в текстовом режиме передаётся отдельным параметром", async () => {
    calls.length = 0;
    // Chirp 3 HD принимает только текст: <prosody> до него не доедет.
    const response = await synthesize({ ssml: SSML, voice: "en-GB-Chirp3-HD-Charon" });

    // 202: синтез идёт после ответа (U3), поэтому вызова ждём, а не ожидаем сразу.
    expect(response.status).toBe(202);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].format).toBe("text");
    expect(calls[0].speakingRate).toBeCloseTo(1.05, 5);
  });

  it("в режиме SSML не передаётся — иначе множители перемножатся", async () => {
    calls.length = 0;
    // Neural2 читает <prosody rate> сам. Передай мы ещё и speakingRate,
    // 105% превратились бы в 110%.
    const response = await synthesize({ ssml: SSML, voice: "en-GB-Neural2-B" });

    expect(response.status).toBe(202);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].format).toBe("ssml");
    expect(calls[0].speakingRate).toBeUndefined();
  });

  it("темп 100% не передаётся вовсе", async () => {
    calls.length = 0;
    const plain = SSML.replace('rate="105%"', 'rate="100%"');
    const response = await synthesize({ ssml: plain, voice: "en-GB-Chirp3-HD-Charon" });

    expect(response.status).toBe(202);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].speakingRate).toBeUndefined();
  });
});
