import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Границы между пользователями (Б1, Б2 аудита от 15.09).
 *
 * Обе дыры нашёл аудит, и обе были не гипотезой: воспроизводились скриптом
 * на локальной базе. Читать чужое приложение не давало и раньше — оно давало
 * ПИСАТЬ в чужой проект, а через подменённый путь файла ещё и прочитать
 * чужой скрипт.
 *
 * Тест написан от лица нападающего: он пробует ровно то, что получалось,
 * и каждая проверка падает, если снять соответствующий хук.
 */

const { payloadClient } = await import("@/lib/payload");
const { insideProject, artifactPath } = await import("@/lib/artifact-path");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let payload: Awaited<ReturnType<typeof payloadClient>>;
let victim: { id: number };
let attacker: { id: number };
let admin: { id: number };
let victimProject: number;
let attackerProject: number;

/** Дочерние коллекции и минимальные данные для каждой. */
const CHILDREN: [string, Record<string, unknown>][] = [
  ["glossary-terms", { sourceTerm: "подсадка", status: "suggested" }],
  ["debriefs", { hardest: "подсадка" }],
  ["documents", { filename: "подсадка.pdf" }],
  ["generations", { kind: "script", status: "running" }],
];

const create = (collection: string, data: Record<string, unknown>, user: unknown) =>
  payload.create({
    collection: collection as "documents",
    data: data as never,
    user: user as never,
    overrideAccess: false,
  });

beforeAll(async () => {
  payload = await payloadClient();

  const makeUser = async (tag: string, role: "interpreter" | "admin" = "interpreter") =>
    (await payload.create({
      collection: "users",
      data: { email: `xt-${tag}-${stamp}@example.test`, role },
      overrideAccess: true,
    })) as unknown as { id: number };

  victim = await makeUser("victim");
  attacker = await makeUser("attacker");
  admin = await makeUser("admin", "admin");

  const makeProject = async (owner: number, title: string) =>
    (
      await payload.create({
        collection: "projects",
        data: {
          title,
          owner,
          sourceLang: "en",
          targetLang: "ru",
          stylePreset: "un",
          status: "draft",
        },
        overrideAccess: true,
      })
    ).id;

  victimProject = await makeProject(victim.id, `Проект жертвы ${stamp}`);
  attackerProject = await makeProject(attacker.id, `Проект атакующего ${stamp}`);
});

afterAll(async () => {
  for (const id of [victimProject, attackerProject]) {
    await payload.delete({ collection: "projects", id, overrideAccess: true }).catch(() => {});
  }
  for (const u of [victim, attacker, admin]) {
    await payload.delete({ collection: "users", id: u.id, overrideAccess: true }).catch(() => {});
  }
});

describe("запись в чужой проект (Б1)", () => {
  for (const [collection, data] of CHILDREN) {
    it(`${collection}: посторонний не может создать строку`, async () => {
      await expect(
        create(collection, { ...data, project: victimProject }, attacker),
      ).rejects.toThrow();
    });
  }

  it("в свой проект — можно, иначе мы сломали приложение", async () => {
    const doc = await create(
      "glossary-terms",
      { sourceTerm: "своё", status: "suggested", project: attackerProject },
      attacker,
    );
    expect(doc.id).toBeTruthy();
  });

  it("правкой тоже не переставить строку в чужой проект", async () => {
    // Доступ отбирает, КАКУЮ строку менять, но не куда её переставить:
    // без хука это был второй вход в ту же дыру.
    const mine = await create(
      "glossary-terms",
      { sourceTerm: "переезд", status: "suggested", project: attackerProject },
      attacker,
    );

    await expect(
      payload.update({
        collection: "glossary-terms",
        id: mine.id,
        data: { project: victimProject },
        user: attacker as never,
        overrideAccess: false,
      }),
    ).rejects.toThrow();
  });

  it("жертва ничего не получила в свой проект", async () => {
    const seen = await payload.find({
      collection: "glossary-terms",
      where: { project: { equals: victimProject } },
      user: victim as never,
      overrideAccess: false,
      depth: 0,
    });
    expect(seen.totalDocs).toBe(0);
  });

  it("администратор по-прежнему может завести строку в чужом проекте", async () => {
    const doc = await create(
      "debriefs",
      { hardest: "разбор администратора", project: victimProject },
      admin,
    );
    expect(doc.id).toBeTruthy();
    await payload.delete({ collection: "debriefs", id: doc.id, overrideAccess: true });
  });

  it("серверный код проходит: Local API без пользователя", async () => {
    // Маршруты приложения владение проверяют сами и зовут Payload с
    // overrideAccess. Если хук перекроет и этот путь, встанет генерация.
    const doc = await payload.create({
      collection: "generations",
      data: { project: victimProject, kind: "script", status: "running" },
      overrideAccess: true,
    });
    expect(doc.id).toBeTruthy();
    await payload.delete({ collection: "generations", id: doc.id, overrideAccess: true });
  });
});

describe("подмена пути файла (Б2)", () => {
  it("артефакт с чужим путём не создаётся даже в своём проекте", async () => {
    // Именно так дыра и работала: строка своя, права сходятся, путь чужой.
    await expect(
      create(
        "artifacts",
        {
          project: attackerProject,
          kind: "script",
          blobPath: artifactPath(victimProject, "script.md"),
          bytes: 1,
        },
        attacker,
      ),
    ).rejects.toThrow();
  });

  it("путь к резервным копиям тоже не принимается", async () => {
    await expect(
      create(
        "artifacts",
        {
          project: attackerProject,
          kind: "script",
          blobPath: "backups/2026-09-15-03-00-00.json.enc",
          bytes: 1,
        },
        attacker,
      ),
    ).rejects.toThrow();
  });

  it("свой путь принимается", async () => {
    const doc = await create(
      "artifacts",
      {
        project: attackerProject,
        kind: "script",
        blobPath: artifactPath(attackerProject, "script.md"),
        bytes: 1,
      },
      attacker,
    );
    expect((doc as { blobPath?: string }).blobPath).toBe(
      artifactPath(attackerProject, "script.md"),
    );
  });

  it("серверная запись артефакта проверяется тоже", async () => {
    // Хук стоит на коллекции, а не на пользователе: путь неверен независимо
    // от того, кто его записал. Ошибка в нашем коде поймается здесь же.
    await expect(
      payload.create({
        collection: "artifacts",
        data: { project: attackerProject, kind: "script", blobPath: "projects/999/script.md" },
        overrideAccess: true,
      }),
    ).rejects.toThrow();
  });
});

describe("разбор пути", () => {
  it("свой каталог проекта — да", () => {
    expect(insideProject("projects/7/script.md", 7)).toBe(true);
    expect(insideProject("projects/7/audio.mp3", "7")).toBe(true);
  });

  it("чужой каталог — нет", () => {
    expect(insideProject("projects/8/script.md", 7)).toBe(false);
  });

  it("выход наверх не проходит, хотя начало верное", () => {
    // `startsWith` в одиночку это пропускает — потому его и мало.
    expect(insideProject("projects/7/../8/script.md", 7)).toBe(false);
  });

  it("вложенный каталог и пустое имя — нет", () => {
    expect(insideProject("projects/7/nested/script.md", 7)).toBe(false);
    expect(insideProject("projects/7/", 7)).toBe(false);
  });

  it("похожий по началу идентификатор не считается своим", () => {
    // Без завершающего слэша в префиксе проект 7 забрал бы файлы проекта 70.
    expect(insideProject("projects/70/script.md", 7)).toBe(false);
  });
});
