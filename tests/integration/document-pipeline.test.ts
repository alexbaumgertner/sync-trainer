import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { Client } from "pg";

/**
 * Требование F2 на полном пути: загрузка → сборка глоссария → скрипт.
 *
 * Путь с R3 разложен на три запроса, и текст документа течёт в модель на
 * двух последних. Проверять F2 надо именно при УСПЕШНОЙ работе: только
 * тогда текст вообще куда-то идёт. Модель подменяем — настоящий вызов
 * стоит денег и требует ключа, а проверяем мы не её, а своё обещание.
 *
 * Сборка и генерация идут фоном, после ответа, поэтому тест ждёт не ответа
 * маршрута, а записи в `generations`: именно её видит и человек на странице.
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
const { POST: BUILD_GLOSSARY } = await import(
  "@/app/api/projects/[id]/glossary/build/route"
);
const { POST: BUILD_SCRIPT } = await import("@/app/api/projects/[id]/script/route");
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

/** Ответ модели на сборку глоссария: у неё своя схема, отдельная от скрипта. */
const glossaryReply = (terms: { source: string; target: string }[]) => ({
  text: JSON.stringify({ terms }),
  usageMetadata: { promptTokenCount: 8000, candidatesTokenCount: 1000 },
});

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
    data: { email: `pipeline-${stamp}@example.test`, role: "interpreter" },
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

  const { token } = issueToken(userId);
  sessionCookie = token;
  const request = new Request(`http://localhost/api/projects/${projectId}/documents`, {
    method: "POST",
    body: form,
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  });

  return POST(request, { params: Promise.resolve({ id: String(projectId) }) });
}

const authorized = (path: string, body?: unknown): Request => {
  const { token } = issueToken(userId);
  sessionCookie = token;
  return new Request(`http://localhost/api/projects/${projectId}/${path}`, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { cookie: `${SESSION_COOKIE}=${token}`, "content-type": "application/json" },
  });
};

/**
 * Ждём, пока фоновая работа допишет свою запись.
 *
 * Именно запись, а не ответ маршрута: маршрут отвечает 202 сразу, а человек
 * на странице смотрит на `generations`. Проверять надо то, на что смотрит он.
 */
