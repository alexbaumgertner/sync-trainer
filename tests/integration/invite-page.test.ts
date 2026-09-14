import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Приглашение по ссылке (A5).
 *
 * Тесты на `redeemInvitation` были и проходили, а на живом приглашении
 * 14 сентября страница отвечала 500: серверный компонент не имеет права
 * ставить куки — и падал уже после того, как токен погашен. Ссылка сгорала,
 * человек видел ошибку. Проверялась библиотека, а ломалось соединение
 * библиотеки со страницей, поэтому здесь проверяется именно оно.
 */

const cookiesSet: { name: string; value: string }[] = [];

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    set: (name: string, value: string) => {
      cookiesSet.push({ name, value });
    },
  }),
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

const sent: { to: string; subject: string; text: string }[] = [];
vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return {
    ...actual,
    emailConfigured: () => true,
    sendEmail: async (args: { to: string; subject: string; text: string }) => {
      sent.push(args);
    },
  };
});

const { payloadClient } = await import("@/lib/payload");
const { createInvitation } = await import("@/lib/invitations");
const { acceptInvitation } = await import("@/app/(frontend)/invite/[token]/actions");
const InvitePage = (await import("@/app/(frontend)/invite/[token]/page")).default;
const { SESSION_COOKIE } = await import("@/lib/session");

const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const tokenFrom = (text: string): string => text.match(/\/invite\/([^\s]+)/)?.[1] ?? "";

let payload: Awaited<ReturnType<typeof payloadClient>>;
const emails: string[] = [];

const accept = async (token: string): Promise<string> => {
  const data = new FormData();
  data.append("token", token);
  try {
    await acceptInvitation(data);
  } catch (error) {
    const message = (error as Error).message;
    if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
    throw error;
  }
  throw new Error("действие завершилось без редиректа");
};

const invite = async (): Promise<string> => {
  const email = `invite-${stamp()}@example.test`;
  emails.push(email);
  sent.length = 0;
  await createInvitation({ email });
  return tokenFrom(sent.at(-1)!.text);
};

const acceptedCount = async (token: string) => {
  const { hashInviteToken } = await import("@/lib/invite-token");
  const found = await payload.find({
    collection: "invitations",
    where: { tokenHash: { equals: hashInviteToken(token) } },
    limit: 1,
    overrideAccess: true,
  });
  return found.docs[0]?.acceptedAt ?? null;
};

beforeAll(async () => {
  payload = await payloadClient();
});

beforeEach(() => {
  cookiesSet.length = 0;
});

afterAll(async () => {
  for (const email of emails) {
    for (const collection of ["invitations", "users"] as const) {
      await payload
        .delete({ collection, where: { email: { equals: email } }, overrideAccess: true })
        .catch(() => {});
    }
  }
});

describe("страница приглашения", () => {
  it("открытие ссылки НЕ гасит приглашение — иначе его сожжёт почтовый сканер", async () => {
    const token = await invite();

    // Отрисовка страницы: ровно то, что делает сканер, пройдя по ссылке.
    await InvitePage({
      params: Promise.resolve({ token }),
      searchParams: Promise.resolve({}),
    });

    expect(await acceptedCount(token)).toBeNull();

    // И человеку она после этого всё ещё открывается.
    expect(await accept(token)).toBe("/projects");
  });

  it("отрисовка не ставит куки — серверный компонент этого не умеет", async () => {
    const token = await invite();
    await InvitePage({
      params: Promise.resolve({ token }),
      searchParams: Promise.resolve({}),
    });
    // Ровно та ошибка, что валила страницу в бою: 500 после погашенного токена.
    expect(cookiesSet).toHaveLength(0);
  });
});

describe("принятие приглашения", () => {
  it("гасит приглашение, выдаёт сессию и ведёт в проекты", async () => {
    const token = await invite();

    expect(await accept(token)).toBe("/projects");
    expect(await acceptedCount(token)).not.toBeNull();
    expect(cookiesSet.map((c) => c.name)).toContain(SESSION_COOKIE);
    expect(cookiesSet.find((c) => c.name === SESSION_COOKIE)?.value).toBeTruthy();
  });

  it("повторное нажатие ведёт на страницу отказа, а не роняет", async () => {
    const token = await invite();
    await accept(token);
    cookiesSet.length = 0;

    expect(await accept(token)).toBe(`/invite/${encodeURIComponent(token)}?failed=1`);
    // Сессию второй раз не выдаём.
    expect(cookiesSet).toHaveLength(0);
  });

  it("негодный токен не выдаёт сессию", async () => {
    expect(await accept("заведомо-негодный")).toContain("failed=1");
    expect(cookiesSet).toHaveLength(0);
  });

  it("пустой токен уводит ко входу", async () => {
    const data = new FormData();
    await expect(acceptInvitation(data)).rejects.toThrow("REDIRECT:/");
  });
});
