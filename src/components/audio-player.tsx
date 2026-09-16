"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Проигрыватель озвучки прямо на странице.
 *
 * Своё рисование, а не готовая библиотека, и причина не в самолюбии.
 * Библиотеки вроде wavesurfer нужны прежде всего затем, чтобы САМИМ посчитать
 * форму волны в браузере, — а у нас она приходит с сервера готовой, потому
 * что восемнадцать минут звука в памяти вкладки телефон не переживёт. Без
 * этой работы от библиотеки остаётся сотня строк рисования по канве,
 * которые здесь и написаны: зато полный контроль над тёмной темой,
 * клавиатурой и тем, что показывается, пока формы ещё нет.
 *
 * Звук играет обычный <audio>. Форма волны — украшение поверх него:
 * не пришла или не построилась — проигрыватель работает как ни в чём
 * не бывало.
 */

const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;

const clock = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
};

export default function AudioPlayer({
  src,
  peaksUrl,
  title,
}: {
  src: string;
  peaksUrl: string;
  title: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState<number>(1);

  // Форма волны приходит отдельно и может опоздать или не прийти вовсе.
  // Проигрывание её не ждёт.
  useEffect(() => {
    let alive = true;
    fetch(peaksUrl, { cache: "force-cache" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { peaks?: number[]; durationSec?: number | null } | null) => {
        if (!alive || !data) return;
        if (Array.isArray(data.peaks)) setPeaks(data.peaks);
        if (data.durationSec) setDuration((known) => known || data.durationSec!);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [peaksUrl]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;

    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);

    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(ratio, ratio);
    context.clearRect(0, 0, width, height);

    // Цвета берём у самой страницы: канва о теме не знает, а переменные
    // объявлены в `globals.css` вместе с остальной палитрой.
    const styles = getComputedStyle(canvas);
    const played = styles.getPropertyValue("--wave-played").trim() || "#171717";
    const rest = styles.getPropertyValue("--wave-rest").trim() || "#d4d4d4";

    const BAR = 3;
    const GAP = 1;
    const bars = Math.max(1, Math.floor(width / (BAR + GAP)));
    const middle = height / 2;
    const progress = duration > 0 ? current / duration : 0;

    for (let i = 0; i < bars; i += 1) {
      // Сохранённых столбиков больше, чем влезает: усредняем по отрезку,
      // а не берём каждый n-й — иначе короткая пауза случайно пропадает
      // или, наоборот, растягивается на весь столбик.
      const from = Math.floor((i / bars) * peaks.length);
      const to = Math.max(from + 1, Math.floor(((i + 1) / bars) * peaks.length));
      let sum = 0;
      for (let p = from; p < to && p < peaks.length; p += 1) sum += peaks[p];
      const value = peaks.length ? sum / (to - from) : 0;

      // Минимальная высота, чтобы тишина читалась полосой, а не пустотой:
      // иначе пауза неотличима от конца файла.
      const barHeight = Math.max(2, (value / 100) * (height - 4));
      const x = i * (BAR + GAP);
      context.fillStyle = i / bars <= progress ? played : rest;
      context.fillRect(x, middle - barHeight / 2, BAR, barHeight);
    }
  }, [peaks, current, duration]);

  useEffect(() => {
    draw();
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [draw]);

  /**
   * Показываем ЗАПРОШЕННУЮ позицию, а не вычитанную обратно из элемента.
   *
   * Пока звук не подгружен, перемотка применяется не сразу, и `currentTime`
   * ещё отдаёт старое значение: полоса и подпись дёргались назад, а с
   * клавиатуры казалось, что стрелки не работают вовсе. `onTimeUpdate`
   * потом всё равно поправит, если браузер встал не туда.
   */
  const moveTo = (seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const limit = Number.isFinite(audio.duration) ? audio.duration : 0;
    const next = Math.min(Math.max(seconds, 0), limit);
    audio.currentTime = next;
    setCurrent(next);
  };

  const seekTo = (fraction: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    moveTo(Math.min(Math.max(fraction, 0), 1) * audio.duration);
  };

  const nudge = (seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    moveTo(audio.currentTime + seconds);
  };

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  };

  return (
    <div className="grid gap-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
      />

      <div className="relative">
        <canvas
          ref={canvasRef}
          className="h-16 w-full cursor-pointer"
          onClick={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            seekTo((e.clientX - box.left) / box.width);
          }}
          // Ползунок, а не картинка: по нему можно идти с клавиатуры,
          // и скринридер объявляет, где мы находимся во времени.
          role="slider"
          tabIndex={0}
          aria-label={`Дорожка: ${title}`}
          aria-valuemin={0}
          aria-valuemax={Math.floor(duration) || 0}
          aria-valuenow={Math.floor(current)}
          aria-valuetext={`${clock(current)} из ${clock(duration)}`}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") nudge(5);
            else if (e.key === "ArrowLeft") nudge(-5);
            else if (e.key === "Home") seekTo(0);
            else if (e.key === "End") seekTo(1);
            else if (e.key === " " || e.key === "Enter") toggle();
            else return;
            e.preventDefault();
          }}
        />
        {peaks.length === 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-xs text-neutral-400">
            форма волны считается…
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {playing ? "Пауза" : "Слушать"}
        </button>

        <button type="button" onClick={() => nudge(-15)} className="text-xs text-neutral-500 underline-offset-2 hover:underline">
          −15 с
        </button>
        <button type="button" onClick={() => nudge(15)} className="text-xs text-neutral-500 underline-offset-2 hover:underline">
          +15 с
        </button>

        <span className="font-mono text-xs tabular-nums text-neutral-500">
          {clock(current)} / {clock(duration)}
        </span>

        <fieldset className="ml-auto flex items-center gap-1">
          <legend className="sr-only">Скорость воспроизведения</legend>
          {SPEEDS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={speed === value}
              onClick={() => {
                setSpeed(value);
                if (audioRef.current) audioRef.current.playbackRate = value;
              }}
              className={`rounded border px-2 py-1 text-xs ${
                speed === value
                  ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
                  : "border-neutral-300 text-neutral-600 hover:border-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
              }`}
            >
              {value}×
            </button>
          ))}
        </fieldset>
      </div>

      <p className="text-xs text-neutral-500">
        Замедление — для разбора трудного места, ускорение — чтобы проверить себя
        на темпе выше рабочего. Полоса показывает громкость: провалы — паузы между
        репликами.
      </p>
    </div>
  );
}
