import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import AppShell from "@/components/app-shell";
import EngagementForm from "@/components/engagement-form";
import { createEngagement } from "../actions";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  title: "Без названия события запись не сохранить.",
  date: "Без даты запись не сохранить: она о конкретном дне.",
};

export default async function NewEngagementPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/");

  const { error } = await searchParams;

  return (
    <AppShell email={user.email} title="Новая запись">
      <div className="mb-5">
        <Link href="/experience" className="text-xs text-neutral-500 underline-offset-2 hover:underline">
          ← К опыту
        </Link>
      </div>

      {error && (
        <p
          role="alert"
          className="mb-5 rounded-lg border border-red-300 bg-red-50 px-4 py-2.5 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200"
        >
          {ERRORS[error] ?? "Не удалось сохранить запись."}
        </p>
      )}

      <EngagementForm
        action={createEngagement}
        submitLabel="Сохранить запись"
        values={{
          title: "",
          organizer: "",
          heldOn: "",
          location: "",
          mode: "simultaneous",
          sourceLang: "en",
          targetLang: "ru",
          wentHow: null,
          wentText: "",
          speakers: [],
          team: [],
          visibility: "team",
        }}
      />
    </AppShell>
  );
}
