import Link from "next/link";
import LogoutButton from "./logout-button";

/**
 * Общая рамка приложения: заголовок, навигация, выход.
 *
 * Ориентиры расставлены не для порядка в разметке. Без `<main>` человеку со
 * скринридером нечем перепрыгнуть шапку: он проходит логотип, заголовок,
 * две ссылки и адрес почты заново на каждой странице. Lighthouse отмечал
 * это единственным провалом доступности.
 */
export default function AppShell({
  email,
  title,
  children,
}: {
  email: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4 border-b border-neutral-200 pb-5 dark:border-neutral-800">
        <div>
          <Link
            href="/projects"
            className="text-[11px] uppercase tracking-wide text-neutral-500 underline-offset-2 hover:underline"
          >
            Тренажёр синхрониста
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h1>
        </div>
        <div className="flex items-center gap-3 text-xs text-neutral-500">
          <nav aria-label="Разделы" className="flex items-center gap-3">
            <Link href="/experience" className="underline-offset-2 hover:underline">
              Опыт
            </Link>
            <Link href="/profile" className="underline-offset-2 hover:underline">
              Профиль
            </Link>
          </nav>
          <span className="hidden sm:inline">{email}</span>
          <LogoutButton />
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
