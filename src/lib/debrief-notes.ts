// Без пометки server-only: модуль зовут маршрут и тесты.
import type { Payload } from "payload";

/**
 * Выводы из прошлых разборов для промта следующей генерации (E4).
 *
 * Ради этого и затевался цикл подготовки, а не разовая генерация: тренаж
 * должен становиться ближе к тому, что у переводчика на самом деле не
 * получается. Разбор — единственный источник таких сведений.
 *
 * Берутся разборы **других** проектов этого переводчика: свой собственный
 * разбор в промт не попадает, иначе перегенерация скрипта после события
 * начала бы объяснять модели, чего не хватило в ней же самой.
 */

/** Сколько прошлых событий подмешивать. Больше — промт пухнет, толку нет. */
const MAX_DEBRIEFS = 3;

/** Сколько пропущенных терминов перечислять. Это список промахов модели. */
const MAX_MISSED_TERMS = 25;

const PACE_NOTE: Record<string, string> = {
  slower: "реальный темп оказался медленнее, чем в подготовке",
  "as-expected": "темп подготовки совпал с реальным",
  faster: "реальный темп оказался быстрее, чем в подготовке",
  "much-faster": "реальный темп оказался ГОРАЗДО быстрее, чем в подготовке",
};

const trimmed = (value: unknown): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

export async function debriefNotesFor(
  payload: Payload,
  userId: number,
  excludeProjectId: number,
): Promise<string[]> {
  const projects = await payload.find({
    collection: "projects",
    where: { and: [{ owner: { equals: userId } }, { id: { not_equals: excludeProjectId } }] },
    limit: 100,
    depth: 0,
    overrideAccess: true,
  });
  if (!projects.docs.length) return [];

  const titles = new Map(projects.docs.map((p) => [p.id, p.eventName?.trim() || p.title]));
  const ids = projects.docs.map((p) => p.id);

  const debriefs = await payload.find({
    collection: "debriefs",
    where: { project: { in: ids } },
    // Свежие события важнее давних: терминология и повестка стареют.
    sort: "-createdAt",
    limit: MAX_DEBRIEFS,
    depth: 0,
    overrideAccess: true,
  });
  if (!debriefs.docs.length) return [];

  const notes: string[] = [];
  const usedProjects: number[] = [];

  for (const debrief of debriefs.docs) {
    const projectId =
      typeof debrief.project === "object" ? debrief.project?.id : debrief.project;
    if (typeof projectId !== "number") continue;
    usedProjects.push(projectId);

    const where = titles.get(projectId) ?? "прошлое событие";
    const parts: string[] = [];

    const hardest = trimmed(debrief.hardest);
    if (hardest) parts.push(`труднее всего давалось: ${hardest}`);

    const surprises = trimmed(debrief.surprises);
    if (surprises) parts.push(`разошлось с ожиданием: ${surprises}`);

    const pace = debrief.actualPace ? PACE_NOTE[debrief.actualPace] : "";
    if (pace) parts.push(pace);

    if (parts.length) notes.push(`«${where}» — ${parts.join("; ")}`);
  }

  if (!usedProjects.length) return notes;

  // Термины со статусом «из практики» — это прямой список промахов: их
  // переводчик дописал руками после события, потому что модель их не дала.
  const missed = await payload.find({
    collection: "glossary-terms",
    where: {
      and: [
        { project: { in: usedProjects } },
        { status: { equals: "from-practice" } },
      ],
    },
    limit: MAX_MISSED_TERMS,
    depth: 0,
    overrideAccess: true,
  });

  const terms = [...new Set(missed.docs.map((term) => term.sourceTerm.trim()).filter(Boolean))];
  if (terms.length) {
    notes.push(
      "на прошлых событиях не хватило терминов, которых не было в подготовке: " +
        terms.join(", "),
    );
  }

  return notes;
}
