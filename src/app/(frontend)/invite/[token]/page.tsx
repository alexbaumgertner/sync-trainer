import Link from "next/link";
import { redirect } from "next/navigation";
import { setSession } from "@/lib/auth";
import { redeemInvitation } from "@/lib/invitations";

export const dynamic = "force-dynamic";

/**
 * Персональная ссылка из письма. Одноразовая: повторный переход ничего не даёт.
 * Успешный переход сразу создаёт сессию — второй раз просить код незачем.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await redeemInvitation(token);

  if (result.ok) {
    await setSession(result.userId);
    redirect("/");
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <h1 className="text-xl font-semibold tracking-tight">Ссылка не сработала</h1>
      <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">{result.error}</p>
      <p className="mt-4 text-sm text-neutral-500 dark:text-neutral-400">
        Если приглашение ещё действует, войти можно по коду на ту же почту.
      </p>
      <Link
        href="/"
        className="mt-5 inline-block rounded-lg bg-neutral-900 px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        Ко входу
      </Link>
    </div>
  );
}
