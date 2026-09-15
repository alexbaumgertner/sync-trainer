/**
 * Путь артефакта в хранилище. Вынесено в отдельный модуль без зависимостей
 * намеренно: форму пути должны знать и `src/lib/artifacts.ts` (он пишет),
 * и слой доступа (он проверяет). Продублируй строку в двух местах — и они
 * разойдутся ровно тогда, когда проверка перестанет ловить подмену.
 */

export const artifactPrefix = (projectId: number | string): string =>
  `projects/${projectId}/`;

export const artifactPath = (projectId: number, name: string): string =>
  `${artifactPrefix(projectId)}${name}`;

/**
 * Лежит ли путь внутри каталога проекта.
 *
 * Имя проверяется целиком: `..` в пути и вложенные каталоги отвергаются.
 * Одного `startsWith` мало — `projects/1/../2/script.md` начинается правильно,
 * а указывает в чужой проект.
 */
export function insideProject(blobPath: string, projectId: number | string): boolean {
  const prefix = artifactPrefix(projectId);
  if (!blobPath.startsWith(prefix)) return false;

  const name = blobPath.slice(prefix.length);
  return name.length > 0 && !name.includes("/");
}
