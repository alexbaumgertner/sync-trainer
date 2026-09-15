// Без `server-only` и без зависимостей: перечисления нужны и коллекции
// (конфигурация Payload исполняется в том числе из CLI), и форме, и отчёту.
import type { Rating } from "@/payload-types";

/**
 * Оценка сгенерированного материала.
 *
 * Зачем она вообще. До сих пор мы знали, сколько сгенерировано и на сколько
 * долларов, — и ничего о том, годится ли полученное для тренировки. Вопрос
 * «сколько озвучек человек реально взял в работу» не имел источника ответа.
 *
 * Оценивается ВЫВОД ГЕНЕРАЦИИ, а не проект. Перегенерировали — это другой
 * материал, и прежняя оценка остаётся при том, что её заслужило. Иначе
 * «тройка» переезжала бы на файл, которого оценивавший не слышал.
 */

export const RATING_TARGETS = ["audio", "glossary", "script"] as const;
export type RatingTarget = (typeof RATING_TARGETS)[number];

export const TARGET_LABELS: Record<RatingTarget, string> = {
  audio: "Озвучка",
  glossary: "Глоссарий",
  script: "Скрипт",
};

/**
 * Винительный падеж — отдельным списком, а не `toLowerCase()` от именительного.
 * «Оценить озвучка» — ровно та небрежность, по которой видно, что интерфейс
 * собирали из кусков. Двух слов из трёх это не касается, и тем заметнее третье.
 */
export const TARGET_ACCUSATIVE: Record<RatingTarget, string> = {
  audio: "озвучку",
  glossary: "глоссарий",
  script: "скрипт",
};

/**
 * Три деления, а не пять, и подписи важнее цифр.
 *
 * Пятибалльная шкала у «как прошло» оправдана: там человек сравнивает
 * мероприятия между собой и различает оттенки. Здесь вопрос другой и
 * практический — взял бы он это в работу. Между «четыре» и «пять» за синтез
 * речи нет различия, которое кто-нибудь смог бы воспроизвести назавтра,
 * а между «не годится» и «сойдёт» — есть.
 */
export const SCORE_LABELS: Record<number, string> = {
  1: "не годится",
  2: "сойдёт с оговорками",
  3: "годится как есть",
};

export const SCORES = Object.keys(SCORE_LABELS).map(Number).sort();

export interface RatingRow {
  id: number;
  target: RatingTarget;
  score: number;
  note: string | null;
  /** Какую именно генерацию оценили. Пусто у записей старше этого поля. */
  generationId: number | null;
  createdAt: string;
}

export function toRatingRow(doc: Rating): RatingRow {
  const generationId =
    typeof doc.generation === "object" ? (doc.generation?.id ?? null) : (doc.generation ?? null);

  return {
    id: doc.id,
    target: doc.target as RatingTarget,
    score: doc.score,
    note: doc.note?.trim() || null,
    generationId: typeof generationId === "number" ? generationId : null,
    createdAt: doc.createdAt,
  };
}

/**
 * Оценка, относящаяся именно к этому выводу.
 *
 * Сопоставление по генерации, а не по проекту: после перегенерации оценки
 * быть не должно, и форма обязана спросить заново.
 */
export const ratingFor = (
  rows: RatingRow[],
  target: RatingTarget,
  generationId: number | null,
): RatingRow | null =>
  rows.find((row) => row.target === target && row.generationId === generationId) ?? null;
