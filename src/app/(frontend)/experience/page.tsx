import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { payloadClient } from "@/lib/payload";
import AppShell from "@/components/app-shell";
import { toRow, MODE_LABELS, formatHeld, yearOf, WENT_LABELS } from "@/lib/engagements";
import { LANG_LABEL } from "@/lib/profile";

export const dynamic = "force-dynamic";

/** Список записей о работе. Новые сверху: свежее важнее давнего. */
export default async function ExperiencePage() {
  const user = await currentUser();
  if (!user) redirect("/");

  const payload = await payloadClient();
  const found = await payload.find({
    collection: "engagements",
    where: { owner: { equals: user.id } },
    sort: "-heldOn",
    limit: 500,
    depth: 0,
    overrideAccess: true,
  });

  const rows = found.docs.map(toRow);
  const years = rows.map((r) => yearOf(r.heldOn));

  return (
    <AppShell email={user.email} title="Опыт">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-sm text-neutral-500">
          Записи о проведённой работе. Не разбор — разбор приватен и живёт
          в проекте. Здесь то, что не стыдно показать коллегам.
        </p>
        <Link
          href="/experience/new"
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          Добавить запись
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Пока пусто. Запись можно завести о любой конференции — в том числе
          о той, к которой вы готовились не здесь.
        </p>
      ) : (
        <>
          <p className="mb-4 text-xs text-neutral-500">
            {rows.length}{" "}
            {rows.length % 10 === 1 && rows.length % 100 !== 11 ? "запись" : "записей"}
            {years.length > 0 && ` · с ${Math.min(...years)} года`}
          </p>
          <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {rows.map((row) => (
              <li key={row.id} className="py-3">
                <Link href={`/experience/${row.id}`} className="group block">
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <span className="font-medium group-hover:underline">{row.title}</span>
                    {row.organizer && (
                      <span className="text-sm text-neutral-500">{row.organizer}</span>
                    )}
                    <span className="ml-auto text-xs tabular-nums text-neutral-500">
                      {formatHeld(row.heldOn)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-neutral-500">
                    <span>{MODE_LABELS[row.mode] ?? row.mode}</span>
                    <span>
                      {LANG_LABEL[row.sourceLang] ?? row.sourceLang} →{" "}
                      {LANG_LABEL[row.targetLang] ?? row.targetLang}
                    </span>
                    {row.location && <span>{row.location}</span>}
                    {row.wentHow && <span>{WENT_LABELS[row.wentHow]}</span>}
                    {row.visibility === "private" && <span>только я</span>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </AppShell>
  );
}
