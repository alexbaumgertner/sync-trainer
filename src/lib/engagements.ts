// Без пометки server-only: модуль чистый, его гоняют страницы и тесты.
import type { Engagement } from "@/payload-types";

/**
 * Записи о проведённой работе (W1–W5).
 *
 * Слово «опыт» выбрано вместо «конференций» намеренно: у переводчика бывают
 * суд, переговоры и сопровождение делегации, и называть это конференцией
 * значит заставить человека врать в собственной карточке.
 */

export const MODE_LABELS: Record<string, string> = {
  simultaneous: "Синхронный",
  rsi: "Удалённый синхронный",
  consecutive: "Последовательный",
  whispered: "Шушутаж",
};

export const MODES = Object.entries(MODE_LABELS).map(([value, label]) => ({ value, label }));

export const VISIBILITY_LABELS: Record<string, string> = {
  private: "Только я",
  team: "Я и команда события",
};

/**
 * «Как прошло» — пять делений, и подписи важнее цифр.
 *
 * Голая шкала 1–5 ничего не значит: у каждого своя четвёрка. Подпись делает
 * оценку сопоставимой хотя бы внутри одной головы.
 */
export const WENT_LABELS: Record<number, string> = {
  1: "тяжело, не хочу повторять",
  2: "справился, но с трудом",
  3: "обычная работа",
  4: "хорошо",
  5: "отлично, пошёл бы снова",
};

export interface Speaker {
  name: string;
  organization: string | null;
}

export interface EngagementRow {
  id: number;
  title: string;
  organizer: string | null;
  heldOn: string;
  location: string | null;
  mode: string;
  sourceLang: string;
  targetLang: string;
  wentHow: number | null;
  wentText: string | null;
  speakers: Speaker[];
  visibility: string;
  /** Есть ли подготовка в тренажёре. Записи без проекта — норма (W2) */
  projectId: number | null;
}

export function toRow(doc: Engagement): EngagementRow {
  const projectId = typeof doc.project === "object" ? (doc.project?.id ?? null) : (doc.project ?? null);

  return {
    id: doc.id,
    title: doc.title,
    organizer: doc.organizer?.trim() || null,
    heldOn: doc.heldOn,
    location: doc.location?.trim() || null,
    mode: doc.mode,
    sourceLang: doc.sourceLang,
    targetLang: doc.targetLang,
    wentHow: typeof doc.wentHow === "number" ? doc.wentHow : null,
    wentText: doc.wentText?.trim() || null,
    speakers: (doc.speakers ?? [])
      .filter((s) => s.name?.trim())
      .map((s) => ({ name: s.name!.trim(), organization: s.organization?.trim() || null })),
    visibility: doc.visibility,
    projectId: typeof projectId === "number" ? projectId : null,
  };
}

/** Год записи — по нему считается «в профессии с» в профиле (P4). */
export const yearOf = (heldOn: string): number => new Date(heldOn).getUTCFullYear();

export const formatHeld = (heldOn: string): string =>
  new Date(heldOn).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
