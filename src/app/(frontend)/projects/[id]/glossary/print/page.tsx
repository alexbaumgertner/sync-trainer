import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getProject } from "@/lib/projects";
import { payloadClient } from "@/lib/payload";
import { LAYER_LABELS, isOverridden, toTermRow } from "@/lib/glossary";

export const dynamic = "force-dynamic";

/**
 * Печатная форма глоссария (I7).
 *
 * Лист, который наклеивают в кабине. Отсюда всё остальное: ни шапки, ни
 * навигации, ни кнопок — в бумаге они превращаются в мусор; крупный шрифт,
 * потому что читают его боковым зрением на ходу; две колонки, потому что
 * термины короткие и в одну колонку лист уходит на три страницы.
 *
 * Своя страница, а не выгрузка в Google Sheets: лист нужен сегодня, а
 * интеграция — это OAuth, права и чужое хранилище. Печать из браузера
 * делает ровно то же самое и работает везде.
 *
 * Печатается ВЕСЬ глоссарий, включая непроверенное: решать, чему верить,
 * должен человек, а пометка рядом ему в этом помогает. Выбросить строку
 * из листа можно только выбросив термин, и это честно — в кабине лист
 * один, и он должен совпадать с глоссарием.
 */
export default async function GlossaryPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/");

  const { id } = await params;
  const projectId = Number(id);
  if (!Number.isInteger(projectId)) notFound();

  const detail = await getProject(projectId, user.id);
  if (!detail) notFound();

  const payload = await payloadClient();
  const terms = await payload.find({
    collection: "glossary-terms",
    where: { project: { equals: projectId } },
    sort: "sourceTerm",
    limit: 500,
    depth: 1,
    overrideAccess: true,
  });

  const rows = terms.docs.map(toTermRow);
  const unverified = rows.filter((row) => row.status === "suggested").length;

  return (
    <main className="print-sheet mx-auto max-w-4xl px-6 py-8 text-neutral-900">
      <header className="mb-5 border-b border-neutral-400 pb-3">
        <h1 className="text-xl font-semibold">{detail.project.title}</h1>
        <p className="mt-1 text-sm text-neutral-600">
          {detail.project.eventName ? `${detail.project.eventName} · ` : ""}
          {rows.length} терминов
          {unverified > 0 ? ` · не подтверждено: ${unverified}` : ""}
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="text-sm">Глоссарий пуст — печатать нечего.</p>
      ) : (
        <ul className="term-columns">
          {rows.map((row) => (
            <li key={row.id} className="term mb-2 break-inside-avoid">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <b className="text-base">{row.source}</b>
                <span aria-hidden>—</span>
                <span className="text-base">{row.target ?? "?"}</span>
                {row.status === "suggested" && (
                  <span className="text-xs text-neutral-600">(?)</span>
                )}
              </div>

              {row.variants.length > 0 && (
                <div className="text-sm text-neutral-700">
                  ещё: {row.variants.map((variant) => variant.text).join(" / ")}
                </div>
              )}

              {isOverridden(row) && row.inheritedFrom && (
                <div className="text-sm text-neutral-700">
                  {LAYER_LABELS[row.inheritedFrom]}: {row.inheritedTarget}
                </div>
              )}

              {row.note && <div className="text-sm text-neutral-700">{row.note}</div>}
            </li>
          ))}
        </ul>
      )}

      <footer className="mt-6 border-t border-neutral-400 pt-3 text-xs text-neutral-600">
        {unverified > 0
          ? "Знаком (?) помечено предложенное моделью и никем не проверенное. В кабине оно выглядит так же уверенно, как выверенное, — а верить ему нельзя."
          : "Все термины подтверждены."}
      </footer>

      {/*
        Стили печати рядом с разметкой, а не в общем файле: они описывают
        ровно эту страницу и нигде больше не применяются. Колонки заданы
        через CSS-колонки, потому что строки разной высоты — сеткой их
        пришлось бы равнять, а по бумаге они должны течь.
      */}
      <style>{`
        .term-columns {
          columns: 2;
          column-gap: 2rem;
        }
        @media (max-width: 640px) {
          .term-columns { columns: 1; }
        }
        @media print {
          @page { margin: 12mm; }
          .print-sheet { max-width: none; padding: 0; }
          .term-columns { columns: 2; column-gap: 12mm; }
          .term { break-inside: avoid; }
        }
      `}</style>
    </main>
  );
}
