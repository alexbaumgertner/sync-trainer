import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";

/**
 * Выгрузка глоссария отдаёт файл наружу, поэтому здесь проверяется не форма
 * файла (это в glossary-export.test.ts), а кому он достаётся: чужой проект
 * не должен отдать ни одного термина.
 */

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: sessionToken }) }),
  headers: async () => new Headers(),
}));

const { payloadClient } = await import("@/lib/payload");
const { issueToken } = await import("@/lib/session");
const { GET } = await import("@/app/api/projects/[id]/glossary/route");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const SECRET_TERM = `СЕКРЕТНЫЙ-ТЕРМИН-${stamp}`;

let sessionToken = "";
let owner: number;
let stranger: number;
let ownProject: number;
let otherProject: number;

const download = (projectId: number, format: string) =>
  GET(new Request(`http://localhost/api/projects/x/glossary?format=${format}`), {
    params: Promise.resolve({ id: String(projectId) }),
  });

beforeAll(async () => {
  const payload = await payloadClient();

  const makeUser = async (tag: string) =>
    (
      await payload.create({
        collection: "users",
        data: { email: `gl-${tag}-${stamp}@example.test`, role: "interpreter" },
        overrideAccess: true,
      })
    ).id;

  owner = await makeUser("owner");
  stranger = await makeUser("stranger");

  const makeProject = async (userId: number, title: string) =>
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

  ownProject = await makeProject(owner, `Свой ${stamp}`);
  otherProject = await makeProject(stranger, `Чужой ${stamp}`);

  await payload.create({
    collection: "glossary-terms",
    data: { project: ownProject, sourceTerm: "headroom", targetTerm: "запас капитала", status: "suggested" },
    overrideAccess: true,
  });
  await payload.create({
    collection: "glossary-terms",
    data: { project: otherProject, sourceTerm: SECRET_TERM, targetTerm: "чужое", status: "verified" },
    overrideAccess: true,
  });

  sessionToken = issueToken(owner).token;
});

afterAll(async () => {
  const payload = await payloadClient();
  for (const id of [ownProject, otherProject]) {
    await payload.delete({ collection: "projects", id, overrideAccess: true }).catch(() => {});
  }
  for (const id of [owner, stranger]) {
    await payload.delete({ collection: "users", id, overrideAccess: true }).catch(() => {});
  }
});

describe("выгрузка глоссария", () => {
  it("свой проект отдаётся в CSV", async () => {
    const response = await download(ownProject, "csv");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain("attachment");

    const body = await response.text();
    expect(body).toContain("headroom");
    expect(body).toContain("предложен моделью");
  });

  it("свой проект отдаётся в XLSX, и это настоящий zip таблицы", async () => {
    const response = await download(ownProject, "xlsx");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("spreadsheetml.sheet");

    const zip = await JSZip.loadAsync(Buffer.from(await response.arrayBuffer()));
    const sheet = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    expect(sheet).toContain("headroom");
  });

  it("чужой проект не отдаёт ни термина", async () => {
    const response = await download(otherProject, "xlsx");
    expect(response.status).toBe(404);

    const body = await response.text();
    expect(body).not.toContain(SECRET_TERM);
  });

  it("неизвестный формат отклоняется до обращения к базе", async () => {
    const response = await download(ownProject, "pdf");
    expect(response.status).toBe(400);
  });

  it("пустой глоссарий даёт внятный отказ, а не пустой файл", async () => {
    const payload = await payloadClient();
    const empty = await payload.create({
      collection: "projects",
      data: {
        title: `Пустой ${stamp}`,
        owner,
        sourceLang: "en",
        targetLang: "ru",
        stylePreset: "un",
        status: "draft",
      },
      overrideAccess: true,
    });

    const response = await download(empty.id, "csv");
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("пуст");

    await payload.delete({ collection: "projects", id: empty.id, overrideAccess: true });
  });
});
