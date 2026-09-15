import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Продуктовая воронка (слой 2 метрик).
 *
 * Проверяется не столько «записалось», сколько два свойства, которые легко
 * потерять при следующей правке: событие не роняет работу человека, и в него
 * нельзя положить текст.
 */

const { payloadClient } = await import("@/lib/payload");
const { recordStep } = await import("@/lib/activity");
const { STEPS, STEP_LABELS } = await import("@/lib/activity-steps");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let payload: Awaited<ReturnType<typeof payloadClient>>;
let userId: number;

beforeAll(async () => {
  payload = await payloadClient();
  userId = (
    await payload.create({
      collection: "users",
      data: { email: `act-${stamp}@example.test`, role: "interpreter" },
      overrideAccess: true,
    })
  ).id as number;
});

afterAll(async () => {
  await payload
    .delete({ collection: "activity", where: { user: { equals: userId } }, overrideAccess: true })
    .catch(() => {});
  await payload.delete({ collection: "users", id: userId, overrideAccess: true }).catch(() => {});
});

describe("запись шага", () => {
  it("сохраняется с пользователем и без проекта", async () => {
    await recordStep(payload, "engagement_created", { user: userId });

    const found = await payload.find({
      collection: "activity",
      where: { user: { equals: userId } },
      depth: 0,
      overrideAccess: true,
    });
    expect(found.totalDocs).toBe(1);
    expect(found.docs[0].step).toBe("engagement_created");
    expect(found.docs[0].project).toBeFalsy();
  });

  it("не бросает наружу, если записать не удалось", async () => {
    // Метрика не стоит того, чтобы из-за неё не сохранился проект человека.
    // Несуществующий пользователь — внешний ключ откажет.
    await expect(
      recordStep(payload, "project_created", { user: 999_999_999 }),
    ).resolves.toBeUndefined();
  });
});

describe("в событие нельзя положить текст", () => {
  it("у коллекции нет свободных полей", async () => {
    // Пользователи работают с материалами заказчиков под NDA. Поле `note`,
    // добавленное «на всякий случай», однажды соберёт названия мероприятий,
    // и вычистить их будет уже неоткуда.
    const { Activity } = await import("@/collections");
    const free = Activity.fields.filter(
      (f) => "type" in f && ["text", "textarea", "richText", "json"].includes(f.type),
    );
    expect(free).toEqual([]);
  });

  it("шаг — перечисление, и подпись есть у каждого", () => {
    for (const step of STEPS) expect(STEP_LABELS[step]).toBeTruthy();
    expect(Object.keys(STEP_LABELS).sort()).toEqual([...STEPS].sort());
  });
});

describe("шаги и миграции не разъезжаются", () => {
  it("каждый шаг заведён в типе-перечислении миграции", () => {
    // Добавить шаг в TypeScript и забыть ALTER TYPE — способ положить запись
    // в проде, оставив тесты зелёными: локально тип держит `push`.
    const dir = path.join(process.cwd(), "migrations");
    const sql = readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && f !== "index.ts")
      .map((f) => readFileSync(path.join(dir, f), "utf8"))
      .join("\n");

    for (const step of STEPS) {
      expect(sql, `шага "${step}" нет в миграциях: в проде запись упадёт`).toContain(`'${step}'`);
    }
  });
});
