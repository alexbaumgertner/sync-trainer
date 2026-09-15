import type { Access, CollectionBeforeChangeHook, Where } from "payload";
import { APIError } from "payload";
import { insideProject } from "./artifact-path";

/**
 * Требование D1: проверка владения проектом выполняется здесь, в слое доступа,
 * а не в каждом обработчике. Обработчиков будет много, и однажды проверку забудут.
 *
 * Payload применяет эти функции ко всем путям сразу — Local API, REST, GraphQL
 * и админке, — поэтому обойти их случайно нельзя.
 */

type User = { id: string | number; role?: string | null } | null | undefined;

export const isAdmin = (user: User): boolean => user?.role === "admin";

/** Только для вошедших. */
export const authenticated: Access = ({ req: { user } }) => Boolean(user);

/** Свои записи и всё для администратора. Для коллекций с полем-владельцем. */
export const ownedBy =
  (field = "owner"): Access =>
  ({ req: { user } }) => {
    if (!user) return false;
    if (isAdmin(user as User)) return true;
    return { [field]: { equals: user.id } } as Where;
  };

/**
 * Записи, принадлежащие проекту текущего пользователя.
 * Payload умеет фильтровать по связи через точку, поэтому одного условия хватает.
 */
export const ownedByProject: Access = ({ req: { user } }) => {
  if (!user) return false;
  if (isAdmin(user as User)) return true;
  return { "project.owner": { equals: user.id } } as Where;
};

/** Только администратор. Для служебных коллекций. */
export const adminOnly: Access = ({ req: { user } }) => isAdmin(user as User);

/**
 * Расходы пользователь видит свои, но менять не может: их пишет только сервер
 * после успешной генерации.
 */
export const ownUsage: Access = ({ req: { user } }) => {
  if (!user) return false;
  if (isAdmin(user as User)) return true;
  return { user: { equals: user.id } } as Where;
};

/**
 * Проект в данных обязан принадлежать обратившемуся (Б1 аудита).
 *
 * Зачем отдельный хук, когда есть `ownedByProject`. У Payload функция доступа
 * на создание отвечает только «да/нет» и фильтровать по владельцу не умеет:
 * `Where` она вернуть может, но применяется он к чтению существующих строк,
 * а не к содержимому новой. Поэтому `create` у дочерних коллекций стоял
 * `authenticated` — и любой вошедший клал строку в чужой проект, указав его
 * идентификатор. Они последовательные, перебирать было нечего.
 *
 * На правке проверка нужна не меньше: `ownedByProject` отбирает, КАКУЮ строку
 * можно менять, но не запрещает переставить её в чужой проект новым значением.
 *
 * Серверный код проходит насквозь: маршруты приложения зовут Local API с
 * `overrideAccess: true` и без пользователя, владение они проверяют сами
 * до вызова. Пользователь в `req` появляется только на путях, где за запросом
 * стоит человек, — REST, GraphQL, админка, — и именно там проверка нужна.
 */
export const withinOwnProject: CollectionBeforeChangeHook = async ({
  data,
  req,
  originalDoc,
}) => {
  const user = req.user as User;
  if (!user || isAdmin(user)) return data;

  const idOf = (value: unknown): number | null => {
    if (typeof value === "number") return value;
    if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
    if (value && typeof value === "object" && "id" in value) {
      return idOf((value as { id: unknown }).id);
    }
    return null;
  };

  // На частичной правке проекта в данных нет — строку уже отобрал доступ.
  const target = idOf(data?.project) ?? idOf(originalDoc?.project);
  if (target === null) return data;

  const project = await req.payload
    .findByID({ collection: "projects", id: target, depth: 0, overrideAccess: true })
    .catch(() => null);

  if (!project || idOf(project.owner) !== idOf(user.id)) {
    // Тот же текст, что у несуществующего проекта: подтверждать существование
    // чужого проекта незачем — это перебором превратилось бы в список чужих.
    throw new APIError("Проект не найден.", 404);
  }

  return data;
};

/**
 * Путь файла обязан лежать в каталоге своего проекта (Б2 аудита).
 *
 * Маршрут выдачи файла проверял, что артефакт лежит в проекте обратившегося,
 * и после этого отдавал `blobPath` из базы не глядя — а путь задаёт тот, кто
 * артефакт создал. Пути предсказуемы (`projects/<id>/script.md`, случайного
 * суффикса нет), поэтому артефакт в СВОЁМ проекте с чужим путём отдавал чужой
 * скрипт, озвучку или глоссарий.
 *
 * Проверка стоит здесь, а не только в маршруте, потому что читает файлы не
 * один маршрут: каскад удаления проекта сносит файлы по тем же путям из базы,
 * и подменённый путь удалил бы чужой файл, ничего не прочитав.
 */
export const artifactStaysInProject: CollectionBeforeChangeHook = ({ data, originalDoc }) => {
  const blobPath = typeof data?.blobPath === "string" ? data.blobPath : null;
  if (blobPath === null) return data;

  const project = data?.project ?? originalDoc?.project;
  const projectId =
    typeof project === "object" && project !== null && "id" in project
      ? (project as { id: number | string }).id
      : (project as number | string | undefined);

  if (projectId === undefined || !insideProject(blobPath, projectId)) {
    throw new APIError("Путь файла не относится к проекту.", 400);
  }

  return data;
};
