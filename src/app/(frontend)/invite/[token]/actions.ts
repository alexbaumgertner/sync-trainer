"use server";

import { redirect } from "next/navigation";
import { setSession } from "@/lib/auth";
import { redeemInvitation } from "@/lib/invitations";

/**
 * Принятие приглашения.
 *
 * Живёт в серверном действии, а не в отрисовке страницы, по двум причинам,
 * и обе выяснились на живом приглашении 14 сентября.
 *
 * Первая: серверный компонент не имеет права ставить куки, и попытка
 * заканчивалась 500 — уже **после** того, как токен погашен. Ссылка сгорала,
 * а человек видел ошибку.
 *
 * Вторая: по ссылке из письма первым ходит не человек, а почтовый сканер.
 * Пока приглашение принималось простым переходом, одноразовый токен гасился
 * этим сканером, и человеку доставалась мёртвая ссылка.
 */
export async function acceptInvitation(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  if (!token) redirect("/");

  const result = await redeemInvitation(token);
  if (!result.ok) {
    // Токен в адресе оставляем: страница по нему ничего не гасит, зато
    // человек видит, о каком именно приглашении речь.
    redirect(`/invite/${encodeURIComponent(token)}?failed=1`);
  }

  await setSession(result.userId);
  redirect("/projects");
}
