import { describe, expect, it } from "vitest";
import { mp3Duration, readFrame } from "@/lib/mp3-frames";
import { silenceMp3 } from "@/lib/silence";
import { withId3 } from "@/lib/id3";

/**
 * Длительность MP3 по заголовкам кадров.
 *
 * Считается для границ реплик: в склейке четырнадцать кусков, и знать,
 * сколько длится каждый, надо не расшифровывая их по отдельности.
 *
 * Главная проверка здесь — про MPEG-2. Ровно на этом однажды вышла ошибка
 * ВДВОЕ: взяли таблицу битрейтов MPEG-1, а Google на 24 кГц отдаёт MPEG-2,
 * где кадр 576 отсчётов вместо 1152. Тест на 24 кГц и ловит эту подмену.
 */

describe("заголовок кадра", () => {
  it("на 24 кГц читается как MPEG-2: 576 отсчётов", () => {
    const mp3 = silenceMp3(1, 24000, 64);
    const frame = readFrame(mp3, 0);

    expect(frame).not.toBeNull();
    expect(frame!.sampleRate).toBe(24000);
    // Та самая разница. Будь здесь 1152, длительность вышла бы вдвое меньше.
    expect(frame!.samples).toBe(576);
  });

  it("на 44,1 кГц — как MPEG-1: 1152 отсчёта", () => {
    const mp3 = silenceMp3(1, 44100, 64);
    const frame = readFrame(mp3, 0);

    expect(frame!.sampleRate).toBe(44100);
    expect(frame!.samples).toBe(1152);
  });

  it("на мусоре кадра не находит", () => {
    expect(readFrame(Buffer.from("не mp3 вовсе", "utf8"), 0)).toBeNull();
    expect(readFrame(Buffer.alloc(0), 0)).toBeNull();
    // Синхрослово есть, а слой не третий — это не наш кадр.
    expect(readFrame(Buffer.from([0xff, 0xfd, 0x90, 0x00]), 0)).toBeNull();
  });
});

describe("длительность", () => {
  for (const seconds of [1, 3, 7.5]) {
    it(`${seconds} с тишины считаются с точностью до 0,1 с`, () => {
      const measured = mp3Duration(silenceMp3(seconds, 24000, 64));
      expect(Math.abs(measured - seconds)).toBeLessThan(0.1);
    });
  }

  it("на разных частотах тоже", () => {
    for (const rate of [22050, 24000, 44100, 48000]) {
      const measured = mp3Duration(silenceMp3(4, rate, 64));
      expect(Math.abs(measured - 4), `частота ${rate}`).toBeLessThan(0.15);
    }
  });

  it("тег ID3 не считается звуком", () => {
    // В теге бывают байты 0xFF, и без пропуска тега они читались бы
    // как кадры — длительность выросла бы из ничего.
    const plain = silenceMp3(5, 24000, 64);
    const tagged = withId3(plain, { title: "Проверка", comment: "ы".repeat(400) });

    expect(tagged.byteLength).toBeGreaterThan(plain.byteLength);
    expect(Math.abs(mp3Duration(tagged) - mp3Duration(plain))).toBeLessThan(0.05);
  });

  it("склейка длится как сумма частей", () => {
    // На этом стоит вся затея: длительность куска в склейке равна
    // длительности куска по отдельности.
    const a = silenceMp3(2, 24000, 64);
    const b = silenceMp3(3, 24000, 64);
    const joined = Buffer.concat([a, b]);

    const sum = mp3Duration(a) + mp3Duration(b);
    expect(Math.abs(mp3Duration(joined) - sum)).toBeLessThan(0.05);
  });

  it("на пустом и на мусоре — ноль, а не бесконечность", () => {
    expect(mp3Duration(Buffer.alloc(0))).toBe(0);
    expect(mp3Duration(Buffer.from("совсем не звук", "utf8"))).toBe(0);
  });
});
