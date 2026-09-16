import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Правка глоссария и запасные эквиваленты.
 *
 * Проверяются два обещания, данные человеку в интерфейсе, и оба про доверие.
 *
 * Первое: пометка «не подтверждён» в выгрузке отличает выверенное от
 * угаданного моделью — и она обязана слетать ровно тогда, когда человек
 * написал перевод своей рукой. Оставить её на своём же переводе — врать
 * в ту сторону, где цена ошибки высокая.
 *
 * Второе: выбор эквивалента обратимый. Сегодня в суде говорят так, на той
 * же неделе у заказчика иначе; прежний перевод не должен пропадать.
 */

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: sessionToken }) }),
  headers: async () => new Headers(),
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    const error = new Error(`REDIRECT:${to}`);
    (error as Error & { digest?: string }).digest = `NEXT_REDIRECT;${to}`;
    throw error;
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { payloadClient } = await import("@/lib/payload");
const { issueToken } = await import("@/lib/session");
const { toTermRow, authorLabel, statusAfterEdit } = await import("@/lib/glossary");
const actions = await import("@/app/(frontend)/projects/[id]/glossary/actions");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let payload: Awaited<ReturnType<typeof payloadClient>>;
let sessionToken = "";
let owner: number;
let outsider: number;
let projectId: number;
let otherProjectId: number;

const form = (entries: Record<string, string | number>): FormData => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, String(value));
  return data;
};

const run = async (fn: (d: FormData) => Promise<void>, data: FormData): Promise<string> => {
  try {
    await fn(data);
  } catch (error) {
    const message = (error as Error).message;
    if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
    throw error;
  }
  throw new Error("действие завершилось без редиректа");
};

const makeTerm = async (over: Record<string, unknown> = {}) =>
  (
    await payload.create({
      collection: "glossary-terms",
      data: {
        project: projectId,
        sourceTerm: `term-${Math.random().toString(36).slice(2, 7)}`,
        targetTerm: "исходный перевод",
        status: "suggested",
        ...over,
      },
      overrideAccess: true,
    })
  ).id as number;

const read = async (id: number) =>
  toTermRow(
    await payload.findByID({
      collection: "glossary-terms",
      id,
      depth: 1,
      overrideAccess: true,
    }),
  );

beforeAll(async () => {
  payload = await payloadClient();
  const makeUser = async (tag: string, name: string) =>
    (
      await payload.create({
        collection: "users",
        data: { email: `gl-${tag}-${stamp}@example.test`, displayName: name, role: "interpreter" },
        overrideAccess: true,
      })
    ).id as number;

  owner = await makeUser("owner", "Хозяйка проекта");
  outsider = await makeUser("outsider", "Посторонний");

  const makeProject = async (ownerId: number, title: string) =>
    (
      await payload.create({
        collection: "projects",
        data: {
          title,
          owner: ownerId,
          sourceLang: "en",
          targetLang: "ru",
          stylePreset: "un",
          status: "draft",
        },
        overrideAccess: true,
      })
    ).id as number;

  projectId = await makeProject(owner, `Глоссарий ${stamp}`);
  otherProjectId = await makeProject(outsider, `Чужой ${stamp}`);
});

beforeEach(async () => {
  await payload.delete({
    collection: "glossary-terms",
    where: { project: { equals: projectId } },
    overrideAccess: true,
  });
  sessionToken = issueToken(owner).token;
});

afterAll(async () => {
  for (const id of [projectId, otherProjectId]) {
    await payload.delete({ collection: "projects", id, overrideAccess: true }).catch(() => {});
  }
  for (const id of [owner, outsider]) {
    await payload.delete({ collection: "users", id, overrideAccess: true }).catch(() => {});
  }
});

describe("пометка «не подтверждён»", () => {
  it("слетает, когда человек переписал эквивалент", async () => {
    const id = await makeTerm();
    await run(actions.saveTerm, form({ projectId, termId: id, source: "term", target: "мой перевод" }));

    const row = await read(id);
    expect(row.status).toBe("verified");
    expect(row.verifiedByName).toBe("Хозяйка проекта");
  });

  it("остаётся, если правили только заметку", async () => {
    // Заметка не про эквивалент: она о контексте. Снимать по ней пометку
    // значило бы объявить выверенным то, что никто не сверял.
    const id = await makeTerm();
    await run(
      actions.saveTerm,
      form({ projectId, termId: id, source: "term", target: "исходный перевод", note: "в суде" }),
    );

    const row = await read(id);
    expect(row.status).toBe("suggested");
    expect(row.note).toBe("в суде");
  });

  it("снимается отдельным подтверждением, когда перевод модели верен", async () => {
    const id = await makeTerm();
    await run(actions.confirmTerm, form({ projectId, termId: id }));

    const row = await read(id);
    expect(row.status).toBe("verified");
    expect(row.target).toBe("исходный перевод");
  });

  it("у термина, заведённого руками, её нет с самого начала", async () => {
    await run(actions.addTerm, form({ projectId, source: "свой термин", target: "свой перевод" }));

    const found = await payload.find({
      collection: "glossary-terms",
      where: { and: [{ project: { equals: projectId } }, { sourceTerm: { equals: "свой термин" } }] },
      depth: 1,
      overrideAccess: true,
    });
    expect(toTermRow(found.docs[0]).status).toBe("verified");
  });

  it("правило проверяется и в чистом виде", () => {
    expect(statusAfterEdit("suggested", "было", "стало")).toBe("verified");
    expect(statusAfterEdit("suggested", "было", "было")).toBe("suggested");
    // Стёртый эквивалент — не подтверждение, а пустое место.
    expect(statusAfterEdit("suggested", "было", null)).toBe("suggested");
    // Уже подтверждённое правкой не понижается и не повышается заново.
    expect(statusAfterEdit("verified", "было", "стало")).toBe("verified");
    expect(statusAfterEdit("from-practice", "было", "стало")).toBe("from-practice");
  });
});

