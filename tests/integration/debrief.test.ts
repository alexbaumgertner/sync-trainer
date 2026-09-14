import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Разбор после события (E1–E3).
 *
 * Приёмка задачи — «отметки сохраняются в occurred_at_event и видны при
 * следующем открытии», поэтому проверяется не форма, а что уцелело в базе
 * после сохранения и что увидит человек, вернувшись.
 */

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: sessionToken }) }),
  headers: async () => new Headers(),
}));

// Серверное действие заканчивается redirect — в тесте это выброс, а не отказ.
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
const { parseMissingTerms } = await import("@/lib/debrief");
const { saveDebrief } = await import("@/app/(frontend)/projects/[id]/debrief/actions");
const { getProject } = await import("@/lib/projects");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let sessionToken = "";
let owner: number;
let stranger: number;
let projectId: number;
let otherProject: number;
let payload: Awaited<ReturnType<typeof payloadClient>>;

const form = (entries: Record<string, string | string[]>): FormData => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  }
  return data;
};

/** Действие всегда заканчивается редиректом; возвращаем его адрес. */
const save = async (data: FormData): Promise<string> => {
  try {
    await saveDebrief(data);
  } catch (error) {
    const message = (error as Error).message;
    if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
    throw error;
  }
  throw new Error("действие завершилось без редиректа");
};

const termsOf = async (project: number) =>
  (
    await payload.find({
      collection: "glossary-terms",
      where: { project: { equals: project } },
      limit: 100,
      depth: 0,
      overrideAccess: true,
    })
  ).docs;

beforeAll(async () => {
  payload = await payloadClient();

  const makeUser = async (tag: string) =>
    (
      await payload.create({
        collection: "users",
        data: { email: `db-${tag}-${stamp}@example.test`, password: `pw-${stamp}`, role: "interpreter" },
        overrideAccess: true,
      })
    ).id;

  owner = await makeUser("owner");
  stranger = await makeUser("stranger");
  sessionToken = issueToken(owner).token;

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
          status: "ready",
        },
        overrideAccess: true,
      })
    ).id;

  projectId = await makeProject(owner, `Разбор ${stamp}`);
  otherProject = await makeProject(stranger, `Чужой ${stamp}`);
});

beforeEach(async () => {
  for (const collection of ["debriefs", "glossary-terms"] as const) {
    await payload.delete({
      collection,
      where: { project: { equals: projectId } },
      overrideAccess: true,
    });
  }
  for (const term of ["headroom", "graduation", "basis points"]) {
    await payload.create({
      collection: "glossary-terms",
      data: { project: projectId, sourceTerm: term, targetTerm: "перевод", status: "suggested" },
      overrideAccess: true,
    });
  }
});

afterAll(async () => {
  for (const id of [projectId, otherProject]) {
    await payload.delete({ collection: "projects", id, overrideAccess: true }).catch(() => {});
  }
  for (const id of [owner, stranger]) {
    await payload.delete({ collection: "users", id, overrideAccess: true }).catch(() => {});
  }
});

describe("E1 · отметка «прозвучало на событии»", () => {
  it("сохраняется и видна при следующем открытии — это приёмка задачи", async () => {
    const before = await termsOf(projectId);
    const marked = before.slice(0, 2).map((term) => String(term.id));

    await save(form({ projectId: String(projectId), occurred: marked }));

    // «Следующее открытие»: перечитываем из базы, а не из памяти.
    const after = await termsOf(projectId);
    const occurred = after.filter((term) => term.occurredAtEvent).map((term) => term.id);
    expect(occurred.sort()).toEqual(marked.map(Number).sort());
  });

  it("снятая отметка гаснет — форма присылает только отмеченные", async () => {
    const terms = await termsOf(projectId);
    await save(form({ projectId: String(projectId), occurred: terms.map((t) => String(t.id)) }));
    expect((await termsOf(projectId)).every((t) => t.occurredAtEvent)).toBe(true);

    // Второй разбор без единой отметки: без явного гашения они бы остались.
    await save(form({ projectId: String(projectId) }));
    expect((await termsOf(projectId)).some((t) => t.occurredAtEvent)).toBe(false);
  });
});

