"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { payloadClient } from "@/lib/payload";
import { recordStep } from "@/lib/activity";
import { RATING_TARGETS, SCORE_LABELS, type RatingTarget } from "@/lib/ratings";

/**
 * Сохранение оценки материала.
 *
 * Одна оценка на пару «генерация + что оценивают»: повторное нажатие
 * переписывает прежнюю, а не плодит вторую. Человек передумал — это по-
 * прежнему одно его мнение об одном файле, и в отчёте оно должно считаться
 * один раз.
 */
export async function saveRating(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect("/");

  const projectId = Number(formData.get("projectId"));
  if (!Number.isInteger(projectId)) redirect("/projects");

  const target = String(formData.get("target") ?? "") as RatingTarget;
  const score = Number(formData.get("score"));
  const rawGeneration = Number(formData.get("generationId"));
  const generation = Number.isInteger(rawGeneration) && rawGeneration > 0 ? rawGeneration : null;
  const note = String(formData.get("note") ?? "").trim() || null;

  // Значения из формы — данные, а не команды: перечисления проверяем сами,
  // иначе в базу приедет что угодно, что уместилось в поле.
  if (!RATING_TARGETS.includes(target)) redirect(`/projects/${projectId}`);
  if (!SCORE_LABELS[score]) redirect(`/projects/${projectId}`);

  const payload = await payloadClient();

  const project = await payload
    .findByID({ collection: "projects", id: projectId, depth: 0, overrideAccess: true })
    .catch(() => null);
  const ownerId = typeof project?.owner === "object" ? project.owner?.id : project?.owner;
  if (!project || ownerId !== user.id) redirect("/projects");

  const existing = await payload.find({
    collection: "ratings",
    where: {
      and: [
        { project: { equals: projectId } },
        { target: { equals: target } },
        generation === null
          ? { generation: { exists: false } }
          : { generation: { equals: generation } },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  });

  if (existing.docs[0]) {
    await payload.update({
      collection: "ratings",
      id: existing.docs[0].id,
      data: { score, note },
      overrideAccess: true,
    });
  } else {
    await payload.create({
      collection: "ratings",
      data: { project: projectId, generation, user: user.id, target, score, note },
      overrideAccess: true,
    });
    // Шаг воронки — только на первой оценке этого вывода. Иначе исправленная
    // опечатка в заметке считалась бы новым событием.
    await recordStep(payload, "rating_given", { user: user.id, project: projectId });
  }

  revalidatePath(`/projects/${projectId}`);
  redirect(`/projects/${projectId}?rated=${target}`);
}
