import { beforeEach, describe, expect, it, vi } from "vitest";
import { forLanguage, listVoicesCached, resetVoiceCache } from "@/lib/voice-catalogue";

/**
 * Кэш каталога голосов (П2 аудита).
 *
 * Маршрут ходил в Google на каждый запрос, хотя каталог меняется раз в месяц.
 * Проверяется не «кэш есть», а три его свойства, каждое из которых легко
 * потерять: в Google не ходим дважды, по истечении суток ходим, и при отказе
 * Google отдаём прошлый список, а не запасной.
 */

const DAY = 24 * 60 * 60 * 1000;

const catalogue = [
  { name: "en-US-Chirp3-HD-Aoede", languageCodes: ["en-US"], ssmlGender: "FEMALE" },
  { name: "en-GB-Neural2-A", languageCodes: ["en-GB"], ssmlGender: "FEMALE" },
  { name: "de-DE-Neural2-B", languageCodes: ["de-DE"], ssmlGender: "MALE" },
];

beforeEach(() => resetVoiceCache());

describe("походы в Google", () => {
  it("второй запрос обслуживается кэшем", async () => {
    const fetchVoices = vi.fn(async () => catalogue);

    const first = await listVoicesCached(fetchVoices);
    const second = await listVoicesCached(fetchVoices);

    expect(fetchVoices).toHaveBeenCalledTimes(1);
    expect(first.source).toBe("google");
    expect(second.source).toBe("cache");
    expect(second.voices).toHaveLength(3);
  });

  it("разные языки не заставляют ходить заново", async () => {
    // Отбор по языку идёт ПОСЛЕ кэша: иначе восемь языков — восемь походов
    // и восемь почти одинаковых копий одного и того же списка.
    const fetchVoices = vi.fn(async () => catalogue);

    const all = await listVoicesCached(fetchVoices);
    await listVoicesCached(fetchVoices);

    expect(fetchVoices).toHaveBeenCalledTimes(1);
    expect(forLanguage(all.voices, "en")).toHaveLength(2);
    expect(forLanguage(all.voices, "de")).toHaveLength(1);
  });

  it("через сутки список обновляется", async () => {
    const fetchVoices = vi.fn(async () => catalogue);

    const start = Date.now();
    await listVoicesCached(fetchVoices, start);
    await listVoicesCached(fetchVoices, start + DAY - 1000);
    expect(fetchVoices).toHaveBeenCalledTimes(1);

    await listVoicesCached(fetchVoices, start + DAY + 1000);
    expect(fetchVoices).toHaveBeenCalledTimes(2);
  });
});

describe("когда Google отказал", () => {
  it("отдаём прошлый список, а не запасной", async () => {
    const start = Date.now();
    await listVoicesCached(async () => catalogue, start);

    const failing = vi.fn(async () => {
      throw new Error("Google недоступен");
    });
    const result = await listVoicesCached(failing, start + DAY + 1000);

    // В прошлом списке настоящие голоса, которые у проекта уже могут быть
    // выбраны; в запасном — три штуки на все случаи жизни.
    expect(result.source).toBe("stale");
    expect(result.voices).toHaveLength(3);
    expect(result.voices.map((v) => v.name)).toContain("de-DE-Neural2-B");
  });

  it("следующий запрос пробует Google снова", async () => {
    const start = Date.now();
    await listVoicesCached(async () => catalogue, start);

    const failing = async () => {
      throw new Error("Google недоступен");
    };
    await listVoicesCached(failing, start + DAY + 1000);

    // Отметку времени при отказе не обновляли, поэтому кэш всё ещё просрочен
    // и попытка повторится — иначе один сбой замораживал бы список на сутки.
    const retry = vi.fn(async () => catalogue);
    await listVoicesCached(retry, start + DAY + 2000);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("если кэша ещё нет, ошибку не проглатываем", async () => {
    // Её ловит маршрут и показывает человеку, что случилось.
    await expect(
      listVoicesCached(async () => {
        throw new Error("Google недоступен");
      }),
    ).rejects.toThrow("Google недоступен");
  });
});
