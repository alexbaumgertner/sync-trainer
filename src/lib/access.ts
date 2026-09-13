import type { Access, Where } from "payload";

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
