import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TextToSpeechClient } from "@google-cloud/text-to-speech";
import type { PlanItem } from "./ssml";
import { languageOf } from "./voices";
import { silenceMp3 } from "./silence";
import { mp3Duration } from "./mp3-frames";

let cached: TextToSpeechClient | null = null;

export const NO_CREDENTIALS =
  "Нет учётных данных Google. Задайте GOOGLE_SERVICE_ACCOUNT_JSON (JSON ключа или его base64) " +
  "либо GOOGLE_APPLICATION_CREDENTIALS (путь к файлу ключа) в .env.local.";

/**
 * Проверяем креды ДО создания клиента. Без этого google-gax уходит искать
 * ADC на metadata-сервере, а его отказ прилетает отдельным unhandledRejection
 * мимо нашего try/catch — в dev это шум в логах, в проде может уронить процесс.
 */
export function hasCredentials(): boolean {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()) return true;

  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (keyFile && fs.existsSync(keyFile)) return true;

  // gcloud auth application-default login
  const adc =
    process.platform === "win32"
      ? path.join(process.env.APPDATA ?? "", "gcloud", "application_default_credentials.json")
      : path.join(os.homedir(), ".config", "gcloud", "application_default_credentials.json");
  return fs.existsSync(adc);
}

/**
 * Два способа авторизации:
 *  1. GOOGLE_SERVICE_ACCOUNT_JSON — содержимое ключа (сырой JSON или base64).
 *     Работает и локально, и на Vercel, где нет файловой системы для ключа.
 *  2. GOOGLE_APPLICATION_CREDENTIALS — путь к файлу ключа (обычный ADC).
 */
