"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { payloadClient } from "@/lib/payload";
import { recordStep } from "@/lib/activity";

/** Создание проекта. Владельца проставляет хук коллекции из сессии. */
export async function createProject(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect("/");

  const title = String(formData.get("title") ?? "").trim();
  if (!title) redirect("/projects/new?error=title");

  const optional = (key: string): string | undefined => {
    const value = String(formData.get(key) ?? "").trim();
    return value || undefined;
  };

  const payload = await payloadClient();
  const project = await payload.create({
    collection: "projects",
    data: {
      title,
      owner: user.id,
      eventName: optional("eventName"),
      eventStartsOn: optional("eventStartsOn"),
      eventLocation: optional("eventLocation"),
      sourceLang: (optional("sourceLang") ?? "en") as "en" | "de" | "fr" | "tr",
      targetLang: (optional("targetLang") ?? "ru") as "ru" | "en",
      stylePreset: (optional("stylePreset") ?? "un") as "un" | "court" | "eu" | "corporate",
      status: "draft",
    },
    overrideAccess: true,
  });

  await recordStep(payload, "project_created", { user: user.id, project: project.id });

  revalidatePath("/projects");
  redirect(`/projects/${project.id}`);
}

/**
 * Удаление проекта. Файлы и связанные записи уносит хук коллекции (F4),
 * поэтому здесь только проверка владения и сам вызов.
 */
export async function deleteProject(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect("/");

  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) redirect("/projects");

  const payload = await payloadClient();
  const project = await payload
    .findByID({ collection: "projects", id, depth: 0, overrideAccess: true })
    .catch(() => null);

  const ownerId = typeof project?.owner === "object" ? project.owner?.id : project?.owner;
  if (!project || ownerId !== user.id) redirect("/projects");

  await payload.delete({ collection: "projects", id, overrideAccess: true });

  revalidatePath("/projects");
  redirect("/projects");
}

/**
 * S2–S3: удаление оригинала документа.
 *
 * Именно это действие и есть «удаление оригинала» — раньше его делал
 * таймер, теперь делает человек. Запись документа остаётся: она говорит,
 * из чего был собран скрипт, и по её отпечатку узнаётся повторная загрузка
 * того же файла. Уходит только сам файл.
 */
export async function deleteDocumentSource(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect("/");

  const documentId = Number(formData.get("documentId"));
  const projectId = Number(formData.get("projectId"));
  if (!Number.isInteger(documentId) || !Number.isInteger(projectId)) redirect("/projects");

  const payload = await payloadClient();
  const project = await payload
    .findByID({ collection: "projects", id: projectId, depth: 0, overrideAccess: true })
    .catch(() => null);
  const ownerId = typeof project?.owner === "object" ? project.owner?.id : project?.owner;
  if (!project || ownerId !== user.id) redirect("/projects");

  const document = await payload
    .findByID({ collection: "documents", id: documentId, depth: 0, overrideAccess: true })
    .catch(() => null);
  // Принадлежность проверяем отдельно: идентификатор документа приходит из
  // формы, и без этой проверки чужой документ удалялся бы по чужой ссылке.
  const documentProjectId =
    typeof document?.project === "object" ? document.project?.id : document?.project;
  if (!document || documentProjectId !== projectId) redirect(`/projects/${projectId}`);

  if (document.blobPath) {
    const { deleteArtifacts } = await import("@/lib/artifacts");
    await deleteArtifacts([document.blobPath]).catch((error: unknown) => {
      // Недоступный файл не повод оставлять запись в противоречивом виде:
      // человек попросил удалить, и на экране должно быть «удалён».
      console.error("[documents] не удалось удалить оригинал", error);
    });
  }

  await payload.update({
    collection: "documents",
    id: documentId,
    data: { blobPath: null, purgedAt: new Date().toISOString() },
    overrideAccess: true,
  });

  revalidatePath(`/projects/${projectId}`);
}
