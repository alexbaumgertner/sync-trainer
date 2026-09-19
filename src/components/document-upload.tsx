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
const TRAPS = [
  { value: "enumeration", label: "Перечисление на компрессию" },
  { value: "self-correction", label: "Оговорка с самокоррекцией" },
  { value: "dense-numbers", label: "Плотная череда цифр" },
];

export default function DocumentUpload({ projectId, clientUpload }: {
  projectId: number;
  clientUpload: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [durationMin, setDurationMin] = useState(20);
  const [speakers, setSpeakers] = useState(5);
  const [termDensity, setTermDensity] = useState(40);
  const [rate, setRate] = useState("105%");
  const [traps, setTraps] = useState<string[]>(TRAPS.map((t) => t.value));

  /**
   * Отправка одной попытки. Вынесена отдельно, потому что попыток бывает
   * две: сервер отвечает 409 на уже загруженный файл (I4), и человек
   * решает, настаивать ли.
   */
  async function send(file: File, force: boolean): Promise<Response> {
    const params = { durationMin, speakers, termDensity, rate, traps };

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
        body: JSON.stringify({ pathname: blob.pathname, filename: file.name, params, force }),
      });
    }

    const form = new FormData();
    form.append("file", file);
    form.append("durationMin", String(durationMin));
    form.append("speakers", String(speakers));
    form.append("termDensity", String(termDensity));
    form.append("rate", rate);
    if (force) form.append("force", "1");
    for (const trap of traps) form.append("traps", trap);
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
    setWarnings([]);

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
        title: string;
        segments: number;
        glossary: number;
        costUsd: number;
        warnings?: string[];
      };

      setDone(
        `«${result.title}»: ${result.segments} реплик, ${result.glossary} терминов, ` +
          `$${result.costUsd.toFixed(3)}`,
      );
      setWarnings(result.warnings ?? []);
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
      <div className="grid gap-3 sm:grid-cols-4">
        <NumberField label="Минут" value={durationMin} min={5} max={30} onChange={setDurationMin} />
        <NumberField label="Спикеров" value={speakers} min={2} max={6} onChange={setSpeakers} />
        <NumberField label="Терминов" value={termDensity} min={20} max={60} onChange={setTermDensity} />
        <label className="block text-xs">
          <span className="mb-1 block text-neutral-500">Темп</span>
          <input
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </label>
      </div>

      <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
        <legend className="mb-1 text-xs text-neutral-500">Обязательные трудности</legend>
        {TRAPS.map((trap) => (
          <label key={trap.value} className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={traps.includes(trap.value)}
              onChange={(e) =>
                setTraps((prev) =>
                  e.target.checked ? [...prev, trap.value] : prev.filter((t) => t !== trap.value),
                )
              }
            />
            {trap.label}
          </label>
        ))}
      </fieldset>

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
          {busy ? "Генерирую…" : "Загрузить и сгенерировать"}
        </button>
      </div>

      <p className="text-xs text-neutral-500">
        PDF, DOCX или PPTX до 25 МБ. Файлов можно загрузить несколько.{" "}
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
        {busy && <p className="sr-only">Документ обрабатывается.</p>}
        {done && (
          <p className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs dark:border-neutral-800 dark:bg-neutral-900">
            Готово. {done}
          </p>
        )}
        {warnings.length > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
            <p className="mb-1 font-medium">Скрипт готов, но не всё вышло как просили:</p>
            <ul className="list-disc pl-4">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
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

/**
 * Числовое поле, которое можно стереть досуха.
 *
 * Состояние здесь строковое, а не числовое, и это единственное, что
 * отличает его от обычного управляемого поля. Пока значение хранилось
 * числом, пустая строка превращалась в ноль (`Number("") === 0`), ноль
 * возвращался в поле — и набранная следом пятёрка читалась как «05».
 * Стереть значение по умолчанию было нельзя в принципе.
 *
 * Родителю число уходит только когда строка в число превращается.
 * Пустое поле — это «ещё не ввели», а не «ввели ноль», и родителю
 * в этот момент остаётся прежнее значение.
 */
function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  function handleChange(next: string) {
    setDraft(next);
    if (next === "") return;
    const parsed = Number(next);
    if (Number.isFinite(parsed)) onChange(parsed);
  }

  /** Приведение к диапазону — на уходе из поля, а не на каждом нажатии:
   *  иначе набор «12» на пути к дюжине спотыкается о верхнюю границу. */
  function handleBlur() {
    const parsed = Number(draft);
    const next =
      draft === "" || !Number.isFinite(parsed)
        ? value
        : Math.min(max, Math.max(min, parsed));
    setDraft(String(next));
    onChange(next);
  }

  return (
    <label className="block text-xs">
      <span className="mb-1 block text-neutral-500">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={draft}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
        className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
      />
    </label>
  );
}
