import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Критерий приёмки T07: десять генераций подряд разбираются без ошибки.
 *
 * Настоящий API не зовём: это деньги и ключ, которого в тестах нет. Проверяем
 * то, что ломается на практике, — разбор ответа, включая кривые варианты,
 * которые модель иногда отдаёт вопреки схеме.
 */

const generateContent = vi.fn();

vi.mock("@google/genai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@google/genai")>();
  return {
    ...actual,
    GoogleGenAI: class {
      models = { generateContent };
    },
  };
});

process.env.GEMINI_API_KEY ||= "test-key";

const { generateScript, scriptToMarkdown, glossaryToCsv } = await import("@/lib/script-generation");
const { presetById } = await import("@/presets");
const { estimateCostUsd } = await import("@/lib/gemini");

const preset = presetById("un")!;
const params = {
  sourceLang: "en",
  targetLang: "ru",
  durationMin: 20,
  speakers: 5,
  termDensity: 40,
  traps: ["enumeration"] as const,
  rate: "105%",
};

// Собираем отдельно: экранирование кавычек внутри шаблонной строки
// слишком легко сломать, а читать такое невозможно.
const BREAK = '<break time="1.5s"/>';
const SSML_OK =
  '<speak><prosody rate="105%">' + ("<p>text</p>" + BREAK).repeat(14) + "</prosody></speak>";

const goodScript = (n: number) => ({
  title: `Панель ${n}`,
  speakers: ["Moderator", "Researcher", "NGO Representative", "Youth Activist", "Donor"],
  segments: Array.from({ length: 14 }, (_, i) => ({
    speaker: ["Moderator", "Researcher", "NGO Representative", "Youth Activist", "Donor"][i % 5],
    timecode: `0${Math.floor(i * 1.4)}:00`.slice(-5),
    text: "word ".repeat(150).trim(),
  })),
  ssml: SSML_OK,
  glossary: Array.from({ length: 42 }, (_, i) => ({ source: `term${i}`, target: `термин${i}` })),
});

const reply = (payload: unknown, tokens = { promptTokenCount: 25000, candidatesTokenCount: 5000 }) => ({
  text: JSON.stringify(payload),
  usageMetadata: tokens,
});

beforeEach(() => generateContent.mockReset());

describe("разбор ответа", () => {
  it("десять генераций подряд разбираются без ошибки", async () => {
    for (let i = 0; i < 10; i++) {
      generateContent.mockResolvedValueOnce(reply(goodScript(i)));
      const outcome = await generateScript({ preset, params: { ...params, traps: ["enumeration"] } });
      expect(outcome.script.segments.length, `генерация ${i}`).toBe(14);
      expect(outcome.script.glossary.length, `генерация ${i}`).toBe(42);
      expect(outcome.warnings, `генерация ${i}`).toEqual([]);
    }
    expect(generateContent).toHaveBeenCalledTimes(10);
  });

  it("чинит SSML без внешнего speak, а не отклоняет генерацию", async () => {
    generateContent.mockResolvedValueOnce(
      reply({ ...goodScript(1), ssml: "<p>Первая реплика</p><p>Вторая</p>" }),
    );
    const outcome = await generateScript({ preset, params: { ...params, traps: [] } });
    expect(outcome.script.ssml.startsWith("<speak>")).toBe(true);
    expect(outcome.script.ssml).toContain('rate="105%"');
  });

  it("выбрасывает пустые реплики и половинчатые термины", async () => {
    generateContent.mockResolvedValueOnce(
      reply({
        ...goodScript(1),
        segments: [...goodScript(1).segments, { speaker: "X", timecode: "20:00", text: "   " }],
        glossary: [{ source: "ok", target: "хорошо" }, { source: "", target: "пусто" }],
      }),
    );
    const outcome = await generateScript({ preset, params: { ...params, traps: [] } });
    expect(outcome.script.segments).toHaveLength(14);
    expect(outcome.script.glossary).toHaveLength(1);
  });

  it("не-JSON в ответе даёт понятную ошибку", async () => {
    generateContent.mockResolvedValueOnce({ text: "Конечно! Вот ваш скрипт:" });
    await expect(generateScript({ preset, params: { ...params, traps: [] } })).rejects.toThrow(
      /не разобрался как JSON/,
    );
  });

  it("пустой ответ не выдаётся за успех", async () => {
    generateContent.mockResolvedValueOnce({ text: "" });
    await expect(generateScript({ preset, params: { ...params, traps: [] } })).rejects.toThrow(
      /пустой ответ/,
    );
  });
});

describe("замечания к результату", () => {
  it("сообщает о недоборе терминов, но не роняет генерацию", async () => {
    generateContent.mockResolvedValueOnce(
      reply({ ...goodScript(1), glossary: [{ source: "a", target: "а" }] }),
    );
    const outcome = await generateScript({ preset, params: { ...params, traps: [] } });
    expect(outcome.warnings.join(" ")).toContain("1 терминов вместо 40");
    expect(outcome.script.title).toBeTruthy();
  });

  it("замечает слишком короткий текст", async () => {
    generateContent.mockResolvedValueOnce(
      reply({ ...goodScript(1), segments: [{ speaker: "M", timecode: "00:00", text: "коротко" }] }),
    );
    const outcome = await generateScript({ preset, params: { ...params, traps: [] } });
    expect(outcome.warnings.join(" ")).toMatch(/минут вместо 20/);
  });

  it("замечает отсутствие SSML — без него синтеза не будет", async () => {
    generateContent.mockResolvedValueOnce(reply({ ...goodScript(1), ssml: "" }));
    const outcome = await generateScript({ preset, params: { ...params, traps: [] } });
    expect(outcome.warnings.join(" ")).toContain("не вернула SSML");
  });

  it("замечает куски SSML сверх лимита Google", async () => {
    const huge = `<speak><p>${"слово ".repeat(2000)}</p></speak>`;
    generateContent.mockResolvedValueOnce(reply({ ...goodScript(1), ssml: huge }));
    const outcome = await generateScript({ preset, params: { ...params, traps: [] } });
    // Нарезка сама дробит длинный абзац, поэтому предупреждения быть не должно
    expect(outcome.warnings.join(" ")).not.toContain("не влезают");
  });
});

describe("стоимость", () => {
  it("считается по токенам ответа", async () => {
    generateContent.mockResolvedValueOnce(
      reply(goodScript(1), { promptTokenCount: 100000, candidatesTokenCount: 20000 }),
    );
    const outcome = await generateScript({ preset, params: { ...params, traps: [] } });
    expect(outcome.costUsd).toBeCloseTo(estimateCostUsd(outcome.model, 100000, 20000), 9);
    expect(outcome.costUsd).toBeGreaterThan(0);
  });

  it("неизвестная модель считается по дорогому тарифу, а не по нулю", () => {
    expect(estimateCostUsd("совершенно-новая-модель", 1_000_000, 0)).toBeGreaterThan(0);
  });
});

describe("выгрузки", () => {
  it("Markdown помечает материал синтетическим", () => {
    const md = scriptToMarkdown(goodScript(1));
    expect(md).toContain("синтетический");
    expect(md).toContain("## Глоссарий");
  });

  it("CSV экранирует кавычки", () => {
    const csv = glossaryToCsv({
      ...goodScript(1),
      glossary: [{ source: 'the "gap"', target: "разрыв", note: "" }],
    });
    expect(csv.split("\n")[0]).toBe("source,target,note");
    expect(csv).toContain('"the ""gap"""');
  });
});
