import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Полнота каскада удаления проекта.
 *
 * У связей на проект стоит `ON DELETE SET NULL`, а обязательные колонки
 * объявлены `NOT NULL` — сочетание, при котором база просто отказывается
 * удалять проект, на который кто-то ссылается. Спасает каскад в хуке
 * `beforeDelete`, но список коллекций в нём написан руками.
 *
 * Добавив `ratings`, я едва не оставил список прежним. Точно так же
 * в прошлый раз забылась колонка в служебной таблице блокировок и лёг прод,
 * и точно так же вчера — `NOT NULL` на `user_id` в метриках. Проверка
 * статическая, по тексту: она не зависит от того, что окажется в базе.
 */

const SOURCE = path.join(process.cwd(), "src", "collections", "index.ts");

describe("каскад удаления проекта", () => {
  it("покрывает каждую коллекцию с обязательной связью на проект", async () => {
    const { collections } = await import("@/collections");
    const source = readFileSync(SOURCE, "utf8");

    // Список из хука: строки между `for (const collection of [` и `] as const)`.
    const block = source.match(/for \(const collection of \[([\s\S]*?)\] as const\)/);
    expect(block, "цикл каскадного удаления не найден — его переписали?").toBeTruthy();
    const cascaded = [...block![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);

    for (const collection of collections) {
      const projectField = collection.fields.find(
        (field) => "name" in field && field.name === "project",
      );
      if (!projectField || !("required" in projectField) || !projectField.required) continue;

      expect(
        cascaded,
        `коллекция "${collection.slug}" обязательно ссылается на проект, но её нет ` +
          "в каскаде: проект с такой записью не удалится вовсе",
      ).toContain(collection.slug);
    }
  });

  it("не тащит в каскад то, что должно пережить удаление проекта", async () => {
    const source = readFileSync(SOURCE, "utf8");
    const block = source.match(/for \(const collection of \[([\s\S]*?)\] as const\)/);
    const cascaded = [...block![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);

    // Шаги воронки переживают удаление проекта: «сколько проектов дошло
    // до озвучки» не должно меняться задним числом.
    expect(cascaded).not.toContain("activity");
  });
});
