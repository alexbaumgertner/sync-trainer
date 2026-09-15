import "server-only";
import type { Payload } from "payload";
import type { Step } from "./activity-steps";

/**
 * Запись шага воронки.
 *
 * Чем это не `usage-events`: там деньги и символы, по одной записи на
 * обращение к Google. Здесь — продуктовая воронка, и записи появляются
 * там, где денег нет вовсе (разбор заполнен, приглашение принято).
 */

/**
 * Никогда не бросает наружу.
 *
 * Метрика не стоит того, чтобы из-за неё падала работа человека: упасть
 * здесь значит не сохранить проект ради строчки в отчёте. Поэтому ошибка
 * уходит в лог, и на этом всё.
 */
export async function recordStep(
  payload: Payload,
  step: Step,
  args: { user: string | number; project?: string | number | null },
): Promise<void> {
  try {
    await payload.create({
      collection: "activity",
      data: {
        step,
        user: Number(args.user),
        project: args.project ? Number(args.project) : null,
      },
      overrideAccess: true,
    });
  } catch (error) {
    console.error("[activity] шаг не записан", step, error);
  }
}
