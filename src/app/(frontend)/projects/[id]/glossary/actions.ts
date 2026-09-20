"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { payloadClient } from "@/lib/payload";
import { statusAfterEdit, type TermStatus } from "@/lib/glossary";
import type { GlossaryTerm } from "@/payload-types";

/**
 * Правка глоссария.
 *
 * Все действия проходят через одну проверку владения: термин обязан лежать
 * в проекте обратившегося. Права коллекции это и так обеспечивают, но здесь
 * нужен ещё и внятный ответ человеку вместо отказа базы.
 */

type Loaded = {
  payload: Awaited<ReturnType<typeof payloadClient>>;
  userId: number;
  projectId: number;
  term: GlossaryTerm;
};

/** Общее начало: кто спрашивает, про какой проект и про какой термин. */
async function load(formData: FormData): Promise<Loaded> {
  const user = await currentUser();
  if (!user) redirect("/");

  const projectId = Number(formData.get("projectId"));
  if (!Number.isInteger(projectId)) redirect("/projects");

  // Отсутствие поля и ноль — разные вещи, а `Number(null)` равен нулю.
  // Без этой проверки добавление термина уходило искать термин с id 0,
  // не находило и молча возвращало человека на список.
  const rawTermId = formData.get("termId");
  const termId = rawTermId === null ? null : Number(rawTermId);

  const payload = await payloadClient();
  const project = await payload
    .findByID({ collection: "projects", id: projectId, depth: 0, overrideAccess: true })
    .catch(() => null);

  // K1–K2: глоссарий правит и команда проекта, но только связанная учётной
  // записью. Названный текстом в составе числится, а править ему нечем —
  // входа у него нет.
  const ownerId = typeof project?.owner === "object" ? project.owner?.id : project?.owner;
  const inTeam = (project?.team ?? []).some((member) => {
    const id = typeof member.user === "object" ? member.user?.id : member.user;
    return id === user.id;
  });
  if (!project || (ownerId !== user.id && !inTeam)) redirect("/projects");

  if (termId === null || !Number.isInteger(termId)) {
    return { payload, userId: user.id as number, projectId, term: null as never };
  }

  const term = (await payload
    .findByID({ collection: "glossary-terms", id: termId, depth: 1, overrideAccess: true })
    .catch(() => null)) as GlossaryTerm | null;

  const termProject = typeof term?.project === "object" ? term.project?.id : term?.project;
  // Термин чужого проекта — тот же ответ, что у несуществующего: подтверждать
  // существование перебором мы не хотим.
  if (!term || termProject !== projectId) redirect(`/projects/${projectId}/glossary`);

  return { payload, userId: user.id as number, projectId, term };
}

/**
 * Куда вернуться после правки.
 *
 * Редактор открывается и на карточке проекта, и на отдельной странице (I2),
 * поэтому адрес возврата приходит из формы. Принимаем только пути внутри
 * этого проекта: поле пришло из браузера, и без проверки оно стало бы
 * открытым перенаправлением — уводило бы с нашего адреса на чужой.
 */
const back = (projectId: number, formData?: FormData): never => {
  const own = `/projects/${projectId}`;
  const asked = String(formData?.get("returnTo") ?? "");
  const target = asked === own || asked === `${own}/glossary` ? asked : `${own}/glossary`;

  revalidatePath(target);
  // Якорь — чтобы вернуться к глоссарию, а не к началу карточки проекта:
  // на ней он теперь третьей секцией, и без якоря человек после каждой
  // правки оказывался бы в шапке.
  /**
   * Возврат на карточку проекта держит редактор раскрытым.
   *
   * Найдено живым использованием: `<details>` — состояние разметки, и после
   * перехода оно сбрасывается. Человек правил термин и каждый раз получал
   * захлопнутый список, в котором надо заново искать место. Параметр
   * говорит странице оставить его открытым, якорь — куда пролистать.
   */
  redirect(target === own ? `${own}?glossary=open#glossary` : target);
};

const text = (formData: FormData, key: string): string | null =>
  String(formData.get(key) ?? "").trim() || null;

export async function saveTerm(formData: FormData): Promise<void> {
  const { payload, userId, projectId, term } = await load(formData);

  const source = text(formData, "source");
  if (!source) return back(projectId, formData);

  const nextTarget = text(formData, "target");
  const previousTarget = term.targetTerm?.trim() || null;
  const status = statusAfterEdit(term.status as TermStatus, previousTarget, nextTarget);
  const becameVerified = status === "verified" && term.status !== "verified";

  await payload.update({
    collection: "glossary-terms",
    id: term.id,
    data: {
      sourceTerm: source,
      targetTerm: nextTarget ?? undefined,
      note: text(formData, "note") ?? undefined,
      status,
      // K5: глоссарий общий, и «эквивалент вдруг стал другим» — обычное
      // дело. Подпись не мешает перезаписи, но делает её видимой.
      editedBy: userId,
      ...(becameVerified ? { verifiedBy: userId, verifiedAt: new Date().toISOString() } : {}),
    },
    overrideAccess: true,
  });

  back(projectId, formData);
}

/**
 * Подтвердить как есть.
 *
 * Отдельным действием, а не галочкой в форме: «перевод модели уже верен» —
 * это утверждение человека, и оно должно требовать отдельного нажатия,
 * а не проезжать вместе с правкой заметки.
 */
