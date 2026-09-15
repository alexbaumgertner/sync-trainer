import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Записи о проведённой работе (W1–W2, W4–W5).
 *
 * Проверяется не форма, а обещания: запись живёт без проекта, переживает
 * удаление проекта, чужую не тронуть, и спикеры остаются текстом — их
 * согласия у нас нет.
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
const { createEngagement, updateEngagement, deleteEngagement } = await import(
  "@/app/(frontend)/experience/actions"
);
const { toRow, yearOf, WENT_LABELS } = await import("@/lib/engagements");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let payload: Awaited<ReturnType<typeof payloadClient>>;
let sessionToken = "";
let owner: number;
let stranger: number;

const form = (entries: Record<string, string | string[]>): FormData => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  }
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

const base = {
  title: `Форум ${stamp}`,
  organizer: "МОТ",
  heldOn: "2026-05-14",
  location: "Женева",
  mode: "rsi",
  sourceLang: "en",
  targetLang: "ru",
  wentHow: "4",
  wentText: "Регламент сдвинули на час.",
};

const idFrom = (to: string): number => Number(to.match(/\/experience\/(\d+)/)?.[1]);

const load = (id: number) =>
  payload.findByID({ collection: "engagements", id, depth: 0, overrideAccess: true });

beforeAll(async () => {
  payload = await payloadClient();
  const makeUser = async (tag: string) =>
    (
      await payload.create({
        collection: "users",
        data: { email: `eng-${tag}-${stamp}@example.test`, role: "interpreter" },
        overrideAccess: true,
      })
    ).id;
  owner = await makeUser("owner");
  stranger = await makeUser("stranger");
});

beforeEach(async () => {
  sessionToken = issueToken(owner).token;
  await payload.delete({
    collection: "engagements",
    where: { owner: { in: [owner, stranger] } },
    overrideAccess: true,
  });
});

afterAll(async () => {
  await payload
    .delete({ collection: "engagements", where: { owner: { in: [owner, stranger] } }, overrideAccess: true })
    .catch(() => {});
  for (const id of [owner, stranger]) {
    await payload.delete({ collection: "users", id, overrideAccess: true }).catch(() => {});
  }
});

describe("создание записи", () => {
  it("сохраняет всё, что просили в поле: событие, заказчик, дата, место, режим, языки", async () => {
    const id = idFrom(await run(createEngagement, form(base)));
    const row = toRow(await load(id));

    expect(row.title).toBe(base.title);
    expect(row.organizer).toBe("МОТ");
    expect(row.location).toBe("Женева");
    expect(row.mode).toBe("rsi");
    expect(row.sourceLang).toBe("en");
    expect(row.targetLang).toBe("ru");
    expect(row.wentHow).toBe(4);
    expect(row.wentText).toContain("Регламент");
    expect(yearOf(row.heldOn)).toBe(2026);
  });

  it("заводится без проекта — это норма, а не недоделка", async () => {
    // У переводчика годы конференций до тренажёра. Требуй проект — и профиль
    // в первый день пуст, заполнять его незачем.
    const id = idFrom(await run(createEngagement, form(base)));
    expect(toRow(await load(id)).projectId).toBeNull();
  });

  it("без названия и без даты не сохраняется", async () => {
    expect(await run(createEngagement, form({ ...base, title: "  " }))).toContain("error=title");
    expect(await run(createEngagement, form({ ...base, heldOn: "" }))).toContain("error=date");

    const all = await payload.count({
      collection: "engagements",
      where: { owner: { equals: owner } },
      overrideAccess: true,
    });
    expect(all.totalDocs).toBe(0);
  });

  it("негодный режим и незнакомый язык подменяются, а не валят сохранение", async () => {
    const id = idFrom(
      await run(
        createEngagement,
        form({ ...base, mode: "телепатия", sourceLang: "klingon", wentHow: "17" }),
      ),
    );
    const row = toRow(await load(id));

    expect(row.mode).toBe("simultaneous");
    expect(row.sourceLang).toBe("en");
    // Оценка вне шкалы — не оценка.
    expect(row.wentHow).toBeNull();
  });

  it("по умолчанию запись видна команде, но можно закрыть", async () => {
    const open = idFrom(await run(createEngagement, form(base)));
    expect(toRow(await load(open)).visibility).toBe("team");

    const closed = idFrom(await run(createEngagement, form({ ...base, visibility: "private" })));
    expect(toRow(await load(closed)).visibility).toBe("private");
  });
});

