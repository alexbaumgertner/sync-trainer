import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { payloadClient } from "@/lib/payload";
import AppShell from "@/components/app-shell";
import DangerousDelete from "@/components/dangerous-delete";
import EngagementForm from "@/components/engagement-form";
import { toRow } from "@/lib/engagements";
import { updateEngagement, deleteEngagement } from "../actions";

export const dynamic = "force-dynamic";

/** Своя запись — всегда на правку: смотреть на собственную карточку незачем. */
export default async function EngagementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/");

  const { id } = await params;
  const { saved, error } = await searchParams;
  const engagementId = Number(id);
  if (!Number.isInteger(engagementId)) notFound();

  const payload = await payloadClient();
  const doc = await payload
    .findByID({ collection: "engagements", id: engagementId, depth: 0, overrideAccess: true })
    .catch(() => null);

  // Владение проверяем здесь, потому что читали с overrideAccess.
  const ownerId = typeof doc?.owner === "object" ? doc.owner?.id : doc?.owner;
  if (!doc || ownerId !== user.id) notFound();

  const row = toRow(doc);

  return (
    <AppShell email={user.email} title={row.title}>
      <div className="mb-5">
        <Link href="/experience" className="text-xs text-neutral-500 underline-offset-2 hover:underline">
          ← К опыту
        </Link>
      </div>

      {saved && (
        <p role="status" className="mb-5 rounded-lg border border-neutral-200 px-4 py-2.5 text-sm dark:border-neutral-800">
          Запись сохранена.
        </p>
      )}
      {error && (
        <p role="alert" className="mb-5 rounded-lg border border-red-300 bg-red-50 px-4 py-2.5 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
          Название и дата обязательны.
        </p>
      )}

      <EngagementForm
        action={updateEngagement}
        submitLabel="Сохранить"
        values={{
          id: row.id,
          title: row.title,
          organizer: row.organizer ?? "",
          heldOn: row.heldOn.slice(0, 10),
          location: row.location ?? "",
          mode: row.mode,
          sourceLang: row.sourceLang,
          targetLang: row.targetLang,
          wentHow: row.wentHow,
          wentText: row.wentText ?? "",
          speakers: row.speakers,
          visibility: row.visibility,
        }}
      />

      <div className="mt-10 flex items-center justify-between border-t border-neutral-200 pt-5 dark:border-neutral-800">
        {row.projectId ? (
          <Link
            href={`/projects/${row.projectId}`}
            className="text-sm text-neutral-500 underline-offset-2 hover:underline"
          >
            Подготовка к этому событию →
          </Link>
        ) : (
          <span className="text-xs text-neutral-500">Подготовки в тренажёре не было</span>
        )}
        <form action={deleteEngagement}>
          <input type="hidden" name="id" value={row.id} />
          <DangerousDelete
            label="Удалить запись"
            confirmation={`Удалить запись «${row.title}»? Это необратимо.`}
          />
        </form>
      </div>
    </AppShell>
  );
}