export function getClient(): TextToSpeechClient {
  if (cached) return cached;
  if (!hasCredentials()) throw new Error(NO_CREDENTIALS);

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (raw) {
    const json = JSON.parse(raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8"));
    cached = new TextToSpeechClient({
      projectId: json.project_id,
      credentials: { client_email: json.client_email, private_key: json.private_key },
    });
  } else {
    cached = new TextToSpeechClient();
  }
  return cached;
}

export interface SynthesisSettings {
  /** имя голоса для куска без спикера / для режима одного голоса */
  defaultVoice: string;
  /** спикер -> голос, для режима «разные голоса» */
  speakerVoices?: Record<string, string>;
  /** дополнительное замедление/ускорение поверх prosody, 0.25..4.0 */
  speakingRate?: number;
  pitch?: number;
  /** MP3 склеивается пофреймово, поэтому частота у всех кусков одна */
  sampleRateHertz?: number;
}

export function voiceFor(speaker: string | null, settings: SynthesisSettings): string {
  if (speaker && settings.speakerVoices?.[speaker]) return settings.speakerVoices[speaker];
  return settings.defaultVoice;
}

const RETRYABLE = new Set([4, 8, 10, 13, 14, 15]); // DEADLINE, RESOURCE_EXHAUSTED, ABORTED, INTERNAL, UNAVAILABLE, DATA_LOSS

type SpeechItem = Extract<PlanItem, { type: "speech" }>;

async function synthesizeOne(
  item: SpeechItem,
  settings: SynthesisSettings,
  attempt = 0,
  dropSpeakingRate = false,
): Promise<Buffer> {
  const client = getClient();
  const voice = voiceFor(item.speaker, settings);

  try {
    const [response] = await client.synthesizeSpeech({
      input: item.format === "ssml" ? { ssml: item.content } : { text: item.content },
      voice: { name: voice, languageCode: languageOf(voice) },
      audioConfig: {
        audioEncoding: "MP3",
        sampleRateHertz: settings.sampleRateHertz ?? 24000,
        speakingRate: dropSpeakingRate ? undefined : settings.speakingRate,
        pitch: dropSpeakingRate ? undefined : settings.pitch,
      },
    });

    const audio = response.audioContent;
    if (!audio) throw new Error(`Google вернул пустой аудиопоток для голоса ${voice}`);
    return Buffer.isBuffer(audio) ? audio : Buffer.from(audio as Uint8Array);
  } catch (error) {
    const code = (error as { code?: number }).code;
    const message = (error as { message?: string }).message ?? "";

    // Страховка на случай голоса, который не принимает speakingRate/pitch:
    // повторяем без них, вместо того чтобы падать на оплаченном запросе.
    //
    // Раньше здесь было сказано, что так себя ведут Chirp 3 HD. Проверено
    // 14 сентября 2026 — неправда: они принимают speakingRate и честно
    // меняют темп (8.09 с против 6.05 с при 1.3). Страховка остаётся,
    // но по умолчанию темп до голоса теперь доезжает.
    if (
      !dropSpeakingRate &&
      code === 3 &&
      (settings.speakingRate !== undefined || settings.pitch !== undefined) &&
      /speaking_rate|speakingRate|pitch|audio_config|audioConfig/i.test(message)
    ) {
      return synthesizeOne(item, settings, attempt, true);
    }

    if (attempt < 3 && code !== undefined && RETRYABLE.has(code)) {
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
      return synthesizeOne(item, settings, attempt + 1, dropSpeakingRate);
    }
    throw error;
  }
}

/**
 * Выполняет план: речевые куски уходят в Google (до `concurrency` параллельно),
 * паузы генерируются локально. Результат склеивается строго по порядку плана.
 */
/**
 * Результат склейки: сам файл и длительность КАЖДОГО куска.
 *
 * Длительности нужны для карты времени — по ней текст раскладывается
 * по звуку. Взять их потом негде: после склейки куски неразличимы, а
 * повторно расшифровывать четырнадцать кусков ради того, что известно
 * здесь, — работа впустую.
 */
export interface SynthesisResult {
  audio: Buffer;
  /** По элементу плана, в том же порядке. Паузы тоже */
  itemSeconds: number[];
}

export async function synthesizePlan(
  plan: PlanItem[],
  settings: SynthesisSettings,
  concurrency = 4,
): Promise<SynthesisResult> {
  const sampleRate = settings.sampleRateHertz ?? 24000;
  const results = new Array<Buffer>(plan.length);

  // Паузы не стоят ни запроса, ни денег — считаем их сразу.
  const speechIndexes: number[] = [];
  plan.forEach((item, i) => {
    if (item.type === "silence") results[i] = silenceMp3(item.seconds, sampleRate);
    else speechIndexes.push(i);
  });

  const measure = (): SynthesisResult => ({
    audio: Buffer.concat(results),
    // По кадрам, а не по байтам и битрейту: у MPEG-2 своя таблица,
    // и на этом уже ошибались вдвое.
    itemSeconds: results.map((part) => (part ? mp3Duration(part) : 0)),
  });

  if (!speechIndexes.length) return measure();

  // Инициализируем клиент ДО пула: иначе несколько параллельных вызовов
  // одновременно триггерят ленивую auth-инициализацию google-gax, и её
  // отказ всплывает как unhandledRejection (в проде это убивает процесс).
  await getClient().initialize();

  let next = 0;
  const worker = async () => {
    while (true) {
      const slot = next++;
      if (slot >= speechIndexes.length) return;
      const i = speechIndexes[slot];
      results[i] = await synthesizeOne(plan[i] as SpeechItem, settings);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, speechIndexes.length) }, worker),
  );
  return measure();
}

/** Человекочитаемое объяснение типовых ошибок Google. */
export function explainError(error: unknown): string {
  const err = error as { code?: number; message?: string };
  const message = err?.message ?? String(error);

  if (
    message === NO_CREDENTIALS ||
    /Could not load the default credentials|Unable to detect a Project/i.test(message)
  ) {
    return NO_CREDENTIALS;
  }
  if (/does not support SSML|Invalid SSML|ssml/i.test(message) && err?.code === 3) {
    return `Голос не принимает SSML либо разметка невалидна. Journey / Chirp / Chirp 3 HD работают только с обычным текстом. Ответ Google: ${message}`;
  }
  if (/does not support SSML|only supports? (plain )?text/i.test(message)) {
    return `Голос не принимает SSML. Переключитесь на Neural2/Wavenet или выберите text-режим (Chirp 3 HD). Ответ Google: ${message}`;
  }
  if (/5000 bytes|too long/i.test(message)) {
    return `Кусок превысил лимит в 5000 байт — уменьшите «Размер куска» в настройках. Ответ Google: ${message}`;
  }
  if (err?.code === 7 || /PERMISSION_DENIED|has not been used|disabled/i.test(message)) {
    return `Нет доступа к Text-to-Speech API. Включите его в проекте и дайте сервис-аккаунту роль. Ответ Google: ${message}`;
  }
  if (err?.code === 8) {
    return `Исчерпана квота запросов. Подождите или поднимите лимит. Ответ Google: ${message}`;
  }
  return message;
}