async function settle(kind: "glossary" | "script", timeoutMs = 20_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const found = await payload.find({
      collection: "generations",
      where: { and: [{ project: { equals: projectId } }, { kind: { equals: kind } }] },
      sort: "-createdAt",
      limit: 1,
      depth: 0,
      overrideAccess: true,
    });
    const doc = found.docs[0];
    if (doc && (doc.status === "done" || doc.status === "failed")) return doc;
    if (Date.now() > until) throw new Error(`работа ${kind} не завершилась за ${timeoutMs} мс`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const buildGlossary = async (terms: { source: string; target: string }[]) => {
  generateContent.mockResolvedValueOnce(glossaryReply(terms));
  const response = await BUILD_GLOSSARY(authorized("glossary/build"), {
    params: Promise.resolve({ id: String(projectId) }),
  });
  if (response.status === 202) await settle("glossary");
  return response;
};

const buildScript = async (terms: { source: string; target: string }[]) => {
  generateContent.mockResolvedValueOnce({
    text: JSON.stringify({ ...modelReply, glossary: terms }),
    usageMetadata: { promptTokenCount: 20000, candidatesTokenCount: 4000 },
  });
  const response = await BUILD_SCRIPT(authorized("script", { durationMin: 20, speakers: 2 }), {
    params: Promise.resolve({ id: String(projectId) }),
  });
  if (response.status === 202) await settle("script");
  return response;
};

describe("полный путь документа", () => {
  it("текст документа доходит до модели и не оседает в базе", async () => {
    const response = await upload(
      await makeDocx(SECRET),
      "note.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(response.status).toBe(200);

    // Загрузка больше ничего не генерирует: она кончается загрузкой.
    const uploaded = (await response.json()) as { id: number; pages: number | null };
    expect(uploaded.id).toBeGreaterThan(0);
    expect(generateContent).not.toHaveBeenCalled();

    await buildGlossary([{ source: "backlash", target: "откат" }]);
    await buildScript([{ source: "backlash", target: "откат" }]);

    // Модель получила текст документа — иначе собирать было бы не из чего
    const prompts = JSON.stringify(generateContent.mock.calls);
    expect(prompts).toContain(SECRET);

    // А в базе его нет нигде (F2)
    const hits = await findInDatabase(SECRET);
    expect(hits, `фраза найдена в: ${hits.join(", ")}`).toEqual([]);
  });

  it("складывает артефакты, глоссарий и оба расхода", async () => {
    const artifacts = await payload.find({
      collection: "artifacts",
      where: { project: { equals: projectId } },
      overrideAccess: true,
    });
    // Снимка глоссария среди файлов нет намеренно: он устаревал при первой
    // же правке термина, а живая выгрузка стоит в секции глоссария.
    expect(artifacts.docs.map((a) => a.kind).sort()).toEqual(["script", "ssml"]);

    const terms = await payload.count({
      collection: "glossary-terms",
      where: { project: { equals: projectId } },
      overrideAccess: true,
    });
    expect(terms.totalDocs).toBe(1);

    // B4: у сборки глоссария своя статья расхода, у скрипта своя.
    const usage = await payload.find({
      collection: "usage-events",
      where: { project: { equals: projectId } },
      limit: 10,
      overrideAccess: true,
    });
    expect(usage.docs.map((u) => u.kind).sort()).toEqual(["glossary", "script"]);

    const project = await payload.findByID({
      collection: "projects",
      id: projectId,
      overrideAccess: true,
    });
    expect(project.status).toBe("scripted");
  });

  it("скрипт не генерируется, пока нет глоссария", async () => {
    // N3: не придирка к порядку кнопок. Речь строится вокруг выверенных
    // терминов, и без них генерировать нечего.
    const empty = await payload.create({
      collection: "projects",
      data: {
        title: `Без глоссария ${stamp}`,
        owner: userId,
        sourceLang: "en",
        targetLang: "ru",
        stylePreset: "un",
        status: "draft",
      },
      overrideAccess: true,
    });

    // Материалы есть, глоссария нет — проверяем именно второе условие
    await payload.create({
      collection: "documents",
      data: {
        project: empty.id,
        filename: "deck.pdf",
        mime: "application/pdf",
        bytes: 10,
        sha256: `sha-${stamp}`,
        blobPath: `projects/${empty.id}/source-1.pdf`,
      },
      overrideAccess: true,
    });

    const { token } = issueToken(userId);
    sessionCookie = token;
    const response = await BUILD_SCRIPT(
      new Request(`http://localhost/api/projects/${empty.id}/script`, {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE}=${token}` },
      }),
      { params: Promise.resolve({ id: String(empty.id) }) },
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("глоссарий");

    await payload.delete({ collection: "projects", id: empty.id, overrideAccess: true });
  });

  it("при отказе модели работа помечена отказом, а текста в базе нет", async () => {
    const marker = `ОТКАЗ-${stamp}`;
    await upload(
      await makeDocx(marker),
      "bad.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );

    generateContent.mockRejectedValueOnce(new Error("API key not valid"));
    const response = await BUILD_GLOSSARY(authorized("glossary/build"), {
      params: Promise.resolve({ id: String(projectId) }),
    });
    expect(response.status).toBe(202);

    const generation = await settle("glossary");
    expect(generation.status).toBe("failed");
    expect(generation.error).toContain("недействителен");

    // Текст документа не остаётся даже в записи об ошибке
    expect(await findInDatabase(marker)).toEqual([]);
  });

  it("посторонний формат отклоняется до всякой работы", async () => {
    generateContent.mockReset();
    const response = await upload(Buffer.from("не документ"), "pic.png", "image/png");
    expect(response.status).toBe(415);
    expect(generateContent).not.toHaveBeenCalled();
  });
});

/**
 * Найдено живым использованием 15 сентября: человек сгенерировал скрипт
 * дважды, и на карточке проекта появились два «Скрипта» разного размера,
 * оба ведущие на один файл, а в глоссарии задвоились термины.
 */
describe("повторная генерация", () => {
  it("не плодит записи о файлах: путь один, значит и строка одна", async () => {
    generateContent.mockReset();
    expect((await buildScript([{ source: "alpha", target: "альфа" }])).status).toBe(202);
    expect((await buildScript([{ source: "beta", target: "бета" }])).status).toBe(202);

    const artifacts = await payload.find({
      collection: "artifacts",
      where: { project: { equals: projectId } },
      limit: 50,
      overrideAccess: true,
    });

    const paths = artifacts.docs.map((a) => a.blobPath);
    // Два «Скрипта» на один путь — это не два файла, а список, который врёт:
    // обе строки отдают одно и то же, но показывают разный размер.
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("не задваивает термины глоссария", async () => {
    generateContent.mockReset();
    await buildScript([
      { source: "headroom", target: "запас" },
      { source: "graduation", target: "утрата права" },
    ]);
    await buildScript([
      { source: "headroom", target: "другой перевод" },
      { source: "rechannelling", target: "перенаправление" },
    ]);

    const terms = await payload.find({
      collection: "glossary-terms",
      where: { project: { equals: projectId } },
      limit: 200,
      overrideAccess: true,
    });

    const sources = terms.docs.map((t) => t.sourceTerm.toLowerCase());
    expect(new Set(sources).size).toBe(sources.length);

    // Существующий перевод не переписан: он мог быть выверен человеком,
    // а это ценнее свежей догадки модели.
    const headroom = terms.docs.find((t) => t.sourceTerm.toLowerCase() === "headroom");
    expect(headroom?.targetTerm).toBe("запас");
  });
});
