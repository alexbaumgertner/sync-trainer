import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";

/**
 * Живой прогон на стенде показал: путь загруженного файла приходит из браузера,
 * а сервер читал по нему хранилище без единой проверки. Здесь проверяется, что
 * чужой путь отклоняется до обращения к Blob, — поэтому обращение и
 * перехватывается: если `get` позвали, значит проверка не сработала.
 */

const blobCalls: string[] = [];

vi.mock("@vercel/blob", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vercel/blob")>();
  return {
    ...actual,
    get: async (path: string) => {
      blobCalls.push(path);
      return null;
    },
    del: async () => {},
  };
});

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: sessionToken }) }),
  headers: async () => new Headers(),
}));

const { payloadClient } = await import("@/lib/payload");
const { issueToken } = await import("@/lib/session");
const { POST } = await import("@/app/api/projects/[id]/documents/route");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let sessionToken = "";
let userId: number;
let ownProject: number;
let otherProject: number;

const post = (projectId: number, body: unknown) =>
  POST(
    new Request("http://localhost/api/projects/x/documents", {
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
    data: { email: `upload-${stamp}@example.test`, password: `pw-${stamp}`, role: "interpreter" },
    overrideAccess: true,
  });
  userId = user.id;
  sessionToken = issueToken(userId).token;

  const make = async (title: string) =>
    (
      await payload.create({
        collection: "projects",
        data: {
          title,
          owner: userId,
          sourceLang: "en",
          targetLang: "ru",
          stylePreset: "un",
          status: "draft",
        },
        overrideAccess: true,
      })
    ).id;

  ownProject = await make(`Свой ${stamp}`);
  otherProject = await make(`Чужой ${stamp}`);
});

afterAll(async () => {
  const payload = await payloadClient();
  for (const id of [ownProject, otherProject]) {
    await payload.delete({ collection: "projects", id, overrideAccess: true }).catch(() => {});
  }
  await payload.delete({ collection: "users", id: userId, overrideAccess: true }).catch(() => {});
});

describe("путь загруженного файла", () => {
  it("путь чужого проекта отклоняется, и до хранилища дело не доходит", async () => {
    blobCalls.length = 0;
    const response = await post(ownProject, {
      pathname: `uploads/${otherProject}/secret.docx`,
      params: {},
    });

    expect(response.status).toBe(400);
    expect(blobCalls).toEqual([]);
  });

  it("выход из каталога проекта отклоняется", async () => {
    blobCalls.length = 0;
    const response = await post(ownProject, {
      pathname: `uploads/${ownProject}/../${otherProject}/secret.docx`,
      params: {},
    });

    expect(response.status).toBe(400);
    expect(blobCalls).toEqual([]);
  });

  it("адрес вместо пути больше не принимается", async () => {
    blobCalls.length = 0;
    // Раньше сюда передавали произвольный URL, и сервер ходил по нему сам.
    const response = await post(ownProject, {
      pathname: "http://169.254.169.254/latest/meta-data/",
      params: {},
    });

    expect(response.status).toBe(400);
    expect(blobCalls).toEqual([]);
  });

  it("свой путь до хранилища доходит", async () => {
    blobCalls.length = 0;
    const response = await post(ownProject, {
      pathname: `uploads/${ownProject}/note.docx`,
      params: {},
    });

    // Мок отдаёт null — значит «файл недоступен», но обращение состоялось.
    expect(blobCalls).toEqual([`uploads/${ownProject}/note.docx`]);
    expect(response.status).toBe(400);
  });
});
