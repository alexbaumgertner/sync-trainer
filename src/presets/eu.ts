import type { StylePreset } from "./types";

/** ЧЕРНОВИК. Нужна проверка носителем, работавшим в институтах ЕС. */
export const eu: StylePreset = {
  id: "eu",
  label: "Институты ЕС",
  languages: { en: "draft", de: "draft", fr: "draft" },
  setting: "Слушание в комитете Европейского парламента или брифинг Комиссии",

  register:
    "Регистр институтов ЕС: отсылки к директивам и регламентам по номерам, " +
    "оглядка на компетенции государств-членов, осторожность в вопросах субсидиарности. " +
    "Синтаксис плотный, много отглагольных существительных.",

  speakerRoles: [
    { role: "Committee Chair", focus: "регламент выступлений, переходы" },
    { role: "Commission Representative", focus: "позиция Комиссии, отсылки к законодательству" },
    { role: "Member of Parliament", focus: "интересы избирателей, критика исполнения" },
    { role: "Civil Society Expert", focus: "данные с мест, оценка последствий" },
  ],

  vocabulary: {
    encouraged: [
      "subsidiarity",
      "acquis communautaire",
      "trilogue",
      "impact assessment",
      "Member States",
    ],
    forbidden: ["points of order", "the floor is given to"],
  },

  terminologySources: [
    "IATE — терминологическая база ЕС",
    "русские версии документов ЕС, где они есть",
  ],

  statistics:
    "Цифры по государствам-членам, доли бюджета ЕС, сроки имплементации директив. " +
    "Обязательны отсылки к годам и конкретным актам.",

  avoid: ["риторика, характерная для ООН", "смешение компетенций ЕС и государств-членов"],
};
