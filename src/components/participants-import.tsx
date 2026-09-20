"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

/**
 * Загрузка списка участников (L4).
 *
 * Принимаем файл в любом виде: программу в PDF, письмо организатора,
 * выгрузку из регистрации. Аккуратных таблиц не бывает, и требовать их —
 * значит переложить разбор на человека, у которого и так событие завтра.
 *
 * Файл не сохраняется: он нужен ровно на время разбора.
 */
export default function ParticipantsImport({ projectId }: { projectId: number }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) return;

    setBusy(true);
    setError(null);
    setDone(null);

    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`/api/projects/${projectId}/participants`, {
        method: "POST",
        body: form,
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }

      const result = (await response.json()) as {
        added: number;
        skipped: number;
        unknown: number;
      };

      setDone(
        `Добавлено: ${result.added}` +
          (result.skipped ? `, уже были: ${result.skipped}` : "") +
          (result.unknown
            ? `. По ${result.unknown} произношение под вопросом — спросите у организатора.`
            : "."),
      );
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx,.pptx,application/pdf"
          required
          aria-label="Файл со списком участников"
          className="text-xs file:mr-3 file:rounded-md file:border file:border-neutral-300 file:bg-transparent file:px-3 file:py-1.5 file:text-xs dark:file:border-neutral-700 dark:file:text-neutral-200"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          {busy ? "Разбираю…" : "Разобрать список"}
        </button>
      </div>

      <div aria-live="polite" className="empty:hidden">
        {busy && <p className="sr-only">Список разбирается.</p>}
        {done && (
          <p className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs dark:border-neutral-800 dark:bg-neutral-900">
            {done}
          </p>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200"
        >
          {error}
        </p>
      )}
    </form>
  );
}
