import type { Payload } from "payload";
import { presetById } from "./index";
import { toStylePreset, type CustomStyleDoc } from "./custom";
import type { StylePreset } from "./types";

interface ProjectStyleRef {
  stylePreset: string;
  sourceLang: string;
  customStyle?: number | { id: number } | null;
}

/**
 * Пресет проекта: стилистика из админки, если выбрана, иначе встроенная.
 * Единственное место, где это решается — маршруты и страницы не должны
 * расходиться в том, что считать стилистикой проекта.
 */
export async function resolveProjectPreset(
  payload: Payload,
  project: ProjectStyleRef,
): Promise<StylePreset | undefined> {
  const ref = project.customStyle;
  const customId = typeof ref === "object" && ref ? ref.id : ref;
  if (typeof customId === "number") {
    const doc = await payload
      .findByID({ collection: "style-presets", id: customId, depth: 0, overrideAccess: true })
      .catch(() => null);
    if (doc) return toStylePreset(doc as unknown as CustomStyleDoc, project.sourceLang);
    // Стилистику удалили: молча подставлять встроенную нельзя — материал
    // выйдет в другом регистре, чем ждёт человек.
    return undefined;
  }
  return presetById(project.stylePreset);
}