describe("запасные эквиваленты", () => {
  it("добавляются с автором", async () => {
    const id = await makeTerm();
    await run(
      actions.addVariant,
      form({ projectId, termId: id, text: "иной перевод", note: "у этого заказчика" }),
    );

    const row = await read(id);
    expect(row.variants).toHaveLength(1);
    expect(row.variants[0].text).toBe("иной перевод");
    expect(row.variants[0].proposedById).toBe(owner);
    expect(authorLabel(row.variants[0], owner)).toBe("вы");
    expect(authorLabel(row.variants[0], outsider)).toBe("Хозяйка проекта");
  });

  it("вариант становится основным, а прежний перевод не пропадает", async () => {
    // Смысл всей затеи: выбор обратим. Сегодня в суде говорят так, на той же
    // неделе у заказчика иначе — и вернуться надо, не вспоминая по памяти.
    const id = await makeTerm();
    await run(actions.addVariant, form({ projectId, termId: id, text: "иной перевод" }));

    const before = await read(id);
    await run(
      actions.promoteVariant,
      form({ projectId, termId: id, variantId: before.variants[0].id }),
    );

    const after = await read(id);
    expect(after.target).toBe("иной перевод");
    expect(after.variants.map((v) => v.text)).toEqual(["исходный перевод"]);
    expect(after.status).toBe("verified");
  });

  it("прежний перевод модели возвращается как вариант модели", async () => {
    // Авторство не выдумывается: перевод был предложен моделью, вариантом
    // он остаётся её же. Иначе человеку приписали бы чужое предложение.
    const id = await makeTerm();
    await run(actions.addVariant, form({ projectId, termId: id, text: "иной перевод" }));
    const before = await read(id);
    await run(actions.promoteVariant, form({ projectId, termId: id, variantId: before.variants[0].id }));

    const after = await read(id);
    expect(after.variants[0].proposedById).toBeNull();
    expect(authorLabel(after.variants[0], owner)).toBe("модель");
  });

  it("убираются по одному", async () => {
    const id = await makeTerm();
    await run(actions.addVariant, form({ projectId, termId: id, text: "первый" }));
    await run(actions.addVariant, form({ projectId, termId: id, text: "второй" }));

    const before = await read(id);
    expect(before.variants).toHaveLength(2);

    await run(actions.removeVariant, form({ projectId, termId: id, variantId: before.variants[0].id }));
    const after = await read(id);
    expect(after.variants.map((v) => v.text)).toEqual(["второй"]);
  });

  it("уходят вместе с термином", async () => {
    const id = await makeTerm();
    await run(actions.addVariant, form({ projectId, termId: id, text: "иной перевод" }));
    await run(actions.deleteTerm, form({ projectId, termId: id }));

    const left = await payload.count({
      collection: "glossary-terms",
      where: { project: { equals: projectId } },
      overrideAccess: true,
    });
    expect(left.totalDocs).toBe(0);
  });
});

describe("границы", () => {
  it("посторонний не правит чужой глоссарий", async () => {
    const id = await makeTerm();
    sessionToken = issueToken(outsider).token;

    expect(await run(actions.saveTerm, form({ projectId, termId: id, source: "x", target: "взлом" }))).toBe(
      "/projects",
    );
    expect((await read(id)).target).toBe("исходный перевод");
  });

  it("термин чужого проекта не правится через свой", async () => {
    // Идентификаторы последовательные: подставить чужой — первое, что придёт
    // в голову. Ответ тот же, что у несуществующего термина.
    const foreign = (
      await payload.create({
        collection: "glossary-terms",
        data: { project: otherProjectId, sourceTerm: "чужой", targetTerm: "чужой перевод", status: "verified" },
        overrideAccess: true,
      })
    ).id as number;

    const to = await run(
      actions.saveTerm,
      form({ projectId, termId: foreign, source: "чужой", target: "взлом" }),
    );
    expect(to).toBe(`/projects/${projectId}/glossary`);

    const untouched = await read(foreign);
    expect(untouched.target).toBe("чужой перевод");

    await payload.delete({ collection: "glossary-terms", id: foreign, overrideAccess: true });
  });
});
