import { describe, expect, it } from "vitest";
import { validateForSynthesis, GOOGLE_MAX_INPUT_BYTES } from "@/lib/ssml";
import { withId3, SYNTHETIC_NOTICE } from "@/lib/id3";

/**
 * Требования G2 и G5. Главное здесь — что негодная разметка отклоняется
 * ДО обращения к Google: отказ после оплаченного запроса бесполезен.
 */

const BREAK = '<break time="1.5s"/>';
const good = '<speak><prosody rate="105%">' + ("<p>Речь спикера.</p>" + BREAK).repeat(4) + "</prosody></speak>";

describe("проверка разметки до синтеза", () => {
  it("пропускает годную разметку и считает план", () => {
    const check = validateForSynthesis(good);
    expect(check.ok).toBe(true);
    expect(check.errors).toEqual([]);
    expect(check.plan.filter((i) => i.type === "speech").length).toBeGreaterThan(0);
    expect(check.billableChars).toBeGreaterThan(0);
  });

  it("отклоняет пустую разметку", () => {
    expect(validateForSynthesis("   ").ok).toBe(false);
    expect(validateForSynthesis("").errors.join(" ")).toContain("пуста");
  });

  it("отклоняет текст без speak", () => {
    const check = validateForSynthesis("<p>просто абзац</p>");
    expect(check.ok).toBe(false);
    expect(check.errors.join(" ")).toContain("<speak>");
  });

  it("отклоняет незакрытый тег", () => {
    const check = validateForSynthesis('<speak><prosody rate="105%"><p>текст</p></speak>');
    expect(check.ok).toBe(false);
    expect(check.errors.join(" ")).toMatch(/prosody.*открыт 1.*закрыт 0/);
  });

  it("отклоняет теги, которых Google не знает", () => {
    const check = validateForSynthesis("<speak><p>текст</p><marquee>бегущая строка</marquee></speak>");
    expect(check.ok).toBe(false);
    expect(check.errors.join(" ")).toContain("marquee");
  });

  it("длинный абзац не ошибка — нарезка его дробит", () => {
    const check = validateForSynthesis(`<speak><p>${"слово ".repeat(3000)}</p></speak>`);
    expect(check.ok).toBe(true);
    const speech = check.plan.filter((i) => i.type === "speech");
    expect(Math.max(...speech.map((i) => i.bytes))).toBeLessThanOrEqual(GOOGLE_MAX_INPUT_BYTES);
  });

  it("в text-режиме паузы становятся отдельными элементами плана", () => {
    const check = validateForSynthesis(good, { format: "text" });
    expect(check.ok).toBe(true);
    expect(check.plan.some((i) => i.type === "silence")).toBe(true);
  });
});

describe("пометка синтетического материала в файле", () => {
  const mp3 = Buffer.from([0xff, 0xf3, 0x84, 0xc4, 0x00, 0x00]);

  it("тег ID3 ставится перед аудио и не портит его", () => {
    const tagged = withId3(mp3, { title: "Панель", comment: SYNTHETIC_NOTICE });
    expect(tagged.subarray(0, 3).toString("latin1")).toBe("ID3");
    // Исходные байты на месте, в самом конце
    expect(tagged.subarray(tagged.length - mp3.length)).toEqual(mp3);
  });

  it("текст пометки читается из файла", () => {
    const tagged = withId3(mp3, { title: "Панель", comment: SYNTHETIC_NOTICE });
    // UTF-16LE: ищем подстроку в той же кодировке
    expect(tagged.includes(Buffer.from("синтетический", "utf16le"))).toBe(true);
    expect(tagged.includes(Buffer.from("Панель", "utf16le"))).toBe(true);
  });

  it("размер тега записан синхробезопасно и совпадает с содержимым", () => {
    const tagged = withId3(mp3, { title: "Панель", comment: SYNTHETIC_NOTICE });
    const size = tagged.subarray(6, 10);

    // Ни один байт размера не имеет старшего бита — иначе плееры прочтут мусор
    for (const byte of size) expect(byte & 0x80).toBe(0);

    const framesLength = (size[0] << 21) | (size[1] << 14) | (size[2] << 7) | size[3];
    // Заголовок 10 байт + кадры + исходное аудио
    expect(tagged.length).toBe(10 + framesLength + mp3.length);
  });
});
