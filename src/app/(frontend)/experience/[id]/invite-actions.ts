"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { payloadClient } from "@/lib/payload";
import { createInvitation } from "@/lib/invitations";
import { displayNameOf } from "@/lib/profile";
import type { Engagement } from "@/payload-types";

type Member = NonNullable<Engagement["team"]>[number];

/**
 * Приглашение коллеги из записи (C4).
 *
 * Механизм приглашений здесь не свой, а тот же, что у администратора (A5):
 * одноразовая ссылка со сроком, письмо из хука коллекции. Второй путь входа
 * означал бы вторую поверхность для ошибок, а вход — не то место, где стоит
 * держать два похожих механизма.
 *
 * Зовёт только владелец записи и только того, кого сам же в неё вписал.
 */
export async function inviteMember(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect("/");

  const id = Number(formData.get("id"));
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!Number.isInteger(id) || !email) redirect("/experience");

  const payload = await payloadClient();
  const doc = await payload
    .findByID({ collection: "engagements", id, depth: 0, overrideAccess: true })
    .catch(() => null);

  const ownerId = typeof doc?.owner === "object" ? doc.owner?.id : doc?.owner;
  if (!doc || ownerId !== user.id) redirect("/experience");

  // Звать можно только того, кто уже назван в этой записи: иначе форма стала
  // бы способом рассылать приглашения кому угодно от чужого имени.
  const team = (doc.team ?? []) as Member[];
  const member = team.find((m) => m.email?.trim().toLowerCase() === email);
  if (!member) redirect(`/experience/${id}?invite=unknown`);

  // Уже в сервисе — приглашать незачем, связь появится сама при следующей
  // правке записи. Проверяем до создания приглашения, а не после.
  const existing = await payload.find({
    collection: "users",
    where: { email: { equals: email } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  });
  if (existing.docs[0]) redirect(`/experience/${id}?invite=exists`);

  // Имя берём из профиля, а не из сессии: в сессии его нет, а адрес
  // приглашающего в письме постороннему человеку показывать незачем.
  const author = await payload
    .findByID({ collection: "users", id: user.id, depth: 0, overrideAccess: true })
    .catch(() => null);
  const who = author ? displayNameOf(author) : "Коллега";

  const note = `${who} указал вас в команде события «${doc.title}».`;

  try {
    await createInvitation({ email, invitedBy: user.id, note });
  } catch (error) {
    console.error("[experience] приглашение не отправлено", email, error);
    redirect(`/experience/${id}?invite=failed`);
  }

  revalidatePath(`/experience/${id}`);
  redirect(`/experience/${id}?invite=sent`);
}
