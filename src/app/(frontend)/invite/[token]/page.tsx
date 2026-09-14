import Link from "next/link";
import { acceptInvitation } from "./actions";
import { invitationIsOpen } from "@/lib/invitations";

export const dynamic = "force-dynamic";

/**
 * Персональная ссылка из письма (A5).
 *
 * Переход по ссылке ничего не гасит — приглашение принимается только
 * нажатием. Иначе одноразовый токен сжигал бы почтовый сканер, который
 * ходит по ссылкам раньше человека, и адресату доставалась бы мёртвая
 * ссылка. Лишнее нажатие — плата за то, чтобы приглашение дожило до того,
 * кому оно послано.
 */
export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ failed?: string }>;
}) {
  const { token } = await params;
  const { failed } = await searchParams;

  // Проверка читающая: показать «уже принято» сразу честнее, чем звать
  // нажать кнопку, которая заведомо откажет. Гасить она ничего не гасит.
  const open = await invitationIsOpen(token);

  if (failed || !open) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
        <h1 className="text-xl font-semibold tracking-tight">Ссылка не сработала</h1>
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
          Приглашение уже принято, отозвано или истекло.
        </p>
        <p className="mt-4 text-sm text-neutral-500 dark:text-neutral-400">
          Это не тупик: если приглашение ещё действует, войдите по коду на тот же адрес —
          приглашение примется само.
        </p>
        <Link
          href="/"
          className="mt-5 inline-block rounded-lg bg-neutral-900 px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          Войти по коду
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <h1 className="text-xl font-semibold tracking-tight">Тренажёр синхрониста</h1>
      <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
        Вас пригласили. Нажмите, чтобы принять приглашение и войти — пароль придумывать
        не нужно.
      </p>
      <form action={acceptInvitation} className="mt-5">
        <input type="hidden" name="token" value={token} />
        <button
          type="submit"
          className="w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          Принять приглашение
        </button>
      </form>
      <p className="mt-4 text-xs text-neutral-500 dark:text-neutral-400">
        Ссылка одноразовая и действует две недели. Если она не сработает, войдите по коду
        на тот же адрес — приглашение примется само.
      </p>
    </div>
  );
}
