"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { payloadClient } from "@/lib/payload";
import type { Engagement } from "@/payload-types";

type Member = NonNullable<Engagement["team"]>[number];

/**
 * Подтверждение участия (C1–C3, C5).
 *
 * Ядро релиза. Утверждение «я переводил с Ивановой» стоит ноль, пока его
 * может написать кто угодно; оно становится ценным, когда Иванова его
 * подтвердила. Отсюда правила, которые нельзя срезать:
 *
 * — решает **только** сам участник, никогда владелец записи;
 * — можно не только подтвердить, но и оспорить: иначе подтверждение
 *   ничего не гарантирует;
 * — подтверждение есть согласие на упоминание, и его можно отозвать.
 */
const ALLOWED = new Set(["confirmed", "disputed", "withdrawn"]);

async function setOwnStatus(formData: FormData, status: string): Promise<void> {
  const user = await currentUser();
  if (!user) redirect("/");

  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || !ALLOWED.has(status)) redirect("/experience");

  const payload = await payloadClient();
  const doc = await payload
    .findByID({ collection: "engagements", id, depth: 0, overrideAccess: true })
    .catch(() => null);
  if (!doc) redirect("/experience");

  const team = (doc.team ?? []) as Member[];
  const mine = team.filter((m) => {
    const userId = typeof m.user === "object" ? m.user?.id : m.user;
    return userId === user.id;
  });

  // Менять можно только собственное участие. Владелец записи сюда не попадает:
  // он в своей команде не числится, а если числится — меняет своё, не чужое.
  if (!mine.length) redirect("/experience");

  const next = team.map((member) => {
    const userId = typeof member.user === "object" ? member.user?.id : member.user;
    if (userId !== user.id) return member;
    return {
      ...member,
      status: status as Member["status"],
      confirmedAt: status === "confirmed" ? new Date().toISOString() : null,
    };
  });

  await payload.update({
    collection: "engagements",
    id,
    data: { team: next },
    overrideAccess: true,
  });

  revalidatePath("/experience");
  revalidatePath(`/experience/${id}`);

  // Оспорив или отозвав согласие, человек выпадает из команды и теряет доступ
  // к записи. Вернуть его на страницу, которой он больше не видит, значило бы
  // показать ему 404 вместо ответа на его же действие.
  if (status !== "confirmed") redirect(`/experience?answered=${status}`);
  redirect(`/experience/${id}?answered=confirmed`);
}

/** «Да, я там переводил». */
export async function confirmParticipation(formData: FormData): Promise<void> {
  await setOwnStatus(formData, "confirmed");
}

/** «Меня там не было». Запись перестаёт показывать участие как факт (C3). */
export async function disputeParticipation(formData: FormData): Promise<void> {
  await setOwnStatus(formData, "disputed");
}

/** «Не хочу, чтобы меня упоминали». Согласие отзывается (C5). */
export async function withdrawParticipation(formData: FormData): Promise<void> {
  await setOwnStatus(formData, "withdrawn");
}
