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
import {
  confirmParticipation,
  disputeParticipation,
  withdrawParticipation,
} from "./confirm-actions";
import { inviteMember } from "./invite-actions";

export const dynamic = "force-dynamic";

/** Своя запись — всегда на правку: смотреть на собственную карточку незачем. */
export default async function EngagementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string; answered?: string; invite?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/");

  const { id } = await params;
  const { saved, error, answered, invite } = await searchParams;
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

        <p className="mb-6 max-w-prose text-sm text-neutral-500">
          Запись завёл другой участник события, и вас назвали в команде.
        </p>

        {answered === "confirmed" && (
          <p role="status" className="mb-6 rounded-lg border border-neutral-200 px-4 py-2.5 text-sm dark:border-neutral-800">
            Участие подтверждено. Теперь это не заявление владельца записи, а факт,
            подтверждённый вами.
          </p>
        )}

        {(() => {
          const me = row.team.find((m) => m.userId === user.id);
          if (!me) return null;

          if (me.status === "confirmed") {
            return (
              <div className="mb-8 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
                <p className="text-sm">Вы подтвердили участие.</p>
                <p className="mt-1 max-w-prose text-xs text-neutral-500">
                  Подтверждение — это ещё и согласие на упоминание. Его можно отозвать:
                  тогда имя уйдёт из записи.
                </p>
                <form action={withdrawParticipation} className="mt-3">
                  <input type="hidden" name="id" value={row.id} />
                  <button
                    type="submit"
                    className="rounded border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
                  >
                    Отозвать согласие
                  </button>
                </form>
              </div>
            );
          }

          return (
            <div className="mb-8 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
              <p className="text-sm font-medium">Вы действительно переводили на этом событии?</p>
              <p className="mt-1 max-w-prose text-xs text-neutral-500">
                Пока вы не ответили, участие показывается как неподтверждённое: это
                заявление владельца записи, а не факт. Подтверждение — заодно согласие
                на то, чтобы вас здесь упоминали.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <form action={confirmParticipation}>
                  <input type="hidden" name="id" value={row.id} />
                  <button
                    type="submit"
                    className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
                  >
                    Да, подтверждаю
                  </button>
                </form>
                <form action={disputeParticipation}>
                  <input type="hidden" name="id" value={row.id} />
                  <button
                    type="submit"
                    className="rounded-lg border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
                  >
                    Меня там не было
                  </button>
                </form>
              </div>
            </div>
          );
        })()}

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

      {(() => {
        // Приглашать имеет смысл только тех, кого назвали с адресом,
        // но связи не появилось: значит учётной записи ещё нет.
        const invitable = row.team.filter((m) => m.email && !m.userId);
        if (!invitable.length) return null;

        return (
          <section className="mt-10 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
            <h2 className="text-sm font-medium">Позвать в сервис</h2>
            <p className="mt-1 max-w-prose text-xs text-neutral-500">
              У этих коллег нет учётной записи, поэтому подтвердить участие они
              не могут — пока запись держится на вашем слове. Приглашение уходит
              обычной персональной ссылкой.
            </p>

            {invite && (
              <p role="status" className="mt-3 text-xs text-neutral-500">
                {invite === "sent" && "Приглашение отправлено."}
                {invite === "exists" && "У этого адреса уже есть учётная запись — связь появится при следующем сохранении записи."}
                {invite === "failed" && "Письмо не ушло. Попробуйте позже."}
                {invite === "unknown" && "Этого адреса нет в команде записи."}
              </p>
            )}

            <ul className="mt-3 grid gap-2">
              {invitable.map((member, i) => (
                <li key={i} className="flex flex-wrap items-center gap-3 text-sm">
                  <span>{member.name}</span>
                  <span className="text-xs text-neutral-500">{member.email}</span>
                  <form action={inviteMember} className="ml-auto">
                    <input type="hidden" name="id" value={row.id} />
                    <input type="hidden" name="email" value={member.email ?? ""} />
                    <button
                      type="submit"
                      className="rounded border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
                    >
                      Пригласить
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        );
      })()}

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
