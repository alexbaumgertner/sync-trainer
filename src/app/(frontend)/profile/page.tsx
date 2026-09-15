import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { payloadClient } from "@/lib/payload";
import AppShell from "@/components/app-shell";
import ProfileForm from "@/components/profile-form";
import { VISIBLE_FIELDS } from "@/lib/profile";

export const dynamic = "force-dynamic";

/** Свой профиль: всегда правка, потому что смотреть на себя незачем. */
export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/");

  const { saved } = await searchParams;
  const payload = await payloadClient();
  const me = await payload.findByID({
    collection: "users",
    id: user.id,
    depth: 0,
    overrideAccess: true,
  });

  const lines = (rows: { name?: string | null }[] | null | undefined) =>
    (rows ?? []).map((r) => r.name ?? "").filter(Boolean).join("\n");

  return (
    <AppShell email={user.email} title="Профиль">
      <p className="mb-6 max-w-prose text-sm text-neutral-500">
        Карточка для коллег. Её видят только вошедшие пользователи — публичной
        страницы у профиля нет.
      </p>

      {saved && (
        <p
          role="status"
          className="mb-6 rounded-lg border border-neutral-200 px-4 py-2.5 text-sm dark:border-neutral-800"
        >
          Профиль сохранён.
        </p>
      )}

      <ProfileForm
        initial={{
          displayName: me.displayName ?? "",
          city: me.city ?? "",
          bio: me.bio ?? "",
          pairs: (me.languagePairs ?? [])
            .filter((p) => p.source && p.target)
            .map((p) => ({ source: p.source!, target: p.target! })),
          specializations: lines(me.specializations),
          memberships: lines(me.memberships),
          visibility: Object.fromEntries(
            VISIBLE_FIELDS.map((f) => [
              f,
              Boolean((me.visibility as Record<string, unknown> | undefined)?.[f]),
            ]),
          ),
        }}
      />
    </AppShell>
  );
}
