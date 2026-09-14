// Без пометки server-only намеренно: модуль зовут и серверные компоненты,
// и серверные действия, и скрипты обслуживания.
import { payloadClient } from "./payload";
import type { Project } from "@/payload-types";
import { PRESETS } from "@/presets";
import { STALE_AFTER_MS } from "./generations";

/**
 * Работа с проектами. Права проверяет Payload по описанию коллекции (D1),
 * поэтому здесь нет ни одной ручной проверки владения — её невозможно забыть,
 * потому что её тут нет.
 */

export const SOURCE_LANG_LABELS: Record<string, string> = {
  en: "English",
  de: "Deutsch",
  fr: "Français",
  tr: "Türkçe",
};

/** Подписи берутся из реестра пресетов, чтобы не расходиться с ним. */
export const STYLE_PRESET_LABELS: Record<string, string> = Object.fromEntries(
  PRESETS.map((preset) => [preset.id, preset.label]),
);

export const STATUS_LABELS: Record<string, string> = {
  draft: "Черновик",
  scripted: "Скрипт готов",
  ready: "Аудио готово",
  held: "Событие прошло",
};

export interface ProjectRow {
  id: number;
  title: string;
  eventName: string | null;
  eventStartsOn: string | null;
  sourceLang: string;
  stylePreset: string;
  status: string;
  costUsd: number;
  createdAt: string;
  /** U3: идёт ли прямо сейчас фоновая работа — видно не заходя в проект */
  busyWith: "script" | "audio" | null;
}

/** Список проектов пользователя со стоимостью каждого. */
export async function listProjects(userId: number): Promise<ProjectRow[]> {
  const payload = await payloadClient();

  const projects = await payload.find({
    collection: "projects",
    where: { owner: { equals: userId } },
    sort: "-createdAt",
    limit: 200,
    depth: 0,
    overrideAccess: true,
  });

  if (!projects.docs.length) return [];

  // Расходы одним запросом на все проекты, а не по одному на карточку.
  const usage = await payload.find({
    collection: "usage-events",
    where: { project: { in: projects.docs.map((p) => p.id) } },
    limit: 2000,
    depth: 0,
    overrideAccess: true,
  });

  // U3: статус фоновой работы виден в списке. Одним запросом на все проекты:
  // по запросу на карточку — это двадцать обращений к базе на одну страницу.
  const active = await payload.find({
    collection: "generations",
    where: {
      and: [
        { project: { in: projects.docs.map((p) => p.id) } },
        { status: { in: ["queued", "running"] } },
      ],
    },
    sort: "-createdAt",
    limit: 200,
    depth: 0,
    overrideAccess: true,
  });

  const now = Date.now();
  const busyByProject = new Map<number, "script" | "audio">();
  for (const row of active.docs) {
    const projectId = typeof row.project === "object" ? row.project?.id : row.project;
    if (typeof projectId !== "number" || busyByProject.has(projectId)) continue;
    // Оборванная работа в списке не горит: иначе «идёт синтез» останется
    // навсегда после перезапуска развёртывания.
    const touched = Date.parse(row.updatedAt ?? row.createdAt);
    if (Number.isFinite(touched) && now - touched > STALE_AFTER_MS) continue;
    busyByProject.set(projectId, row.kind as "script" | "audio");
  }

  const costByProject = new Map<number, number>();
  for (const row of usage.docs) {
    const projectId = typeof row.project === "object" ? row.project?.id : row.project;
    if (typeof projectId !== "number") continue;
    costByProject.set(projectId, (costByProject.get(projectId) ?? 0) + (row.costUsd ?? 0));
  }

  return projects.docs.map((project) => ({
    id: project.id,
    title: project.title,
    eventName: project.eventName ?? null,
    eventStartsOn: project.eventStartsOn ?? null,
    sourceLang: project.sourceLang,
    stylePreset: project.stylePreset,
    status: project.status,
    costUsd: costByProject.get(project.id) ?? 0,
    createdAt: project.createdAt,
    busyWith: busyByProject.get(project.id) ?? null,
  }));
}

export interface ProjectFile {
  id: number;
  kind: string;
  label: string;
  bytes: number | null;
  createdAt: string;
  blobPath: string;
}

const ARTIFACT_LABELS: Record<string, string> = {
  script: "Скрипт",
  ssml: "SSML",
  audio: "Аудио MP3",
  glossary: "Глоссарий CSV",
};

export interface ProjectDetail {
  project: Project;
  files: ProjectFile[];
  documents: {
    id: number;
    filename: string;
    bytes: number | null;
    pages: number | null;
    purgedAt: string | null;
  }[];
  costUsd: number;
  glossaryCount: number;
}

/** Карточка проекта. Возвращает null, если проект чужой или не существует. */
export async function getProject(id: number, userId: number): Promise<ProjectDetail | null> {
  const payload = await payloadClient();

  const project = await payload
    .findByID({ collection: "projects", id, depth: 0, overrideAccess: true })
    .catch(() => null);

  // Владение проверяем здесь, потому что читаем с overrideAccess ради
  // связанных коллекций; сравнение явное и в одном месте.
  const ownerId = typeof project?.owner === "object" ? project.owner?.id : project?.owner;
  if (!project || ownerId !== userId) return null;

  const [artifacts, documents, usage, glossary] = await Promise.all([
    payload.find({
      collection: "artifacts",
      where: { project: { equals: id } },
      sort: "-createdAt",
      limit: 200,
      depth: 0,
      overrideAccess: true,
    }),
    payload.find({
      collection: "documents",
      where: { project: { equals: id } },
      sort: "-createdAt",
      limit: 50,
      depth: 0,
      overrideAccess: true,
    }),
    payload.find({
      collection: "usage-events",
      where: { project: { equals: id } },
      limit: 500,
      depth: 0,
      overrideAccess: true,
    }),
    payload.count({
      collection: "glossary-terms",
      where: { project: { equals: id } },
      overrideAccess: true,
    }),
  ]);

  return {
    project,
    files: artifacts.docs.map((doc) => ({
      id: doc.id,
      kind: doc.kind,
      label: ARTIFACT_LABELS[doc.kind] ?? doc.kind,
      bytes: doc.bytes ?? null,
      createdAt: doc.createdAt,
      blobPath: doc.blobPath,
    })),
    documents: documents.docs.map((doc) => ({
      id: doc.id,
      filename: doc.filename,
      bytes: doc.bytes ?? null,
      pages: doc.pages ?? null,
      purgedAt: doc.purgedAt ?? null,
    })),
    costUsd: usage.docs.reduce((sum, row) => sum + (row.costUsd ?? 0), 0),
    glossaryCount: glossary.totalDocs,
  };
}
