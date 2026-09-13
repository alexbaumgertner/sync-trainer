import { describe, expect, it } from "vitest";
import { PRESETS, presetById, presetOptions, qualityFor, supportedLanguages } from "@/presets";
import { buildScriptPrompt, type ScriptParams } from "@/lib/prompt";
import type { StylePreset } from "@/presets";

/**
 * Критерий приёмки T06: добавление пресета не требует правок в коде генерации.
 * Проверяем это буквально — собираем промт выдуманным пресетом, которого нет
 * в реестре, той же функцией.
 */

const params: ScriptParams = {
  sourceLang: "en",
  targetLang: "ru",
  durationMin: 20,
  speakers: 5,
  termDensity: 40,
  traps: ["enumeration", "self-correction"],
  rate: "105%",
};

describe("реестр", () => {
  it("идентификаторы уникальны", () => {
    const ids = PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("варианты для списков совпадают с реестром", () => {
    expect(presetOptions().map((o) => o.value)).toEqual(PRESETS.map((p) => p.id));
  });

  it("у каждого пресета есть хотя бы один язык", () => {
    for (const preset of PRESETS) {
      expect(Object.keys(preset.languages).length, preset.id).toBeGreaterThan(0);
    }
  });

  it("полностью выверен пока только регистр ООН и только для английского", () => {
    const full = PRESETS.flatMap((preset) =>
      Object.entries(preset.languages)
        .filter(([, quality]) => quality === "full")
        .map(([lang]) => `${preset.id}/${lang}`),
    );
    expect(full).toEqual(["un/en"]);
  });

  it("языки собираются из всех пресетов без повторов", () => {
    const languages = supportedLanguages();
    expect(languages).toContain("en");
    expect(new Set(languages).size).toBe(languages.length);
  });

  it("порядок языков стабилен и начинается с выверенного", () => {
    // Порядок попадает в enum схемы базы: перестановка вызвала бы
    // разрушительную миграцию ради ничего. Первым идёт единственный
    // полностью выверенный язык.
    expect(supportedLanguages()[0]).toBe("en");
    expect(supportedLanguages()).toEqual(supportedLanguages());
  });
});

describe("сборка промта", () => {
  it("работает для каждого пресета на каждом заявленном языке", () => {
    for (const preset of PRESETS) {
      for (const lang of Object.keys(preset.languages)) {
        const prompt = buildScriptPrompt({ preset, params: { ...params, sourceLang: lang } });
        expect(prompt.length, `${preset.id}/${lang}`).toBeGreaterThan(500);
        expect(prompt, `${preset.id}/${lang}`).toContain(preset.register.slice(0, 40));
      }
    }
  });

  it("черновой пресет получает предупреждение, выверенный — нет", () => {
    const draft = buildScriptPrompt({ preset: presetById("corporate")!, params });
    expect(draft).toContain("проработан не полностью");

    const full = buildScriptPrompt({ preset: presetById("un")!, params });
    expect(full).not.toContain("проработан не полностью");
  });

  it("переносит запреты пресета в промт", () => {
    const prompt = buildScriptPrompt({ preset: presetById("un")!, params });
    expect(prompt).toContain("points of order");
    expect(prompt).toContain("не упрощай синтаксис");
  });

  it("объём считается из длительности", () => {
    const prompt = buildScriptPrompt({
      preset: presetById("un")!,
      params: { ...params, durationMin: 20 },
    });
    expect(prompt).toContain("2000–2200 слов");
  });

  it("включает только запрошенные трудности", () => {
    const prompt = buildScriptPrompt({
      preset: presetById("un")!,
      params: { ...params, traps: ["self-correction"] },
    });
    expect(prompt).toContain("самокоррекцией");
    expect(prompt).not.toContain("компрессию");
  });

  it("подмешивает выводы прошлых разборов", () => {
    const prompt = buildScriptPrompt({
      preset: presetById("un")!,
      params,
      debriefNotes: ["не хватало терминологии по финансированию"],
    });
    expect(prompt).toContain("не хватало терминологии по финансированию");
  });

  it("различает текст документа и приложенный файл", () => {
    const withText = buildScriptPrompt({ preset: presetById("un")!, params, documentText: "ТЕКСТ" });
    expect(withText).toContain("ТЕКСТ");

    const withFile = buildScriptPrompt({ preset: presetById("un")!, params });
    expect(withFile).toContain("приложен к запросу файлом");
  });

  it("новый пресет не требует правок в генераторе", () => {
    // Пресета нет в реестре — он собран прямо здесь, как это сделал бы автор
    // нового регистра. Функция сборки о нём ничего не знает.
    const invented: StylePreset = {
      id: "medical",
      label: "Медицинский конгресс",
      languages: { en: "draft" },
      setting: "Симпозиум на медицинском конгрессе",
      register: "Клинический регистр с латинской номенклатурой и осторожными выводами.",
      speakerRoles: [
        { role: "Chair", focus: "порядок докладов" },
        { role: "Principal Investigator", focus: "результаты исследования" },
      ],
      vocabulary: { encouraged: ["randomised controlled trial"], forbidden: ["subsidiarity"] },
      terminologySources: ["МКБ-11 на русском"],
      statistics: "Доверительные интервалы, размеры выборки, p-значения.",
      avoid: ["обещания эффективности без данных"],
    };

    const prompt = buildScriptPrompt({ preset: invented, params: { ...params, speakers: 2 } });
    expect(prompt).toContain("Клинический регистр");
    expect(prompt).toContain("Principal Investigator");
    expect(prompt).toContain("МКБ-11");
    expect(prompt).toContain("subsidiarity");
  });
});

describe("качество по языкам", () => {
  it("сообщает качество и отсутствие поддержки", () => {
    const un = presetById("un")!;
    expect(qualityFor(un, "en")).toBe("full");
    expect(qualityFor(un, "de")).toBe("draft");
    expect(qualityFor(presetById("court")!, "tr")).toBeNull();
  });
});
