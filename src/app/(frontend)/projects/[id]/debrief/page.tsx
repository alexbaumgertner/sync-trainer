import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getProject } from "@/lib/projects";
import { payloadClient } from "@/lib/payload";
import AppShell from "@/components/app-shell";
import { saveDebrief } from "./actions";

export const dynamic = "force-dynamic";

const PACES = [
  { value: "slower", label: "Медленнее, чем готовились" },
  { value: "as-expected", label: "Как и ожидали" },
  { value: "faster", label: "Быстрее, чем готовились" },
  { value: "much-faster", label: "Гораздо быстрее" },
] as const;

const STATUS_HINT: Record<string, string> = {
  suggested: "предложен моделью",
  verified: "подтверждён",
  "from-practice": "из практики",
};

const dateValue = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toISOString().slice(0, 10) : "";

/**
 * Разбор после события (E1–E3).
 *
 * Не дневник и не оценка материала — заготовка для следующей подготовки.
 * Отсюда и вопросы: что было труднее всего, чем событие разошлось с
 * ожиданием, каким оказался темп. Из этих ответов растёт промт следующей
 * генерации (E4, задача T11).
 */
export default async function DebriefPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/");

  const { id } = await params;
  const projectId = Number(id);
  const detail = await getProject(projectId, user.id);
  if (!detail) notFound();

  const payload = await payloadClient();

  const [debriefs, terms] = await Promise.all([
    payload.find({
      collection: "debriefs",
      where: { project: { equals: projectId } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    }),
    payload.find({
      collection: "glossary-terms",
      where: { project: { equals: projectId } },
      // Термины из практики сверху: они добыты на событии и важнее прочих.
      sort: ["status", "sourceTerm"],
      limit: 5000,
      depth: 0,
      overrideAccess: true,
    }),
  ]);

  const debrief = debriefs.docs[0];
  const project = detail.project;

  return (
    <AppShell email={user.email} title={project.title}>
      <div className="mb-5 flex flex-wrap items-center gap-3 text-xs text-neutral-500">
        <Link href={`/projects/${projectId}`} className="underline-offset-2 hover:underline">
          ← К проекту
        </Link>
        {debrief && <span>Разбор сохранён, можно дополнить</span>}
      </div>

      <h1 className="mb-2 text-lg font-medium">Разбор после события</h1>
      <p className="mb-8 max-w-prose text-sm text-neutral-500">
        Не отчёт и не оценка материала — заготовка для следующей подготовки.
        Чем точнее здесь про трудное, тем ближе к делу будет следующий тренаж.
      </p>

      <form action={saveDebrief} className="grid gap-8 lg:grid-cols-[1fr_1fr]">
        <input type="hidden" name="projectId" value={projectId} />

        <div className="grid content-start gap-5">
          <div className="grid gap-1.5">
            <label htmlFor="heldOn" className="text-sm font-medium">
              Дата события
            </label>
            <input
              id="heldOn"
              name="heldOn"
              type="date"
              defaultValue={dateValue(debrief?.heldOn ?? project.eventStartsOn)}
              className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
            />
          </div>

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Темп речи на событии</legend>
            <p id="pace-hint" className="mb-1 text-xs text-neutral-500">
              Относительно того, к чему готовились. От этого зависит темп следующего аудио.
            </p>
            {PACES.map((pace) => (
              <label key={pace.value} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="actualPace"
                  value={pace.value}
                  aria-describedby="pace-hint"
                  defaultChecked={debrief?.actualPace === pace.value}
                />
                {pace.label}
              </label>
            ))}
          </fieldset>

          <div className="grid gap-1.5">
            <label htmlFor="hardest" className="text-sm font-medium">
              Что было труднее всего
            </label>
            <p id="hardest-hint" className="text-xs text-neutral-500">
              Цифры, перечисления, акценты, скорость, конкретная тема — чем конкретнее,
              тем полезнее.
            </p>
            <textarea
              id="hardest"
              name="hardest"
              rows={4}
              aria-describedby="hardest-hint"
              defaultValue={debrief?.hardest ?? ""}
              className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
            />
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="surprises" className="text-sm font-medium">
              Чем событие разошлось с ожиданием
            </label>
            <p id="surprises-hint" className="text-xs text-neutral-500">
              Другие темы, незаявленные спикеры, регламент — всё, к чему подготовка
              не готовила.
            </p>
            <textarea
              id="surprises"
              name="surprises"
              rows={4}
              aria-describedby="surprises-hint"
              defaultValue={debrief?.surprises ?? ""}
              className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
            />
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="missingTerms" className="text-sm font-medium">
              Каких терминов не хватило
            </label>
            <p id="missing-hint" className="text-xs text-neutral-500">
              По одному в строке. Можно с переводом через тире — «headroom — запас
              капитала», — можно без него. Каждый попадёт в глоссарий с пометкой
              «из практики»: такие термины ценнее предложенных моделью.
            </p>
            <textarea
              id="missingTerms"
              name="missingTerms"
              rows={6}
              aria-describedby="missing-hint"
              defaultValue={debrief?.missingTerms ?? ""}
              placeholder={"headroom — запас капитала\nrechannelling"}
              className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 font-mono text-sm dark:border-neutral-700"
            />
          </div>
        </div>

        <div className="grid content-start gap-3">
          <h2 className="text-sm font-medium">Что прозвучало на событии</h2>
          {terms.docs.length === 0 ? (
            <p className="text-sm text-neutral-500">
              Глоссарий пуст — отмечать нечего. Термины появятся при генерации скрипта,
              а недостающие можно вписать слева.
            </p>
          ) : (
            <>
              <p className="text-xs text-neutral-500">
                {terms.docs.length} терминов. Отметьте те, что действительно прозвучали, —
                это разделит подготовку, которая пригодилась, и ту, что прошла впустую.
              </p>
              <ul className="max-h-[32rem] overflow-y-auto rounded-md border border-neutral-200 dark:border-neutral-800">
                {terms.docs.map((term) => (
                  <li
                    key={term.id}
                    className="border-b border-neutral-100 last:border-0 dark:border-neutral-900"
                  >
                    <label className="flex cursor-pointer items-start gap-3 px-3 py-2 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-900">
                      <input
                        type="checkbox"
                        name="occurred"
                        value={term.id}
                        defaultChecked={Boolean(term.occurredAtEvent)}
                        className="mt-1"
                      />
                      <span className="min-w-0">
                        <span className="block truncate">
                          {term.sourceTerm}
                          {term.targetTerm ? (
                            <span className="text-neutral-500"> — {term.targetTerm}</span>
                          ) : null}
                        </span>
                        <span className="text-xs text-neutral-400">
                          {STATUS_HINT[term.status] ?? term.status}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="lg:col-span-2">
          <button
            type="submit"
            className="rounded-lg bg-neutral-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            Сохранить разбор
          </button>
        </div>
      </form>
    </AppShell>
  );
}
