"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Загрузка исходного документа.
 *
 * На Vercel файл уходит в хранилище прямо из браузера: тело запроса к функции
 * ограничено 4.5 МБ, а конференционный PDF бывает втрое больше. Локально
 * такого предела нет, и файл идёт через сервер, не попадая в хранилище вовсе.
 */
export default function DocumentUpload({ projectId, clientUpload }: {
  projectId: number;
  clientUpload: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) return;

    if (file.size > MAX_BYTES) {
      setError("Файл больше 25 МБ.");
      return;
    }

    setBusy(true);
    setError(null);
    setDone(null);

    try {
      let response: Response;

      if (clientUpload) {
        const { upload } = await import("@vercel/blob/client");
        const blob = await upload(`uploads/${projectId}/${file.name}`, file, {
          access: "public",
          handleUploadUrl: `/api/projects/${projectId}/documents/upload-token`,
          contentType: file.type || undefined,
        });
        response = await fetch(`/api/projects/${projectId}/documents`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: blob.url, pathname: blob.pathname }),
        });
      } else {
        const form = new FormData();
        form.append("file", file);
        response = await fetch(`/api/projects/${projectId}/documents`, {
          method: "POST",
          body: form,
        });
      }

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }

      const result = (await response.json()) as {
        filename: string;
        pages: number | null;
        extractedChars: number | null;
      };

      setDone(
        result.extractedChars === null
          ? `${result.filename}: ${result.pages ?? "?"} с., разбор текста сделает модель`
          : `${result.filename}: ${result.extractedChars.toLocaleString("ru-RU")} знаков текста`,
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
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx,.pptx,application/pdf"
          required
          aria-label="Файл документа"
          className="text-xs file:mr-3 file:rounded-md file:border file:border-neutral-300 file:bg-transparent file:px-3 file:py-1.5 file:text-xs dark:file:border-neutral-700 dark:file:text-neutral-200"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-40 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {busy ? "Обрабатываю…" : "Загрузить"}
        </button>
      </div>

      <p className="text-xs text-neutral-500">
        PDF, DOCX или PPTX до 25 МБ.{" "}
        <strong className="font-medium text-neutral-700 dark:text-neutral-300">
          Оригинал удаляется сразу после разбора
        </strong>{" "}
        — перегенерировать скрипт из того же файла потом не получится, документ
        придётся загрузить снова.
      </p>

      {done && (
        <p className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs dark:border-neutral-800 dark:bg-neutral-900">
          Готово. {done}
        </p>
      )}
      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </p>
      )}
    </form>
  );
}
