import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { payloadClient } from "@/lib/payload";
import AppShell from "@/components/app-shell";
import DangerousDelete from "@/components/dangerous-delete";
import EngagementForm from "@/components/engagement-form";
import { toRow, canSee, activeTeam, MODE_LABELS, MEMBER_STATUS_LABELS, WENT_LABELS, formatHeld } from "@/lib/engagements";
import { LANG_LABEL } from "@/lib/profile";
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

  if (!doc) notFound();

  // Читали с overrideAccess, поэтому доступ проверяем сами.
  const ownerId = typeof doc.owner === "object" ? doc.owner?.id : doc.owner;
  const row = toRow(doc);
  const mine = ownerId === user.id;
  if (!mine && !canSee(row, Number(ownerId), user.id)) notFound();

  // Чужую запись показываем, но не даём править: она не наша, даже если
  // мы в ней названы. Своё участие подтверждают отдельно (R2-4).
  if (!mine) {
    return (
      <AppShell email={user.email} title={row.title}>
        <div className="mb-5">
          <Link href="/experience" className="text-xs text-neutral-500 underline-offset-2 hover:underline">
            ← К опыту
          </Link>
        </div>

        <p className="mb-6 text-sm text-neutral-500">
          Запись завёл другой участник события, и вас назвали в команде.
        </p>

        <dl className="grid max-w-2xl gap-5 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-neutral-500">Когда и где</dt>
            <dd className="mt-1">
              {formatHeld(row.heldOn)}
              {row.location ? ` · ${row.location}` : ""}
              {row.organizer ? ` · ${row.organizer}` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-neutral-500">Режим и языки</dt>
            <dd className="mt-1">
              {MODE_LABELS[row.mode] ?? row.mode} ·{" "}
              {LANG_LABEL[row.sourceLang] ?? row.sourceLang} →{" "}
              {LANG_LABEL[row.targetLang] ?? row.targetLang}
            </dd>
          </div>
          {activeTeam(row).length > 0 && (
            <div>
              <dt className="text-xs uppercase tracking-wide text-neutral-500">Команда</dt>
              <dd className="mt-1 grid gap-1">
                {activeTeam(row).map((member, i) => (
                  <span key={i}>
                    {member.name}
                    {member.booth ? ` · ${member.booth}` : ""}
                    <span className="text-neutral-500">
                      {" "}
                      — {MEMBER_STATUS_LABELS[member.status] ?? member.status}
                    </span>
                  </span>
                ))}
              </dd>
            </div>
          )}
          {row.speakers.length > 0 && (
            <div>
              <dt className="text-xs uppercase tracking-wide text-neutral-500">Выступали</dt>
              <dd className="mt-1 grid gap-1">
                {row.speakers.map((s, i) => (
                  <span key={i}>
                    {s.name}
                    {s.organization ? ` · ${s.organization}` : ""}
                  </span>
                ))}
              </dd>
            </div>
          )}
          {(row.wentHow || row.wentText) && (
            <div>
              <dt className="text-xs uppercase tracking-wide text-neutral-500">Как прошло</dt>
              <dd className="mt-1 max-w-prose whitespace-pre-line">
                {row.wentHow ? WENT_LABELS[row.wentHow] : ""}
                {row.wentText ? `\n${row.wentText}` : ""}
              </dd>
            </div>
          )}
        </dl>
      </AppShell>
    );
  }

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
          team: row.team,
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
