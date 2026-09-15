import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Напоминание о разборе через день после события (E5).
 *
 * Проверяется главным образом то, чего делать НЕЛЬЗЯ: писать дважды, писать
 * про вчера сегодня же, писать про конференцию полугодовой давности и писать
 * тому, кто разбор уже написал. Напоминание, нарушившее любое из этих правил,
 * перестаёт быть заботой и становится преследованием.
 */

const sent: { to: string; subject: string; text: string }[] = [];

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

let failMail = false;

const { payloadClient } = await import("@/lib/payload");
const { sendDebriefReminders, reminderEmail } = await import("@/lib/debrief-reminder");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let payload: Awaited<ReturnType<typeof payloadClient>>;
let userId: number;
const created: number[] = [];

const NOW = new Date("2026-10-20T09:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 3600e3).toISOString();

const makeProject = async (eventStartsOn: string | null, title = `Проект ${stamp}`) => {
  const project = await payload.create({
    collection: "projects",
    data: {
      title,
      eventName: "Панель по финансированию",
      owner: userId,
      eventStartsOn: eventStartsOn ?? undefined,
      sourceLang: "en",
      targetLang: "ru",
      stylePreset: "un",
      status: "ready",
    },
    overrideAccess: true,
  });
  created.push(project.id);
  return project.id;
};

const remindedAt = async (id: number) =>
  (await payload.findByID({ collection: "projects", id, depth: 0, overrideAccess: true }))
    .debriefRemindedAt ?? null;

beforeAll(async () => {
  payload = await payloadClient();
  const user = await payload.create({
    collection: "users",
    data: { email: `rem-${stamp}@example.test`, role: "interpreter" },
    overrideAccess: true,
  });
  userId = user.id;
});

beforeEach(async () => {
  sent.length = 0;
  failMail = false;
  for (const id of created.splice(0)) {
    await payload.delete({ collection: "projects", id, overrideAccess: true }).catch(() => {});
  }
});

afterAll(async () => {
  for (const id of created) {
    await payload.delete({ collection: "projects", id, overrideAccess: true }).catch(() => {});
  }
  await payload.delete({ collection: "users", id: userId, overrideAccess: true }).catch(() => {});
});

describe("кому пишем", () => {
  it("вчерашнее событие без разбора — пишем", async () => {
    const id = await makeProject(daysAgo(2));

    const report = await sendDebriefReminders(payload, NOW);

    expect(report.sent.map((s) => s.projectId)).toContain(id);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(`rem-${stamp}@example.test`);
    expect(sent[0].text).toContain(`/projects/${id}/debrief`);
    expect(await remindedAt(id)).not.toBeNull();
  });

  it("сегодняшнее событие — молчим: оно могло идти до вечера", async () => {
    await makeProject(daysAgo(0.5));
    await sendDebriefReminders(payload, NOW);
    expect(sent).toHaveLength(0);
  });

  it("событие полугодовой давности — молчим", async () => {
    // Иначе первый же запуск разослал бы письма по всем старым проектам:
    // это выглядит как сломавшаяся рассылка, а не как забота.
    await makeProject(daysAgo(180));
    await sendDebriefReminders(payload, NOW);
    expect(sent).toHaveLength(0);
  });

  it("проект без даты события — молчим, напоминать не от чего", async () => {
    await makeProject(null);
    await sendDebriefReminders(payload, NOW);
    expect(sent).toHaveLength(0);
  });
});

describe("не преследуем", () => {
  it("второй проход не пишет повторно", async () => {
    const id = await makeProject(daysAgo(2));

    await sendDebriefReminders(payload, NOW);
    expect(sent).toHaveLength(1);

    sent.length = 0;
    await sendDebriefReminders(payload, new Date(NOW.getTime() + 24 * 3600e3));
    expect(sent).toHaveLength(0);
    expect(await remindedAt(id)).not.toBeNull();
  });

  it("если разбор уже написан — не пишем, но проект больше не перебираем", async () => {
    const id = await makeProject(daysAgo(2));
    await payload.create({
      collection: "debriefs",
      data: { project: id, hardest: "уже написано" },
      overrideAccess: true,
    });

    const report = await sendDebriefReminders(payload, NOW);

    expect(sent).toHaveLength(0);
    expect(report.skipped.some((s) => s.projectId === id)).toBe(true);
    // Отметка нужна, иначе проект будет перебираться каждые сутки впустую.
    expect(await remindedAt(id)).not.toBeNull();
  });
});

describe("когда почта отказала", () => {
  it("отметка не ставится — напоминание не теряется навсегда", async () => {
    const id = await makeProject(daysAgo(2));
    failMail = true;

    const report = await sendDebriefReminders(payload, NOW);
    expect(report.sent).toHaveLength(0);
    expect(await remindedAt(id)).toBeNull();

    // Починили почту — напоминание уходит на следующем проходе.
    failMail = false;
    await sendDebriefReminders(payload, NOW);
    expect(sent).toHaveLength(1);
    expect(await remindedAt(id)).not.toBeNull();
  });
});

describe("само письмо", () => {
  it("называет событие и объясняет, зачем разбор", () => {
    const mail = reminderEmail({
      title: "Внутреннее название",
      eventName: "ЭКОСОС, панель по долгу",
      url: "https://booth.example/projects/7/debrief",
    });

    // В теме — название события, а не внутреннее название проекта.
    expect(mail.subject).toContain("ЭКОСОС");
    expect(mail.text).toContain("https://booth.example/projects/7/debrief");
    // Разбор — заготовка для следующей подготовки, и это должно быть сказано.
    expect(mail.text).toContain("следующему");
    expect(mail.text).toContain("один раз");
  });

  it("без названия события берёт название проекта", () => {
    const mail = reminderEmail({ title: "Мой проект", eventName: null, url: "https://x/y" });
    expect(mail.subject).toContain("Мой проект");
  });
});
