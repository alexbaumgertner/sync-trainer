"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Генерация тренировочного скрипта по выверенному глоссарию (N3).
 *
 * Параметры речи живут здесь, а не в форме загрузки, и это переезд по
 * смыслу: длительность, число спикеров и плотность терминов описывают
 * скрипт, а не документ. Пока они стояли у загрузки, их приходилось
 * задавать до того, как человек вообще увидел свои термины.
 */

const TRAPS = [
  { value: "enumeration", label: "Перечисление на компрессию" },
  { value: "self-correction", label: "Оговорка с самокоррекцией" },
  { value: "dense-numbers", label: "Плотная череда цифр" },
];

type Status = "queued" | "running" | "done" | "failed";

interface GenerationState {
  id: number;
  status: Status;
  stale: boolean;
  error: string | null;
}

const POLL_MS = 3000;

export default function ScriptBuild({
  projectId,
  hasDocuments,
  termCount,
  hasScript,
}: {
  projectId: number;
  hasDocuments: boolean;
  termCount: number;
  hasScript: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<GenerationState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [durationMin, setDurationMin] = useState(20);
  const [speakers, setSpeakers] = useState(5);
  const [termDensity, setTermDensity] = useState(40);
  // 100% — темп голоса как есть. Прежние 105% были ускорением по
  // умолчанию, и человек, не трогавший поле, получал его молча.
  const [rate, setRate] = useState("100%");
  const [traps, setTraps] = useState<string[]>(TRAPS.map((t) => t.value));
  const wasRunning = useRef(false);

  const running = Boolean(
    state && (state.status === "queued" || state.status === "running") && !state.stale,
  );
  const ready = hasDocuments && termCount > 0;

  useEffect(() => {
    let alive = true;

    async function poll() {
      try {
        const response = await fetch(`/api/projects/${projectId}/generations`, {
          cache: "no-store",
        });
        if (!response.ok || !alive) return;
        const data = (await response.json()) as { generations: { script?: GenerationState } };
        const next = data.generations.script ?? null;
        setState(next);

        const active = Boolean(
          next && (next.status === "queued" || next.status === "running") && !next.stale,
        );
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
      const response = await fetch(`/api/projects/${projectId}/script`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ durationMin, speakers, termDensity, rate, traps }),
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
        <button
          type="button"
          onClick={start}
          disabled={!ready || running || starting}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-40 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {running ? "Генерирую…" : hasScript ? "Сгенерировать заново" : "Сгенерировать скрипт"}
        </button>
        {!hasDocuments && (
          <span className="text-xs text-neutral-500">Сначала загрузите материалы события.</span>
        )}
        {hasDocuments && termCount === 0 && (
          <span className="text-xs text-neutral-500">
            Сначала соберите глоссарий: скрипт строится вокруг его терминов.
          </span>
        )}
      </div>

      <div aria-live="polite" className="flex flex-col gap-2 empty:hidden">
        {running && (
          <p className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs dark:border-neutral-800 dark:bg-neutral-900">
            Пишу речь вокруг ваших терминов. Это минута-полторы. Можно закрыть
            вкладку — генерация идёт на сервере.
          </p>
        )}
        {state?.stale && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
            Прошлая генерация прервалась на полпути. Запустите ещё раз.
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
