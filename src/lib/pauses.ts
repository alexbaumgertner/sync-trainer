import "server-only";
import { MPEGDecoder } from "mpg123-decoder";

/**
 * Паузы в озвучке, найденные по самому звуку.
 *
 * Нужны, чтобы подсветка текста стояла там, где человек слышит границу
 * фразы, а не там, где её предсказали по числу символов.
 *
 * Почему предсказания мало. Границы реплик известны точно — по кадрам
 * MP3 каждого куска. А вот фразы внутри реплики до сих пор раскладывались
 * пропорционально длине, и на реплике в минуту это давало десяток секунд
 * ошибки: живая речь не идёт с постоянным числом символов в секунду.
 * Замерено на настоящей озвучке: между голосами разброс — от 14,5 до 25,1
 * символа в секунду, в 1,7 раза.
 *
 * Синтез при этом не трогаем: звук должен остаться естественным, а резать
 * его по предложениям значило бы потерять интонацию через предложение.
 * Поэтому берём то, что в звуке уже есть, — паузы между фразами.
 */

export interface Pause {
  /** Середина паузы в секундах от начала файла */
  time: number;
  /** Длительность паузы: по ней отличают конец предложения от запятой */
  length: number;
}

/** Окно измерения громкости. 20 мс — короче самой короткой паузы на порядок. */
const WINDOW_SEC = 0.02;

/**
 * Порог тишины — доля от медианной громкости файла.
 *
 * Доля, а не абсолютное значение: у разных голосов и у разного темпа
 * громкость своя. Замерено на настоящей озвучке: медиана 0,074, десятый
 * процентиль 0,002 — разделение уверенное, и 12% медианы проходит между
 * ними с запасом.
 */
const SILENCE_RATIO = 0.12;

/**
 * Короче этого — не пауза, а смычка внутри слова.
 *
 * 0,18 с выбрано по замеру: паузы на запятых в синтезе выходят 0,18–0,26,
 * на концах предложений 0,3–0,48. Нижний край захватываем намеренно —
 * отбирать из кандидатов будет выравнивание, и лучше дать ему больше.
 */
const MIN_PAUSE_SEC = 0.18;

export async function findPauses(mp3: Buffer): Promise<Pause[]> {
  const decoder = new MPEGDecoder();
  await decoder.ready;

  try {
    const { channelData, samplesDecoded, sampleRate } = decoder.decode(new Uint8Array(mp3));
    if (!samplesDecoded || !channelData.length) return [];

    // Первый канал: синтез у нас моно, второй — его копия.
    const pcm = channelData[0];
    const window = Math.max(1, Math.round(sampleRate * WINDOW_SEC));
    const step = window / sampleRate;

    const levels: number[] = [];
    for (let i = 0; i + window <= samplesDecoded; i += window) {
      let sum = 0;
      for (let j = i; j < i + window; j++) sum += pcm[j] * pcm[j];
      levels.push(Math.sqrt(sum / window));
    }
    if (!levels.length) return [];

    const sorted = [...levels].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    // Ровная тишина без речи: порога нет, и делить нечего.
    if (!(median > 0)) return [];
    const threshold = median * SILENCE_RATIO;

    const pauses: Pause[] = [];
    let run = 0;
    const close = (endIndex: number) => {
      const length = run * step;
      if (length < MIN_PAUSE_SEC) return;
      const start = (endIndex - run) * step;
      pauses.push({ time: start + length / 2, length });
    };

    for (let i = 0; i < levels.length; i++) {
      if (levels[i] < threshold) {
        run += 1;
        continue;
      }
      close(i);
      run = 0;
    }
    close(levels.length);

    return pauses;
  } finally {
    decoder.free();
  }
}
