import { describe, expect, it } from "vitest";

const { speakingRateFrom, validateForSynthesis } = await import("@/lib/ssml");

const SSML = (rate: string | null, body: string) =>
  rate ? `<speak><prosody rate="${rate}">${body}</prosody></speak>` : `<speak>${body}</speak>`;

const BODY = "<p>Moderator: Good morning, colleagues.</p><p>Researcher: Thank you, chair.</p>";

describe("темп из <prosody rate>", () => {
  it("переводится в множитель для audioConfig", () => {
    expect(speakingRateFrom("105%")).toBeCloseTo(1.05, 5);
    expect(speakingRateFrom("80%")).toBeCloseTo(0.8, 5);
  });

  it("100% и отсутствие темпа не передаются вовсе", () => {
    // Лишний параметр — лишний повод для отказа у голоса, который его не примет.
    expect(speakingRateFrom("100%")).toBeUndefined();
    expect(speakingRateFrom(null)).toBeUndefined();
    expect(speakingRateFrom("чепуха")).toBeUndefined();
    expect(speakingRateFrom("0%")).toBeUndefined();
  });

  it("подрезается к пределам Google, а не уходит в отказ", () => {
    // Google принимает 0.25–4.0 и отказывает за границами. Отказ приходит
    // на середине оплаченного синтеза, поэтому подрезаем заранее.
    expect(speakingRateFrom("900%")).toBe(4);
    expect(speakingRateFrom("5%")).toBe(0.25);
  });

  it("проверка разметки отдаёт темп наружу — иначе он теряется при срезке тегов", () => {
    expect(validateForSynthesis(SSML("105%", BODY), { format: "text" }).rate).toBe("105%");
    expect(validateForSynthesis(SSML(null, BODY), { format: "text" }).rate).toBeNull();
  });
});

describe("оценка длительности", () => {
  it("совпадает с боевым замером в пределах процента", () => {
    // Живой прогон 14 сентября: 18195 символов речи, 13 пауз по 1.5 с,
    // темп 105%. Файл вышел на 1118 с, но темп тогда до голоса не доехал,
    // то есть речь звучала на 100%. С применённым темпом это 1065 с.
    // Тест держит константу CHARS_PER_SECOND: если её подвинут на глаз,
    // расхождение с реальным файлом вылезет здесь, а не у пользователя.
    const body = `<p>${"x".repeat(18195)}</p>` + '<break time="1.5s"/>'.repeat(13);
    const result = validateForSynthesis(SSML("105%", body), { format: "text" });

    const measured = 1098 / 1.05 + 19.5;
    expect(result.estimatedSeconds).toBeGreaterThan(measured * 0.99);
    expect(result.estimatedSeconds).toBeLessThan(measured * 1.01);
  });
});
