import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addNewTerms } from "@/lib/glossary-store";

/**
 * Модель только добавляет (N6–N7).
 *
 * Этот тест появился после того, как сквозной прогон всего порядка работы
 * прошёл со СНЯТЫМ заслоном: модель в тот раз просто не повторила термин,
 * и проверка ничего не заметила. Тест, который не падает от поломки, хуже
 * отсутствующего — он даёт ложную уверенность.
 *
 * Поэтому здесь кандидаты задаются руками, и среди них намеренно есть тот,
 * что уже лежит в глоссарии, — с другим переводом.
 */

const { payloadClient } = await import("@/lib/payload");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let payload: Awaited<ReturnType<typeof payloadClient>>;
let userId: number;
let projectId: number;

beforeAll(async () => {
  payload = await payloadClient();
  userId = (
    await payload.create({
      collection: "users",
      data: { email: `store-${stamp}@example.test`, role: "interpreter" },
      overrideAccess: true,
    })
  ).id as number;
  projectId = (
    await payload.create({
      collection: "projects",
      data: {
        title: `Склад ${stamp}`,
        owner: userId,
        sourceLang: "en",
        targetLang: "ru",
        stylePreset: "un",
        status: "draft",
      },
      overrideAccess: true,
    })
  ).id as number;
});

afterAll(async () => {
  await payload.delete({ collection: "projects", id: projectId, overrideAccess: true }).catch(() => {});
  await payload.delete({ collection: "users", id: userId, overrideAccess: true }).catch(() => {});
});

const termsOf = async (source: string) =>
  (
    await payload.find({
      collection: "glossary-terms",
      where: { and: [{ project: { equals: projectId } }, { sourceTerm: { equals: source } }] },
      limit: 10,
      depth: 0,
      overrideAccess: true,
    })
  ).docs;

describe("выверенное не трогают", () => {
  it("повтор известного термина не заводит второй записи и не меняет перевод", async () => {
    const existing = await payload.create({
      collection: "glossary-terms",
      data: {
        scope: "project",
        project: projectId,
        sourceTerm: "framework agreement",
        targetTerm: "рамочное соглашение",
        status: "verified",
      },
      overrideAccess: true,
    });

    const report = await addNewTerms(
      payload,
      projectId,
      [{ source: "framework agreement", target: "базовый договор" }],
      ["framework agreement"],
    );

    expect(report.added).toBe(0);
    expect(report.skipped).toBe(1);

    const after = await termsOf("framework agreement");
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(existing.id);
    expect(after[0].targetTerm).toBe("рамочное соглашение");
    expect(after[0].status).toBe("verified");
  });

  it("регистр и пробелы не делают термин новым", async () => {
    // Иначе «Civic Space» и «civic space» разъехались бы в две записи,
    // и в кабине это читается как ошибка выверки.
    await payload.create({
      collection: "glossary-terms",
      data: {
        scope: "project",
        project: projectId,
        sourceTerm: "civic space",
        targetTerm: "гражданское пространство",
        status: "verified",
      },
      overrideAccess: true,
    });

    const report = await addNewTerms(
      payload,
      projectId,
      [{ source: "  Civic Space  ", target: "что-то другое" }],
      ["civic space"],
    );

    expect(report.added).toBe(0);
    expect(await termsOf("  Civic Space  ")).toHaveLength(0);
  });
});

describe("новое добавляется", () => {
  it("незнакомый термин заводится со статусом «предложен моделью»", async () => {
    const report = await addNewTerms(
      payload,
      projectId,
      [{ source: "blended finance", target: "смешанное финансирование", note: "МБР" }],
      [],
    );

    expect(report.added).toBe(1);
    const [added] = await termsOf("blended finance");
    expect(added.targetTerm).toBe("смешанное финансирование");
    expect(added.note).toBe("МБР");
    // Догадка модели обязана быть помечена: в кабине она выглядит так же
    // уверенно, как выверенное, а верить ей нельзя.
    expect(added.status).toBe("suggested");
  });

  it("повтор внутри одной пачки заводится один раз", async () => {
    const report = await addNewTerms(
      payload,
      projectId,
      [
        { source: "adaptation gap", target: "разрыв в адаптации" },
        { source: "adaptation gap", target: "адаптационный разрыв" },
      ],
      [],
    );

    expect(report.added).toBe(1);
    expect(await termsOf("adaptation gap")).toHaveLength(1);
  });
});
