import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getProject } from "@/lib/projects";
import { payloadClient } from "@/lib/payload";
import AppShell from "@/components/app-shell";
import GlossaryEditor from "@/components/glossary-editor";
import { toTermRow } from "@/lib/glossary";
import {
  addTerm,
  addVariant,
  confirmTerm,
  deleteTerm,
  pinToPersonal,
  promoteVariant,
  removeVariant,
  saveTerm,
} from "./actions";

export const dynamic = "force-dynamic";

/**
 * Правка глоссария.
 *
 * До сих пор глоссарий был витриной: сгенерировался — скачай файлом.
 * Между тем подготовка к мероприятию как раз и состоит в том, чтобы
 * перебрать термины руками: часть выбросить, часть переписать, а над
 * несколькими держать два-три варианта до последнего дня.
 */
export default async function GlossaryPage({ params }: { params: Promise<{ id: string }> }) {
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
    // Глубина 1: нужны имена тех, кто предложил вариант и кто подтвердил.
    depth: 1,
    overrideAccess: true,
  });

  const rows = terms.docs.map(toTermRow);

  return (
    <AppShell email={user.email} title="Глоссарий">
      <p className="mb-6 max-w-prose text-sm text-neutral-500">
        {detail.project.title}. Термины, предложенные моделью, помечены — в кабине
        они выглядят так же уверенно, как выверенные, а верить им нельзя. Правка
        эквивалента снимает пометку: перевод, написанный вашей рукой, подтверждения
        не требует.
      </p>

      <GlossaryEditor
        projectId={projectId}
        viewerId={user.id as number}
        terms={rows}
        actions={{
          saveTerm,
          confirmTerm,
          deleteTerm,
          addTerm,
          addVariant,
          removeVariant,
          promoteVariant,
          pinToPersonal,
        }}
      />

      <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-neutral-200 pt-5 dark:border-neutral-800">
        <a
          href={`/api/projects/${projectId}/glossary?format=xlsx`}
          className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          Для InterpretBank (XLSX)
        </a>
        <a
          href={`/api/projects/${projectId}/glossary?format=csv`}
          className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          CSV
        </a>
        <Link
          href={`/projects/${projectId}`}
          className="ml-auto text-xs text-neutral-500 underline-offset-2 hover:underline"
        >
          ← К проекту
        </Link>
      </div>
    </AppShell>
  );
}
