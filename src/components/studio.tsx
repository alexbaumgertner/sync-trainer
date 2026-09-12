"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  parseScript,
  planSynthesis,
  analyzeScript,
  formatDuration,
  DEFAULT_CHUNK_BYTES,
  GOOGLE_MAX_INPUT_BYTES,
} from "@/lib/ssml";
import {
  assignVoices,
  estimateCostUsd,
  formatForVoices,
  tierOf,
  TIER_LABEL,
  FALLBACK_VOICES,
  DEFAULT_VOICE,
  type VoiceOption,
  type VoiceTier,
} from "@/lib/voices";
import type { TtsRequest, UsageSummary } from "@/lib/api-types";
import { budgetBlock } from "@/lib/budget";

const EMPTY_SPEAKERS: string[] = [];

/** Порядок групп в выпадашке: сначала самые естественные. */
const TIER_ORDER: VoiceTier[] = [
  "Chirp3HD",
  "Neural2",
  "Studio",
  "Wavenet",
  "Polyglot",
  "Standard",
  "Journey",
  "Other",
];

interface Result {
  url: string;
  size: number;
  chunks: number;
  silences: number;
  chars: number;
  elapsedMs: number;
  format: string;
}

export default function Studio() {
  const [script, setScript] = useState("");
  const [voices, setVoices] = useState<VoiceOption[]>(FALLBACK_VOICES);
  const [voicesWarning, setVoicesWarning] = useState<string | null>(null);
  const [mode, setMode] = useState<"single" | "perSpeaker">("perSpeaker");
  const [voice, setVoice] = useState(DEFAULT_VOICE);
  const [voiceOverrides, setVoiceOverrides] = useState<Record<string, string>>({});
  const [rate, setRate] = useState("105%");
  const [stripLabels, setStripLabels] = useState(true);
  const [maxBytes, setMaxBytes] = useState(DEFAULT_CHUNK_BYTES);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const lastUrl = useRef<string | null>(null);
  const router = useRouter();

  const refreshUsage = useCallback(() => {
    fetch("/api/usage")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: UsageSummary | null) => data && setUsage(data))
      .catch(() => {});
  }, []);

  useEffect(refreshUsage, [refreshUsage]);

  const logout = useCallback(async () => {
    await fetch("/api/logout", { method: "POST" });
    router.refresh();
  }, [router]);

  /* ---- список голосов из Google (с фолбэком, если нет кредов) ---- */
  useEffect(() => {
    fetch("/api/voices?lang=en")
      .then((r) => r.json())
      .then((data: { voices: VoiceOption[]; source: string; warning?: string }) => {
        if (data.voices?.length) setVoices(data.voices);
        if (data.source === "fallback") {
          setVoicesWarning(data.warning ?? "Не удалось получить список голосов.");
        }
      })
      .catch(() => setVoicesWarning("Не удалось получить список голосов."));
  }, []);

  /* ---- разбор скрипта прямо в браузере: та же библиотека, что на сервере ---- */
  const parsed = useMemo(() => (script.trim() ? parseScript(script) : null), [script]);
  const stats = useMemo(
    () => (parsed ? analyzeScript(parsed.blocks, rate || parsed.rate) : null),
    [parsed, rate],
  );

  /* ---- спикер -> голос: автораздача по кругу + ручные правки пользователя ---- */
  const speakers = stats?.speakers ?? EMPTY_SPEAKERS;
  const speakerVoices = useMemo(() => {
    const pool = voices.filter((v) => tierOf(v.name) === tierOf(DEFAULT_VOICE));
    const auto = assignVoices(speakers, pool.length ? pool : voices);
    return { ...auto, ...voiceOverrides };
  }, [speakers, voices, voiceOverrides]);

  const usedVoices = useMemo(
    () => (mode === "perSpeaker" ? [voice, ...Object.values(speakerVoices)] : [voice]),
    [mode, voice, speakerVoices],
  );

  /**
   * Формат не выбирается руками — его диктуют голоса. Chirp 3 HD звучит
   * естественнее всего, но SSML не принимает, поэтому для него разметка
   * снимается, а <break> превращается в реальную тишину при склейке.
   */
  const format = useMemo(() => formatForVoices(usedVoices), [usedVoices]);

  const plan = useMemo(() => {
    if (!parsed) return null;
    try {
      const items = planSynthesis(parsed.blocks, {
        format,
        rate: rate || parsed.rate,
        perSpeaker: mode === "perSpeaker",
        stripLabels,
        maxBytes,
      });
      return { items, error: null as string | null };
    } catch (e) {
      return { items: [], error: (e as Error).message };
    }
  }, [parsed, format, rate, mode, stripLabels, maxBytes]);

  const speechItems = plan?.items.filter((i) => i.type === "speech") ?? [];
  const silenceCount = (plan?.items.length ?? 0) - speechItems.length;
  const billable = speechItems.reduce((s, c) => s + c.billableChars, 0);
  const cost = estimateCostUsd(billable, usedVoices);

  // Тот же расчёт, что и на сервере в /api/tts — общий budgetBlock.
  const blockedByBudget = usage ? budgetBlock(usage, cost) : null;

  const loadExample = useCallback(async () => {
    const res = await fetch("/examples/panel.ssml");
    setScript(await res.text());
  }, []);

  const generate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const payload: TtsRequest = {
        script,
        mode,
        voice,
        speakerVoices,
        rate: rate || null,
        stripLabels,
        maxBytes,
      };
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      const blob = await res.blob();
      if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
      const url = URL.createObjectURL(blob);
      lastUrl.current = url;
      setResult({
        url,
        size: blob.size,
        chunks: Number(res.headers.get("X-Chunk-Count") ?? 0),
        silences: Number(res.headers.get("X-Silence-Count") ?? 0),
        chars: Number(res.headers.get("X-Billable-Chars") ?? 0),
        elapsedMs: Number(res.headers.get("X-Elapsed-Ms") ?? 0),
        format: res.headers.get("X-Format") ?? format,
      });
      refreshUsage();
    } catch (e) {
      setError((e as Error).message);
      setResult(null);
    } finally {
      setBusy(false);
    }
  }, [script, mode, voice, speakerVoices, rate, stripLabels, maxBytes, format, refreshUsage]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Тренажёр синхрониста · генератор аудио
          </h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Скрипт → озвучка через Google Cloud Text-to-Speech. Длинный текст режется на куски
            по {GOOGLE_MAX_INPUT_BYTES} байт (лимит API) и склеивается обратно в один MP3.
          </p>
        </div>
        <button type="button" onClick={logout} className={ghostButton}>
          Выйти
        </button>
      </header>

      {voicesWarning && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          <strong className="font-medium">Голоса загружены из локального списка. </strong>
          {voicesWarning}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        {/* ------------------------------ скрипт ------------------------------ */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <label htmlFor="script" className="text-sm font-medium">
              Скрипт (SSML или обычный текст)
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={loadExample} className={ghostButton}>
                Загрузить пример
              </button>
              <button type="button" onClick={() => setScript("")} className={ghostButton}>
                Очистить
              </button>
            </div>
          </div>
          <textarea
            id="script"
            value={script}
            onChange={(e) => setScript(e.target.value)}
            spellCheck={false}
            placeholder="<speak>…</speak> или просто текст с репликами вида «Moderator: …»"
            className="h-[26rem] w-full resize-y rounded-lg border border-neutral-300 bg-white p-3 font-mono text-xs leading-relaxed outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
          />

          {stats && plan && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Спикеров" value={String(stats.speakers.length)} />
              <Stat label="Абзацев" value={String(stats.paragraphs)} />
              <Stat
                label="Запросов к API"
                value={plan.error ? "—" : String(speechItems.length)}
                hint={format === "text" ? `+ ${silenceCount} пауз локально` : undefined}
              />
              <Stat label="Длительность ≈" value={formatDuration(stats.estimatedSeconds)} />
              <Stat
                label="Символов (тариф)"
                value={billable.toLocaleString("ru-RU")}
                hint={format === "ssml" ? "Google считает и SSML-теги" : "теги не тарифицируются"}
              />
              <Stat
                label="Стоимость ≈"
                value={`$${cost.toFixed(3)}`}
                hint={`тариф ${TIER_LABEL[tierOf(usedVoices[0])]}`}
              />
              <Stat label="Речи" value={`${stats.spokenChars.toLocaleString("ru-RU")} зн.`} />
              <Stat label="Паузы" value={`${stats.breakSeconds.toFixed(1)} с`} />
            </div>
          )}
          {plan?.error && (
            <p className="text-sm text-red-600 dark:text-red-400">{plan.error}</p>
          )}
        </section>

        {/* ----------------------------- настройки ----------------------------- */}
        <section className="flex flex-col gap-5">
          <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
            <h2 className="mb-3 text-sm font-medium">Голоса</h2>

            <div className="mb-4 flex gap-2">
              {(["perSpeaker", "single"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`flex-1 rounded-md border px-3 py-2 text-xs transition ${
                    mode === m
                      ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
                      : "border-neutral-300 hover:border-neutral-500 dark:border-neutral-700"
                  }`}
                >
                  {m === "perSpeaker" ? "Разные голоса" : "Один голос"}
                </button>
              ))}
            </div>

            {mode === "single" ? (
              <VoicePicker label="Голос" value={voice} voices={voices} onChange={setVoice} />
            ) : (
              <div className="flex flex-col gap-2">
                {speakers.map((speaker) => (
                  <VoicePicker
                    key={speaker}
                    label={speaker}
                    value={speakerVoices[speaker] ?? DEFAULT_VOICE}
                    voices={voices}
                    onChange={(v) => setVoiceOverrides((prev) => ({ ...prev, [speaker]: v }))}
                  />
                ))}
                {!speakers.length && (
                  <p className="text-xs text-neutral-500">
                    Спикеры определяются по началу абзаца: «Moderator: …». Пока их не видно.
                  </p>
                )}
                <VoicePicker
                  label="Абзацы без спикера"
                  value={voice}
                  voices={voices}
                  onChange={setVoice}
                />
              </div>
            )}

            <FormatNote format={format} silenceCount={silenceCount} />
          </div>

          <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
            <h2 className="mb-3 text-sm font-medium">Параметры</h2>

            <label className="mb-3 block text-xs">
              <span className="mb-1 block text-neutral-500">
                Темп {format === "ssml" ? "(prosody rate)" : "(audioConfig.speakingRate)"}
              </span>
              <input
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                placeholder="105%"
                className={inputClass}
              />
            </label>

            <label className="mb-3 block text-xs">
              <span className="mb-1 block text-neutral-500">
                Размер куска, байт (лимит Google — {GOOGLE_MAX_INPUT_BYTES})
              </span>
              <input
                type="number"
                min={500}
                max={GOOGLE_MAX_INPUT_BYTES}
                value={maxBytes}
                onChange={(e) => setMaxBytes(Number(e.target.value))}
                className={inputClass}
              />
            </label>

            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={stripLabels}
                onChange={(e) => setStripLabels(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Не произносить «Moderator:» и другие имена спикеров
                <span className="block text-neutral-500">
                  Смена голоса и так обозначает смену говорящего.
                </span>
              </span>
            </label>
          </div>

          <BudgetCard usage={usage} pending={cost} blocked={blockedByBudget} />

          <button
            type="button"
            onClick={generate}
            disabled={busy || !script.trim() || !!plan?.error || !!blockedByBudget}
            className="rounded-lg bg-neutral-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            {busy
              ? `Синтез… ${speechItems.length} запросов к Google`
              : blockedByBudget
                ? "Лимит бюджета исчерпан"
                : "Сгенерировать MP3"}
          </button>

          {error && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
              {error}
            </div>
          )}

          {result && (
            <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
              <h2 className="mb-3 text-sm font-medium">Готово</h2>
              <audio controls src={result.url} className="w-full" />
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-neutral-500">
                <div>Запросов: {result.chunks}</div>
                <div>Пауз: {result.silences}</div>
                <div>Символов: {result.chars.toLocaleString("ru-RU")}</div>
                <div>Размер: {(result.size / 1024 / 1024).toFixed(2)} МБ</div>
                <div>Время: {(result.elapsedMs / 1000).toFixed(1)} с</div>
                <div>Режим: {result.format}</div>
              </dl>
              <a
                href={result.url}
                download={`training-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.mp3`}
                className="mt-3 inline-block rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:border-neutral-500 dark:border-neutral-700"
              >
                Скачать MP3
              </a>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/* ------------------------------ мелочи UI ------------------------------ */

const ghostButton =
  "rounded-md border border-neutral-300 px-2.5 py-1 text-xs hover:border-neutral-500 dark:border-neutral-700";
const inputClass =
  "w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900";

function FormatNote({ format, silenceCount }: { format: string; silenceCount: number }) {
  return (
    <p className="mt-3 rounded-md bg-neutral-100 px-3 py-2 text-[11px] leading-relaxed text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
      {format === "text" ? (
        <>
          <strong className="font-medium">Text-режим.</strong> Выбранные голоса не принимают SSML.
          Разметка снимается автоматически, а {silenceCount} пауз вставляются реальной тишиной
          при склейке — вручную делать ничего не нужно.
        </>
      ) : (
        <>
          <strong className="font-medium">SSML-режим.</strong> Паузы и темп уходят в Google
          разметкой как есть.
        </>
      )}
    </p>
  );
}

function BudgetCard({
  usage,
  pending,
  blocked,
}: {
  usage: UsageSummary | null;
  pending: number;
  blocked: string | null;
}) {
  if (!usage) return null;

  const share = usage.budgetUsd ? Math.min(usage.totalUsd / usage.budgetUsd, 1) : null;

  return (
    <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <h2 className="mb-3 text-sm font-medium">Бюджет</h2>

      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums">${usage.totalUsd.toFixed(2)}</span>
        {usage.budgetUsd && (
          <span className="text-xs text-neutral-500">из ${usage.budgetUsd.toFixed(0)}</span>
        )}
        {pending > 0 && (
          <span className="ml-auto text-xs text-neutral-500">
            эта генерация +${pending.toFixed(3)}
          </span>
        )}
      </div>

      {share !== null && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
          <div
            className={`h-full rounded-full ${share > 0.8 ? "bg-red-500" : "bg-neutral-900 dark:bg-white"}`}
            style={{ width: `${Math.max(share * 100, 0.5)}%` }}
          />
        </div>
      )}

      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs text-neutral-500">
        <div>
          <dt>В этом месяце</dt>
          <dd className="font-medium tabular-nums text-neutral-900 dark:text-neutral-100">
            ${usage.monthUsd.toFixed(2)}
          </dd>
        </div>
        <div>
          <dt>Генераций</dt>
          <dd className="font-medium tabular-nums text-neutral-900 dark:text-neutral-100">
            {usage.generations}
          </dd>
        </div>
        <div>
          <dt>Символов</dt>
          <dd className="font-medium tabular-nums text-neutral-900 dark:text-neutral-100">
            {usage.totalChars.toLocaleString("ru-RU")}
          </dd>
        </div>
      </dl>

      <p className="mt-3 text-[11px] leading-relaxed text-neutral-500">
        Символы точные — мы сами их отправили. Доллары это <strong className="font-medium">оценка</strong>{" "}
        по нашей таблице тарифов, а не счёт Google: бесплатный лимит, скидки и изменения
        прайса здесь не учтены. Факт смотрите в биллинге Google Cloud.
      </p>

      {blocked && (
        <p className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-[11px] leading-relaxed text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
          {blocked}
        </p>
      )}

      {usage.monthLimitUsd !== null && (
        <p className="mt-2 text-[11px] text-neutral-500">
          Месячный лимит: ${usage.monthUsd.toFixed(2)} из ${usage.monthLimitUsd.toFixed(2)}.
          По его достижении генерация останавливается.
        </p>
      )}

      {usage.volatile && (
        <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          Счётчик хранится в памяти и обнулится при перезапуске. Чтобы он пережил
          деплой, подключите Vercel Blob — переменная{" "}
          <code className="font-mono">BLOB_READ_WRITE_TOKEN</code> появится сама.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-800">
      <div className="text-[11px] text-neutral-500">{label}</div>
      <div className="text-sm font-medium tabular-nums">{value}</div>
      {hint && <div className="text-[10px] text-neutral-400">{hint}</div>}
    </div>
  );
}

function VoicePicker({
  label,
  value,
  voices,
  onChange,
}: {
  label: string;
  value: string;
  voices: VoiceOption[];
  onChange: (value: string) => void;
}) {
  const groups = useMemo(() => {
    const byTier = new Map<VoiceTier, VoiceOption[]>();
    for (const v of voices) {
      const list = byTier.get(v.tier) ?? [];
      list.push(v);
      byTier.set(v.tier, list);
    }
    return TIER_ORDER.filter((t) => byTier.has(t)).map((t) => ({
      tier: t,
      voices: byTier.get(t)!,
    }));
  }, [voices]);

  return (
    <label className="block text-xs">
      <span className="mb-1 block truncate text-neutral-500">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
        {!voices.some((v) => v.name === value) && <option value={value}>{value}</option>}
        {groups.map(({ tier, voices: list }) => (
          <optgroup
            key={tier}
            label={`${TIER_LABEL[tier]} — ${list[0].ssml ? "SSML" : "только текст"}`}
          >
            {list.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name} · {v.gender.toLowerCase()}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
