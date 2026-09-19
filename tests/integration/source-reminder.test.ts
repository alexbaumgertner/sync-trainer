import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Предложение убрать исходные материалы через неделю после события (S4).
 *
 * С отменой F1 оригиналы живут в хранилище неопределённо долго, и это
 * письмо — единственное, что держит цену решения в узде. Поэтому проверяем
 * не столько «письмо ушло», сколько обратное: что оно НЕ приходит, когда
 * удалять нечего, приходит один раз, и не зовёт убирать материалы к
 * событию, которое ещё вчера шло.
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

const { payloadClient } = await import("@/lib/payload");
const { sendSourceReminders } = await import("@/lib/source-reminder");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let payload: Awaited<ReturnType<typeof payloadClient>>;
let userId: number;
const created: number[] = [];

const NOW = new Date("2026-10-20T09:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 3600e3).toISOString();

const makeProject = async (eventStartsOn: string | null) => {
  const project = await payload.create({
    collection: "projects",
    data: {
      title: `Проект ${stamp}`,
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

/** Документ с оригиналом на месте или без него — разница здесь и проверяется. */
const makeDocument = async (projectId: number, blobPath: string | null) => {
  await payload.create({
    collection: "documents",
    data: {
      project: projectId,
      filename: "deck.pdf",
      mime: "application/pdf",
      bytes: 1024,
      sha256: `sha-${Math.random().toString(36).slice(2)}`,
      blobPath: blobPath ?? undefined,
      purgedAt: blobPath ? undefined : new Date().toISOString(),
    },
    overrideAccess: true,
  });
};

const remindedAt = async (id: number) =>
  (await payload.findByID({ collection: "projects", id, depth: 0, overrideAccess: true }))
    .sourcesRemindedAt ?? null;

beforeAll(async () => {
  payload = await payloadClient();
  const user = await payload.create({
    collection: "users",
    data: { email: `src-${stamp}@example.test`, role: "interpreter" },
    overrideAccess: true,
  });
  userId = user.id;
});

beforeEach(async () => {
  sent.length = 0;
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

describe("когда предлагаем убрать материалы", () => {
  it("неделя прошла, оригиналы лежат — предлагаем", async () => {
    const id = await makeProject(daysAgo(8));
    await makeDocument(id, "projects/1/source-1.pdf");

    const report = await sendSourceReminders(payload, NOW);

    expect(report.sent.map((s) => s.projectId)).toContain(id);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(`src-${stamp}@example.test`);
    expect(sent[0].text).toContain(`/projects/${id}`);
    // Письмо обязано говорить, что само ничего не удаляет: иначе человек
    // решит, что материалы уже уничтожены, и не станет их убирать.
    expect(sent[0].text).toContain("ничего не удаляем сами");
  });

  it("событие было вчера — молчим: к материалам ещё возвращаются", async () => {
    const id = await makeProject(daysAgo(1));
    await makeDocument(id, "projects/1/source-1.pdf");

    await sendSourceReminders(payload, NOW);

    expect(sent).toHaveLength(0);
  });

  it("событие двухмесячной давности — молчим", async () => {
    const id = await makeProject(daysAgo(70));
    await makeDocument(id, "projects/1/source-1.pdf");

    await sendSourceReminders(payload, NOW);

    expect(sent).toHaveLength(0);
  });
});

describe("не тревожим попусту", () => {
  it("оригиналы уже удалены — не пишем, но и перебирать больше не будем", async () => {
    const id = await makeProject(daysAgo(8));
    await makeDocument(id, null);

    const report = await sendSourceReminders(payload, NOW);

    expect(sent).toHaveLength(0);
    expect(report.skipped.map((s) => s.why)).toContain("оригиналов нет");
    expect(await remindedAt(id)).not.toBeNull();
  });

  it("документов нет вовсе — молчим", async () => {
    await makeProject(daysAgo(8));

    await sendSourceReminders(payload, NOW);

    expect(sent).toHaveLength(0);
  });

  it("второй проход не пишет повторно", async () => {
    const id = await makeProject(daysAgo(8));
    await makeDocument(id, "projects/1/source-1.pdf");

    await sendSourceReminders(payload, NOW);
    expect(sent).toHaveLength(1);

    sent.length = 0;
    await sendSourceReminders(payload, new Date(NOW.getTime() + 24 * 3600e3));
    expect(sent).toHaveLength(0);
  });
});
