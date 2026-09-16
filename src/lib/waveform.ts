import "server-only";
import { MPEGDecoder } from "mpg123-decoder";

/**
 * Форма волны для проигрывателя на странице.
 *
 * Считается НА СЕРВЕРЕ и хранится рядом с файлом. В браузере это делать
 * нельзя: восемнадцать минут при 24 кГц — это около ста мегабайт отсчётов
 * в памяти вкладки, и на телефоне она просто закроется. На сервере то же
 * самое занимает треть секунды и живёт в памяти wasm, а не в куче JS
 * (измерено на настоящем файле: 4,2 МБ, 17,3 минуты — 293 мс, 6 МБ кучи).
 *
 * Считается один раз: результат ложится в запись артефакта.
 */

/**
 * Столбиков в сохранённой форме.
 *
 * Выбрано по измерению, а не на глаз. У синтезированной речи громкость почти
 * постоянна, поэтому при грубом разрешении форма волны вырождается в ровную
 * полосу и не говорит ни о чём. Паузы — единственное, что в ней читается,
 * и они проявляются, когда на столбик приходится меньше секунды:
 *
 *   1200 столбиков (0,86 с) — тихих 3%
 *   2400 столбиков (0,43 с) — тихих 9%, паузы видно
 *
 * 2000 — компромисс: около 8 КБ в записи и достаточная дробность.
 */
export const WAVEFORM_BUCKETS = 2000;

export interface Waveform {
  /** Громкость по столбикам, 0–100. Целые: дробность здесь не нужна */
  peaks: number[];
  durationSec: number;
}

/**
 * Среднеквадратичная громкость, а не пиковая.
 *
 * Замерено на настоящей озвучке (17,3 минуты, 2000 столбиков): пиковая
 * даёт 7% тихих столбиков, среднеквадратичная — 14%. То есть паузы, ради
 * которых форма волны и нужна, видно вдвое лучше. Разница не драматическая,
 * но бесплатная, а у синтезированной речи громкость и так почти постоянна:
 * в грубом разрешении пиковая вырождается в сплошную заливку (на 600
 * столбиках её разброс был 49–102 из ста).
 */
export async function waveformFromMp3(mp3: Buffer): Promise<Waveform> {
  const decoder = new MPEGDecoder();
  await decoder.ready;

  try {
    const { channelData, samplesDecoded, sampleRate } = decoder.decode(new Uint8Array(mp3));
    if (!samplesDecoded || !channelData.length) return { peaks: [], durationSec: 0 };

    // Берём первый канал: у нас моно-синтез, второй канал — его копия.
    const pcm = channelData[0];
    const perBucket = Math.floor(samplesDecoded / WAVEFORM_BUCKETS);
    if (perBucket < 1) return { peaks: [], durationSec: samplesDecoded / sampleRate };

    const raw: number[] = [];
    let loudest = 0;
    for (let bucket = 0; bucket < WAVEFORM_BUCKETS; bucket += 1) {
      const start = bucket * perBucket;
      let energy = 0;
      for (let i = start; i < start + perBucket; i += 1) energy += pcm[i] * pcm[i];
      const rms = Math.sqrt(energy / perBucket);
      if (rms > loudest) loudest = rms;
      raw.push(rms);
    }

    // Нормируем по самому громкому месту: абсолютные значения зависят от
    // голоса и настроек синтеза, а показываем мы форму, а не децибелы.
    const scale = loudest > 0 ? 100 / loudest : 0;
    return {
      peaks: raw.map((value) => Math.round(value * scale)),
      durationSec: samplesDecoded / sampleRate,
    };
  } finally {
    decoder.free();
  }
}
