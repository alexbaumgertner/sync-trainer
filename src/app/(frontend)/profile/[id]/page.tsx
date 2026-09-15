import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { payloadClient } from "@/lib/payload";
import AppShell from "@/components/app-shell";
import { profileView, profileIsEmpty, pairLabel } from "@/lib/profile";

export const dynamic = "force-dynamic";

/**
 * Профиль коллеги (P2, P3).
 *
 * Видят только вошедшие — за этим следит проверка ниже, а не скрытая ссылка.
 * Что именно показать, решает `profileView`: он собирает разрешённое поимённо,
 * а не вычёркивает запрещённое из всей записи.
 */
export default async function ColleagueProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const viewer = await currentUser();
  if (!viewer) redirect("/");

  const { id } = await params;
  const userId = Number(id);
  if (!Number.isInteger(userId)) notFound();

  // Свой профиль правится, а не рассматривается.
  if (userId === viewer.id) redirect("/profile");

  const payload = await payloadClient();
  const person = await payload
    .findByID({ collection: "users", id: userId, depth: 0, overrideAccess: true })
    .catch(() => null);
  if (!person) notFound();

  const view = profileView(person, viewer.id);

  return (
    <AppShell email={viewer.email} title={view.displayName}>
      {profileIsEmpty(view) ? (
        <p className="text-sm text-neutral-500">
          Профиль пока не заполнен или закрыт.
        </p>
      ) : (
        <dl className="grid max-w-2xl gap-5 text-sm">
          {view.languagePairs.length > 0 && (
            <div>
              <dt className="text-xs uppercase tracking-wide text-neutral-500">Языковые пары</dt>
              <dd className="mt-1 flex flex-wrap gap-2">
                {view.languagePairs.map((pair, i) => (
                  <span
                    key={i}
                    className="rounded bg-neutral-100 px-2 py-0.5 text-xs dark:bg-neutral-800"
                  >
                    {pairLabel(pair)}
                  </span>
                ))}
              </dd>
            </div>
          )}

          {view.city && (
            <div>
              <dt className="text-xs uppercase tracking-wide text-neutral-500">Город</dt>
              <dd className="mt-1">{view.city}</dd>
            </div>
          )}

          {view.specializations.length > 0 && (
            <div>
              <dt className="text-xs uppercase tracking-wide text-neutral-500">Специализации</dt>
              <dd className="mt-1">{view.specializations.join(" · ")}</dd>
            </div>
          )}

          {view.memberships.length > 0 && (
            <div>
              <dt className="text-xs uppercase tracking-wide text-neutral-500">Объединения</dt>
              <dd className="mt-1">{view.memberships.join(" · ")}</dd>
            </div>
          )}

          {view.bio && (
            <div>
              <dt className="text-xs uppercase tracking-wide text-neutral-500">О себе</dt>
              <dd className="mt-1 max-w-prose whitespace-pre-line">{view.bio}</dd>
            </div>
          )}
        </dl>
      )}

      <div className="mt-8 border-t border-neutral-200 pt-5 dark:border-neutral-800">
        <Link href="/projects" className="text-sm text-neutral-500 underline-offset-2 hover:underline">
          ← К проектам
        </Link>
      </div>
    </AppShell>
  );
}
