import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Срок хранения одноразовых кодов.
 *
 * Таблица растёт на КАЖДУЮ попытку входа, включая попытки с незнакомых
 * адресов: запись служит счётчиком частоты, а отличить по базе приглашённого
 * от постороннего нельзя — хранится хеш. То есть растёт она от чужого
 * интереса, а не от нашего использования.
 *
 * Опасность уборки ровно одна и она тихая: удалив запись, которая ещё
 * попадает в окно ограничителя, мы дарим обратившемуся свежий лимит.
 * Проверяется здесь в первую очередь это, а не сам факт удаления.
 */

vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return { ...actual, emailConfigured: () => true, sendEmail: async () => {} };
});

const { payloadClient } = await import("@/lib/payload");
const { purgeStaleCodes, CODE_RETENTION_MS } = await import("@/lib/otp");

const HOUR = 60 * 60 * 1000;
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const email = `ret-${stamp}@example.test`;
const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;

const payload = await payloadClient();

/** Код с подставленной датой создания: Payload позволяет её задать. */
const makeCode = async (ageMs: number) =>
  payload.create({
    collection: "otp-codes",
    data: {
      email,
      codeHash: "0".repeat(64),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      attempts: 0,
      requestIp: ip,
      delivered: false,
      createdAt: new Date(Date.now() - ageMs).toISOString(),
    },
    overrideAccess: true,
  });

const remaining = async () =>
  (
    await payload.count({
      collection: "otp-codes",
      where: { email: { equals: email } },
      overrideAccess: true,
    })
  ).totalDocs;

beforeEach(async () => {
  await payload.delete({
    collection: "otp-codes",
    where: { email: { equals: email } },
    overrideAccess: true,
  });
});

afterAll(async () => {
  await payload
    .delete({ collection: "otp-codes", where: { email: { equals: email } }, overrideAccess: true })
    .catch(() => {});
});

describe("срок хранения", () => {
  it("длиннее самого длинного окна ограничителя", () => {
    // Главный инвариант. Подрезав срок до получаса, кто-нибудь молча
    // выключил бы предел «двадцать запросов с адреса сети в час»,
    // и заметить это было бы нечем.
    expect(CODE_RETENTION_MS).toBeGreaterThan(HOUR);
  });
});

describe("уборка", () => {
  it("убирает то, что старше срока", async () => {
    await makeCode(CODE_RETENTION_MS + HOUR);
    await makeCode(CODE_RETENTION_MS + 10 * HOUR);
    expect(await remaining()).toBe(2);

    await purgeStaleCodes();
    expect(await remaining()).toBe(0);
  });

  it("не трогает записи внутри окна ограничителя", async () => {
    // Час с минутами — уже за пределами окна по адресу сети, но далеко
    // внутри срока хранения. Такую запись уборка удалять не должна:
    // срок хранения и окно ограничителя — разные вещи.
    await makeCode(0);
    await makeCode(HOUR - 60_000);
    await makeCode(HOUR + 60_000);

    await purgeStaleCodes();
    expect(await remaining()).toBe(3);
  });

  it("после уборки ограничитель по-прежнему видит свежие попытки", async () => {
    // Смысл предыдущей проверки, выраженный через поведение: лимит по
    // адресу сети — двадцать в час. Набираем его, убираемся и убеждаемся,
    // что уборка не вернула обратившемуся право на новые попытки.
    for (let i = 0; i < 20; i += 1) await makeCode(i * 60_000);
    await makeCode(CODE_RETENTION_MS + HOUR);

    await purgeStaleCodes();

    const withinWindow = await payload.count({
      collection: "otp-codes",
      where: {
        and: [
          { requestIp: { equals: ip } },
          { createdAt: { greater_than: new Date(Date.now() - HOUR).toISOString() } },
        ],
      },
      overrideAccess: true,
    });
    expect(withinWindow.totalDocs).toBe(20);
  });

  it("на пустой таблице не падает", async () => {
    await expect(purgeStaleCodes()).resolves.toBeGreaterThanOrEqual(0);
  });
});
