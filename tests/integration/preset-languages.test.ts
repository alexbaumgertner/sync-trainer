import { describe, expect, it } from "vitest";

/**
 * Черновые пресеты для DE, FR, TR (T13).
 *
 * Голоса Google проверены отдельно: de — 42, fr — 87, tr — 40, причём у
 * турецкого нет ни Neural2, ни Studio, зато 30 голосов Chirp 3 HD — а это
 * и есть основной путь. Пяти разных спикеров хватает на любом языке.
 *
 * Здесь проверяется то, что ломалось молча: пресет описан по-английски, и
 * без приведения к языку в немецкий скрипт уезжали английские обороты.
 */

const { PRESETS, presetById, localizePreset, qualityFor } = await import("@/presets");
const { buildScriptPrompt } = await import("@/lib/prompt");

const LANGS = ["de", "fr", "tr"] as const;

const promptFor = (presetId: string, lang: string) =>
  buildScriptPrompt({
    preset: presetById(presetId)!,
    params: {
      sourceLang: lang,
      targetLang: "ru",
      durationMin: 20,
      speakers: 5,
      termDensity: 40,
      traps: [],
      rate: "105%",
    },
    documentText: "Konzeptpapier.",
  });

describe("приведение пресета к языку", () => {
  it("английский остаётся как есть", () => {
    const un = presetById("un")!;
    expect(localizePreset(un, "en")).toBe(un);
  });

  it.each(LANGS)("для %s не остаётся английских оборотов", (lang) => {
    const local = localizePreset(presetById("un")!, lang);
    const english = presetById("un")!.vocabulary.encouraged;

    for (const term of local.vocabulary.encouraged) {
      expect(english).not.toContain(term);
    }
  });

  it("без выверенного словаря в промт не уходит ничего, а не английское", () => {
    // Пресет без perLanguage: проверяем сам механизм, а не наполнение.
    const bare = { ...presetById("un")!, perLanguage: undefined };
    const local = localizePreset(bare, "de");

    expect(local.vocabulary.encouraged).toEqual([]);
    expect(local.vocabulary.forbidden).toEqual([]);
    // Роли при этом остаются: без них модель не поймёт состав панели вовсе.
    expect(local.speakerRoles).toEqual(bare.speakerRoles);
  });
});

describe("промт на других языках", () => {
  it.each(LANGS)("для %s не содержит английских клише из пресета", (lang) => {
    const prompt = promptFor("un", lang);
    for (const term of presetById("un")!.vocabulary.encouraged) {
      expect(prompt).not.toContain(term);
    }
  });

  it.each(LANGS)("для %s помечает регистр как непроработанный", (lang) => {
    expect(qualityFor(presetById("un")!, lang)).toBe("draft");
    expect(promptFor("un", lang)).toContain("проработан не полностью");
  });

  it("без словаря велит брать обороты языка, а не переводить английские", () => {
    const bare = { ...presetById("un")!, perLanguage: undefined };
    const prompt = buildScriptPrompt({
      preset: bare,
      params: {
        sourceLang: "de",
        targetLang: "ru",
        durationMin: 20,
        speakers: 5,
        termDensity: 40,
        traps: [],
        rate: "105%",
      },
    });

    expect(prompt).toContain("на немецком языке");
    expect(prompt).toContain("Не переводи английские клише дословно");
    expect(prompt).not.toContain("Характерные для этого регистра обороты");
  });

  it("на английском словарь пресета по-прежнему уходит в промт", () => {
    const prompt = promptFor("un", "en");
    expect(prompt).toContain("Характерные для этого регистра обороты");
    expect(prompt).toContain(presetById("un")!.vocabulary.encouraged[0]);
  });
});

describe("наполнение черновиков", () => {
  it.each(LANGS)("у пресета ООН для %s есть словарь и роли", (lang) => {
    const local = localizePreset(presetById("un")!, lang);
    expect(local.vocabulary.encouraged.length).toBeGreaterThanOrEqual(5);
    // Пять спикеров — столько же ролей нужно, иначе состав панели урежется.
    expect(local.speakerRoles.length).toBeGreaterThanOrEqual(5);
  });

  it("каждый язык пресета объявлен и в languages, иначе его не выбрать", () => {
    for (const preset of PRESETS) {
      for (const lang of Object.keys(preset.perLanguage ?? {})) {
        expect(
          qualityFor(preset, lang),
          `${preset.id}: есть словарь для ${lang}, но язык не объявлен`,
        ).not.toBeNull();
      }
    }
  });
});
