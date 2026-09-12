import "server-only";
import { Mp3Encoder } from "@breezystack/lamejs";

/**
 * Генератор тишины в MP3.
 *
 * Нужен для голосов, которые не принимают SSML (Chirp 3 HD, Journey):
 * <break time="1.5s"/> там нельзя отдать в API, поэтому пауза становится
 * настоящим куском тишины, который вставляется между репликами при склейке.
 *
 * Частоту держим ту же, что у речевых кусков (24 кГц моно) — на 24 кГц это
 * MPEG-2 Layer III с 576 сэмплами на фрейм, ровно как отдаёт Google, так что
 * фреймы стыкуются без пересборки файла.
 */

const SAMPLES_PER_FRAME = 1152;
/** Кодер добавляет свой delay + padding; компенсируем, чтобы пауза не «плыла». */
const ENCODER_PADDING_SAMPLES = 1440;
const MAX_SILENCE_SECONDS = 30;

const cache = new Map<string, Buffer>();

export function silenceMp3(seconds: number, sampleRate = 24000, bitrateKbps = 64): Buffer {
  const clamped = Math.min(Math.max(seconds, 0), MAX_SILENCE_SECONDS);
  const key = `${clamped.toFixed(3)}:${sampleRate}:${bitrateKbps}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const total = Math.max(0, Math.round(clamped * sampleRate) - ENCODER_PADDING_SAMPLES);
  const encoder = new Mp3Encoder(1, sampleRate, bitrateKbps);
  const silent = new Int16Array(SAMPLES_PER_FRAME);
  const parts: Buffer[] = [];

  for (let i = 0; i < total; i += SAMPLES_PER_FRAME) {
    const frame = encoder.encodeBuffer(silent.subarray(0, Math.min(SAMPLES_PER_FRAME, total - i)));
    if (frame.length) parts.push(Buffer.from(frame));
  }
  const tail = encoder.flush();
  if (tail.length) parts.push(Buffer.from(tail));

  const mp3 = Buffer.concat(parts);
  cache.set(key, mp3);
  return mp3;
}
