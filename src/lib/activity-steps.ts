/**
 * Шаги продуктовой воронки (слой 2 метрик).
 *
 * Без `server-only` и без зависимостей: перечисление нужно и коллекции
 * (конфигурация Payload исполняется в том числе из CLI), и отчёту.
 *
 * Перечисление, а не свободный текст, и это главное решение здесь.
 * Пользователи — синхронисты с материалами заказчиков под NDA. Стоит один
 * раз положить в событие название мероприятия или имя спикера — и оно
 * останется в базе метрик навсегда, хотя согласия на такое хранение никто
 * не давал. Перечисление делает эту ошибку невозможной: в событие физически
 * нечего вписать, кроме шага и связей.
 */
export const STEPS = [
  "project_created",
  "document_uploaded",
  "participants_imported",
  "glossary_built",
  "script_generated",
  "audio_generated",
  "glossary_exported",
  "debrief_filled",
  "engagement_created",
  "invite_sent",
  "invite_accepted",
  "rating_given",
] as const;

export type Step = (typeof STEPS)[number];

export const STEP_LABELS: Record<Step, string> = {
  project_created: "проект заведён",
  document_uploaded: "документ загружен",
  participants_imported: "список участников разобран",
  glossary_built: "глоссарий собран",
  script_generated: "скрипт сгенерирован",
  audio_generated: "аудио сгенерировано",
  glossary_exported: "глоссарий выгружен",
  debrief_filled: "разбор заполнен",
  engagement_created: "запись о работе заведена",
  invite_sent: "приглашение отправлено",
  invite_accepted: "приглашение принято",
  rating_given: "материал оценён",
};
