import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Оценка сгенерированного материала.
 *
 * Главное здесь — не «оценка сохранилась», а к ЧЕМУ она привязана.
 * Оценивается вывод генерации: перегенерировали — это другой материал,
 * и прежняя оценка не должна к нему переезжать. Иначе «годится как есть»
 * оказывалось бы на файле, которого оценивавший не слышал.
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
const { saveRating } = await import("@/app/(frontend)/projects/[id]/rate-actions");
const { ratingFor, toRatingRow } = await import("@/lib/ratings");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let payload: Awaited<ReturnType<typeof payloadClient>>;
let sessionToken = "";
let owner: number;
let outsider: number;
let projectId: number;
let generationA: number;
let generationB: number;

const form = (entries: Record<string, string | number | null>): FormData => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    if (value !== null) data.append(key, String(value));
  }
  return data;
};

const run = async (data: FormData): Promise<string> => {
  try {
    await saveRating(data);
  } catch (error) {
    const message = (error as Error).message;
    if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
    throw error;
  }
  throw new Error("действие завершилось без редиректа");
};

const ratings = async () =>
  (
    await payload.find({
      collection: "ratings",
      where: { project: { equals: projectId } },
      depth: 0,
      limit: 50,
      overrideAccess: true,
    })
  ).docs.map(toRatingRow);

beforeAll(async () => {
  payload = await payloadClient();
  const makeUser = async (tag: string) =>
    (
      await payload.create({
        collection: "users",
        data: { email: `rt-${tag}-${stamp}@example.test`, role: "interpreter" },
        overrideAccess: true,
      })
    ).id as number;

  owner = await makeUser("owner");
  outsider = await makeUser("outsider");

  projectId = (
    await payload.create({
      collection: "projects",
      data: {
        title: `Оценки ${stamp}`,
        owner,
        sourceLang: "en",
        targetLang: "ru",
        stylePreset: "un",
        status: "draft",
      },
      overrideAccess: true,
    })
  ).id as number;

  const makeGeneration = async () =>
    (
      await payload.create({
        collection: "generations",
        data: { project: projectId, kind: "audio", status: "done" },
        overrideAccess: true,
      })
    ).id as number;

  generationA = await makeGeneration();
  generationB = await makeGeneration();
});

beforeEach(async () => {
  // Чистим и шаги воронки: они копятся между проверками, и счётчик
  // в последнем тесте иначе считает чужие.
  for (const collection of ["ratings", "activity"] as const) {
    await payload.delete({
      collection,
      where: { project: { equals: projectId } },
      overrideAccess: true,
    });
  }
  sessionToken = issueToken(owner).token;
});

afterAll(async () => {
  await payload.delete({ collection: "projects", id: projectId, overrideAccess: true }).catch(() => {});
  for (const id of [owner, outsider]) {
    await payload.delete({ collection: "users", id, overrideAccess: true }).catch(() => {});
  }
});

describe("сохранение", () => {
  it("оценка с заметкой записывается", async () => {
    const to = await run(
      form({ projectId, target: "audio", score: 2, generationId: generationA, note: "  Цифры слитно.  " }),
    );
    expect(to).toContain("rated=audio");

    const rows = await ratings();
    expect(rows).toHaveLength(1);
    expect(rows[0].score).toBe(2);
    expect(rows[0].note).toBe("Цифры слитно.");
    expect(rows[0].generationId).toBe(generationA);
  });

  it("повторная оценка того же вывода переписывает, а не плодит вторую", async () => {
    await run(form({ projectId, target: "audio", score: 1, generationId: generationA }));
    await run(form({ projectId, target: "audio", score: 3, generationId: generationA, note: "Переслушал." }));

    const rows = await ratings();
    // Человек передумал — это по-прежнему одно мнение об одном файле,
    // и в отчёте оно должно считаться один раз.
    expect(rows).toHaveLength(1);
    expect(rows[0].score).toBe(3);
    expect(rows[0].note).toBe("Переслушал.");
  });

  it("оценки разного материала не смешиваются", async () => {
    await run(form({ projectId, target: "audio", score: 1, generationId: generationA }));
    await run(form({ projectId, target: "glossary", score: 3, generationId: generationA }));

    const rows = await ratings();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.target).sort()).toEqual(["audio", "glossary"]);
  });
});

describe("оценивается вывод, а не проект", () => {
  it("после перегенерации прежняя оценка к новому файлу не относится", async () => {
    await run(form({ projectId, target: "audio", score: 3, generationId: generationA }));
    const rows = await ratings();

    // Это и есть смысл привязки к генерации: у нового вывода оценки нет,
    // и форма обязана спросить заново.
    expect(ratingFor(rows, "audio", generationA)?.score).toBe(3);
    expect(ratingFor(rows, "audio", generationB)).toBeNull();
  });

  it("оценка нового вывода не затирает прежнюю", async () => {
    await run(form({ projectId, target: "audio", score: 3, generationId: generationA }));
    await run(form({ projectId, target: "audio", score: 1, generationId: generationB }));

    const rows = await ratings();
    expect(rows).toHaveLength(2);
    expect(ratingFor(rows, "audio", generationA)?.score).toBe(3);
    expect(ratingFor(rows, "audio", generationB)?.score).toBe(1);
  });
});

describe("чего принимать нельзя", () => {
  it("посторонний не может оценить чужой проект", async () => {
    sessionToken = issueToken(outsider).token;
    expect(await run(form({ projectId, target: "audio", score: 3, generationId: generationA }))).toBe(
      "/projects",
    );
    expect(await ratings()).toHaveLength(0);
  });

  it("выдуманный вид материала отклоняется", async () => {
    // Значения из формы — данные, а не команды: без проверки в базу
    // приехало бы что угодно, что уместилось в поле.
    await run(form({ projectId, target: "всё сразу", score: 3, generationId: generationA }));
    expect(await ratings()).toHaveLength(0);
  });

  it("оценка вне шкалы отклоняется", async () => {
    await run(form({ projectId, target: "audio", score: 5, generationId: generationA }));
    await run(form({ projectId, target: "audio", score: 0, generationId: generationA }));
    expect(await ratings()).toHaveLength(0);
  });
});

describe("след в воронке", () => {
  it("первая оценка — шаг, исправление — нет", async () => {
    const count = async () =>
      (
        await payload.count({
          collection: "activity",
          where: { and: [{ project: { equals: projectId } }, { step: { equals: "rating_given" } }] },
          overrideAccess: true,
        })
      ).totalDocs;

    await run(form({ projectId, target: "audio", score: 2, generationId: generationA }));
    expect(await count()).toBe(1);

    // Исправленная опечатка в заметке — не новое событие.
    await run(form({ projectId, target: "audio", score: 2, generationId: generationA, note: "Уточнил." }));
    expect(await count()).toBe(1);
  });
});
