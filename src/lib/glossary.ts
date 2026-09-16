// Без `server-only`: модуль читают и страницы, и действия, и выгрузка.
import type { GlossaryTerm } from "@/payload-types";

/**
 * Термин глоссария для показа и правки.
 *
 * Глоссарий до сих пор был витриной: сгенерировался — скачай файлом.
 * Между тем подготовка к мероприятию как раз и состоит в том, чтобы
 * перебрать термины руками, часть выбросить, часть переписать, а над
 * несколькими думать до последнего. Файлом этого не сделать.
 */

export type TermStatus = "suggested" | "verified" | "from-practice";

export const STATUS_LABELS: Record<TermStatus, string> = {
  suggested: "предложен моделью",
  verified: "подтверждён",
  "from-practice": "из практики",
};

export interface TermVariant {
  /** Идентификатор строки массива — строковый, его назначает Payload */
  id: string;
  text: string;
  /** Пусто означает «предложила модель», а не «неизвестно» */
  proposedById: number | null;
  proposedByName: string | null;
  note: string | null;
  at: string | null;
}

export interface TermRow {
  id: number;
  source: string;
  target: string | null;
  note: string | null;
  status: TermStatus;
  occurredAtEvent: boolean;
  verifiedByName: string | null;
  verifiedAt: string | null;
  variants: TermVariant[];
}

const idOf = (value: unknown): number | null => {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "id" in value) {
    const inner = (value as { id: unknown }).id;
    return typeof inner === "number" ? inner : null;
  }
  return null;
};

const nameOf = (value: unknown): string | null => {
  if (!value || typeof value !== "object") return null;
  const user = value as { displayName?: string | null; email?: string | null };
  // Имя, а не почта: коллега не должен узнавать чужой адрес лишь потому,
  // что человек не заполнил профиль. Та же оговорка, что в карточке.
  return user.displayName?.trim() || null;
};

export function toTermRow(doc: GlossaryTerm): TermRow {
  return {
    id: doc.id,
    source: doc.sourceTerm,
    target: doc.targetTerm?.trim() || null,
    note: doc.note?.trim() || null,
    status: doc.status as TermStatus,
    occurredAtEvent: Boolean(doc.occurredAtEvent),
    verifiedByName: nameOf(doc.verifiedBy),
    verifiedAt: doc.verifiedAt ?? null,
    variants: (doc.variants ?? [])
      .filter((variant) => variant.text?.trim())
      .map((variant) => ({
        id: String(variant.id),
        text: variant.text!.trim(),
        proposedById: idOf(variant.proposedBy),
        proposedByName: nameOf(variant.proposedBy),
        note: variant.note?.trim() || null,
        at: variant.at ?? null,
      })),
  };
}

/**
 * Чьё это предложение — так, как это стоит читать глазами.
 *
 * «Модель» отдельной подписью, а не молчанием: в кабине вариант от человека
 * и вариант от модели весят по-разному, и разница должна быть видна без
 * наведения мыши.
 */
export function authorLabel(variant: TermVariant, viewerId: number): string {
  if (variant.proposedById === null) return "модель";
  if (variant.proposedById === viewerId) return "вы";
  return variant.proposedByName ?? "коллега";
}

/**
 * Стал ли термин подтверждённым после правки человеком.
 *
 * Правило одно: если человек своей рукой написал перевод, термин больше
 * не «предложен моделью» — он подтверждён, и в выгрузке с него снимается
 * пометка «не подтверждён». Именно она в кабине отличает выверенное от
 * угаданного, и оставлять её на том, что человек сам и написал, — врать.
 *
 * Правка одной заметки статуса не меняет: заметка не про эквивалент.
 */
export function statusAfterEdit(
  current: TermStatus,
  previousTarget: string | null,
  nextTarget: string | null,
): TermStatus {
  if (current !== "suggested") return current;
  const changed = (nextTarget ?? "") !== (previousTarget ?? "");
  return changed && nextTarget ? "verified" : current;
}
