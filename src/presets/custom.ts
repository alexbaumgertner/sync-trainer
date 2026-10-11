import type { SpeakerRole, StylePreset } from "./types";

/** Запись коллекции `style-presets` в том виде, в каком она нужна преобразованию. */
export interface CustomStyleDoc {
  id: number | string;
  label: string;
  setting: string;
  register: string;
  speakerRoles?: string | null;
  encouraged?: string | null;
  forbidden?: string | null;
  terminologySources?: string | null;
  statistics?: string | null;
  avoid?: string | null;
  extra?: string | null;
}

/** Пункты списка — по строке; пустые строки и маркеры «-» в начале отбрасываем. */
export const lines = (text: string | null | undefined): string[] =>
  (text ?? "")
    .split("\n")
    .map((line) => line.replace(/^\s*[-•*]\s+/, "").trim())
    .filter(Boolean);

/** «Роль — фокус»; без разделителя вся строка — роль, фокус пуст. */
const parseRole = (line: string): SpeakerRole => {
  const match = line.match(/^(.+?)\s+[—–-]\s+(.+)$/);
  return match ? { role: match[1].trim(), focus: match[2].trim() } : { role: line, focus: "" };
};

/**
 * Стилистика из админки как обычный пресет.
 *
 * Язык нужен, потому что `localizePreset` для всех языков, кроме английского,
 * берёт словарь только из `perLanguage`. Термины в админке пишут на языке,
 * для которого выбирают стилистику, поэтому кладём их под язык проекта.
 * Качество всегда «черновое»: носитель такой стилистики не проверял.
 */
export function toStylePreset(doc: CustomStyleDoc, lang: string): StylePreset {
  const roles = lines(doc.speakerRoles).map(parseRole);
  const encouraged = lines(doc.encouraged);
  const forbidden = lines(doc.forbidden);
  const sources = lines(doc.terminologySources);

  return {
    id: `custom:${doc.id}`,
    label: doc.label,
    languages: { [lang]: "draft" },
    setting: doc.setting,
    register: doc.register,
    speakerRoles: roles.length
      ? roles
      : [
          { role: "Moderator", focus: "ведёт обсуждение" },
          { role: "Speaker", focus: "излагает позицию" },
        ],
    vocabulary: { encouraged, forbidden },
    perLanguage: { [lang]: { encouraged, forbidden } },
    terminologySources: sources.length ? sources : ["отраслевые глоссарии по теме"],
    statistics: doc.statistics?.trim() || "Цифры уместны в меру и подаются со ссылкой на источник.",
    avoid: lines(doc.avoid),
    extra: doc.extra?.trim() || undefined,
  };
}
