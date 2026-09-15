import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Приглашение коллеги из записи (C4).
 *
 * Механизм тот же, что у администратора (A5). Проверяется, что он именно тот,
 * и что форма не превратилась в способ рассылать приглашения кому угодно
 * от чужого имени.
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
const { inviteMember } = await import("@/app/(frontend)/experience/[id]/invite-actions");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let payload: Awaited<ReturnType<typeof payloadClient>>;
let sessionToken = "";
let owner: number;
let outsider: number;
let engagementId: number;

const NEWCOMER = `newcomer-${stamp}@example.test`;
const REGISTERED = `registered-${stamp}@example.test`;

const form = (entries: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
};

const run = async (data: FormData): Promise<string> => {
  try {
    await inviteMember(data);
  } catch (error) {
    const message = (error as Error).message;
    if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
    throw error;
  }
  throw new Error("действие завершилось без редиректа");
};

const invitations = async (email: string) =>
  (
    await payload.count({
      collection: "invitations",
      where: { email: { equals: email } },
      overrideAccess: true,
    })
  ).totalDocs;

beforeAll(async () => {
  payload = await payloadClient();

  const makeUser = async (email: string, name: string) =>
    (
      await payload.create({
        collection: "users",
        data: { email, displayName: name, role: "interpreter" },
        overrideAccess: true,
      })
    ).id;

  owner = await makeUser(`inv-owner-${stamp}@example.test`, "Анна Иванова");
  outsider = await makeUser(`inv-outsider-${stamp}@example.test`, "Посторонний");
  await makeUser(REGISTERED, "Уже В Сервисе");
});

beforeEach(async () => {
  sent.length = 0;
  sessionToken = issueToken(owner).token;

  await payload.delete({
    collection: "engagements",
    where: { owner: { equals: owner } },
    overrideAccess: true,
  });
  await payload.delete({
    collection: "invitations",
    where: { email: { in: [NEWCOMER, REGISTERED] } },
    overrideAccess: true,
  });

  const doc = await payload.create({
    collection: "engagements",
    data: {
      title: `Событие ${stamp}`,
      owner,
      heldOn: "2026-07-01",
      mode: "simultaneous",
      sourceLang: "en",
      targetLang: "ru",
      visibility: "team",
      team: [
        { name: "Новичок", email: NEWCOMER, status: "listed" },
        { name: "Уже в сервисе", email: REGISTERED, status: "listed" },
        { name: "Без адреса", status: "listed" },
      ],
    },
    overrideAccess: true,
  });
  engagementId = doc.id;
});

afterAll(async () => {
  await payload
    .delete({ collection: "engagements", where: { owner: { equals: owner } }, overrideAccess: true })
    .catch(() => {});
  await payload
    .delete({ collection: "invitations", where: { email: { in: [NEWCOMER, REGISTERED] } }, overrideAccess: true })
    .catch(() => {});
  await payload
    .delete({ collection: "users", where: { email: { contains: stamp } }, overrideAccess: true })
    .catch(() => {});
});

describe("приглашение из записи", () => {
  it("уходит тому, у кого нет учётной записи", async () => {
    expect(await run(form({ id: String(engagementId), email: NEWCOMER }))).toContain("invite=sent");

    expect(await invitations(NEWCOMER)).toBe(1);
    expect(sent.some((m) => m.to === NEWCOMER)).toBe(true);
  });

  it("это тот же механизм, что у администратора: одноразовая ссылка со сроком", async () => {
    await run(form({ id: String(engagementId), email: NEWCOMER }));

    const letter = sent.find((m) => m.to === NEWCOMER)!;
    expect(letter.text).toContain("/invite/");
    expect(letter.text).toContain("одноразовая");

    const record = await payload.find({
      collection: "invitations",
      where: { email: { equals: NEWCOMER } },
      limit: 1,
      overrideAccess: true,
    });
    expect(record.docs[0].tokenHash).toBeTruthy();
    expect(record.docs[0].expiresAt).toBeTruthy();
    // В заметке видно, откуда приглашение: человек получил письмо не просто так.
    expect(record.docs[0].note).toContain("команде события");
  });

  it("в письме имя приглашающего, а не его почта", async () => {
    await run(form({ id: String(engagementId), email: NEWCOMER }));

    const record = await payload.find({
      collection: "invitations",
      where: { email: { equals: NEWCOMER } },
      limit: 1,
      overrideAccess: true,
    });
    expect(record.docs[0].note).toContain("Анна Иванова");
    expect(record.docs[0].note).not.toContain("@example.test");
  });

  it("уже зарегистрированному приглашение не создаётся", async () => {
    expect(await run(form({ id: String(engagementId), email: REGISTERED }))).toContain("invite=exists");
    expect(await invitations(REGISTERED)).toBe(0);
  });
});

describe("кого звать нельзя", () => {
  it("адрес не из команды записи — отказ", async () => {
    // Иначе форма стала бы способом рассылать приглашения кому угодно.
    const foreign = `foreign-${stamp}@example.test`;
    expect(await run(form({ id: String(engagementId), email: foreign }))).toContain("invite=unknown");
    expect(await invitations(foreign)).toBe(0);
  });

  it("чужую запись посторонний использовать не может", async () => {
    sessionToken = issueToken(outsider).token;
    expect(await run(form({ id: String(engagementId), email: NEWCOMER }))).toBe("/experience");
    expect(await invitations(NEWCOMER)).toBe(0);
  });
});
