import type { StylePreset } from "./types";

/** ЧЕРНОВИК. Самый свободный регистр, проверять проще остальных. */
export const corporate: StylePreset = {
  id: "corporate",
  label: "Корпоративная конференция",
  languages: { en: "draft", de: "draft", fr: "draft", tr: "draft" },
  setting: "Панель или презентация на отраслевой конференции",

  register:
    "Деловой регистр: короче и живее институционального, но с плотной отраслевой " +
    "терминологией и цифрами. Спикеры перебивают друг друга, шутят, ссылаются " +
    "на свои компании. Темп выше, чем на межправительственных площадках.",

  speakerRoles: [
    { role: "Moderator", focus: "динамика панели, провокационные вопросы" },
    { role: "Chief Executive", focus: "стратегия, рыночная позиция, осторожность в прогнозах" },
    { role: "Head of Product", focus: "конкретика продукта, метрики внедрения" },
    { role: "Industry Analyst", focus: "сравнение с рынком, скепсис к заявлениям" },
  ],

  vocabulary: {
    encouraged: ["go-to-market", "unit economics", "churn", "run rate", "time to value"],
    forbidden: ["gender mainstreaming", "erga omnes", "subsidiarity"],
  },

  terminologySources: ["отраслевые глоссарии", "русская деловая пресса по теме"],

  statistics:
    "Цифры бизнеса: рост в процентах год к году, доли рынка, сроки окупаемости. " +
    "Подаются напористо и часто без ссылки на источник — это тоже упражнение.",

  avoid: ["институциональная осторожность формулировок", "процедурная лексика"],
};
