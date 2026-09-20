import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { getPayload, type Payload } from "payload";
import config from "@payload-config";

/**
 * Требование D1. Проверка владения объявлена в коллекциях, поэтому
 * тестируем её через Local API — тот же путь, которым ходит приложение.
 *
 * Тест намеренно не мокает Payload: права применяет его слой запросов,
 * и на моках проверять было бы нечего.
 */

let payload: Payload;
const stamp = Date.now();
const alice = { email: `alice-${stamp}@example.test`};
const bob = { email: `bob-${stamp}@example.test`};

let aliceUser: { id: number };
let bobUser: { id: number };
let aliceProject: { id: number };

beforeAll(async () => {
  payload = await getPayload({ config });

  aliceUser = await payload.create({
    collection: "users",
    data: { ...alice, role: "interpreter" },
    overrideAccess: true,
  });
  bobUser = await payload.create({
    collection: "users",
    data: { ...bob, role: "interpreter" },
    overrideAccess: true,
  });

  aliceProject = await payload.create({
    collection: "projects",
    data: {
      title: "Стамбульская панель",
      owner: aliceUser.id,
      sourceLang: "en",
      targetLang: "ru",
      stylePreset: "un",
      status: "draft",
    },
    overrideAccess: true,
  });

  await payload.create({
    collection: "glossary-terms",
    data: {
      project: aliceProject.id,
      scope: "project",
      sourceTerm: "backlash",
      targetTerm: "откат",
      status: "suggested",
    },
    overrideAccess: true,
  });
});

afterAll(async () => {
  for (const id of [aliceProject?.id]) {
    if (id) await payload.delete({ collection: "projects", id, overrideAccess: true }).catch(() => {});
  }
  for (const id of [aliceUser?.id, bobUser?.id]) {
    if (id) await payload.delete({ collection: "users", id, overrideAccess: true }).catch(() => {});
  }
});

describe("владение проектом", () => {
  it("владелец видит свой проект", async () => {
    const found = await payload.find({
      collection: "projects",
      where: { id: { equals: aliceProject.id } },
      user: aliceUser as never,
      overrideAccess: false,
    });
    expect(found.docs).toHaveLength(1);
  });

  it("чужой проект не виден в списке", async () => {
    const found = await payload.find({
      collection: "projects",
      user: bobUser as never,
      overrideAccess: false,
    });
    expect(found.docs.map((d) => d.id)).not.toContain(aliceProject.id);
  });

  it("прямой запрос чужого проекта не отдаёт данные", async () => {
    const result = await payload
      .findByID({
        collection: "projects",
        id: aliceProject.id,
        user: bobUser as never,
        overrideAccess: false,
      })
      .catch((error: unknown) => error);

    // Payload отвечает ошибкой доступа, а не содержимым чужого проекта
    expect(result).toBeInstanceOf(Error);
  });

  it("чужой проект нельзя изменить", async () => {
    const result = await payload
      .update({
        collection: "projects",
        id: aliceProject.id,
        data: { title: "Захвачено" },
        user: bobUser as never,
        overrideAccess: false,
      })
      .catch((error: unknown) => error);

    expect(result).toBeInstanceOf(Error);

    const check = await payload.findByID({
      collection: "projects",
      id: aliceProject.id,
      overrideAccess: true,
    });
    expect(check.title).toBe("Стамбульская панель");
  });

  it("анонимный запрос отклоняется", async () => {
    // Payload отвечает Forbidden, а не пустым списком: разницы для утечки нет,
    // но отказ честнее — клиент не примет пустоту за «проектов нет».
    const result = await payload
      .find({ collection: "projects", overrideAccess: false })
      .catch((error: unknown) => error);

    expect(result).toBeInstanceOf(Error);
  });
});

describe("вложенные объекты наследуют владение проектом", () => {
  it("чужой глоссарий не виден", async () => {
    const found = await payload.find({
      collection: "glossary-terms",
      user: bobUser as never,
      overrideAccess: false,
    });
    expect(found.docs).toHaveLength(0);
  });

  it("свой глоссарий виден владельцу проекта", async () => {
    const found = await payload.find({
      collection: "glossary-terms",
      user: aliceUser as never,
      overrideAccess: false,
    });
    expect(found.docs.length).toBeGreaterThan(0);
  });
});

describe("расходы", () => {
  it("пользователь не может создать себе запись о расходе", async () => {
    const result = await payload
      .create({
        collection: "usage-events",
        data: { user: bobUser.id, kind: "audio", chars: 1, costUsd: 0 },
        user: bobUser as never,
        overrideAccess: false,
      })
      .catch((error: unknown) => error);

    expect(result).toBeInstanceOf(Error);
  });
});

describe("подмена владельца при создании", () => {
  it("проект нельзя создать на чужое имя", async () => {
    const created = await payload.create({
      collection: "projects",
      data: {
        title: "Попытка подмены",
        owner: aliceUser.id,
        sourceLang: "en",
        targetLang: "ru",
        stylePreset: "un",
        status: "draft",
      },
      user: bobUser as never,
      overrideAccess: false,
    });

    // Владелец взят из сессии, а не из тела запроса
    const ownerId = typeof created.owner === "object" ? created.owner.id : created.owner;
    expect(ownerId).toBe(bobUser.id);

    await payload.delete({ collection: "projects", id: created.id, overrideAccess: true });
  });
});

/**
 * Кто попадает в админку (Б4 аудита).
 *
 * До починки Payload пускал в оболочку любого вошедшего: данных он бы не
 * показал, но схему целиком — да, а вместе с ней удобный интерфейс для
 * записи. Проверяем саму функцию из конфигурации: через Local API этот
 * путь не проходит, его дёргает только оболочка админки.
 */
describe("доступ в админку", () => {
  it("объявлен у коллекции пользователей", async () => {
    const { Users } = await import("@/collections");
    // Функции нет — значит Payload пускает всех, и это не мелочь оформления.
    expect(typeof Users.access?.admin).toBe("function");
  });

  it("пускает администратора и отказывает остальным", async () => {
    const { Users } = await import("@/collections");
    const ask = (user: unknown) =>
      Users.access!.admin!({ req: { user } } as never);

    expect(await ask({ id: 1, role: "admin" })).toBe(true);
    expect(await ask({ id: 2, role: "interpreter" })).toBe(false);
    expect(await ask({ id: 3 })).toBe(false);
    expect(await ask(null)).toBe(false);
  });
});
