// Без пометки server-only: модуль зовут страницы и тесты.
import type { Payload } from "payload";
import { toRow, canSee, yearOf, type EngagementRow } from "./engagements";

/**
 * Записи чужого профиля глазами смотрящего (P4).
 *
 * Отбираем по тому же правилу, что и сами записи: витрина не должна быть
 * обходным путём к тому, что в самой записи закрыто.
 *
 * Счётчики считаются по видимому. «34 конференции» при двух показанных —
 * это уже утечка: число говорит то, чего человек показывать не собирался.
 */
export async function visibleEngagements(
  payload: Payload,
  personId: number,
  viewerId: number,
  limit = 50,
): Promise<{ rows: EngagementRow[]; total: number; sinceYear: number | null }> {
  const found = await payload.find({
    collection: "engagements",
    where: { owner: { equals: personId } },
    sort: "-heldOn",
    limit: 500,
    depth: 0,
    overrideAccess: true,
  });

  const rows = found.docs
    .map(toRow)
    .filter((row) => canSee(row, personId, viewerId));

  const years = rows.map((r) => yearOf(r.heldOn)).filter(Number.isFinite);

  return {
    rows: rows.slice(0, limit),
    total: rows.length,
    sinceYear: years.length ? Math.min(...years) : null,
  };
}
