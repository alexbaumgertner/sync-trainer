import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Записи и счётчики в чужом профиле (P4).
 *
 * Главное здесь — что профиль **не обходной путь** к тому, что закрыто
 * в самой записи, и что счётчик не рассказывает больше, чем список.
 */

const { payloadClient } = await import("@/lib/payload");
const { visibleEngagements } = await import("@/lib/profile-engagements");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let payload: Awaited<ReturnType<typeof payloadClient>>;
let person: number;
let mate: number;
let outsider: number;

const make = async (over: Record<string, unknown>) =>
  payload.create({
    collection: "engagements",
    data: {
      title: `Событие ${Math.random().toString(36).slice(2, 6)}`,
      owner: person,
      heldOn: "2024-05-01",
      mode: "simultaneous",
      sourceLang: "en",
      targetLang: "ru",
      visibility: "team",
      ...over,
    },
    overrideAccess: true,
  });

beforeAll(async () => {
  payload = await payloadClient();
  const makeUser = async (tag: string) =>
    (
      await payload.create({
        collection: "users",
        data: { email: `pe-${tag}-${stamp}@example.test`, role: "interpreter" },
        overrideAccess: true,
      })
    ).id;
  person = await makeUser("person");
  mate = await makeUser("mate");
  outsider = await makeUser("outsider");
});

beforeEach(async () => {
  await payload.delete({
    collection: "engagements",
    where: { owner: { equals: person } },
    overrideAccess: true,
  });
});

afterAll(async () => {
  await payload
    .delete({ collection: "engagements", where: { owner: { equals: person } }, overrideAccess: true })
    .catch(() => {});
  for (const id of [person, mate, outsider]) {
    await payload.delete({ collection: "users", id, overrideAccess: true }).catch(() => {});
  }
});

describe("что видно в чужом профиле", () => {
  it("владелец видит всё своё", async () => {
    await make({ visibility: "private" });
    await make({ visibility: "team" });

    const seen = await visibleEngagements(payload, person, person);
    expect(seen.total).toBe(2);
  });

  it("коллега видит только то, где он назван и связан", async () => {
    await make({ visibility: "private", team: [{ name: "Коллега", user: mate, status: "confirmed" }] });
    await make({ visibility: "team", team: [{ name: "Коллега", user: mate, status: "confirmed" }] });
    await make({ visibility: "team", team: [{ name: "Коллега", status: "listed" }] });
    await make({ visibility: "team" });

    const seen = await visibleEngagements(payload, person, mate);
    // Открыта команде И он в ней связан — ровно одна.
    expect(seen.total).toBe(1);
  });

  it("посторонний не видит ничего", async () => {
    await make({ visibility: "team", team: [{ name: "Коллега", user: mate, status: "confirmed" }] });
    expect((await visibleEngagements(payload, person, outsider)).total).toBe(0);
  });

  it("оспоривший теряет запись из виду", async () => {
    await make({ visibility: "team", team: [{ name: "Коллега", user: mate, status: "disputed" }] });
    expect((await visibleEngagements(payload, person, mate)).total).toBe(0);
  });
});

describe("счётчики", () => {
  it("считаются по видимому, а не по всему", async () => {
    // «34 конференции» при двух показанных — это и есть утечка: число
    // говорит то, чего человек показывать не собирался.
    for (let i = 0; i < 5; i++) await make({ visibility: "private" });
    await make({ visibility: "team", team: [{ name: "Коллега", user: mate, status: "confirmed" }] });

    expect((await visibleEngagements(payload, person, person)).total).toBe(6);
    expect((await visibleEngagements(payload, person, mate)).total).toBe(1);
    expect((await visibleEngagements(payload, person, outsider)).total).toBe(0);
  });

  it("«с какого года» берётся из видимого, а не из самой ранней записи", async () => {
    await make({ visibility: "private", heldOn: "2011-01-01" });
    await make({
      visibility: "team",
      heldOn: "2021-01-01",
      team: [{ name: "Коллега", user: mate, status: "confirmed" }],
    });

    expect((await visibleEngagements(payload, person, person)).sinceYear).toBe(2011);
    // Иначе год выдал бы существование скрытых записей.
    expect((await visibleEngagements(payload, person, mate)).sinceYear).toBe(2021);
  });

  it("без видимых записей года нет вовсе", async () => {
    await make({ visibility: "private" });
    expect((await visibleEngagements(payload, person, outsider)).sinceYear).toBeNull();
  });
});

describe("порядок и предел", () => {
  it("свежие сверху", async () => {
    await make({ heldOn: "2020-01-01", title: `Старое ${stamp}` });
    await make({ heldOn: "2026-01-01", title: `Свежее ${stamp}` });

    const seen = await visibleEngagements(payload, person, person);
    expect(seen.rows[0].title).toContain("Свежее");
  });

  it("список подрезается, а счётчик остаётся полным", async () => {
    for (let i = 0; i < 4; i++) await make({});

    const seen = await visibleEngagements(payload, person, person, 2);
    expect(seen.rows).toHaveLength(2);
    // Счётчик про всё видимое, а не про показанный кусок.
    expect(seen.total).toBe(4);
  });
});
