// Без пометки server-only: модуль зовут маршруты, страницы и тесты.
import type { Payload } from "payload";

/**
 * Состояние фоновых генераций проекта (U3).
 *
 * Фоновая работа живёт в том же развёртывании, что и запрос. Если инстанс
 * умрёт посреди синтеза — выкатили новую версию, упал процесс, — запись
 * останется «выполняется» навсегда, и человек будет ждать файла, которого
 * никто не делает. Поэтому «выполняется» действует ограниченное время,
 * после чего считается оборванной.
 *
 * Порог с запасом: самый долгий замеренный синтез — сорок секунд на двадцать
 * минут звука, предел функции — пять минут. Десять минут не оборвут живую
 * работу, но и не заставят ждать зря.
 */
export const STALE_AFTER_MS = 10 * 60 * 1000;

export type GenerationKind = "script" | "audio";

export interface GenerationState {
  id: number;
  status: "queued" | "running" | "done" | "failed";
  /** работа висит в «выполняется» дольше разумного — считаем оборванной */
  stale: boolean;
  error: string | null;
  costUsd: number | null;
  createdAt: string;
}

const isActive = (status: string) => status === "queued" || status === "running";

const toState = (doc: {
  id: number;
  status: string;
  error?: string | null;
  costUsd?: number | null;
  createdAt: string;
  updatedAt?: string;
}, now: number): GenerationState => {
  // Время считаем от последнего изменения: у долгой работы оно обновляется,
  // и живая генерация не будет объявлена оборванной из-за старой даты создания.
  const touched = Date.parse(doc.updatedAt ?? doc.createdAt);
  return {
    id: doc.id,
    status: doc.status as GenerationState["status"],
    stale: isActive(doc.status) && Number.isFinite(touched) && now - touched > STALE_AFTER_MS,
    error: doc.error ?? null,
    costUsd: doc.costUsd ?? null,
    createdAt: doc.createdAt,
  };
};

/** Последняя генерация каждого вида: ровно то, что показывает страница. */
export async function latestGenerations(
  payload: Payload,
  projectId: number,
  now: number = Date.now(),
): Promise<Partial<Record<GenerationKind, GenerationState>>> {
  const found = await payload.find({
    collection: "generations",
    where: { project: { equals: projectId } },
    sort: "-createdAt",
    limit: 20,
    depth: 0,
    overrideAccess: true,
  });

  const result: Partial<Record<GenerationKind, GenerationState>> = {};
  for (const doc of found.docs) {
    const kind = doc.kind as GenerationKind;
    if (!result[kind]) result[kind] = toState(doc, now);
  }
  return result;
}

/**
 * Идёт ли прямо сейчас работа этого вида.
 *
 * Нужно до запуска новой: повторный запуск стоит ещё полдоллара и перезапишет
 * тот же файл. Оборванная работа при этом помехой не считается.
 */
export async function activeGeneration(
  payload: Payload,
  projectId: number,
  kind: GenerationKind,
  now: number = Date.now(),
): Promise<GenerationState | null> {
  const state = (await latestGenerations(payload, projectId, now))[kind];
  if (!state || !isActive(state.status) || state.stale) return null;
  return state;
}

/**
 * Помечает оборванные работы отказом.
 *
 * Вызывается перед запуском новой: без этого «выполняется» осталось бы в базе
 * навсегда, и в списке проектов вечно горел бы несуществующий синтез.
 */
export async function failStaleGenerations(
  payload: Payload,
  projectId: number,
  now: number = Date.now(),
): Promise<number> {
  const found = await payload.find({
    collection: "generations",
    where: {
      and: [{ project: { equals: projectId } }, { status: { in: ["queued", "running"] } }],
    },
    limit: 50,
    depth: 0,
    overrideAccess: true,
  });

  let failed = 0;
  for (const doc of found.docs) {
    if (!toState(doc, now).stale) continue;
    await payload.update({
      collection: "generations",
      id: doc.id,
      data: {
        status: "failed",
        error: "Работа прервана: развёртывание перезапустилось или процесс не дожил до конца.",
      },
      overrideAccess: true,
    });
    failed += 1;
  }
  return failed;
}
