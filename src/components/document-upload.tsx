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

  /**
   * Отправка одной попытки. Вынесена отдельно, потому что попыток бывает
   * две: сервер отвечает 409 на уже загруженный файл (I4), и человек
   * решает, настаивать ли.
   */
  async function send(file: File, force: boolean): Promise<Response> {
    if (clientUpload) {
      const { upload } = await import("@vercel/blob/client");
      // Хранилище приватное — публичная запись в него даёт 400 без
      // CORS-заголовков, браузер показывает только «CORS», а SDK молча
      // повторяет попытку семь раз. Отсюда и берётся вечное «Генерирую…».
      const blob = await upload(`uploads/${projectId}/${file.name}`, file, {
        access: "private",
        handleUploadUrl: `/api/projects/${projectId}/documents/upload-token`,
        contentType: file.type || undefined,
      });
      return fetch(`/api/projects/${projectId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Путь, а не ссылка: приватный файл по ссылке не скачать, сервер
        // читает его через SDK. Путь приходит от хранилища — из-за
        // addRandomSuffix он не равен тому, что просил браузер.
        // Имя отдаём своё: в пути хранилища к нему приклеен случайный суффикс.
        body: JSON.stringify({ pathname: blob.pathname, filename: file.name, force }),
      });
    }

    const form = new FormData();
    form.append("file", file);
    if (force) form.append("force", "1");
    return fetch(`/api/projects/${projectId}/documents`, { method: "POST", body: form });
  }

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
      let response = await send(file, false);

      /**
       * I4: тот же файл уже загружен.
       *
       * Повторяют загрузку обычно не со зла, а решив, что первая пропала.
       * Поэтому не молча запускаем вторую генерацию за те же деньги, а
       * спрашиваем — и настаиваем, только если человек подтвердил.
       */
      if (response.status === 409) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
          duplicate?: boolean;
        };
        if (!data.duplicate) throw new Error(data.error ?? "HTTP 409");
        if (!window.confirm(`${data.error} Сгенерировать по нему ещё раз?`)) {
          setBusy(false);
          return;
        }
        response = await send(file, true);
      }

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }

      const result = (await response.json()) as {
        filename: string;
        pages: number | null;
      };

      setDone(
        `«${result.filename}» загружен${result.pages ? `, ${result.pages} с.` : ""}. ` +
          "Теперь соберите по нему глоссарий.",
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
          {busy ? "Загружаю…" : "Загрузить"}
        </button>
      </div>

      <p className="text-xs text-neutral-500">
        PDF, DOCX или PPTX до 25 МБ. Файлов можно загрузить несколько — глоссарий
        соберётся по всем сразу.{" "}
        <strong className="font-medium text-neutral-700 dark:text-neutral-300">
          Оригинал хранится, пока вы его не удалите
        </strong>{" "}
        — кнопка удаления стоит рядом с каждым документом выше. Текст документа
        мы не сохраняем ни при каких условиях.
      </p>

      {/*
        Живая область — ОБЁРТКА над видимыми блоками, а не вторая копия
        текста рядом. Копия читалась бы дважды и, как выяснилось, ломает
        поиск по тексту: на странице оказывалось два «Готово».
        Обёртка при этом всегда в разметке — область, добавленную вместе
        с содержимым, скринридеры объявляют ненадёжно.

        Разбор документа идёт минуту с лишним, и всё это время меняется
        только надпись на отключённой кнопке, а её смену не объявляют.
      */}
      <div aria-live="polite" className="flex flex-col gap-3 empty:hidden">
        {busy && <p className="sr-only">Документ загружается.</p>}
        {done && (
          <p className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs dark:border-neutral-800 dark:bg-neutral-900">
            Готово. {done}
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
