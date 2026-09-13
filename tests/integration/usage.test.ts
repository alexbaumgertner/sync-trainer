import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { payloadClient } from "@/lib/payload";
import { readUsage, recordUsage } from "@/lib/usage";
import { budgetBlock } from "@/lib/budget";

/**
 * Требования B1–B3. Проверяем, что расход привязан к пользователю, личный
 * лимит останавливает именно его, а соседа не задевает.
 */

let payload: Awaited<ReturnType<typeof payloadClient>>;
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let poor: number;
let rich: number;

const makeUser = async (prefix: string, monthlyLimitUsd?: number) => {
  const user = await payload.create({
    collection: "users",
    data: {
      email: `${prefix}-${stamp}@example.test`,
      password: "irrelevant-password",
      role: "interpreter",
      monthlyLimitUsd,
    },
    overrideAccess: true,
  });
  return user.id;
};

beforeAll(async () => {
  payload = await payloadClient();
  poor = await makeUser("poor", 1);
  rich = await makeUser("rich", 100);
});

afterAll(async () => {
  for (const id of [poor, rich]) {
    const events = await payload.find({
      collection: "usage-events",
      where: { user: { equals: id } },
      limit: 200,
      overrideAccess: true,
    });
    for (const row of events.docs) {
      await payload.delete({ collection: "usage-events", id: row.id, overrideAccess: true });
    }
    await payload.delete({ collection: "users", id, overrideAccess: true }).catch(() => {});
  }
});

describe("привязка расхода", () => {
  it("расход виден своему владельцу и не виден соседу", async () => {
    await recordUsage({ userId: poor, kind: "audio", chars: 1000, costUsd: 0.4 });

    const mine = await readUsage(poor, false);
    expect(mine.totalUsd).toBeCloseTo(0.4, 6);
    expect(mine.generations).toBe(1);

    const neighbour = await readUsage(rich, false);
    expect(neighbour.totalUsd).toBe(0);
    expect(neighbour.generations).toBe(0);
  });
});

describe("личный месячный лимит", () => {
  it("пропускает, пока есть запас", async () => {
    const summary = await readUsage(poor, false);
    expect(summary.monthLimitUsd).toBe(1);
    expect(budgetBlock(summary, 0.1)).toBeNull();
  });

  it("останавливает генерацию, которая перешагнула бы лимит", async () => {
    const summary = await readUsage(poor, false);
    // Потрачено 0.4 из 1; заявка на 0.7 перешагнула бы предел
    const blocked = budgetBlock(summary, 0.7);
    expect(blocked).toContain("месячный лимит");
  });

  it("не задевает соседа с другим лимитом", async () => {
    const summary = await readUsage(rich, false);
    expect(budgetBlock(summary, 0.7)).toBeNull();
  });
});

describe("видимость общей картины", () => {
  it("обычный пользователь не видит оборот сервиса", async () => {
    const summary = await readUsage(poor, false);
    expect(summary.global).toBeNull();
  });

  it("администратор видит", async () => {
    const summary = await readUsage(poor, true);
    expect(summary.global).not.toBeNull();
    expect(summary.global!.totalUsd).toBeGreaterThanOrEqual(0.4);
  });
});

describe("общий лимит сервиса", () => {
  it("останавливает всех, когда запас меньше заявки", async () => {
    const summary = await readUsage(rich, false);
    const withNoHeadroom = { ...summary, globalRemainingUsd: 0.05 };
    const blocked = budgetBlock(withNoHeadroom, 0.5);
    expect(blocked).toContain("Общий лимит сервиса");
  });

  it("без общих лимитов запас не ограничивает", async () => {
    const summary = await readUsage(rich, false);
    const unlimited = { ...summary, globalRemainingUsd: null, monthLimitUsd: null };
    expect(budgetBlock(unlimited, 1000)).toBeNull();
  });
});
