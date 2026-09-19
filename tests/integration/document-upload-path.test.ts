import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";

/**
 * Живой прогон на стенде показал: путь загруженного файла приходит из браузера,
 * а сервер читал по нему хранилище без единой проверки. Здесь проверяется, что
 * чужой путь отклоняется до обращения к Blob, — поэтому обращение и
 * перехватывается: если `get` позвали, значит проверка не сработала.
 */

const blobCalls: string[] = [];

/** Когда задано — `get` отдаёт эти байты вместо отказа. */
let storedBytes: Buffer | null = null;

vi.mock("@vercel/blob", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vercel/blob")>();
  return {
    ...actual,
    get: async (path: string) => {
      blobCalls.push(path);
      if (!storedBytes) return null;
      return {
        statusCode: 200 as const,
        stream: new Response(new Uint8Array(storedBytes)).body,
        blob: { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
      };
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
    data: { email: `upload-${stamp}@example.test`, role: "interpreter" },
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

/**
 * Содержимое у каждого случая своё, и это не прихоть: с R3 повторная загрузка
 * того же файла отклоняется как дубль (I4). Одинаковый docx во всех проверках
 * означал бы, что вторая и дальше получают 409 вместо того, что проверяют.
 */

/**
 * Найдено живым использованием: к пути в хранилище приклеен случайный суффикс
 * (`addRandomSuffix`), и он показывался человеку как часть названия файла —
 * «Концепт-нота-GGBuGU8DFs7mZty1IaY9rZKikCRhHT.pdf».
 */
describe("имя файла в списке документов", () => {
  it("берётся от браузера, а не из пути в хранилище", async () => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.folder("_rels")!.file(".rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.folder("word")!.file("document.xml", '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>текст-{stamp}-1</w:t></w:r></w:p></w:body></w:document>');
    storedBytes = await zip.generateAsync({ type: "nodebuffer" });

    // Ключа модели в тесте нет — генерация остановится на этом, но запись
    // о документе к тому моменту уже создана, а нас интересует её имя.
    await post(ownProject, {
      pathname: `uploads/${ownProject}/Концепт-нота-GGBuGU8DFs7mZty1IaY9rZKikCRhHT.docx`,
      filename: "Концепт-нота.docx",
      params: {},
    });

    const payload = await payloadClient();
    const documents = await payload.find({
      collection: "documents",
      where: { project: { equals: ownProject } },
      sort: "-createdAt",
      limit: 1,
      overrideAccess: true,
    });

    expect(documents.docs[0]?.filename).toBe("Концепт-нота.docx");
    storedBytes = null;
  });

  it("разделители пути и управляющие символы в имени обезвреживаются", async () => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.folder("_rels")!.file(".rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.folder("word")!.file("document.xml", '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>текст-{stamp}-2</w:t></w:r></w:p></w:body></w:document>');
    storedBytes = await zip.generateAsync({ type: "nodebuffer" });

    // Имя приходит из браузера и попадает человеку на экран.
    await post(ownProject, {
      pathname: `uploads/${ownProject}/ok.docx`,
      filename: "../../etc/passwd\u0007.docx",
      params: {},
    });

    const payload = await payloadClient();
    const documents = await payload.find({
      collection: "documents",
      where: { project: { equals: ownProject } },
      sort: "-createdAt",
      limit: 1,
      overrideAccess: true,
    });

    const name = documents.docs[0]?.filename ?? "";
    expect(name).not.toContain("/");
    expect(name).not.toMatch(/[\u0000-\u001f]/);
    expect(name).toContain("passwd");
    storedBytes = null;
  });
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
