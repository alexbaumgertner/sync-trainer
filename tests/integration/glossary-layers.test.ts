import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addNewTerms, inheritedLayers, promoteToPersonal } from "@/lib/glossary-store";

/**
 * Три слоя глоссария (T1–T10).
 *
 * Проверяется то, ради чего слои и заводились: один термин переводится
 * по-разному в разных проектах, личная память сильнее общего справочника,
 * а перекрытое не пропадает из виду. И отдельно — то, что удаление проекта
 * не трогает память: на этом человек теряет годы работы одним щелчком.
 */

const { payloadClient } = await import("@/lib/payload");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let payload: Awaited<ReturnType<typeof payloadClient>>;
let userId: number;
let otherId: number;
const projects: number[] = [];
const loose: number[] = [];

const makeProject = async (title: string) => {
  const project = await payload.create({
    collection: "projects",
    data: {
      title: `${title} ${stamp}`,
      owner: userId,
      sourceLang: "en",
      targetLang: "ru",
      stylePreset: "un",
      status: "draft",
    },
    overrideAccess: true,
  });
  projects.push(project.id);
  return project.id;
};

const layerTerm = async (
  scope: "personal" | "shared",
  source: string,
  target: string,
  owner?: number,
) => {
  const term = await payload.create({
    collection: "glossary-terms",
    data: { scope, owner, sourceTerm: source, targetTerm: target, status: "verified" },
    overrideAccess: true,
  });
  loose.push(term.id);
  return term.id;
};

const projectTerms = async (projectId: number) =>
  (
    await payload.find({
      collection: "glossary-terms",
      where: { project: { equals: projectId } },
      limit: 100,
      depth: 0,
      overrideAccess: true,
    })
  ).docs;

beforeAll(async () => {
  payload = await payloadClient();
  userId = (
    await payload.create({
      collection: "users",
      data: { email: `layers-${stamp}@example.test`, role: "interpreter" },
      overrideAccess: true,
    })
  ).id as number;
  otherId = (
    await payload.create({
      collection: "users",
      data: { email: `layers-other-${stamp}@example.test`, role: "interpreter" },
      overrideAccess: true,
    })
  ).id as number;
});

afterAll(async () => {
  for (const id of loose) {
    await payload.delete({ collection: "glossary-terms", id, overrideAccess: true }).catch(() => {});
  }
  for (const id of projects) {
    await payload.delete({ collection: "projects", id, overrideAccess: true }).catch(() => {});
  }
  for (const id of [userId, otherId]) {
    await payload.delete({ collection: "users", id, overrideAccess: true }).catch(() => {});
  }
});

describe("ближний слой перекрывает дальний", () => {
  it("личный сильнее общего", async () => {
    await layerTerm("shared", `due diligence ${stamp}`, "должная осмотрительность");
    await layerTerm("personal", `due diligence ${stamp}`, "проверка добросовестности", userId);

    const map = await inheritedLayers(payload, userId);
    const found = map.get(`due diligence ${stamp}`.toLowerCase());

    expect(found?.target).toBe("проверка добросовестности");
    expect(found?.from).toBe("personal");
  });

  it("чужая личная память не подставляется", async () => {
    await layerTerm("personal", `relay ${stamp}`, "чужой вариант", otherId);

    const map = await inheritedLayers(payload, userId);

    expect(map.has(`relay ${stamp}`.toLowerCase())).toBe(false);
  });

  it("эквивалент из памяти сильнее свежей догадки модели", async () => {
    await layerTerm("personal", `headroom ${stamp}`, "запас прочности", userId);
    const projectId = await makeProject("Подстановка");

    const map = await inheritedLayers(payload, userId);
    const report = await addNewTerms(
      payload,
      projectId,
      [{ source: `headroom ${stamp}`, target: "свободное место" }],
      [],
      map,
    );

    expect(report.inherited).toBe(1);
    const [term] = await projectTerms(projectId);
    expect(term.targetTerm).toBe("запас прочности");
    expect(term.inheritedFrom).toBe("personal");
    // Подставленный термин уже проверен человеком — пометки «предложен
    // моделью» на нём быть не должно.
    expect(term.status).toBe("verified");
  });
});

