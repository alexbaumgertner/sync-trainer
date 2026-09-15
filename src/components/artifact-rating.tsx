"use client";

import { useState } from "react";
import {
  SCORE_LABELS,
  SCORES,
  TARGET_ACCUSATIVE,
  TARGET_LABELS,
  type RatingTarget,
} from "@/lib/ratings";

/**
 * Оценка одного сгенерированного файла.
 *
 * Свёрнута по умолчанию и раскрывается нажатием. Причина не в экономии места:
 * форма, висящая рядом с каждым файлом, читается как требование ответить,
 * а мы спрашиваем мнение — его дают, когда есть что сказать. Уже
 * поставленная оценка видна и без раскрытия: она и есть ответ.
 */
export default function ArtifactRating({
  action,
  projectId,
  target,
  generationId,
  current,
}: {
  action: (formData: FormData) => Promise<void>;
  projectId: number;
  target: RatingTarget;
  generationId: number | null;
  current: { score: number; note: string | null } | null;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-neutral-500 underline-offset-2 hover:underline"
      >
        {current
          ? `${TARGET_LABELS[target]}: ${SCORE_LABELS[current.score]} — изменить`
          : `Оценить ${TARGET_ACCUSATIVE[target]}`}
      </button>
    );
  }

  return (
    <form
      action={action}
      className="grid gap-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
    >
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="target" value={target} />
      {generationId !== null && (
        <input type="hidden" name="generationId" value={generationId} />
      )}

      <fieldset className="grid gap-1.5">
        <legend className="mb-1 text-xs font-medium">
          {TARGET_LABELS[target]}: взяли бы это в работу?
        </legend>
        {SCORES.map((score) => (
          <label key={score} className="flex items-center gap-2 text-xs">
            <input
              type="radio"
              name="score"
              value={score}
              required
              defaultChecked={current?.score === score}
            />
            {SCORE_LABELS[score]}
          </label>
        ))}
      </fieldset>

      <label className="grid gap-1 text-xs">
        <span className="text-neutral-500">Чем именно — необязательно</span>
        <textarea
          name="note"
          rows={2}
          defaultValue={current?.note ?? ""}
          placeholder="Цифры читает слитно, на них и сбиваешься."
          className="w-full rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-xs dark:border-neutral-700"
        />
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          Сохранить оценку
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-neutral-500 underline-offset-2 hover:underline"
        >
          Отмена
        </button>
      </div>
    </form>
  );
}