export async function confirmTerm(formData: FormData): Promise<void> {
  const { payload, userId, projectId, term } = await load(formData);

  await payload.update({
    collection: "glossary-terms",
    id: term.id,
    data: {
      status: "verified",
      verifiedBy: userId,
      editedBy: userId,
      verifiedAt: new Date().toISOString(),
    },
    overrideAccess: true,
  });

  back(projectId, formData);
}

export async function deleteTerm(formData: FormData): Promise<void> {
  const { payload, projectId, term } = await load(formData);
  await payload.delete({ collection: "glossary-terms", id: term.id, overrideAccess: true });
  back(projectId, formData);
}

export async function addTerm(formData: FormData): Promise<void> {
  const { payload, userId, projectId } = await load(formData);

  const source = text(formData, "source");
  if (!source) return back(projectId, formData);

  await payload.create({
    collection: "glossary-terms",
    data: {
      project: projectId,
      scope: "project" as const,
      sourceTerm: source,
      targetTerm: text(formData, "target") ?? undefined,
      note: text(formData, "note") ?? undefined,
      // Термин, заведённый руками, не нуждается в подтверждении: человек
      // его и написал. Пометки «не подтверждён» в выгрузке у него не будет.
      status: "verified",
      proposedBy: userId,
      verifiedBy: userId,
      verifiedAt: new Date().toISOString(),
    },
    overrideAccess: true,
  });

  back(projectId, formData);
}

export async function addVariant(formData: FormData): Promise<void> {
  const { payload, userId, projectId, term } = await load(formData);

  const variantText = text(formData, "text");
  if (!variantText) return back(projectId, formData);

  const existing = (term.variants ?? []).map((variant) => ({
    text: variant.text,
    proposedBy:
      typeof variant.proposedBy === "object" ? variant.proposedBy?.id : variant.proposedBy,
    note: variant.note ?? undefined,
    at: variant.at ?? undefined,
  }));

  await payload.update({
    collection: "glossary-terms",
    id: term.id,
    data: {
      variants: [
        ...existing,
        {
          text: variantText,
          proposedBy: userId,
          note: text(formData, "note") ?? undefined,
          at: new Date().toISOString(),
        },
      ],
    },
    overrideAccess: true,
  });

  back(projectId, formData);
}

export async function removeVariant(formData: FormData): Promise<void> {
  const { payload, projectId, term } = await load(formData);
  const variantId = String(formData.get("variantId") ?? "");

  await payload.update({
    collection: "glossary-terms",
    id: term.id,
    data: {
      variants: (term.variants ?? [])
        .filter((variant) => String(variant.id) !== variantId)
        .map((variant) => ({
          text: variant.text,
          proposedBy:
            typeof variant.proposedBy === "object" ? variant.proposedBy?.id : variant.proposedBy,
          note: variant.note ?? undefined,
          at: variant.at ?? undefined,
        })),
    },
    overrideAccess: true,
  });

  back(projectId, formData);
}

/**
 * Сделать вариант основным.
 *
 * Прежний эквивалент не выбрасывается, а становится вариантом. Выбор здесь
 * обратимый по своей природе: сегодня в суде говорят так, а на той же неделе
 * у заказчика иначе, — и человек должен иметь возможность вернуться, не
 * вспоминая по памяти, что было написано раньше.
 *
 * Авторство прежнего эквивалента известно: если термин был подтверждён —
 * это подтвердивший, если предложен моделью — модель, то есть пусто.
 */
export async function promoteVariant(formData: FormData): Promise<void> {
  const { payload, userId, projectId, term } = await load(formData);
  const variantId = String(formData.get("variantId") ?? "");

  const chosen = (term.variants ?? []).find((variant) => String(variant.id) === variantId);
  if (!chosen?.text?.trim()) return back(projectId, formData);

  const previousTarget = term.targetTerm?.trim() || null;
  const previousAuthor =
    term.status === "suggested"
      ? null
      : typeof term.verifiedBy === "object"
        ? (term.verifiedBy?.id ?? null)
        : (term.verifiedBy ?? null);

  const kept = (term.variants ?? [])
    .filter((variant) => String(variant.id) !== variantId)
    .map((variant) => ({
      text: variant.text,
      proposedBy:
        typeof variant.proposedBy === "object" ? variant.proposedBy?.id : variant.proposedBy,
      note: variant.note ?? undefined,
      at: variant.at ?? undefined,
    }));

  await payload.update({
    collection: "glossary-terms",
    id: term.id,
    data: {
      targetTerm: chosen.text!.trim(),
      status: "verified",
      verifiedBy: userId,
      verifiedAt: new Date().toISOString(),
      variants: previousTarget
        ? [
            ...kept,
            {
              text: previousTarget,
              proposedBy: previousAuthor ?? undefined,
              at: chosen.at ?? undefined,
            },
          ]
        : kept,
    },
    overrideAccess: true,
  });

  back(projectId, formData);
}


/**
 * Закрепить термин в личном слое (T5).
 *
 * Отдельное действие человека, а не автоматика при сохранении: память тем
 * и ценна, что в неё кладут сознательно. Автоматический перенос затащил бы
 * туда эквивалент, подошедший одному мероприятию, — и в следующем проекте
 * он молча подставился бы как проверенный.
 */
export async function pinToPersonal(formData: FormData): Promise<void> {
  const { payload, userId, projectId, term } = await load(formData);
  if (!term) return back(projectId, formData);

  const { promoteToPersonal } = await import("@/lib/glossary-store");
  await promoteToPersonal(payload, userId, {
    sourceTerm: term.sourceTerm,
    targetTerm: term.targetTerm,
    note: term.note,
  });

  back(projectId, formData);
}
