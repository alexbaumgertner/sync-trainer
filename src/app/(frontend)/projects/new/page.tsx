import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { SOURCE_LANG_LABELS, STYLE_PRESET_LABELS } from "@/lib/projects";
import { createProject } from "../actions";
import AppShell from "@/components/app-shell";

export const dynamic = "force-dynamic";

export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/");
  const { error } = await searchParams;

  return (
    <AppShell email={user.email} title="Новый проект">
      <form action={createProject} className="max-w-xl">
        {error === "title" && (
          <p className="mb-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
            Название обязательно — по нему вы найдёте проект в списке.
          </p>
        )}

        <Field label="Название" hint="Как вы сами будете его искать" htmlFor="title">
          <input id="title" aria-describedby="title-hint" name="title" required autoFocus className={inputClass} />
        </Field>

        <Field label="Событие" hint="Официальное название конференции, необязательно" htmlFor="eventName">
          <input id="eventName" aria-describedby="eventName-hint" name="eventName" className={inputClass} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Дата начала" htmlFor="eventStartsOn">
            <input id="eventStartsOn" type="date" name="eventStartsOn" className={inputClass} />
          </Field>
          <Field label="Место" htmlFor="eventLocation">
            <input id="eventLocation" name="eventLocation" placeholder="Стамбул" className={inputClass} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Язык речи" hint="На нём будет звучать тренировочное аудио" htmlFor="sourceLang">
            <select id="sourceLang" aria-describedby="sourceLang-hint" name="sourceLang" defaultValue="en" className={inputClass}>
              {Object.entries(SOURCE_LANG_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                  {value === "en" ? "" : " — черновой пресет"}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Язык глоссария" htmlFor="targetLang">
            <select id="targetLang" name="targetLang" defaultValue="ru" className={inputClass}>
              <option value="ru">Русский</option>
              <option value="en">English</option>
            </select>
          </Field>
        </div>

        <Field label="Стилистика" hint="Определяет регистр, роли спикеров и терминологию" htmlFor="stylePreset">
          <select id="stylePreset" aria-describedby="stylePreset-hint" name="stylePreset" defaultValue="un" className={inputClass}>
            {Object.entries(STYLE_PRESET_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        <div className="mt-6 flex items-center gap-3">
          <button
            type="submit"
            className="rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            Создать
          </button>
          <Link href="/projects" className="text-sm text-neutral-500 underline-offset-2 hover:underline">
            Отмена
          </Link>
        </div>
      </form>
    </AppShell>
  );
}

/**
 * Подсказка вынесена из <label> и связана через aria-describedby.
 * Внутри метки она попадала бы в доступное имя поля: экранный диктор читал бы
 * «Название Как вы сами будете его искать», а поиск по метке цеплял соседние поля.
 */
function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4 text-xs">
      <label
        htmlFor={htmlFor}
        className="mb-1 block font-medium text-neutral-700 dark:text-neutral-300"
      >
        {label}
      </label>
      {children}
      {hint && (
        <p id={`${htmlFor}-hint`} className="mt-1 text-neutral-500">
          {hint}
        </p>
      )}
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900";
