import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Напоминание о неподтверждённом участии (C6).
 *
 * Правила те же, что у напоминания о разборе, и проверяется то же самое:
 * чего делать НЕЛЬЗЯ. Напоминание, написавшее дважды или потревожившее
 * ответившего, перестаёт быть заботой.
 */

const sent: { to: string; subject: string; text: string }[] = [];
let failMail = false;

vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return {
    ...actual,
    emailConfigured: () => true,
    sendEmail: async (args: (typeof sent)[number]) => {
      if (failMail) throw new Error("почта молчит");
      sent.push(args);
    },
  };
});

const { payloadClient } = await import("@/lib/payload");
const { sendConfirmReminders, confirmReminderEmail } = await import("@/lib/confirm-reminder");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let payload: Awaited<ReturnType<typeof payloadClient>>;
let owner: number;
let mate: number;
let mateEmail = "";

const NOW = new Date("2026-10-20T09:30:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 3600e3).toISOString();

const make = async (heldOn: string, status: string) =>
  payload.create({
    collection: "engagements",
    data: {
      title: `Событие ${Math.random().toString(36).slice(2, 6)}`,
      owner,
      heldOn,
      mode: "simultaneous",
      sourceLang: "en",
      targetLang: "ru",
      visibility: "team",
      team: [{ name: "Коллега", user: mate, status: status as "invited" }],
    },
    overrideAccess: true,
  });

const statusOf = async (id: number) => {
  const doc = await payload.findByID({
    collection: "engagements",
    id,
    depth: 0,
    overrideAccess: true,
  });
  return (doc.team ?? [])[0]?.status;
};

beforeAll(async () => {
  payload = await payloadClient();
  const makeUser = async (tag: string) =>
    (
      await payload.create({
        collection: "users",
        data: {
          email: `cr-${tag}-${stamp}@example.test`,
          displayName: tag === "owner" ? "Анна Иванова" : "Коллега",
          role: "interpreter",
        },
        overrideAccess: true,
      })
    ).id;
  owner = await makeUser("owner");
  mate = await makeUser("mate");
  mateEmail = `cr-mate-${stamp}@example.test`;
});

beforeEach(async () => {
  sent.length = 0;
  failMail = false;
  await payload.delete({
    collection: "engagements",
    where: { owner: { equals: owner } },
    overrideAccess: true,
  });
});

afterAll(async () => {
  await payload
    .delete({ collection: "engagements", where: { owner: { equals: owner } }, overrideAccess: true })
    .catch(() => {});
  for (const id of [owner, mate]) {
    await payload.delete({ collection: "users", id, overrideAccess: true }).catch(() => {});
  }
});

describe("кому напоминаем", () => {
  it("приглашённому, который не ответил", async () => {
    const doc = await make(daysAgo(7), "invited");

    const report = await sendConfirmReminders(payload, NOW);

    expect(report.sent).toHaveLength(1);
    expect(sent[0].to).toBe(mateEmail);
    expect(sent[0].text).toContain(`/experience/${doc.id}`);
    // Письмо должно говорить и про «меня там не было»: подтверждение без
    // возможности возразить ничего не гарантирует.
    expect(sent[0].text).toContain("Меня там не было");
  });

  it("не трогаем свежее событие", async () => {
    await make(daysAgo(1), "invited");
    await sendConfirmReminders(payload, NOW);
    expect(sent).toHaveLength(0);
  });

  it("не трогаем давнее: подтверждать нечего, событие забылось", async () => {
    await make(daysAgo(200), "invited");
    await sendConfirmReminders(payload, NOW);
    expect(sent).toHaveLength(0);
  });

  it("не трогаем тех, кто уже ответил", async () => {
    for (const status of ["confirmed", "disputed", "withdrawn"]) {
      await make(daysAgo(7), status);
    }
    await sendConfirmReminders(payload, NOW);
    expect(sent).toHaveLength(0);
  });

  it("не трогаем названного, но ещё не приглашённого", async () => {
    // `listed` — первого письма ему не уходило, напоминать не о чем.
    await make(daysAgo(7), "listed");
    await sendConfirmReminders(payload, NOW);
    expect(sent).toHaveLength(0);
  });
});

describe("не преследуем", () => {
  it("второй проход молчит", async () => {
    const doc = await make(daysAgo(7), "invited");

    await sendConfirmReminders(payload, NOW);
    expect(sent).toHaveLength(1);
    expect(await statusOf(doc.id)).toBe("reminded");

    sent.length = 0;
    await sendConfirmReminders(payload, new Date(NOW.getTime() + 7 * 24 * 3600e3));
    expect(sent).toHaveLength(0);
  });

  it("напомнили — но человек всё ещё в команде и видит запись", async () => {
    const doc = await make(daysAgo(7), "invited");
    await sendConfirmReminders(payload, NOW);

    const { toRow, activeTeam, canSee } = await import("@/lib/engagements");
    const row = toRow(
      await payload.findByID({ collection: "engagements", id: doc.id, depth: 0, overrideAccess: true }),
    );
    // Иначе человек получил бы письмо со ссылкой на страницу, которой не видит.
    expect(activeTeam(row)).toHaveLength(1);
    expect(canSee(row, owner, mate)).toBe(true);
  });
});

describe("когда почта отказала", () => {
  it("статус не меняется — напоминание попробует снова", async () => {
    const doc = await make(daysAgo(7), "invited");
    failMail = true;

    const report = await sendConfirmReminders(payload, NOW);
    expect(report.sent).toHaveLength(0);
    expect(await statusOf(doc.id)).toBe("invited");

    failMail = false;
    await sendConfirmReminders(payload, NOW);
    expect(sent).toHaveLength(1);
    expect(await statusOf(doc.id)).toBe("reminded");
  });
});

describe("само письмо", () => {
  it("называет событие и того, кто вписал", () => {
    const mail = confirmReminderEmail({
      who: "Анна Иванова",
      event: "Форум по климату",
      url: "https://booth.example/experience/7",
    });
    expect(mail.subject).toContain("Форум по климату");
    expect(mail.text).toContain("Анна Иванова");
    expect(mail.text).toContain("один раз");
  });
});
