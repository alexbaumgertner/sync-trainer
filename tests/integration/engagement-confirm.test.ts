import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Подтверждение и оспаривание участия (C1–C3, C5).
 *
 * Ядро релиза. До него запись — личные заметки: утверждение «я переводил
 * с Ивановой» может написать кто угодно. Ценность ему даёт подтверждение
 * самой Ивановой, поэтому здесь проверяется главным образом то, чего делать
 * НЕЛЬЗЯ: решать за участника, скрывать неподтверждённое и не пускать
 * человека забрать своё согласие.
 */

const sent: { to: string; subject: string; text: string }[] = [];

vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return {
    ...actual,
    emailConfigured: () => true,
    sendEmail: async (args: (typeof sent)[number]) => {
      sent.push(args);
    },
  };
});

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
const { createEngagement } = await import("@/app/(frontend)/experience/actions");
const { confirmParticipation, disputeParticipation, withdrawParticipation } = await import(
  "@/app/(frontend)/experience/[id]/confirm-actions"
);
const { toRow, canSee, activeTeam } = await import("@/lib/engagements");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let payload: Awaited<ReturnType<typeof payloadClient>>;
let sessionToken = "";
let owner: number;
let mate: number;
let outsider: number;
let mateEmail = "";

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

const load = (id: number) =>
  payload.findByID({ collection: "engagements", id, depth: 0, overrideAccess: true });

const memberOf = async (id: number, userId: number) =>
  toRow(await load(id)).team.find((m) => m.userId === userId);

/** Запись владельца, где `mate` назван и связан. */
const makeWithMate = async (): Promise<number> => {
  sessionToken = issueToken(owner).token;
  sent.length = 0;
  const to = await run(
    createEngagement,
    form({
      title: `Форум ${stamp}-${Math.random().toString(36).slice(2, 5)}`,
      heldOn: "2026-06-10",
      mode: "simultaneous",
      sourceLang: "en",
      targetLang: "ru",
      memberName: ["Коллега"],
      memberEmail: [mateEmail],
      memberBooth: ["кабина RU"],
    }),
  );
  return Number(to.match(/\/experience\/(\d+)/)?.[1]);
};

beforeAll(async () => {
  payload = await payloadClient();
  const makeUser = async (tag: string) =>
    (
      await payload.create({
        collection: "users",
        data: { email: `cf-${tag}-${stamp}@example.test`, displayName: `Имя ${tag}`, role: "interpreter" },
        overrideAccess: true,
      })
    ).id;

  owner = await makeUser("owner");
  mate = await makeUser("mate");
  outsider = await makeUser("outsider");
  mateEmail = `cf-mate-${stamp}@example.test`;
});

beforeEach(async () => {
  sent.length = 0;
  await payload.delete({
    collection: "engagements",
    where: { owner: { in: [owner, mate, outsider] } },
    overrideAccess: true,
  });
});

afterAll(async () => {
  await payload
    .delete({ collection: "engagements", where: { owner: { in: [owner, mate, outsider] } }, overrideAccess: true })
    .catch(() => {});
  for (const id of [owner, mate, outsider]) {
    await payload.delete({ collection: "users", id, overrideAccess: true }).catch(() => {});
  }
});

describe("письмо участнику (C1)", () => {
  it("уходит связанному и зовёт ответить", async () => {
    await makeWithMate();

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(mateEmail);
    expect(sent[0].subject).toContain("Вас назвали в команде");
    expect(sent[0].text).toContain("/experience/");
    // Письмо должно объяснять, зачем отвечать, а не просто уведомлять.
    expect(sent[0].text).toContain("неподтверждённое");
  });

  it("после письма статус — «приглашён», и второе письмо не уходит", async () => {
    const id = await makeWithMate();
    expect((await memberOf(id, mate))?.status).toBe("invited");

    sent.length = 0;
    const { updateEngagement } = await import("@/app/(frontend)/experience/actions");
    await run(
      updateEngagement,
      form({
        id: String(id),
        title: "Новое название",
        heldOn: "2026-06-10",
        mode: "simultaneous",
        sourceLang: "en",
        targetLang: "ru",
        memberName: ["Коллега"],
        memberEmail: [mateEmail],
        memberBooth: ["кабина RU"],
      }),
    );
    expect(sent).toHaveLength(0);
  });

  it("несвязанному участнику писать некуда — и не пишем", async () => {
    sessionToken = issueToken(owner).token;
    sent.length = 0;
    await run(
      createEngagement,
      form({
        title: `Без связи ${stamp}`,
        heldOn: "2026-06-10",
        mode: "simultaneous",
        sourceLang: "en",
        targetLang: "ru",
        memberName: ["Пётр Без Учётки"],
        memberEmail: [""],
        memberBooth: [""],
      }),
    );
    expect(sent).toHaveLength(0);
  });
});