describe("E2 · недостающие термины", () => {
  it("попадают в глоссарий со статусом «из практики»", async () => {
    await save(
      form({
        projectId: String(projectId),
        missingTerms: "rechannelling — перенаправление\ncallable capital",
      }),
    );

    const added = (await termsOf(projectId)).filter((t) => t.status === "from-practice");
    expect(added).toHaveLength(2);

    const rechannelling = added.find((t) => t.sourceTerm === "rechannelling");
    expect(rechannelling?.targetTerm).toBe("перенаправление");
    // Записаны после события — значит на нём и прозвучали.
    expect(rechannelling?.occurredAtEvent).toBe(true);
    expect(added.find((t) => t.sourceTerm === "callable capital")?.targetTerm).toBeFalsy();
  });

  it("уже известный термин не задваивается", async () => {
    await save(form({ projectId: String(projectId), missingTerms: "headroom — запас" }));

    const headroom = (await termsOf(projectId)).filter((t) => t.sourceTerm === "headroom");
    expect(headroom).toHaveLength(1);
    // И остался прежним: разбор не переписывает то, что уже выверено.
    expect(headroom[0].status).toBe("suggested");
  });

  it("повторное сохранение не плодит копии", async () => {
    const data = { projectId: String(projectId), missingTerms: "relay — эстафета" };
    await save(form(data));
    await save(form(data));

    expect((await termsOf(projectId)).filter((t) => t.sourceTerm === "relay")).toHaveLength(1);
  });
});

describe("E3 · короткие вопросы", () => {
  it("ответы сохраняются и читаются обратно", async () => {
    await save(
      form({
        projectId: String(projectId),
        heldOn: "2026-10-15",
        actualPace: "much-faster",
        hardest: "плотные цифры в третьей панели",
        surprises: "добавили незаявленного спикера",
      }),
    );

    const debrief = (
      await payload.find({
        collection: "debriefs",
        where: { project: { equals: projectId } },
        limit: 1,
        overrideAccess: true,
      })
    ).docs[0];

    expect(debrief.actualPace).toBe("much-faster");
    expect(debrief.hardest).toContain("цифры");
    expect(debrief.surprises).toContain("спикера");
    expect(debrief.heldOn?.slice(0, 10)).toBe("2026-10-15");
  });

  it("разбор у события один: второе сохранение правит, а не добавляет", async () => {
    await save(form({ projectId: String(projectId), hardest: "первая версия" }));
    await save(form({ projectId: String(projectId), hardest: "вторая версия" }));

    const found = await payload.find({
      collection: "debriefs",
      where: { project: { equals: projectId } },
      overrideAccess: true,
    });
    expect(found.totalDocs).toBe(1);
    expect(found.docs[0].hardest).toBe("вторая версия");
  });

  it("негодный темп не записывается, а не валит сохранение", async () => {
    await save(form({ projectId: String(projectId), actualPace: "мгновенно" }));

    const debrief = (
      await payload.find({
        collection: "debriefs",
        where: { project: { equals: projectId } },
        overrideAccess: true,
      })
    ).docs[0];
    expect(debrief.actualPace).toBeFalsy();
  });

  it("проект переходит в «событие прошло», и это видно на карточке", async () => {
    await save(form({ projectId: String(projectId), hardest: "темп" }));

    const detail = await getProject(projectId, owner);
    expect(detail?.project.status).toBe("held");
    expect(detail?.hasDebrief).toBe(true);
  });
});

describe("чужой проект", () => {
  it("разбор не создаётся и термины не трогаются", async () => {
    await payload.create({
      collection: "glossary-terms",
      data: { project: otherProject, sourceTerm: "чужой термин", status: "suggested" },
      overrideAccess: true,
    });

    const to = await save(
      form({
        projectId: String(otherProject),
        hardest: "попытка чужими руками",
        missingTerms: "подсадной — термин",
        occurred: "1",
      }),
    );
    expect(to).toBe("/projects");

    const debriefs = await payload.count({
      collection: "debriefs",
      where: { project: { equals: otherProject } },
      overrideAccess: true,
    });
    expect(debriefs.totalDocs).toBe(0);
    expect(await termsOf(otherProject)).toHaveLength(1);
  });
});

describe("разбор строк с терминами", () => {
  it("понимает привычные разделители", () => {
    expect(
      parseMissingTerms(
        [
          "headroom — запас капитала",
          "graduation – утрата права",
          "relay - эстафета",
          "pivot: язык-посредник",
          "décalage",
          "- callable capital — отзывной капитал",
        ].join("\n"),
      ),
    ).toEqual([
      { source: "headroom", target: "запас капитала" },
      { source: "graduation", target: "утрата права" },
      { source: "relay", target: "эстафета" },
      { source: "pivot", target: "язык-посредник" },
      { source: "décalage", target: null },
      { source: "callable capital", target: "отзывной капитал" },
    ]);
  });

  it("не разрывает термин с дефисом внутри", () => {
    // «middle-income» — один термин, а не «middle» с переводом «income».
    expect(parseMissingTerms("middle-income countries")).toEqual([
      { source: "middle-income countries", target: null },
    ]);
  });

  it("пустые строки и повторы отбрасываются", () => {
    expect(parseMissingTerms("\n  \nheadroom\nHEADROOM — запас\n\n")).toEqual([
      { source: "headroom", target: null },
    ]);
  });
});
