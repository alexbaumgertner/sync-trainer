"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { payloadClient } from "@/lib/payload";
import { recordStep } from "@/lib/activity";
import { parseMissingTerms } from "@/lib/debrief";

const PACES = ["slower", "as-expected", "faster", "much-faster"] as const;
type Pace = (typeof PACES)[number];

/**
 * Сохранение разбора после события (E1–E3).
 *
 * Три требования в одном действии, потому что человек заполняет их за один
 * присест и ждёт одного нажатия: короткие вопросы, отметки «прозвучало» у
 * терминов и список того, чего не хватило.
 */
export async function saveDebrief(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect("/");

  const projectId = Number(formData.get("projectId"));
  if (!Number.isInteger(projectId)) redirect("/projects");

  const payload = await payloadClient();

  // Владение проверяем до единой записи: разбор трогает и глоссарий тоже.
  const project = await payload
    .findByID({ collection: "projects", id: projectId, depth: 0, overrideAccess: true })
    .catch(() => null);
  const ownerId = typeof project?.owner === "object" ? project.owner?.id : project?.owner;
  if (!project || ownerId !== user.id) redirect("/projects");

  const text = (key: string): string | undefined => {
    const value = String(formData.get(key) ?? "").trim();
    return value || undefined;
  };

  const rawPace = String(formData.get("actualPace") ?? "");
  const actualPace = (PACES as readonly string[]).includes(rawPace)
    ? (rawPace as Pace)
    : undefined;

  const data = {
    project: projectId,
    heldOn: text("heldOn"),
    hardest: text("hardest"),
    surprises: text("surprises"),
    missingTerms: text("missingTerms"),
    actualPace,
  };

  // Разбор у события один: второе сохранение правит его, а не плодит копии.
  const existing = await payload.find({
    collection: "debriefs",
    where: { project: { equals: projectId } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  });

  if (existing.docs[0]) {
    await payload.update({
      collection: "debriefs",
      id: existing.docs[0].id,
      data,
      overrideAccess: true,
    });
  } else {
    await payload.create({ collection: "debriefs", data, overrideAccess: true });
  }

  // Шаг пишем и на правке: заполненность — это про то, вернулся ли человек
  // к проекту после мероприятия, а не про то, сколько строк в таблице.
  await recordStep(payload, "debrief_filled", { user: user.id, project: projectId });

  // E1: отметки «прозвучало на событии». Форма присылает только отмеченные,
  // поэтому снятые надо гасить явно — иначе снять отметку было бы нельзя.
  const marked = new Set(
    formData.getAll("occurred").map((value) => Number(value)).filter(Number.isInteger),
  );

  const terms = await payload.find({
    collection: "glossary-terms",
    where: { project: { equals: projectId } },
    limit: 5000,
    depth: 0,
    overrideAccess: true,
  });

  for (const term of terms.docs) {
    const should = marked.has(term.id);
    // Пишем только изменившееся: иначе каждое сохранение разбора — это
    // несколько сотен запросов на обновление ничего.
    if (Boolean(term.occurredAtEvent) === should) continue;
    await payload.update({
      collection: "glossary-terms",
      id: term.id,
      data: { occurredAtEvent: should },
      overrideAccess: true,
    });
  }

  // E2: недостающие термины попадают в глоссарий со статусом «из практики».
  // Они ценнее предложенных моделью: добыты на живом событии.
  const byTerm = new Map(terms.docs.map((term) => [term.sourceTerm.trim().toLowerCase(), term]));

  for (const parsed of parseMissingTerms(data.missingTerms ?? "")) {
    const key = parsed.source.toLowerCase();
    const existing = byTerm.get(key);

    if (existing) {
      // Термин уже есть в глоссарии, но человек написал, что его не хватило, —
      // значит он прозвучал. Молча пропустить эту строку значило бы выбросить
      // единственное свидетельство о событии, какое у нас есть.
      const data: Record<string, unknown> = {};
      if (!existing.occurredAtEvent) data.occurredAtEvent = true;
      // Перевод дописываем только в пустое: свой, выверенный, затирать нельзя.
      if (parsed.target && !existing.targetTerm?.trim()) data.targetTerm = parsed.target;
      if (Object.keys(data).length) {
        await payload.update({
          collection: "glossary-terms",
          id: existing.id,
          data,
          overrideAccess: true,
        });
      }
      continue;
    }

    byTerm.set(key, { id: -1, sourceTerm: parsed.source } as (typeof terms.docs)[number]);
    await payload.create({
      collection: "glossary-terms",
      data: {
        project: projectId,
        sourceTerm: parsed.source,
        targetTerm: parsed.target ?? undefined,
        status: "from-practice",
        proposedBy: user.id,
        occurredAtEvent: true,
        note: "Записан после события",
      },
      overrideAccess: true,
    });
  }

  await payload.update({
    collection: "projects",
    id: projectId,
    data: { status: "held" },
    overrideAccess: true,
  });

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
  redirect(`/projects/${projectId}?debrief=saved`);
}
