import type { StylePreset } from "@/presets";
import { qualityFor } from "@/presets";

/**
 * Сборка промта для генерации скрипта.
 *
 * Функция одна на все пресеты: она читает описание регистра и подставляет его
 * в общий каркас. Поэтому добавление нового пресета не требует правок здесь —
 * достаточно положить файл в src/presets и перечислить его в реестре.
 */

export type Trap = "enumeration" | "self-correction" | "dense-numbers";

export const TRAP_LABELS: Record<Trap, string> = {
  enumeration: "перечисление из 4–5 пунктов — проверка на компрессию",
  "self-correction": "оговорка с самокоррекцией спикера, как в живой речи",
  "dense-numbers": "реплика с плотной чередой цифр и лет",
};

const TRAP_INSTRUCTIONS: Record<Trap, string> = {
  enumeration:
    "Ровно одна реплика содержит плотное перечисление из 4–5 пунктов подряд, " +
    "без пауз между ними. Это проверка на компрессию.",
  "self-correction":
    "Ровно одна реплика содержит оговорку с самокоррекцией: спикер называет " +
    "цифру или факт, обрывает себя и поправляется. Так говорят живые люди, " +
    "и переводчик должен успеть за этим.",
  "dense-numbers":
    "Ровно одна реплика насыщена цифрами: проценты, годы, суммы подряд, " +
    "почти без связующего текста.",
};

export interface ScriptParams {
  sourceLang: string;
  targetLang: string;
  durationMin: number;
  speakers: number;
  termDensity: number;
  traps: Trap[];
  /** Значение для <prosody rate="...">, например "105%" */
  rate: string;
}

export interface PromptContext {
  preset: StylePreset;
  params: ScriptParams;
  /** Текст исходного документа. Для PDF пусто: файл уходит в модель отдельно. */
  documentText?: string;
  /** Выводы из прошлых разборов этого переводчика (E4). */
  debriefNotes?: string[];
  eventName?: string;
}

const LANGUAGE_NAMES: Record<string, string> = {
  en: "английском",
  de: "немецком",
  fr: "французском",
  tr: "турецком",
  ru: "русском",
};

/** 100–110 слов в минуту — темп, на котором тренируются синхронисты. */
const wordRange = (minutes: number): string => `${minutes * 100}–${minutes * 110}`;

export function buildScriptPrompt(context: PromptContext): string {
  const { preset, params } = context;
  const quality = qualityFor(preset, params.sourceLang);

  const sections: string[] = [];

  sections.push(
    [
      "# Роль и задача",
      "",
      "Ты составляешь материал для тренировки синхронного перевода. Материал " +
        `предназначен профессиональному переводчику, который готовится к работе ` +
        `в паре ${params.sourceLang.toUpperCase()} → ${params.targetLang.toUpperCase()}.`,
      "",
      `Формат: ${preset.setting}.`,
      context.eventName ? `Событие: ${context.eventName}.` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );

  sections.push(
    [
      "# Регистр",
      "",
      preset.register,
      "",
      quality === "draft"
        ? "ВАЖНО: этот регистр проработан не полностью. Держись описания выше буквально " +
          "и не добавляй оборотов, в которых не уверен."
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );

  const roles = preset.speakerRoles.slice(0, Math.max(params.speakers, 2));
  sections.push(
    [
      "# Участники",
      "",
      `Всего говорящих: ${params.speakers}. Роли и их фокус:`,
      ...roles.map((role) => `- ${role.role} — ${role.focus}`),
      "",
      "Спикеры ссылаются друг на друга по именам и спорят: возражают, уточняют, " +
        "перехватывают тему. Монолога по очереди быть не должно.",
    ].join("\n"),
  );

  sections.push(
    [
      "# Объём и темп",
      "",
      `Длительность звучания: ${params.durationMin} минут, то есть ` +
        `${wordRange(params.durationMin)} слов.`,
      `Язык скрипта: ${LANGUAGE_NAMES[params.sourceLang] ?? params.sourceLang}.`,
      `Темп при озвучке: ${params.rate}.`,
      "Каждая реплика — 60–90 секунд связного текста.",
    ].join("\n"),
  );

  sections.push(
    [
      "# Терминология",
      "",
      `Покрой не менее ${params.termDensity} терминологических единиц, распределив их ` +
        "равномерно, а не скоплениями в одной реплике.",
      "",
      "Характерные для этого регистра обороты:",
      preset.vocabulary.encouraged.map((term) => `- ${term}`).join("\n"),
      "",
      "Названия организаций при первом упоминании давай полностью, далее аббревиатурой.",
    ].join("\n"),
  );

  if (context.documentText) {
    sections.push(
      [
        "# Исходный документ",
        "",
        "Опирайся на приложенный материал: бери из него термины, цифры и повестку.",
        "Точные цифры из документа приводи дословно — они и есть главная нагрузка.",
        "",
        "---",
        context.documentText,
        "---",
      ].join("\n"),
    );
  } else {
    sections.push(
      [
        "# Исходный документ",
        "",
        "Документ приложен к запросу файлом. Бери из него термины, цифры и повестку; " +
          "точные цифры приводи дословно.",
      ].join("\n"),
    );
  }

  sections.push(
    [
      "# Статистика",
      "",
      preset.statistics,
      "",
      "Сверх взятого из документа добавь 8–10 правдоподобных показателей с процентами " +
        "и годами. Помни: они вымышлены, и материал будет помечен как синтетический.",
    ].join("\n"),
  );

  if (params.traps.length) {
    sections.push(
      [
        "# Обязательные трудности",
        "",
        ...params.traps.map((trap) => `- ${TRAP_INSTRUCTIONS[trap]}`),
      ].join("\n"),
    );
  }

  if (context.debriefNotes?.length) {
    sections.push(
      [
        "# Что переводчик отмечал после прошлых мероприятий",
        "",
        ...context.debriefNotes.map((note) => `- ${note}`),
        "",
        "Учти это: усиль темы, где были пробелы.",
      ].join("\n"),
    );
  }

  sections.push(
    [
      "# Чего не делать",
      "",
      ...preset.avoid.map((item) => `- ${item}`),
      ...preset.vocabulary.forbidden.map(
        (term) => `- не используй «${term}» — этот оборот не из данного формата`,
      ),
      `- не вставляй перевод на ${LANGUAGE_NAMES[params.targetLang] ?? params.targetLang} ` +
        "внутрь скрипта",
      "- не упрощай синтаксис: сложность здесь и есть предмет тренировки",
    ].join("\n"),
  );

  sections.push(
    [
      "# Формат ответа",
      "",
      "Верни структуру по заданной схеме:",
      "- segments — реплики по порядку: говорящий, тайм-код, текст",
      "- ssml — тот же текст разметкой: <speak>, <prosody rate>, <p> на реплику, " +
        "<break time=\"1.5s\"/> между репликами",
      `- glossary — термины с эквивалентами на ${LANGUAGE_NAMES[params.targetLang] ?? params.targetLang}`,
      "",
      "Источники эквивалентов для глоссария:",
      ...preset.terminologySources.map((source) => `- ${source}`),
    ].join("\n"),
  );

  return sections.join("\n\n");
}