describe("один термин — разные проекты", () => {
  it("свой эквивалент в проекте не трогает память и не мешает соседу", async () => {
    const source = `framework agreement ${stamp}`;
    await layerTerm("personal", source, "рамочное соглашение", userId);

    const court = await makeProject("Суд");
    const corporate = await makeProject("Корпоратив");
    const map = await inheritedLayers(payload, userId);

    await addNewTerms(payload, court, [{ source, target: "от модели" }], [], map);
    await addNewTerms(payload, corporate, [{ source, target: "от модели" }], [], map);

    // В суде переводчик перекрывает своим
    const [courtTerm] = await projectTerms(court);
    await payload.update({
      collection: "glossary-terms",
      id: courtTerm.id,
      data: { targetTerm: "базовый договор" },
      overrideAccess: true,
    });

    const [afterCourt] = await projectTerms(court);
    const [afterCorporate] = await projectTerms(corporate);

    expect(afterCourt.targetTerm).toBe("базовый договор");
    // Перекрытое остаётся видно: без этого человек не узнает, что перекрыл
    expect(afterCourt.inheritedTarget).toBe("рамочное соглашение");
    // Соседний проект и личная память не изменились
    expect(afterCorporate.targetTerm).toBe("рамочное соглашение");

    const memory = await inheritedLayers(payload, userId);
    expect(memory.get(source.toLowerCase())?.target).toBe("рамочное соглашение");
  });
});

describe("память переживает проекты", () => {
  it("удаление проекта не трогает личный и общий слои", async () => {
    const source = `graduation ${stamp}`;
    await layerTerm("personal", source, "утрата права", userId);
    const projectId = await makeProject("Удаляемый");
    await addNewTerms(payload, projectId, [{ source, target: "что угодно" }], []);

    await payload.delete({ collection: "projects", id: projectId, overrideAccess: true });

    const map = await inheritedLayers(payload, userId);
    expect(map.get(source.toLowerCase())?.target).toBe("утрата права");
  });
});

describe("перенос в память — только руками", () => {
  it("закрепление заводит термин в личном слое как подтверждённый", async () => {
    const source = `blended finance ${stamp}`;
    const result = await promoteToPersonal(payload, userId, {
      sourceTerm: source,
      targetTerm: "смешанное финансирование",
    });

    expect(result).toBe("created");
    const map = await inheritedLayers(payload, userId);
    expect(map.get(source.toLowerCase())?.target).toBe("смешанное финансирование");
  });

  it("повторное закрепление обновляет, а не задваивает", async () => {
    const source = `concessional ${stamp}`;
    await promoteToPersonal(payload, userId, { sourceTerm: source, targetTerm: "льготный" });
    const again = await promoteToPersonal(payload, userId, {
      sourceTerm: source,
      targetTerm: "на льготных условиях",
    });

    expect(again).toBe("updated");

    const found = await payload.find({
      collection: "glossary-terms",
      where: {
        and: [{ scope: { equals: "personal" } }, { sourceTerm: { equals: source } }],
      },
      limit: 10,
      depth: 0,
      overrideAccess: true,
    });
    expect(found.docs).toHaveLength(1);
    expect(found.docs[0].targetTerm).toBe("на льготных условиях");
  });

  it("термин без эквивалента памятью не становится", async () => {
    const result = await promoteToPersonal(payload, userId, {
      sourceTerm: `empty ${stamp}`,
      targetTerm: null,
    });
    expect(result).toBe("skipped");
  });
});

describe("общий справочник правит только владелец сервиса (T9)", () => {
  it("пользователь видит общий слой", async () => {
    await layerTerm("shared", `civic space ${stamp}`, "гражданское пространство");

    const asUser = await payload.find({
      collection: "glossary-terms",
      where: { sourceTerm: { equals: `civic space ${stamp}` } },
      user: { id: userId, collection: "users", role: "interpreter" } as never,
      overrideAccess: false,
    });

    expect(asUser.docs.length).toBe(1);
  });

  it("но завести в нём термин не может", async () => {
    // Пусти сюда пользователей — и первый же случайный эквивалент уедет
    // всем, а вычищать его будет некому.
    await expect(
      payload.create({
        collection: "glossary-terms",
        data: {
          scope: "shared",
          sourceTerm: `подлог ${stamp}`,
          targetTerm: "что угодно",
          status: "verified",
        },
        user: { id: userId, collection: "users", role: "interpreter" } as never,
        overrideAccess: false,
      }),
    ).rejects.toThrow();
  });

  it("чужой личный слой не виден и не правится", async () => {
    const id = await layerTerm("personal", `чужое ${stamp}`, "чужой перевод", otherId);

    const visible = await payload.find({
      collection: "glossary-terms",
      where: { id: { equals: id } },
      user: { id: userId, collection: "users", role: "interpreter" } as never,
      overrideAccess: false,
    });
    expect(visible.docs).toHaveLength(0);

    await expect(
      payload.update({
        collection: "glossary-terms",
        id,
        data: { targetTerm: "подменён" },
        user: { id: userId, collection: "users", role: "interpreter" } as never,
        overrideAccess: false,
      }),
    ).rejects.toThrow();
  });
});
