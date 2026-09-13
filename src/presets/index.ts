import type { PresetQuality, StylePreset } from "./types";
import { un } from "./un";
import { court } from "./court";
import { eu } from "./eu";
import { corporate } from "./corporate";

export type { StylePreset, PresetQuality, SpeakerRole } from "./types";

/**
 * Единственное место, где перечислены пресеты. Отсюда их берут и форма
 * создания проекта, и описание коллекции, и генератор промта — поэтому
 * добавление пресета не требует правок ни в одном из них.
 */
export const PRESETS: StylePreset[] = [un, court, eu, corporate];

export const presetById = (id: string): StylePreset | undefined =>
  PRESETS.find((preset) => preset.id === id);

/** Варианты для выпадающих списков и описания коллекции Payload. */
export const presetOptions = (): { label: string; value: string }[] =>
  PRESETS.map((preset) => ({ label: preset.label, value: preset.id }));

/** Языки, на которых пресет вообще можно использовать. */
export const presetLanguages = (preset: StylePreset): string[] =>
  Object.keys(preset.languages);

export const qualityFor = (preset: StylePreset, lang: string): PresetQuality | null =>
  preset.languages[lang] ?? null;

/**
 * Порядок языков задан явно, а не алфавитом: он попадает в enum схемы базы,
 * и перестановка значений вызвала бы разрушительную миграцию ради ничего.
 * Первым идёт единственный полностью выверенный язык.
 */
const LANGUAGE_ORDER = ["en", "de", "fr", "tr"];

/** Языки, для которых готов хотя бы один пресет. */
export const supportedLanguages = (): string[] => {
  const present = new Set(PRESETS.flatMap(presetLanguages));
  const known = LANGUAGE_ORDER.filter((lang) => present.has(lang));
  const rest = [...present].filter((lang) => !LANGUAGE_ORDER.includes(lang)).sort();
  return [...known, ...rest];
};
