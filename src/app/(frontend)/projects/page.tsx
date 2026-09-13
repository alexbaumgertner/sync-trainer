import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import {
  listProjects,
  SOURCE_LANG_LABELS,
  STATUS_LABELS,
  STYLE_PRESET_LABELS,
} from "@/lib/projects";
import AppShell from "@/components/app-shell";

export const dynamic = "force-dynamic";

const formatDate = (value: string | null): string =>
  value ? new Date(value).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" }) : "—";

export default async function ProjectsPage() {
  const user = await currentUser();
  if (!user) redirect("/");

  const projects = await listProjects(user.id);

  return (
    <AppShell email={user.email} title="Проекты">
      <div className="mb-6 flex items-center justify-between gap-4">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Проект — это одна конференция: документ, скрипт, глоссарий и аудио вместе.
        </p>
        <Link
          href="/projects/new"
          className="shrink-0 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          Новый проект
        </Link>
      </div>

      {projects.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 px-6 py-12 text-center dark:border-neutral-700">
          <p className="text-sm font-medium">Проектов пока нет</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-neutral-500 dark:text-neutral-400">
            Создайте проект под ближайшую конференцию. Дальше к нему добавятся
            документ, сгенерированный скрипт, глоссарий и аудио для прогона.
          </p>
          <Link
            href="/projects/new"
            className="mt-5 inline-block rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            Создать первый
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[42rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-900 text-left dark:border-neutral-100">
                {["Проект", "Событие", "Дата", "Язык", "Статус", "Расход"].map((head) => (
                  <th
                    key={head}
                    className="pb-2 pr-4 text-[11px] font-medium uppercase tracking-wide text-neutral-500"
                  >
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr
                  key={project.id}
                  className="border-b border-neutral-200 last:border-0 dark:border-neutral-800"
                >
                  <td className="py-3 pr-4">
                    <Link
                      href={`/projects/${project.id}`}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {project.title}
                    </Link>
                    <div className="text-xs text-neutral-500">
                      {STYLE_PRESET_LABELS[project.stylePreset] ?? project.stylePreset}
                    </div>
                  </td>
                  <td className="py-3 pr-4 text-neutral-600 dark:text-neutral-300">
                    {project.eventName ?? "—"}
                  </td>
                  <td className="py-3 pr-4 tabular-nums text-neutral-600 dark:text-neutral-300">
                    {formatDate(project.eventStartsOn)}
                  </td>
                  <td className="py-3 pr-4 text-neutral-600 dark:text-neutral-300">
                    {SOURCE_LANG_LABELS[project.sourceLang] ?? project.sourceLang}
                  </td>
                  <td className="py-3 pr-4">
                    <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs dark:bg-neutral-800">
                      {STATUS_LABELS[project.status] ?? project.status}
                    </span>
                  </td>
                  <td className="py-3 tabular-nums text-neutral-600 dark:text-neutral-300">
                    ${project.costUsd.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
