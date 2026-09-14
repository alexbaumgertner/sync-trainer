import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { Client } from "pg";

/**
 * Требование F2 на полном пути: загрузка → разбор → генерация → сохранение.
 *
 * Проверять это надо именно при УСПЕШНОЙ генерации: только тогда текст
 * документа вообще куда-то течёт. Модель подменяем — настоящий вызов стоит
 * денег и требует ключа, а проверяем мы не её, а своё обещание.
 */

const generateContent = vi.fn();

vi.mock("@google/genai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@google/genai")>();
  return {
    ...actual,
    GoogleGenAI: class {
      models = { generateContent };
    },
  };
});

process.env.GEMINI_API_KEY ||= "test-key";

/**
 * cookies() из next/headers живёт только внутри запроса Next. В тесте мы
 * зовём обработчик напрямую, поэтому подменяем источник куки на переменную,
 * которую выставляет помощник upload().
 */
let sessionCookie = "";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "sync_trainer_session" && sessionCookie
        ? { name, value: sessionCookie }
        : undefined,
    set: () => {},
  }),
}));

const { payloadClient } = await import("@/lib/payload");
const { POST } = await import("@/app/api/projects/[id]/documents/route");
const { issueToken, SESSION_COOKIE } = await import("@/lib/session");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const SECRET = `ТАЙНА-${stamp}`;

let payload: Awaited<ReturnType<typeof payloadClient>>;
let userId: number;
let projectId: number;

async function makeDocx(text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.folder("_rels")!.file(
    ".rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.folder("word")!.file(
    "document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

async function findInDatabase(needle: string): Promise<string[]> {
  const client = new Client({ connectionString: process.env.DATABASE_URI });
  await client.connect();
  try {
    const columns = await client.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
       where table_schema = 'public'
         and data_type in ('text','character varying','jsonb','json')`,
    );
    const hits: string[] = [];
    for (const { table_name, column_name } of columns.rows) {
      const { rows } = await client.query(
        `select 1 from "${table_name}" where "${column_name}"::text like $1 limit 1`,
        [`%${needle}%`],
      );
      if (rows.length) hits.push(`${table_name}.${column_name}`);
    }
    return hits;
  } finally {
    await client.end();
  }
}

const BREAK = '<break time="1.5s"/>';
const modelReply = {
  title: "Панель о равенстве",
  speakers: ["Moderator", "Researcher"],
  segments: [
    { speaker: "Moderator", timecode: "00:00", text: "word ".repeat(150).trim() },
    { speaker: "Researcher", timecode: "01:30", text: "word ".repeat(150).trim() },
  ],
  ssml: '<speak><prosody rate="105%">' + ("<p>text</p>" + BREAK).repeat(2) + "</prosody></speak>",
  glossary: [{ source: "backlash", target: "откат" }],
};

beforeAll(async () => {
  payload = await payloadClient();
  const user = await payload.create({
    collection: "users",
    data: { email: `pipeline-${stamp}@example.test`, password: `pw-${stamp}`, role: "interpreter" },
    overrideAccess: true,
  });
  userId = user.id;

  const project = await payload.create({
    collection: "projects",
    data: {
      title: `Пайплайн ${stamp}`,
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
  await payload.delete({ collection: "projects", id: projectId, overrideAccess: true }).catch(() => {});
  await payload.delete({ collection: "users", id: userId, overrideAccess: true }).catch(() => {});
});

async function upload(fileBuffer: Buffer, name: string, type: string): Promise<Response> {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(fileBuffer)], name, { type }));
  form.append("durationMin", "20");
  form.append("speakers", "2");
  form.append("termDensity", "40");
  form.append("rate", "105%");

  const { token } = issueToken(userId);
  sessionCookie = token;
  const request = new Request(`http://localhost/api/projects/${projectId}/documents`, {
    method: "POST",
    body: form,
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  });

  return POST(request, { params: Promise.resolve({ id: String(projectId) }) });
}

describe("полный путь документа", () => {
  it("генерирует скрипт и не оставляет текста документа в базе", async () => {
    generateContent.mockResolvedValueOnce({
      text: JSON.stringify(modelReply),
      usageMetadata: { promptTokenCount: 20000, candidatesTokenCount: 4000 },
    });

    const response = await upload(
      await makeDocx(SECRET),
      "note.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as { title: string; glossary: number; costUsd: number };
    expect(body.title).toBe("Панель о равенстве");
    expect(body.glossary).toBe(1);
    expect(body.costUsd).toBeGreaterThan(0);

    // Модель получила текст документа — иначе генерировать было бы не из чего
    const prompt = JSON.stringify(generateContent.mock.calls[0][0]);
    expect(prompt).toContain(SECRET);

    // А в базе его нет нигде (F2)
    const hits = await findInDatabase(SECRET);
    expect(hits, `фраза найдена в: ${hits.join(", ")}`).toEqual([]);
  });

  it("складывает артефакты, глоссарий и расход", async () => {
    const artifacts = await payload.find({
      collection: "artifacts",
      where: { project: { equals: projectId } },
      overrideAccess: true,
    });
    expect(artifacts.docs.map((a) => a.kind).sort()).toEqual(["glossary", "script", "ssml"]);

    const terms = await payload.count({
      collection: "glossary-terms",
      where: { project: { equals: projectId } },
      overrideAccess: true,
    });
    expect(terms.totalDocs).toBe(1);

    const usage = await payload.find({
      collection: "usage-events",
      where: { project: { equals: projectId } },
      overrideAccess: true,
    });
    expect(usage.docs[0]?.kind).toBe("script");

    const project = await payload.findByID({
      collection: "projects",
      id: projectId,
      overrideAccess: true,
    });
    expect(project.status).toBe("scripted");
  });

  it("при отказе модели ничего лишнего не остаётся", async () => {
    generateContent.mockRejectedValueOnce(new Error("API key not valid"));
    const marker = `ОТКАЗ-${stamp}`;

    const response = await upload(
      await makeDocx(marker),
      "bad.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(response.status).toBe(502);
    expect((await response.json()).error).toContain("недействителен");

    expect(await findInDatabase(marker)).toEqual([]);

    const failed = await payload.find({
      collection: "generations",
      where: { and: [{ project: { equals: projectId } }, { status: { equals: "failed" } }] },
      overrideAccess: true,
    });
    expect(failed.totalDocs).toBe(1);
  });

  it("посторонний формат отклоняется до обращения к модели", async () => {
    generateContent.mockReset();
    const response = await upload(Buffer.from("не документ"), "pic.png", "image/png");
    expect(response.status).toBe(415);
    expect(generateContent).not.toHaveBeenCalled();
  });
});
