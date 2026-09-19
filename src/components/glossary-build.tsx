"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Сборка глоссария по материалам события (N1–N2, I3).
 *
 * Работа идёт на сервере и переживает закрытие вкладки — состояние лежит
 * в `generations`, а не в памяти страницы. Отсюда две обязанности этой
 * кнопки, помимо самого запуска:
 *
 *  - спросить перед уходом, пока сборка идёт. Не потому, что уход её
 *    прервёт, а потому, что человек об этом не знает и решит, что всё
 *    пропало;
 *  - при открытии страницы показать уже идущую сборку. Ровно из-за её
 *    отсутствия человек, вернувшийся на пустую страницу, загружал файл
 *    второй раз.
 */

type Status = "queued" | "running" | "done" | "failed";

interface GenerationState {
  id: number;
  status: Status;
  stale: boolean;
  error: string | null;
}

const POLL_MS = 3000;

export default function GlossaryBuild({
  projectId,
  hasDocuments,
  termCount,
}: {
  projectId: number;
  hasDocuments: boolean;
  termCount: number;
}) {
  const router = useRouter();
  const [state, setState] = useState<GenerationState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const wasRunning = useRef(false);

  const running = Boolean(state && (state.status === "queued" || state.status === "running") && !state.stale);

  /** Состояние сборки из базы: его же видит вернувшийся на страницу. */
  useEffect(() => {
    let alive = true;

    async function poll() {
      try {
        const response = await fetch(`/api/projects/${projectId}/generations`, {
          cache: "no-store",
        });
        if (!response.ok || !alive) return;
        const data = (await response.json()) as {
          generations: { glossary?: GenerationState };
        };
        const next = data.generations.glossary ?? null;
        setState(next);

        // Сборка закончилась, пока мы смотрели — забираем termы с сервера.
        const active = Boolean(next && (next.status === "queued" || next.status === "running") && !next.stale);
        if (wasRunning.current && !active) router.refresh();
        wasRunning.current = active;
      } catch {
        // Опрос — не главное действие страницы: молча пробуем снова.
      }
    }

    void poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [projectId, router]);

  /** I3: предупреждение об уходе, пока сборка идёт. */
  useEffect(() => {
    if (!running) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/glossary/build`, {
        method: "POST",
      });
      if (!response.ok && response.status !== 202) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }
      const data = (await response.json()) as { generationId: number };
      setState({ id: data.generationId, status: "running", stale: false, error: null });
      wasRunning.current = true;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={start}
          disabled={!hasDocuments || running || starting}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-40 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {running ? "Собираю…" : termCount > 0 ? "Дособрать по материалам" : "Собрать глоссарий"}
        </button>
        {!hasDocuments && (
          <span className="text-xs text-neutral-500">
            Сначала загрузите материалы события — собирать не из чего.
          </span>
        )}
        {termCount > 0 && !running && (
          <span className="text-xs text-neutral-500">
            Уже выверенное не переписывается: добавятся только новые термины.
          </span>
        )}
      </div>

      {/* Живая область: смену надписи на отключённой кнопке не объявляют. */}
      <div aria-live="polite" className="flex flex-col gap-2 empty:hidden">
        {running && (
          <p className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs dark:border-neutral-800 dark:bg-neutral-900">
            Читаю материалы и подбираю эквиваленты. Это минута-полторы. Можно
            закрыть вкладку — сборка идёт на сервере, а результат будет здесь.
          </p>
        )}
        {state?.stale && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
            Прошлая сборка прервалась на полпути. Запустите ещё раз.
          </p>
        )}
        {state?.status === "failed" && state.error && (
          <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
            {state.error}
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
    </div>
  );
}
