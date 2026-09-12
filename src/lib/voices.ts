/**
 * ВАЖНО про голоса.
 *
 * Chirp 3 HD и Journey звучат заметно естественнее Neural2, НО они принимают
 * только plain text: запрос с input.ssml к ним падает с INVALID_ARGUMENT.
 * Приложение решает это автоматически — для таких голосов разметка снимается,
 * а <break> превращается в реальную тишину при склейке (см. lib/silence.ts).
 *
 * Полный SSML принимают Neural2 / Wavenet / Standard / Polyglot,
 * подмножество тегов — Studio.
 */

export type VoiceTier =
  | "Standard"
  | "Wavenet"
  | "Neural2"
  | "Polyglot"
  | "Studio"
  | "Chirp3HD"
  | "Journey"
  | "Other";

export interface VoiceOption {
  name: string;
  languageCode: string;
  /** как Google помечает тип голоса: FEMALE | MALE | NEUTRAL */
  gender: string;
  tier: VoiceTier;
  /** принимает ли голос SSML; если нет — работаем в text-режиме */
  ssml: boolean;
}

/** Цена за 1 млн символов, USD. Ориентировочно — сверяйтесь с прайсом Google. */
export const PRICE_PER_MILLION: Record<VoiceTier, number> = {
  Standard: 4,
  Wavenet: 16,
  Neural2: 16,
  Polyglot: 16,
  Studio: 160,
  Chirp3HD: 30,
  Journey: 30,
  Other: 16,
};

export const TIER_LABEL: Record<VoiceTier, string> = {
  Standard: "Standard",
  Wavenet: "WaveNet",
  Neural2: "Neural2",
  Polyglot: "Polyglot",
  Studio: "Studio",
  Chirp3HD: "Chirp 3 HD",
  Journey: "Journey",
  Other: "прочие",
};

export function tierOf(voiceName: string): VoiceTier {
  if (/-Chirp3-HD-|-Chirp-HD-|-Chirp3HD-/i.test(voiceName)) return "Chirp3HD";
  if (/-Journey-/i.test(voiceName)) return "Journey";
  if (/-Neural2-/i.test(voiceName)) return "Neural2";
  if (/-Wavenet-/i.test(voiceName)) return "Wavenet";
  if (/-Studio-/i.test(voiceName)) return "Studio";
  if (/-Polyglot-/i.test(voiceName)) return "Polyglot";
  if (/-Standard-/i.test(voiceName)) return "Standard";
  return "Other";
}

/** Голоса без поддержки SSML — для них включается text-режим. */
export function supportsSsml(voiceName: string): boolean {
  return !/(journey|chirp)/i.test(voiceName);
}

export function makeVoiceOption(name: string, languageCode: string, gender: string): VoiceOption {
  return { name, languageCode, gender, tier: tierOf(name), ssml: supportsSsml(name) };
}

/**
 * Фолбэк-список: показывается, пока нет учётных данных (тогда listVoices
 * недоступен). Как только креды есть, список приходит живьём из Google и
 * перекрывает этот. Порядок подобран так, чтобы соседние голоса максимально
 * различались по тембру и акценту — для тренировки синхрониста это ближе
 * к реальной панели, чем один диктор.
 */
export const FALLBACK_VOICES: VoiceOption[] = [
  // Chirp 3 HD — самые естественные, text-режим
  makeVoiceOption("en-US-Chirp3-HD-Aoede", "en-US", "FEMALE"),
  makeVoiceOption("en-US-Chirp3-HD-Charon", "en-US", "MALE"),
  makeVoiceOption("en-GB-Chirp3-HD-Kore", "en-GB", "FEMALE"),
  makeVoiceOption("en-US-Chirp3-HD-Puck", "en-US", "MALE"),
  makeVoiceOption("en-AU-Chirp3-HD-Leda", "en-AU", "FEMALE"),
  makeVoiceOption("en-GB-Chirp3-HD-Orus", "en-GB", "MALE"),
  makeVoiceOption("en-IN-Chirp3-HD-Zephyr", "en-IN", "FEMALE"),
  makeVoiceOption("en-US-Chirp3-HD-Fenrir", "en-US", "MALE"),
  // Neural2 — полный SSML
  makeVoiceOption("en-US-Neural2-F", "en-US", "FEMALE"),
  makeVoiceOption("en-US-Neural2-D", "en-US", "MALE"),
  makeVoiceOption("en-GB-Neural2-C", "en-GB", "FEMALE"),
  makeVoiceOption("en-US-Neural2-I", "en-US", "MALE"),
  makeVoiceOption("en-AU-Neural2-A", "en-AU", "FEMALE"),
  makeVoiceOption("en-GB-Neural2-B", "en-GB", "MALE"),
  makeVoiceOption("en-IN-Neural2-A", "en-IN", "FEMALE"),
  makeVoiceOption("en-US-Neural2-J", "en-US", "MALE"),
];

/** Естественность важнее ручного контроля разметки — по умолчанию Chirp 3 HD. */
export const DEFAULT_VOICE = "en-US-Chirp3-HD-Aoede";

/** Раздаёт спикерам разные голоса по кругу. */
export function assignVoices(
  speakers: string[],
  pool: VoiceOption[] = FALLBACK_VOICES,
): Record<string, string> {
  const list = pool.length ? pool : FALLBACK_VOICES;
  const out: Record<string, string> = {};
  speakers.forEach((speaker, i) => {
    out[speaker] = list[i % list.length].name;
  });
  return out;
}

export function languageOf(voiceName: string): string {
  const m = voiceName.match(/^([a-z]{2,3}-[A-Z]{2})/);
  return m ? m[1] : "en-US";
}

export function estimateCostUsd(billableChars: number, voiceNames: string[]): number {
  const worst = Math.max(...voiceNames.map((v) => PRICE_PER_MILLION[tierOf(v)]), 0);
  return (billableChars / 1_000_000) * worst;
}

/**
 * Формат определяется голосами, а не пользователем: если хоть один выбранный
 * голос не принимает SSML, весь скрипт идёт текстом с тишиной вместо <break>.
 * Смешивать форматы в одном файле нельзя — разметка применялась бы выборочно.
 */
export function formatForVoices(voiceNames: string[]): "ssml" | "text" {
  return voiceNames.every(supportsSsml) ? "ssml" : "text";
}
