import type { StylePreset } from "./types";

/** ЧЕРНОВИК. Регистр выверен приблизительно, нужен носитель с судебной практикой. */
export const court: StylePreset = {
  id: "court",
  label: "Суд и Гаага",
  languages: { en: "draft" },
  setting: "Слушание в международном суде или трибунале",

  register:
    "Юридический регистр международного правосудия. Точные отсылки к статьям и " +
    "прецедентам, условные конструкции, осторожные модальности. Формулировки " +
    "выверенные: спикер избегает утверждений, которые нельзя доказать.",

  speakerRoles: [
    { role: "Presiding Judge", focus: "порядок слушания, уточняющие вопросы сторонам" },
    { role: "Counsel for the Applicant", focus: "изложение позиции, отсылки к прецедентам" },
    { role: "Counsel for the Respondent", focus: "возражения, процессуальные аргументы" },
    { role: "Expert Witness", focus: "фактические обстоятельства, пределы своей компетенции" },
  ],

  vocabulary: {
    encouraged: [
      "admissibility",
      "jurisdiction ratione materiae",
      "burden of proof",
      "provisional measures",
      "erga omnes",
    ],
    forbidden: ["gender mainstreaming", "stakeholder engagement", "capacity building"],
  },

  terminologySources: [
    "терминология Международного суда ООН на русском",
    "русские тексты Римского статута и регламентов",
  ],

  statistics:
    "Цифры редки и всегда привязаны к материалам дела: даты, номера статей, " +
    "количество эпизодов. Проценты почти не встречаются.",

  avoid: [
    "лексика проектной деятельности и развития",
    "эмоциональная подача — регистр сдержанный даже в острых местах",
  ],
};
