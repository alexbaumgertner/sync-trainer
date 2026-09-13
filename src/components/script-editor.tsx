"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { validateForSynthesis } from "@/lib/ssml";
import { analyzeScript, parseScript, formatDuration } from "@/lib/ssml";
import { assignVoices, estimateCostUsd, formatForVoices, tierOf, TIER_LABEL, type VoiceOption } from "@/lib/voices";

/**
 * Правка разметки перед синтезом (G4) и назначение голосов (G6).
 *
 * Проверка разметки идёт тем же кодом, что и на сервере, поэтому кнопка
 * гаснет ровно тогда, когда синтез всё равно откажет. Но решение за сервером:
 * здесь это подсказка, а не запрет.
 */
export default function ScriptEditor({
  projectId,
  sourceLang,
  initialSsml,
  markdown,
  audioFileId,
}: {
  projectId: number;
  sourceLang: string;
  initialSsml: string;
  markdown: string;
  audioFileId: number | null;
}) {
  const router = useRouter();
  const [ssml, setSsml] = useState(initialSsml);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [result, setResult] = useState<{ seconds: number; costUsd: number; chunks: number } | null>(null);
  const [showSource, setShowSource] = useState(false);

  useEffect(() => {
    fetch(`/api/voices?lang=${sourceLang}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { voices?: VoiceOption[] } | null) => setVoices(data?.voices ?? []))
      .catch(() => setVoices([]));
  }, [sourceLang]);

  const stats = useMemo(() => {
    const parsed = parseScript(ssml);
    return { ...analyzeScript(parsed.blocks, parsed.rate), rate: parsed.rate };
  }, [ssml]);

  const speakerVoices = useMemo(() => {
    const pool = voices.filter((v) => v.tier === "Chirp3HD");
    const auto = assignVoices(stats.speakers, pool.length ? pool : voices);
    return { ...auto, ...overrides };
  }, [stats.speakers, voices, overrides]);

  const defaultVoice = voices[0]?.name ?? "";
  const usedVoices = useMemo(
    () => [...new Set([defaultVoice, ...Object.values(speakerVoices)])].filter(Boolean),
    [defaultVoice, speakerVoices],
  );

  const check = useMemo(() => {
    if (!usedVoices.length) return null;
    return validateForSynthesis(ssml, {
      format: formatForVoices(usedVoices),
      perSpeaker: stats.speakers.length > 0,
      stripLabels: stats.speakers.length > 0,
    });
  }, [ssml, usedVoices, stats.speakers.length]);

  const cost = check ? estimateCostUsd(check.billableChars, usedVoices) : 0;

  const synthesize = useCallback(async () => {
    setBusy(true);
    setError(null);
    setIssues([]);
    try {
      const response = await fetch(`/api/projects/${projectId}/audio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ssml, voice: defaultVoice, speakerVoices }),
      });
      const data = await response.json();
      if (!response.ok) {
        setIssues(data.issues ?? []);
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }
      setResult(data);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [projectId, ssml, defaultVoice, speakerVoices, router]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium">{showSource ? "Разметка SSML" : "Скрипт"}</h2>
          <button
            type="button"
            onClick={() => setShowSource((v) => !v)}
            className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs hover:border-neutral-500 dark:border-neutral-700"
          >
            {showSource ? "Показать скрипт" : "Править разметку"}
          </button>
        </div>

        {showSource ? (
          <textarea
            value={ssml}
            onChange={(e) => setSsml(e.target.value)}
            spellCheck={false}
            aria-label="Разметка SSML"
            className="h-[30rem] w-full resize-y rounded-lg border border-neutral-300 bg-white p-3 font-mono text-xs leading-relaxed outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
          />
        ) : (
          <pre className="h-[30rem] overflow-auto whitespace-pre-wrap rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm leading-relaxed dark:border-neutral-800 dark:bg-neutral-900">
            {markdown || "Скрипт не сохранился, но разметка есть — правьте её."}
          </pre>
        )}

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Спикеров" value={String(stats.speakers.length)} />
          <Stat label="Абзацев" value={String(stats.paragraphs)} />
          <Stat label="Длительность ≈" value={formatDuration(stats.estimatedSeconds)} />
          <Stat
            label="Стоимость ≈"
            value={`$${cost.toFixed(3)}`}
            hint={usedVoices[0] ? TIER_LABEL[tierOf(usedVoices[0])] : undefined}
          />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <h2 className="mb-3 text-sm font-medium">Голоса</h2>
          {voices.length === 0 ? (
            <p className="text-xs text-neutral-500">
              Список голосов недоступен: проверьте учётные данные Google.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {stats.speakers.map((speaker) => (
                <label key={speaker} className="block text-xs">
                  <span className="mb-1 block truncate text-neutral-500">{speaker}</span>
                  <select
                    value={speakerVoices[speaker] ?? ""}
                    onChange={(e) =>
                      setOverrides((prev) => ({ ...prev, [speaker]: e.target.value }))
                    }
                    className={inputClass}
                  >
                    {voices.map((voice) => (
                      <option key={voice.name} value={voice.name}>
                        {voice.name} · {voice.gender.toLowerCase()}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              {stats.speakers.length === 0 && (
                <p className="text-xs text-neutral-500">
                  Спикеры не распознаны — весь текст озвучит один голос.
                </p>
              )}
            </div>
          )}
        </div>

        {check && !check.ok && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
            <p className="mb-1 font-medium">Разметка не годится для синтеза:</p>
            <ul className="list-disc pl-4">
              {check.errors.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        )}

        <button
          type="button"
          onClick={synthesize}
          disabled={busy || !check?.ok || !usedVoices.length}
          className="rounded-lg bg-neutral-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {busy
            ? `Синтез… ${check?.plan.filter((i) => i.type === "speech").length ?? 0} запросов`
            : "Синтезировать аудио"}
        </button>

        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
            {error}
            {issues.length > 0 && (
              <ul className="mt-2 list-disc pl-4 text-xs">
                {issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {(result || audioFileId) && (
          <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
            <h2 className="mb-3 text-sm font-medium">Аудио</h2>
            {audioFileId && (
              <audio controls src={`/api/projects/${projectId}/files/${audioFileId}`} className="w-full" />
            )}
            {result && (
              <dl className="mt-3 grid grid-cols-3 gap-2 text-xs text-neutral-500">
                <div>Кусков: {result.chunks}</div>
                <div>≈ {formatDuration(result.seconds)}</div>
                <div>${result.costUsd.toFixed(3)}</div>
              </dl>
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-neutral-500">
              Материал синтетический. Пометка об этом записана и в метаданные файла,
              чтобы она не потерялась при пересылке.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-800">
      <div className="text-[11px] text-neutral-500">{label}</div>
      <div className="text-sm font-medium tabular-nums">{value}</div>
      {hint && <div className="text-[10px] text-neutral-400">{hint}</div>}
    </div>
  );
}
