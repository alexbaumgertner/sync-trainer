import { describe, expect, it } from "vitest";
import { PRESETS, localizePreset, presetById, qualityFor, supportedLanguages } from "@/presets";
import { toStylePreset, lines } from "@/presets/custom";
import { buildScriptPrompt, type ScriptParams } from "@/lib/prompt";
import { defaultVoiceFor, fallbackVoices, languageOf } from "@/lib/voices";

const params: ScriptParams = {
  sourceLang: "es",
  targetLang: "ru",
  durationMin: 20,
  speakers: 4,
  termDensity: 40,
  traps: [],
  rate: "100%",
};

describe("испанский язык речи", () => {
  it("входит в список языков после турецкого", () => {
    expect(supportedLanguages()).toEqual(["en", "de", "fr", "tr", "es"]);
  });

  it("промт называет язык и не тащит английский словарь", () => {
    const prompt = buildScriptPrompt({ preset: presetById("un")!, params });
    expect(prompt).toContain("Язык скрипта: испанском");
    expect(prompt).toContain("ES → RU");
    expect(prompt).toContain("rendición de cuentas");
    expect(prompt).not.toContain("gender mainstreaming");
  });

  it("у испанского пресета роли на испанском", () => {
    const localized = localizePreset(presetById("un")!, "es");
    expect(localized.speakerRoles[0].role).toBe("Moderador");
  });

  it("голоса по умолчанию и запасные — испанские, а не английские", () => {
    expect(languageOf(defaultVoiceFor("es"))).toMatch(/^es-/);
    for (const voice of fallbackVoices("es")) expect(voice.languageCode).toMatch(/^es-/);
    expect(defaultVoiceFor("en")).toMatch(/^en-US/);
  });
});

describe("пресет «Деловой перевод»", () => {
  const business = presetById("business")!;

  it("доступен на всех языках речи как черновой", () => {
    for (const lang of supportedLanguages()) expect(qualityFor(business, lang), lang).toBe("draft");
  });

  it("собирает промт на каждом языке с локальными ролями", () => {
    for (const lang of supportedLanguages()) {
      const prompt = buildScriptPrompt({ preset: business, params: { ...params, sourceLang: lang } });
      expect(prompt, lang).toContain("Деловые переговоры");
      if (lang !== "en") expect(prompt, lang).not.toContain("scope of work");
    }
  });

  it("зарегистрирован в реестре один раз", () => {
    expect(PRESETS.filter((preset) => preset.id === "business")).toHaveLength(1);
  });
});

describe("стилистика из админки", () => {
  const doc = {
    id: 7,
    label: "Медицина",
    setting: "Консилиум",
    register: "Клинический регистр, короткие формулы.",
    speakerRoles: "Cardiologist — тактика лечения\nRadiologist",
    encouraged: "- ejection fraction\n\ncontrast study",
    forbidden: "slang",
    extra: "Всегда называй дозировки полностью.",
  };

  it("разбирает списки построчно, без маркеров и пустых строк", () => {
    expect(lines("- a\n\n  • b \n* c")).toEqual(["a", "b", "c"]);
  });

  it("превращается в пресет, который держит словарь на любом языке", () => {
    const preset = toStylePreset(doc, "es");
    expect(preset.id).toBe("custom:7");
    expect(preset.speakerRoles[0]).toEqual({ role: "Cardiologist", focus: "тактика лечения" });
    expect(preset.speakerRoles[1]).toEqual({ role: "Radiologist", focus: "" });
    expect(localizePreset(preset, "es").vocabulary.encouraged).toEqual([
      "ejection fraction",
      "contrast study",
    ]);
    expect(qualityFor(preset, "es")).toBe("draft");
  });

  it("попадает в промт: регистр, словарь и дополнительные указания", () => {
    const prompt = buildScriptPrompt({ preset: toStylePreset(doc, "es"), params });
    expect(prompt).toContain("Клинический регистр");
    expect(prompt).toContain("ejection fraction");
    expect(prompt).toContain("Дополнительные указания стилистики");
    expect(prompt).toContain("дозировки");
    expect(prompt).toContain("проработан не полностью");
  });
});
