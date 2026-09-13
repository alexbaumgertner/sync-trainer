import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Коды хранятся хешами, поэтому в тесте перехватываем их на отправке письма —
 * ровно там, где их видит настоящий получатель.
 */
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
const { requestCode, verifyCode, BAD_CODE, TOO_MANY } = await import("@/lib/otp");
const { createInvitation, redeemInvitation, INVALID_INVITE } = await import("@/lib/invitations");

const codeFrom = (text: string): string => text.match(/\b(\d{6})\b/)?.[1] ?? "";
const tokenFrom = (text: string): string => text.match(/\/invite\/([^\s]+)/)?.[1] ?? "";

const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const created: { collection: string; id: number }[] = [];

let payload: Awaited<ReturnType<typeof payloadClient>>;

beforeAll(async () => {
  payload = await payloadClient();
});

beforeEach(() => {
  sent.length = 0;
});

afterAll(async () => {
  for (const { collection, id } of created.reverse()) {
    await payload
      .delete({ collection: collection as never, id, overrideAccess: true })
      .catch(() => {});
  }
});

async function cleanupEmail(email: string) {
  for (const collection of ["otp-codes", "invitations", "users"] as const) {
    const found = await payload.find({
      collection,
      where: { email: { equals: email } },
      limit: 100,
      overrideAccess: true,
    });
    for (const doc of found.docs) {
      await payload.delete({ collection, id: doc.id, overrideAccess: true }).catch(() => {});
    }
  }
}

describe("приглашения", () => {
  it("ссылка создаёт учётную запись и срабатывает один раз", async () => {
    const email = `invited-${stamp()}@example.test`;
    await createInvitation({ email });

    expect(sent).toHaveLength(1);
    const token = tokenFrom(sent[0].text);
    expect(token).toBeTruthy();

    const first = await redeemInvitation(token);
    expect(first.ok).toBe(true);

    const second = await redeemInvitation(token);
    expect(second).toEqual({ ok: false, error: INVALID_INVITE });

    await cleanupEmail(email);
  });

  it("запись, созданная из админки, тоже выписывает токен и шлёт письмо", async () => {
    const email = `admin-made-${stamp()}@example.test`;

    // Ровно то, что делает админка: create без токена и без срока
    const invite = await payload.create({
      collection: "invitations",
      data: { email },
      overrideAccess: true,
    });
    created.push({ collection: "invitations", id: invite.id });

    expect(invite.tokenHash).toBeTruthy();
    expect(invite.expiresAt).toBeTruthy();
    expect(sent).toHaveLength(1);

    const result = await redeemInvitation(tokenFrom(sent[0].text));
    expect(result.ok).toBe(true);

    await cleanupEmail(email);
  });

  it("несуществующий токен отклоняется", async () => {
    const result = await redeemInvitation("явно-неправильный-токен");
    expect(result).toEqual({ ok: false, error: INVALID_INVITE });
  });

  it("истёкшее приглашение не срабатывает", async () => {
    const email = `expired-${stamp()}@example.test`;
    await createInvitation({ email });
    const token = tokenFrom(sent[0].text);

    const found = await payload.find({
      collection: "invitations",
      where: { email: { equals: email } },
      limit: 1,
      overrideAccess: true,
    });
    await payload.update({
      collection: "invitations",
      id: found.docs[0].id,
      data: { expiresAt: new Date(Date.now() - 1000).toISOString() },
      overrideAccess: true,
    });

    expect(await redeemInvitation(token)).toEqual({ ok: false, error: INVALID_INVITE });
    await cleanupEmail(email);
  });
});

describe("вход по коду", () => {
  it("приглашённый получает письмо и входит", async () => {
    const email = `code-${stamp()}@example.test`;
    await createInvitation({ email });
    sent.length = 0;

    expect(await requestCode(email, "10.0.0.1")).toEqual({ ok: true });
    expect(sent).toHaveLength(1);

    const result = await verifyCode(email, codeFrom(sent[0].text));
    expect(result.ok).toBe(true);

    await cleanupEmail(email);
  });

  it("неприглашённому письмо не уходит, но ответ такой же", async () => {
    const email = `stranger-${stamp()}@example.test`;

    // A4: ответ не должен выдавать, знаком ли адрес
    expect(await requestCode(email, "10.0.0.2")).toEqual({ ok: true });
    expect(sent).toHaveLength(0);

    // Даже угадав шесть цифр, войти нельзя: письма не было
    const guessed = await verifyCode(email, "000000");
    expect(guessed.ok).toBe(false);

    await cleanupEmail(email);
  });

  it("код срабатывает один раз", async () => {
    const email = `once-${stamp()}@example.test`;
    await createInvitation({ email });
    sent.length = 0;
    await requestCode(email, "10.0.0.3");
    const code = codeFrom(sent[0].text);

    expect((await verifyCode(email, code)).ok).toBe(true);
    expect(await verifyCode(email, code)).toEqual({ ok: false, error: BAD_CODE });

    await cleanupEmail(email);
  });

  it("после пяти неверных попыток код аннулируется", async () => {
    const email = `attempts-${stamp()}@example.test`;
    await createInvitation({ email });
    sent.length = 0;
    await requestCode(email, "10.0.0.4");
    const code = codeFrom(sent[0].text);

    for (let i = 0; i < 5; i++) {
      expect(await verifyCode(email, "111111")).toEqual({ ok: false, error: BAD_CODE });
    }

    // Шестая попытка не проверяет код вовсе, а верный код уже мёртв
    expect(await verifyCode(email, code)).toEqual({ ok: false, error: TOO_MANY });

    await cleanupEmail(email);
  });

  it("четвёртый запрос кода за окно отклоняется", async () => {
    const email = `rate-${stamp()}@example.test`;
    await createInvitation({ email });
    const ip = `10.0.0.${Math.floor(Math.random() * 200) + 20}`;

    for (let i = 0; i < 3; i++) {
      expect(await requestCode(email, ip)).toEqual({ ok: true });
    }
    expect(await requestCode(email, ip)).toEqual({ ok: false, error: TOO_MANY });

    await cleanupEmail(email);
  });
});
