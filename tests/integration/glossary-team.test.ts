import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Команда проекта правит глоссарий (K1–K5).
 *
 * Это перенос в R3 совместного доступа, заложенного на R4, и проверять
 * здесь надо обе стороны сразу: что коллега действительно может править —
 * ради этого релиз и затевался, — и что посторонний по-прежнему не может
 * ничего. Вторая половина важнее: открыть доступ легко, открыть его
 * ровно тем, кому надо, — нет.
 */

const { payloadClient } = await import("@/lib/payload");
const { getProject } = await import("@/lib/projects");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let payload: Awaited<ReturnType<typeof payloadClient>>;
let ownerId: number;
let mateId: number;
let strangerId: number;
let projectId: number;
let termId: number;

const asUser = (id: number) => ({ id, collection: "users", role: "interpreter" }) as never;

beforeAll(async () => {
  payload = await payloadClient();

  const make = async (prefix: string) =>
    (
      await payload.create({
        collection: "users",
        data: { email: `${prefix}-${stamp}@example.test`, displayName: prefix, role: "interpreter" },
        overrideAccess: true,
      })
    ).id as number;

  ownerId = await make("owner");
  mateId = await make("mate");
  strangerId = await make("stranger");

  projectId = (
    await payload.create({
      collection: "projects",
      data: {
        title: `Кабина ${stamp}`,
        owner: ownerId,
        sourceLang: "en",
        targetLang: "ru",
        stylePreset: "un",
        status: "draft",
        team: [
          { name: "Связанный коллега", user: mateId, booth: "кабина 2" },
          // Названный текстом: в составе числится, а править ему нечем —
          // учётной записи у него нет.
          { name: "Названный текстом", email: `ghost-${stamp}@example.test` },
        ],
      },
      overrideAccess: true,
    })
  ).id as number;

  termId = (
    await payload.create({
      collection: "glossary-terms",
      data: {
        project: projectId,
        scope: "project",
        sourceTerm: "framework agreement",
        targetTerm: "рамочное соглашение",
        status: "suggested",
      },
      overrideAccess: true,
    })
  ).id as number;
});

afterAll(async () => {
  await payload.delete({ collection: "projects", id: projectId, overrideAccess: true }).catch(() => {});
  for (const id of [ownerId, mateId, strangerId]) {
    await payload.delete({ collection: "users", id, overrideAccess: true }).catch(() => {});
  }
});

describe("коллега из состава", () => {
  it("видит проект", async () => {
    const detail = await getProject(projectId, mateId);
    expect(detail).not.toBeNull();
    // Но владельцем не становится: генерации и удаление — не его.
    expect(detail?.isOwner).toBe(false);
  });

  it("видит и правит глоссарий", async () => {
    const visible = await payload.find({
      collection: "glossary-terms",
      where: { project: { equals: projectId } },
      user: asUser(mateId),
      overrideAccess: false,
    });
    expect(visible.docs).toHaveLength(1);

    await payload.update({
      collection: "glossary-terms",
      id: termId,
      data: { targetTerm: "базовый договор" },
      user: asUser(mateId),
      overrideAccess: false,
    });

    const after = await payload.findByID({
      collection: "glossary-terms",
      id: termId,
      depth: 0,
      overrideAccess: true,
    });
    expect(after.targetTerm).toBe("базовый договор");
  });

  it("но проект не удаляет: его позвали выверять термины", async () => {
    await expect(
      payload.delete({
        collection: "projects",
        id: projectId,
        user: asUser(mateId),
        overrideAccess: false,
      }),
    ).rejects.toThrow();
  });
});

describe("посторонний", () => {
  it("проекта не видит", async () => {
    expect(await getProject(projectId, strangerId)).toBeNull();
  });

  it("глоссария не видит и не правит", async () => {
    const visible = await payload.find({
      collection: "glossary-terms",
      where: { project: { equals: projectId } },
      user: asUser(strangerId),
      overrideAccess: false,
    });
    expect(visible.docs).toHaveLength(0);

    await expect(
      payload.update({
        collection: "glossary-terms",
        id: termId,
        data: { targetTerm: "подменён" },
        user: asUser(strangerId),
        overrideAccess: false,
      }),
    ).rejects.toThrow();
  });
});

describe("личный слой команде не открывается (K4)", () => {
  it("личный словарь владельца коллеге не виден", async () => {
    const personal = await payload.create({
      collection: "glossary-terms",
      data: {
        scope: "personal",
        owner: ownerId,
        sourceTerm: `память ${stamp}`,
        targetTerm: "моё",
        status: "verified",
      },
      overrideAccess: true,
    });

    const visible = await payload.find({
      collection: "glossary-terms",
      where: { id: { equals: personal.id } },
      user: asUser(mateId),
      overrideAccess: false,
    });

    // В проект из личного слоя приходят КОПИИ, а не ссылки: команда видит
    // подставленный термин в проекте, но не саму память.
    expect(visible.docs).toHaveLength(0);

    await payload.delete({ collection: "glossary-terms", id: personal.id, overrideAccess: true });
  });
});
