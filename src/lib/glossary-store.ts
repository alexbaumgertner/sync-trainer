// Без пометки server-only: модуль зовут маршруты и тесты.
import type { Payload } from "payload";

/**
 * Пополнение глоссария проекта кандидатами от модели (N6–N7).
 *
 * Вынесено из маршрутов в отдельный модуль по одной причине: это правило,
 * а не подробность реализации. Оно звучит так — **модель только добавляет**.
 * Ни сборка глоссария, ни генерация скрипта не вправе переписать то, что
 * уже лежит: существующий эквивалент мог быть выверен человеком или добыт
 * на прошлом событии, и это ценнее свежей догадки.
 *
 * Пока правило жило двумя копиями внутри двух маршрутов, проверить его
 * было нечем: сквозной тест проходил и со снятым заслоном — просто потому,
 * что модель в тот раз не повторила термин. Тест, который не падает от
 * поломки, хуже отсутствующего, и лечится это не упорством в тесте, а
 * местом, куда можно прицелиться.
 */

export interface TermCandidate {
  source: string;
  target: string;
  note?: string | null;
}

export interface MergeReport {
  added: number;
  /** Сколько кандидатов отклонено как уже известные. Полезно в отчёте. */
  skipped: number;
}

/** Ключ сравнения: регистр и краевые пробелы термина не различают. */
export const termKey = (source: string): string => source.trim().toLowerCase();

export async function addNewTerms(
  payload: Payload,
  projectId: number,
  candidates: TermCandidate[],
  known: Iterable<string>,
): Promise<MergeReport> {
  const seen = new Set<string>();
  for (const source of known) seen.add(termKey(source));

  const report: MergeReport = { added: 0, skipped: 0 };

  for (const candidate of candidates) {
    const key = termKey(candidate.source ?? "");
    if (!key) continue;

    // Повтор внутри одной пачки тоже повтор: иначе один термин уехал бы
    // в выгрузку для кабины дважды.
    if (seen.has(key)) {
      report.skipped += 1;
      continue;
    }
    seen.add(key);

    await payload.create({
      collection: "glossary-terms",
      data: {
        project: projectId,
        sourceTerm: candidate.source.trim(),
        targetTerm: candidate.target?.trim() || undefined,
        note: candidate.note?.trim() || undefined,
        status: "suggested",
      },
      overrideAccess: true,
    });
    report.added += 1;
  }

  return report;
}
