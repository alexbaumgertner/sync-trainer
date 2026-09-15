import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { payloadClient } from "@/lib/payload";
import { getProject, listProjects } from "@/lib/projects";
import { artifactPath, putArtifact, readArtifact } from "@/lib/artifacts";

/**
 * Требования U1 и F4. Главное здесь — что удаление проекта уносит файлы
 * и связанные записи, а не только строку проекта.
 */

let payload: Awaited<ReturnType<typeof payloadClient>>;
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let owner: number;
let stranger: number;

const makeUser = async (prefix: string) => {
  const user = await payload.create({
    collection: "users",
    data: { email: `${prefix}-${stamp}@example.test`, role: "interpreter" },
    overrideAccess: true,
  });
  return user.id;
};

const makeProject = async (userId: number, title: string) => {
  const project = await payload.create({
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
  });
  return project.id;
};

beforeAll(async () => {
  payload = await payloadClient();
  owner = await makeUser("owner");
  stranger = await makeUser("stranger");
});

afterAll(async () => {
  for (const id of [owner, stranger]) {
    const projects = await payload.find({
      collection: "projects",
      where: { owner: { equals: id } },
      limit: 100,
      overrideAccess: true,
    });
    for (const project of projects.docs) {
      await payload.delete({ collection: "projects", id: project.id, overrideAccess: true }).catch(() => {});
    }
    await payload.delete({ collection: "users", id, overrideAccess: true }).catch(() => {});
  }
});

describe("список и карточка", () => {
  it("показывает только свои проекты", async () => {
    const mine = await makeProject(owner, "Стамбульская панель");
    await makeProject(stranger, "Чужой проект");

    const rows = await listProjects(owner);
    expect(rows.map((r) => r.title)).toContain("Стамбульская панель");
    expect(rows.map((r) => r.title)).not.toContain("Чужой проект");

    await payload.delete({ collection: "projects", id: mine, overrideAccess: true });
  });

  it("карточка чужого проекта не отдаётся", async () => {
    const theirs = await makeProject(stranger, "Не ваш");
    expect(await getProject(theirs, owner)).toBeNull();
    expect(await getProject(theirs, stranger)).not.toBeNull();
    await payload.delete({ collection: "projects", id: theirs, overrideAccess: true });
  });

  it("считает расход проекта", async () => {
    const id = await makeProject(owner, "С расходом");
    await payload.create({
      collection: "usage-events",
      data: { user: owner, project: id, kind: "audio", chars: 100, costUsd: 0.25 },
      overrideAccess: true,
    });

    const detail = await getProject(id, owner);
    expect(detail?.costUsd).toBeCloseTo(0.25, 6);

    const rows = await listProjects(owner);
    expect(rows.find((r) => r.id === id)?.costUsd).toBeCloseTo(0.25, 6);

    await payload.delete({ collection: "projects", id, overrideAccess: true });
  });
});

describe("удаление проекта", () => {
  it("уносит файлы, связанные записи и расходы не ломает", async () => {
    const id = await makeProject(owner, "На удаление");
    const blobPath = artifactPath(id, "script.md");

    await putArtifact(blobPath, "текст скрипта", "text/markdown");
    expect(await readArtifact(blobPath)).not.toBeNull();

    await payload.create({
      collection: "artifacts",
      data: { project: id, kind: "script", blobPath, bytes: 26 },
      overrideAccess: true,
    });
    await payload.create({
      collection: "glossary-terms",
      data: { project: id, sourceTerm: "backlash", targetTerm: "откат", status: "suggested" },
      overrideAccess: true,
    });
    await payload.create({
      collection: "debriefs",
      data: { project: id, hardest: "путались в цифрах" },
      overrideAccess: true,
    });

    await payload.delete({ collection: "projects", id, overrideAccess: true });

    // Файл исчез вместе с проектом (F4)
    expect(await readArtifact(blobPath)).toBeNull();

    // И связанные записи тоже, а не повисли без проекта
    for (const collection of ["artifacts", "glossary-terms", "debriefs"] as const) {
      const left = await payload.count({
        collection,
        where: { project: { equals: id } },
        overrideAccess: true,
      });
      expect(left.totalDocs, `осталось в ${collection}`).toBe(0);
    }
  });
});
