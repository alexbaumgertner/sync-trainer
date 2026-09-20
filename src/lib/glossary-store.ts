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

/**
 * Термин, найденный в более общем слое (T2–T3).
 *
 * Подстановка происходит при сборке, а не при каждом показе: дальше
 * подставленный термин живёт как проектный и правится как проектный (T10).
 * Поэтому эквивалент дальнего слоя сохраняется рядом — иначе, перекрыв его
 * своим, человек потерял бы то, что перекрывал.
 */
export interface InheritedTerm {
  target: string;
  from: "personal" | "shared";
  status: "suggested" | "verified" | "from-practice";
}

export interface MergeReport {
  added: number;
  /** Сколько кандидатов отклонено как уже известные. Полезно в отчёте. */
  skipped: number;
  /** Сколько эквивалентов пришло из личного или общего слоя. */
  inherited: number;
}

/** Ключ сравнения: регистр и краевые пробелы термина не различают. */
export const termKey = (source: string): string => source.trim().toLowerCase();

export async function addNewTerms(
  payload: Payload,
  projectId: number,
  candidates: TermCandidate[],
  known: Iterable<string>,
  /** Что найдено в личном и общем слоях, ключ — нормализованная форма. */
  inherit: Map<string, InheritedTerm> = new Map(),
): Promise<MergeReport> {
  const seen = new Set<string>();
  for (const source of known) seen.add(termKey(source));

  const report: MergeReport = { added: 0, skipped: 0, inherited: 0 };

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

    /**
     * T2–T3: ближний слой перекрывает дальний, но дальний виден рядом.
     *
     * Эквивалент из личного слоя сильнее свежей догадки модели: его уже
     * выбирал человек. Своё, проектное, он перекроет потом руками — и
     * тогда пригодится `inheritedTarget`, чтобы видеть, что перекрыл.
     */
    const known = inherit.get(key);
    if (known) report.inherited += 1;

    await payload.create({
      collection: "glossary-terms",
      data: {
        project: projectId,
        scope: "project" as const,
        sourceTerm: candidate.source.trim(),
        targetTerm: known ? known.target : candidate.target?.trim() || undefined,
        note: candidate.note?.trim() || undefined,
        status: known ? known.status : "suggested",
        inheritedFrom: known?.from,
        inheritedTarget: known?.target,
      },
      overrideAccess: true,
    });
    report.added += 1;
  }

  return report;
}

/**
 * Что лежит в дальних слоях: личном переводчика и общем для сервиса (T2).
 *
 * Личный сильнее общего, поэтому он и кладётся вторым: последняя запись
 * в карту побеждает. Порядок здесь — и есть правило перекрытия, и менять
 * его местами нельзя, сколько бы это ни выглядело безразличным.
 */
export async function inheritedLayers(
  payload: Payload,
  ownerId: number,
): Promise<Map<string, InheritedTerm>> {
  const map = new Map<string, InheritedTerm>();

  const pull = async (
    where: Record<string, unknown>,
    from: InheritedTerm["from"],
  ): Promise<void> => {
    const found = await payload.find({
      collection: "glossary-terms",
      where: where as never,
      limit: 5000,
      depth: 0,
      overrideAccess: true,
    });
    for (const term of found.docs) {
      const target = term.targetTerm?.trim();
      if (!target) continue;
      map.set(termKey(term.sourceTerm), {
        target,
        from,
        status: (term.status ?? "suggested") as InheritedTerm["status"],
      });
    }
  };

  await pull({ scope: { equals: "shared" } }, "shared");
  await pull(
    { and: [{ scope: { equals: "personal" } }, { owner: { equals: ownerId } }] },
    "personal",
  );

  return map;
}

/**
 * Перенос термина в личный слой (T5).
 *
 * Только руками. Автоматический перенос затащил бы в память случайный
 * эквивалент одного мероприятия, и вычищать его было бы некому — а память
 * тем и ценна, что ей можно верить.
 */
export async function promoteToPersonal(
  payload: Payload,
  ownerId: number,
  term: { sourceTerm: string; targetTerm?: string | null; note?: string | null },
): Promise<"created" | "updated" | "skipped"> {
  const target = term.targetTerm?.trim();
  // Закреплять нечего: термин без эквивалента памятью не станет.
  if (!target) return "skipped";

  const existing = await payload.find({
    collection: "glossary-terms",
    where: {
      and: [{ scope: { equals: "personal" } }, { owner: { equals: ownerId } }],
    },
    limit: 5000,
    depth: 0,
    overrideAccess: true,
  });

  const key = termKey(term.sourceTerm);
  const twin = existing.docs.find((doc) => termKey(doc.sourceTerm) === key);

  if (twin) {
    await payload.update({
      collection: "glossary-terms",
      id: twin.id,
      data: { targetTerm: target, note: term.note?.trim() || undefined },
      overrideAccess: true,
    });
    return "updated";
  }

  await payload.create({
    collection: "glossary-terms",
    data: {
      scope: "personal",
      owner: ownerId,
      sourceTerm: term.sourceTerm.trim(),
      targetTerm: target,
      note: term.note?.trim() || undefined,
      // Закрепляет человек своей рукой — это и есть подтверждение.
      status: "verified",
    },
    overrideAccess: true,
  });
  return "created";
}
