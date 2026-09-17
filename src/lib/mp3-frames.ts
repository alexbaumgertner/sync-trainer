/**
 * Подсчёт длительности MP3 по заголовкам кадров.
 *
 * Зачем не расшифровка. Границы реплик нужны на каждый из четырнадцати
 * кусков склейки, и расшифровывать их по отдельности — секунды работы
 * впустую. Заголовок кадра говорит длительность сам: достаточно пройти
 * по файлу, ни разу не заглянув в звук.
 *
 * Зачем не «байты поделить на битрейт». Так уже ошибались — ровно вдвое:
 * взяли таблицу битрейтов MPEG-1, а Google на 24 кГц отдаёт MPEG-2, где
 * и таблица другая, и кадр вдвое короче (576 отсчётов против 1152).
 * Здесь обе таблицы, и версия читается из самого файла. Заодно это верно
 * для переменного битрейта, где деления не хватило бы в принципе.
 */

// Таблицы из ISO/IEC 11172-3 и 13818-3, только Layer III.
const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const RATES_V1 = [44100, 48000, 32000, 0];
const RATES_V2 = [22050, 24000, 16000, 0];
const RATES_V25 = [11025, 12000, 8000, 0];

export interface Mp3Frame {
  offset: number;
  length: number;
  samples: number;
  sampleRate: number;
}

/** Разбор одного заголовка. `null` — на этом месте кадра нет. */
export function readFrame(buffer: Buffer, offset: number): Mp3Frame | null {
  if (offset + 4 > buffer.length) return null;
  // Синхрослово: одиннадцать единиц подряд.
  if (buffer[offset] !== 0xff || (buffer[offset + 1] & 0xe0) !== 0xe0) return null;

  const versionBits = (buffer[offset + 1] >> 3) & 0b11;
  const layerBits = (buffer[offset + 1] >> 1) & 0b11;
  // Layer III — это 0b01; прочие слои нам не встречаются и не поддерживаются.
  if (layerBits !== 0b01) return null;

  const rateBits = (buffer[offset + 2] >> 2) & 0b11;
  const bitrateBits = (buffer[offset + 2] >> 4) & 0b1111;
  const padding = (buffer[offset + 2] >> 1) & 1;

  // 0b01 — зарезервировано и в живых файлах не бывает.
  if (versionBits === 0b01) return null;

  const isV1 = versionBits === 0b11;
  const sampleRate = isV1
    ? RATES_V1[rateBits]
    : versionBits === 0b10
      ? RATES_V2[rateBits]
      : RATES_V25[rateBits];
  const bitrate = (isV1 ? BITRATES_V1 : BITRATES_V2)[bitrateBits];
  if (!sampleRate || !bitrate) return null;

  // У MPEG-2 и 2.5 кадр вдвое короче — та самая разница, на которой
  // однажды вышла ошибка вдвое.
  const samples = isV1 ? 1152 : 576;
  const length = Math.floor((samples / 8) * ((bitrate * 1000) / sampleRate)) + padding;
  if (length < 4) return null;

  return { offset, length, samples, sampleRate };
}

/**
 * Длительность в секундах.
 *
 * Идём по кадрам, а не сканируем каждый байт: у целого файла кадры лежат
 * подряд, и прыжок на длину кадра стоит одного сложения. Сбились — ищем
 * следующее синхрослово побайтно, но это путь для битых файлов.
 */
export function mp3Duration(buffer: Buffer): number {
  let offset = 0;

  // Пропускаем тег ID3v2, если он есть: внутри него бывают байты 0xFF.
  if (buffer.length > 10 && buffer.toString("latin1", 0, 3) === "ID3") {
    const size =
      (buffer[6] << 21) | (buffer[7] << 14) | (buffer[8] << 7) | buffer[9];
    offset = 10 + size;
  }

  let samples = 0;
  let sampleRate = 0;

  while (offset < buffer.length) {
    const frame = readFrame(buffer, offset);
    if (frame) {
      samples += frame.samples;
      sampleRate = frame.sampleRate;
      offset += frame.length;
    } else {
      offset += 1;
    }
  }

  return sampleRate > 0 ? samples / sampleRate : 0;
}