describe("решает только сам участник", () => {
  it("владелец записи не может подтвердить за коллегу", async () => {
    const id = await makeWithMate();

    // Владелец жмёт «подтвердить» — за себя, а себя в команде нет.
    sessionToken = issueToken(owner).token;
    expect(await run(confirmParticipation, form({ id: String(id) }))).toBe("/experience");
    expect((await memberOf(id, mate))?.status).toBe("invited");
  });

  it("посторонний не может ответить за команду", async () => {
    const id = await makeWithMate();

    sessionToken = issueToken(outsider).token;
    expect(await run(confirmParticipation, form({ id: String(id) }))).toBe("/experience");
    expect((await memberOf(id, mate))?.status).toBe("invited");
  });

  it("участник подтверждает своё участие", async () => {
    const id = await makeWithMate();

    sessionToken = issueToken(mate).token;
    expect(await run(confirmParticipation, form({ id: String(id) }))).toContain("answered=confirmed");

    const me = await memberOf(id, mate);
    expect(me?.status).toBe("confirmed");
    expect(me?.confirmedAt).toBeTruthy();
  });
});

describe("оспаривание (C2, C3)", () => {
  it("до ответа участие показывается как неподтверждённое", async () => {
    const id = await makeWithMate();
    const row = toRow(await load(id));

    // Это заявление владельца записи, а не факт, и выглядеть должно именно так.
    expect(row.team[0].status).toBe("invited");
    expect(row.team[0].confirmedAt).toBeNull();
  });

  it("оспоренное участие уходит из команды и теряет доступ", async () => {
    const id = await makeWithMate();

    sessionToken = issueToken(mate).token;
    // Оспоривший больше не видит записи, поэтому возвращаем его в список.
    expect(await run(disputeParticipation, form({ id: String(id) }))).toContain("/experience?");

    const row = toRow(await load(id));
    expect(row.team[0].status).toBe("disputed");
    expect(activeTeam(row)).toHaveLength(0);
    expect(canSee(row, owner, mate)).toBe(false);
  });

  it("владелец не может отменить оспаривание правкой записи", async () => {
    const id = await makeWithMate();
    sessionToken = issueToken(mate).token;
    await run(disputeParticipation, form({ id: String(id) }));

    sessionToken = issueToken(owner).token;
    const { updateEngagement } = await import("@/app/(frontend)/experience/actions");
    await run(
      updateEngagement,
      form({
        id: String(id),
        title: "Правка",
        heldOn: "2026-06-10",
        mode: "simultaneous",
        sourceLang: "en",
        targetLang: "ru",
        memberName: ["Коллега"],
        memberEmail: [mateEmail],
        memberBooth: ["другая кабина"],
      }),
    );

    // Иначе оспаривание ничего бы не значило: владелец переписал бы его сам.
    expect((await memberOf(id, mate))?.status).toBe("disputed");
  });
});

describe("отзыв согласия (C5)", () => {
  it("подтвердивший может забрать согласие, и он уходит из команды", async () => {
    const id = await makeWithMate();

    sessionToken = issueToken(mate).token;
    await run(confirmParticipation, form({ id: String(id) }));
    expect(activeTeam(toRow(await load(id)))).toHaveLength(1);

    await run(withdrawParticipation, form({ id: String(id) }));

    const row = toRow(await load(id));
    expect(row.team[0].status).toBe("withdrawn");
    // Подтверждение было согласием на упоминание. Забрал — имя не показывается.
    expect(activeTeam(row)).toHaveLength(0);
    expect(canSee(row, owner, mate)).toBe(false);
  });

  it("отметка подтверждения снимается вместе с согласием", async () => {
    const id = await makeWithMate();
    sessionToken = issueToken(mate).token;
    await run(confirmParticipation, form({ id: String(id) }));
    await run(withdrawParticipation, form({ id: String(id) }));

    expect((await memberOf(id, mate))?.confirmedAt).toBeNull();
  });
});
