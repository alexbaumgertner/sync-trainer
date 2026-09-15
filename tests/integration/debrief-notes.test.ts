import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";

/**
 * E4: выводы из прошлых разборов попадают в промт следующей генерации.
 *
 * Приёмка задачи — «два проекта с разными разборами дают заметно разные
 * скрипты». Сравнивать сами скрипты нельзя: модель недетерминирована, и
 * такой тест мерил бы погоду. Проверяется то, что в нашей власти и что
 * целиком определяет разницу, — промт.
 */

const { payloadClient } = await import("@/lib/payload");
const { debriefNotesFor } = await import("@/lib/debrief-notes");
const { buildScriptPrompt } = await import("@/lib/prompt");
const { presetById } = await import("@/presets");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let payload: Awaited<ReturnType<typeof payloadClient>>;
let userId: number;
let otherUserId: number;
const projects: number[] = [];

const makeProject = async (owner: number, title: string, eventName?: string) => {
  const project = await payload.create({
    collection: "projects",
    data: {
      title,
      eventName,
      owner,
      sourceLang: "en",
      targetLang: "ru",
      stylePreset: "un",
      status: "held",
    },
    overrideAccess: true,
  });
  projects.push(project.id);
  return project.id;
};

const promptFor = (notes: string[]) =>
  buildScriptPrompt({
    preset: presetById("un")!,
    params: {
      sourceLang: "en",
      targetLang: "ru",
      durationMin: 20,
      speakers: 5,
      termDensity: 40,
      traps: [],
      rate: "105%",
    },
    documentText: "Concept note on financing.",
    debriefNotes: notes,
  });

beforeAll(async () => {
  payload = await payloadClient();
  const makeUser = async (tag: string) =>
    (
      await payload.create({
        collection: "users",
        data: { email: `dn-${tag}-${stamp}@example.test`, role: "interpreter" },
        overrideAccess: true,
      })
    ).id;
  userId = await makeUser("own");
  otherUserId = await makeUser("other");
});

beforeEach(async () => {
  for (const id of projects.splice(0)) {
    await payload.delete({ collection: "projects", id, overrideAccess: true }).catch(() => {});
  }
});

afterAll(async () => {
  for (const id of projects) {
    await payload.delete({ collection: "projects", id, overrideAccess: true }).catch(() => {});
  }
  for (const id of [userId, otherUserId]) {
    await payload.delete({ collection: "users", id, overrideAccess: true }).catch(() => {});
  }
});

describe("сбор выводов", () => {
  it("без прошлых разборов выводов нет — и промт остаётся обычным", async () => {
    const current = await makeProject(userId, `Текущий ${stamp}`);
    expect(await debriefNotesFor(payload, userId, current)).toEqual([]);
    expect(promptFor([])).not.toContain("Что переводчик отмечал");
  });

  it("собирает трудное, расхождение и темп прошлого события", async () => {
    const past = await makeProject(userId, `Прошлый ${stamp}`, "Совет по правам человека");
    const current = await makeProject(userId, `Текущий ${stamp}`);

    await payload.create({
      collection: "debriefs",
      data: {
        project: past,
        hardest: "плотные цифры в панели про долг",
        surprises: "добавили незаявленного спикера",
        actualPace: "much-faster",
      },
      overrideAccess: true,
    });

    const notes = await debriefNotesFor(payload, userId, current);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("Совет по правам человека");
    expect(notes[0]).toContain("плотные цифры");
    expect(notes[0]).toContain("незаявленного спикера");
    expect(notes[0]).toContain("ГОРАЗДО быстрее");
  });

  it("термины «из практики» идут отдельной строкой — это промахи модели", async () => {
    const past = await makeProject(userId, `Прошлый ${stamp}`);
    const current = await makeProject(userId, `Текущий ${stamp}`);

    await payload.create({
      collection: "debriefs",
      data: { project: past, hardest: "темп" },
      overrideAccess: true,
    });
    for (const [term, status] of [
      ["rechannelling", "from-practice"],
      ["callable capital", "from-practice"],
      ["headroom", "suggested"],
    ] as const) {
      await payload.create({
        collection: "glossary-terms",
        data: { project: past, sourceTerm: term, status },
        overrideAccess: true,
      });
    }

    const notes = await debriefNotesFor(payload, userId, current);
    const missed = notes.find((n) => n.includes("не хватило терминов"));
    expect(missed).toContain("rechannelling");
    expect(missed).toContain("callable capital");
    // Предложенный моделью термин промахом не был — его в списке быть не должно.
    expect(missed).not.toContain("headroom");
  });

  it("свой собственный разбор в промт не попадает", async () => {
    const current = await makeProject(userId, `Текущий ${stamp}`);
    await payload.create({
      collection: "debriefs",
      data: { project: current, hardest: "это разбор самого этого проекта" },
      overrideAccess: true,
    });

    // Иначе перегенерация после события объясняла бы модели, чего не хватило
    // в ней же самой.
    expect(await debriefNotesFor(payload, userId, current)).toEqual([]);
  });

  it("чужие разборы не подмешиваются", async () => {
    const foreign = await makeProject(otherUserId, `Чужой ${stamp}`);
    const current = await makeProject(userId, `Текущий ${stamp}`);
    await payload.create({
      collection: "debriefs",
      data: { project: foreign, hardest: "чужая трудность" },
      overrideAccess: true,
    });

    expect(await debriefNotesFor(payload, userId, current)).toEqual([]);
  });

  it("берутся три последних события, а не все подряд", async () => {
    const current = await makeProject(userId, `Текущий ${stamp}`);
    for (let i = 1; i <= 5; i++) {
      const past = await makeProject(userId, `Прошлый ${i} ${stamp}`, `Событие ${i}`);
      await payload.create({
        collection: "debriefs",
        data: { project: past, hardest: `трудность номер ${i}` },
        overrideAccess: true,
      });
    }

    const notes = await debriefNotesFor(payload, userId, current);
    expect(notes).toHaveLength(3);
    // Свежие, а не первые попавшиеся: терминология и повестка стареют.
    expect(notes.join(" ")).toContain("трудность номер 5");
    expect(notes.join(" ")).not.toContain("трудность номер 1");
  });
});

describe("промт", () => {
  it("с разными разборами получается заметно разным — это приёмка задачи", () => {
    const a = promptFor(["«Панель по долгу» — труднее всего давалось: плотные цифры"]);
    const b = promptFor(["«Суд в Гааге» — труднее всего давалось: латинские формулы"]);

    expect(a).not.toBe(b);
    expect(a).toContain("плотные цифры");
    expect(b).toContain("латинские формулы");
    expect(a).not.toContain("латинские формулы");

    // И оба отличаются от промта без разборов — иначе вся задача впустую.
    const plain = promptFor([]);
    expect(a).not.toBe(plain);
    expect(plain).not.toContain("Что переводчик отмечал");
  });

  it("выводы попадают в раздел с указанием, что с ними делать", () => {
    const prompt = promptFor(["не хватило терминов: rechannelling"]);
    expect(prompt).toContain("Что переводчик отмечал после прошлых мероприятий");
    expect(prompt).toContain("rechannelling");
    expect(prompt).toContain("усиль темы, где были пробелы");
  });
});