describe("спикеры", () => {
  it("сохраняются именем и организацией, повторы отбрасываются", async () => {
    const id = idFrom(
      await run(
        createEngagement,
        form({
          ...base,
          speakerName: ["Анна Шмидт", "  ", "Пётр Ли", "анна шмидт"],
          speakerOrg: ["ВОЗ", "", "ЮНИСЕФ", "другая"],
        }),
      ),
    );

    const speakers = toRow(await load(id)).speakers;
    expect(speakers).toHaveLength(2);
    expect(speakers[0]).toEqual({ name: "Анна Шмидт", organization: "ВОЗ" });
    expect(speakers[1]).toEqual({ name: "Пётр Ли", organization: "ЮНИСЕФ" });
  });

  it("остаются текстом и ни с кем не связываются", async () => {
    // Спикеры не пользователи сервиса: их согласия у нас нет и не будет,
    // поэтому связывать их с учётными записями нельзя даже при совпадении.
    const id = idFrom(
      await run(createEngagement, form({ ...base, speakerName: ["Анна"], speakerOrg: [""] })),
    );
    const raw = await load(id);
    const speaker = (raw.speakers ?? [])[0] as Record<string, unknown>;
    expect(Object.keys(speaker).sort()).toEqual(["id", "name", "organization"].sort());
  });
});

describe("правка и удаление", () => {
  it("своя запись правится", async () => {
    const id = idFrom(await run(createEngagement, form(base)));
    await run(updateEngagement, form({ ...base, id: String(id), title: "Новое название" }));

    expect((await load(id)).title).toBe("Новое название");
  });

  it("чужую запись не тронуть ни правкой, ни удалением", async () => {
    const foreign = await payload.create({
      collection: "engagements",
      data: {
        title: `Чужая ${stamp}`,
        owner: stranger,
        heldOn: "2026-01-01",
        mode: "simultaneous",
        sourceLang: "en",
        targetLang: "ru",
        visibility: "team",
      },
      overrideAccess: true,
    });

    expect(
      await run(updateEngagement, form({ ...base, id: String(foreign.id), title: "Захват" })),
    ).toBe("/experience");
    expect((await load(foreign.id)).title).toBe(`Чужая ${stamp}`);

    expect(await run(deleteEngagement, form({ id: String(foreign.id) }))).toBe("/experience");
    expect(await load(foreign.id)).toBeTruthy();
  });

  it("своя запись удаляется", async () => {
    const id = idFrom(await run(createEngagement, form(base)));
    expect(await run(deleteEngagement, form({ id: String(id) }))).toBe("/experience");
    await expect(load(id)).rejects.toThrow();
  });
});

describe("связь с проектом", () => {
  it("удаление проекта не стирает запись о том, что событие было", async () => {
    const project = await payload.create({
      collection: "projects",
      data: {
        title: `Подготовка ${stamp}`,
        owner,
        sourceLang: "en",
        targetLang: "ru",
        stylePreset: "un",
        status: "held",
      },
      overrideAccess: true,
    });

    const engagement = await payload.create({
      collection: "engagements",
      data: {
        title: `Событие ${stamp}`,
        owner,
        project: project.id,
        heldOn: "2026-03-01",
        mode: "simultaneous",
        sourceLang: "en",
        targetLang: "ru",
        visibility: "team",
      },
      overrideAccess: true,
    });

    await payload.delete({ collection: "projects", id: project.id, overrideAccess: true });

    // Проект — это подготовка, запись — факт. Факт переживает подготовку.
    const after = await load(engagement.id);
    expect(after.title).toBe(`Событие ${stamp}`);
    expect(toRow(after).projectId).toBeNull();
  });
});

describe("подписи оценки", () => {
  it("у каждого деления есть словесная подпись", () => {
    // Голая шкала 1–5 несопоставима: у каждого своя четвёрка.
    for (const value of [1, 2, 3, 4, 5]) {
      expect(WENT_LABELS[value]).toBeTruthy();
    }
  });
});
