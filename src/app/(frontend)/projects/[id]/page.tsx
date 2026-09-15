import ArtifactRating from "@/components/artifact-rating";
import { saveRating } from "./rate-actions";
import { RATING_TARGETS, ratingFor, type RatingTarget } from "@/lib/ratings";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import {
  getProject,
  SOURCE_LANG_LABELS,
  STATUS_LABELS,
  STYLE_PRESET_LABELS,
} from "@/lib/projects";
import { deleteProject } from "../actions";
import AppShell from "@/components/app-shell";
import DangerousDelete from "@/components/dangerous-delete";
import DocumentUpload from "@/components/document-upload";

export const dynamic = "force-dynamic";

const formatBytes = (bytes: number | null): string =>
  bytes === null ? "—" : bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(0)} КБ`
    : `${(bytes / 1024 / 1024).toFixed(2)} МБ`;

const formatDate = (value: string | null): string =>
  value ? new Date(value).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }) : "—";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/");

  const { id } = await params;
  const detail = await getProject(Number(id), user.id);
  if (!detail) notFound();

  const { project, files, documents, ratings, costUsd, glossaryCount, hasDebrief } = detail;

  return (
    <AppShell email={user.email} title={project.title}>
      <div className="mb-6 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
        <span className="rounded bg-neutral-100 px-2 py-0.5 dark:bg-neutral-800">
          {STATUS_LABELS[project.status] ?? project.status}
        </span>
        <span>{SOURCE_LANG_LABELS[project.sourceLang] ?? project.sourceLang}</span>
        <span>·</span>
        <span>{STYLE_PRESET_LABELS[project.stylePreset] ?? project.stylePreset}</span>
        <span>·</span>
        <span className="tabular-nums">${costUsd.toFixed(2)}</span>
      </div>

      <dl className="mb-8 grid gap-4 border-y border-neutral-200 py-4 text-sm sm:grid-cols-3 dark:border-neutral-800">
        <Detail label="Событие" value={project.eventName ?? "—"} />
        <Detail label="Дата" value={formatDate(project.eventStartsOn ?? null)} />
        <Detail label="Место" value={project.eventLocation ?? "—"} />
      </dl>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium">Исходные документы</h2>
        {documents.length > 0 && (
          <ul className="divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
            {documents.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-baseline gap-x-3 py-2">
                <span className="font-medium">{doc.filename}</span>
                <span className="text-xs text-neutral-500">{formatBytes(doc.bytes)}</span>
                {doc.pages && <span className="text-xs text-neutral-500">{doc.pages} с.</span>}
                <span className="ml-auto text-xs text-neutral-500">
                  {doc.purgedAt ? "оригинал удалён" : "обрабатывается"}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className={documents.length > 0 ? "mt-4" : ""}>
          <DocumentUpload
            projectId={project.id}
            clientUpload={Boolean(process.env.BLOB_READ_WRITE_TOKEN)}
          />
        </div>
      </section>

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium">Файлы проекта</h2>
          <Link
            href={`/projects/${project.id}/script`}
            className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs hover:border-neutral-500 dark:border-neutral-700"
          >
            Скрипт и озвучка
          </Link>
        </div>
        {files.length === 0 ? (
          <p className="text-sm text-neutral-500">
            Здесь появятся скрипт, SSML, аудио и выгрузка глоссария — всё, к чему можно
            вернуться перед следующим прогоном.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
            {files.map((file) => (
              <li key={file.id} className="flex flex-wrap items-baseline gap-x-3 py-2">
                <span className="font-medium">{file.label}</span>
                <span className="text-xs text-neutral-500">{formatBytes(file.bytes)}</span>
                <span className="text-xs text-neutral-500">{formatDate(file.createdAt)}</span>
                <a
                  href={`/api/projects/${project.id}/files/${file.id}`}
                  className="ml-auto text-xs underline-offset-2 hover:underline"
                >
                  Скачать
                </a>
                {RATING_TARGETS.includes(file.kind as RatingTarget) && (
                  <div className="mt-1 w-full">
                    <ArtifactRating
                      action={saveRating}
                      projectId={project.id}
                      target={file.kind as RatingTarget}
                      generationId={file.generationId}
                      current={ratingFor(ratings, file.kind as RatingTarget, file.generationId)}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-medium">После события</h2>
        <p className="mb-3 max-w-prose text-sm text-neutral-500">
          {hasDebrief
            ? "Разбор сохранён. Его можно дополнить — он пойдёт в подготовку к следующему событию."
            : "Когда событие пройдёт, отметьте, что прозвучало, и запишите, чего не хватило. Это заготовка для следующей подготовки, а не отчёт."}
        </p>
        <Link
          href={`/projects/${project.id}/debrief`}
          className="inline-block rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          {hasDebrief ? "Открыть разбор" : "Заполнить разбор"}
        </Link>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-medium">Глоссарий</h2>
        {glossaryCount === 0 ? (
          <p className="text-sm text-neutral-500">Пока пуст. Заполнится при генерации скрипта.</p>
        ) : (
          <>
            <p className="text-sm text-neutral-500">{glossaryCount} терминов.</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <a
                href={`/api/projects/${project.id}/glossary?format=xlsx`}
                className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
              >
                Для InterpretBank (XLSX)
              </a>
              <a
                href={`/api/projects/${project.id}/glossary?format=csv`}
                className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
              >
                CSV
              </a>
            </div>
            <p className="mt-3 max-w-prose text-xs text-neutral-500">
              При импорте в InterpretBank отметьте <b>Exclude first row</b> — в первой строке
              названия языков, по ним он определяет колонки. Термины, предложенные моделью и
              никем не проверенные, помечены в колонке примечаний: в кабине они выглядят так же
              уверенно, как выверенные, а верить им нельзя.
            </p>
          </>
        )}
      </section>

      <div className="flex items-center justify-between border-t border-neutral-200 pt-5 dark:border-neutral-800">
        <Link href="/projects" className="text-sm text-neutral-500 underline-offset-2 hover:underline">
          ← Ко всем проектам
        </Link>
        <form action={deleteProject}>
          <input type="hidden" name="id" value={project.id} />
          <DangerousDelete
            label="Удалить проект"
            confirmation={`Удалить «${project.title}»? Вместе с проектом исчезнут его файлы, глоссарий и разбор. Это необратимо.`}
          />
        </form>
      </div>
    </AppShell>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}
