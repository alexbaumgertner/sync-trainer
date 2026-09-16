import { describe, expect, it } from "vitest";
import { Mp3Encoder } from "@breezystack/lamejs";
import { waveformFromMp3, WAVEFORM_BUCKETS } from "@/lib/waveform";
import { silenceMp3 } from "@/lib/silence";

/**
 * Форма волны, посчитанная на сервере.
 *
 * Считать её в браузере нельзя: восемнадцать минут при 24 кГц — около ста
 * мегабайт отсчётов в памяти вкладки, и телефон её закроет. Здесь проверяется
 * то, от чего зависит картинка на странице: что тишина выглядит тишиной,
 * что длительность берётся у расшифровщика, а не считается из битрейта,
 * и что негодный файл не роняет страницу.
 */

const SECONDS = 6;

describe("тишина", () => {
  it("даёт нулевые столбики и верную длительность", async () => {
    const mp3 = silenceMp3(SECONDS);
    const wave = await waveformFromMp3(mp3);

    // Длительность из расшифровщика. Раньше её считали из битрейта и
    // ошиблись ровно вдвое: у MPEG-2 своя таблица.
    expect(wave.durationSec).toBeGreaterThan(SECONDS - 0.5);
    expect(wave.durationSec).toBeLessThan(SECONDS + 0.5);

    expect(wave.peaks).toHaveLength(WAVEFORM_BUCKETS);
    expect(Math.max(...wave.peaks)).toBe(0);
  });
});

describe("звук с паузами", () => {
  /**
   * Образец собираем здесь же, а не кладём файлом в репозиторий.
   *
   * Настоящая озвучка — это чужие материалы, которым в репозитории не место;
   * а без образца проверка на речь молча пропускалась бы и не проверяла
   * ничего. Тон и тишина вперемежку дают ровно то, что должна показывать
   * форма волны: где говорят, а где пауза.
   */
  const toneAndSilence = (): Buffer => {
    const rate = 24000;
    const encoder = new Mp3Encoder(1, rate, 64);
    const parts: Buffer[] = [];
    const frame = new Int16Array(1152);

    // Шесть секунд: секунда тона, секунда тишины, и так далее.
    for (let i = 0; i < Math.floor((rate * 6) / 1152); i += 1) {
      const loud = Math.floor((i * 1152) / rate) % 2 === 0;
      for (let n = 0; n < frame.length; n += 1) {
        const t = (i * 1152 + n) / rate;
        frame[n] = loud ? Math.round(Math.sin(2 * Math.PI * 220 * t) * 12000) : 0;
      }
      const chunk = encoder.encodeBuffer(frame);
      if (chunk.length) parts.push(Buffer.from(chunk));
    }
    const tail = encoder.flush();
    if (tail.length) parts.push(Buffer.from(tail));
    return Buffer.concat(parts);
  };

  it("громкие места нормируются в сотню, тихие проваливаются", async () => {
    const wave = await waveformFromMp3(toneAndSilence());

    expect(wave.peaks).toHaveLength(WAVEFORM_BUCKETS);
    // Нормировка по самому громкому: показываем форму, а не децибелы.
    expect(Math.max(...wave.peaks)).toBe(100);
    expect(Math.min(...wave.peaks)).toBeLessThan(10);
  });

  it("паузы занимают примерно половину — как их и заложили", async () => {
    // Ради этого всё и считается: провалы на форме означают паузы между
    // репликами.
    //
    // Оговорка: выбор среднеквадратичной громкости вместо пиковой эта
    // проверка НЕ стережёт — на чистом тоне с цифровой тишиной обе дают
    // одинаковую картинку. Выбор сделан по замеру на настоящей озвучке
    // (2000 столбиков: пиковая — 7% тихих, среднеквадратичная — 14%),
    // и живёт этот довод в журнале решений, а не здесь.
    const wave = await waveformFromMp3(toneAndSilence());
    const quiet = wave.peaks.filter((value) => value < 20).length;
    const share = quiet / wave.peaks.length;

    expect(share).toBeGreaterThan(0.3);
    expect(share).toBeLessThan(0.7);
  });
});

describe("негодный файл", () => {
  it("не роняет вызов, а отдаёт пустую форму", async () => {
    // Проигрыватель обязан работать без формы волны: она украшение поверх
    // обычного <audio>, а не условие его работы.
    const wave = await waveformFromMp3(Buffer.from("это совсем не mp3", "utf8"));
    expect(wave.peaks).toEqual([]);
    expect(wave.durationSec).toBe(0);
  });

  it("на пустом буфере тоже", async () => {
    const wave = await waveformFromMp3(Buffer.alloc(0));
    expect(wave.peaks).toEqual([]);
  });
});

describe("столбиков хватает, чтобы увидеть паузу", () => {
  it("на восемнадцати минутах меньше секунды на столбик", () => {
    // Измерено: при 0,86 с на столбик тихих участков 3% и форма вырождается
    // в ровную полосу; при 0,43 с — 9%, и паузы видно. Если кто-то уменьшит
    // разрешение ради экономии, картинка перестанет что-либо значить.
    const longestSec = 18 * 60;
    expect(longestSec / WAVEFORM_BUCKETS).toBeLessThan(1);
  });
});
