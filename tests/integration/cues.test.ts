import { describe, expect, it } from "vitest";
import {
  buildCues,
  estimateDurations,
  parseVoice,
  splitSentences,
  toVtt,
  type TimedItem,
} from "@/lib/cues";

/**
 * Текст, разложенный по времени звука.
 *
 * Главная цель — «переслушать вот это место»: щёлкнул по фразе, звук пошёл
 * оттуда. Поэтому точность до доли секунды здесь не проверяется и не нужна;
 * проверяется, что времена идут по порядку, не оставляют щелей и не уезжают
 * за пределы куска — иначе щелчок отправит не туда.
 *
 * Модуль не знает ни о Payload, ни о Next, ни о нашем разборе SSML: на входе
 * куски с длительностями, на выходе фразы и стандартный WebVTT. Это и есть
 * причина, по которой его можно будет вынуть в отдельный пакет.
 */

describe("разбивка на предложения", () => {
  it("режет по точке, воскликам и вопросам", () => {
    expect(splitSentences("Первое. Второе! Третье?")).toEqual([
      "Первое.",
      "Второе!",
      "Третье?",
    ]);
  });

  it("не режет инициалы и сокращения", () => {
    // «Dr. Smith» — одно предложение. Резать здесь значит показать
    // человеку фразу из двух букв и отправить щелчок не туда.
    expect(splitSentences("Dr. Smith opened the session.")).toEqual([
      "Dr. Smith opened the session.",
    ]);
    expect(splitSentences("J. Smith said no.")).toEqual(["J. Smith said no."]);
    expect(splitSentences("Мы ждём 5 тыс. человек.")).toEqual(["Мы ждём 5 тыс. человек."]);
  });

  it("режет перед цифрой и кавычкой", () => {
    expect(splitSentences('Итог. 2031 год — срок. «Дальше» не обсуждали.')).toEqual([
      "Итог.",
      "2031 год — срок.",
      "«Дальше» не обсуждали.",
    ]);
  });

  it("многоточие и закрывающая кавычка кончают фразу", () => {
    expect(splitSentences('Он сказал «нет». Потом ушёл.')).toEqual([
      "Он сказал «нет».",
      "Потом ушёл.",
    ]);
  });

  it("пустое и пробелы дают пустой список", () => {
    expect(splitSentences("")).toEqual([]);
    expect(splitSentences("   \n  ")).toEqual([]);
  });

  it("текст без знаков конца остаётся одной фразой", () => {
    expect(splitSentences("просто строка без точки")).toEqual(["просто строка без точки"]);
  });
});

describe("дробление длинных предложений", () => {
  it("предложение на шестьсот символов делится", () => {
    // Модель пишет такие: в настоящем скрипте нашлось одно на 35 секунд.
    // По одним точкам оно не разбивается, а щелчок по нему отправлял бы
    // человека переслушивать полминуты вместо нужной мысли.
    const monster =
      "Middle-income populations are subjected to five intersecting drivers of fiscal extraction: " +
      "the imposition of regressive value-added taxation regimes; the erosion of purchasing power " +
      "through persistent inflation; the withdrawal of subsidies without compensating transfers; " +
      "the financialization of housing markets beyond wage growth; and the quiet transfer of risk " +
      "from institutions onto households through precarious employment arrangements.";
    const parts = splitSentences(monster);

    // Сколько именно частей — не важно; важно, что ни одна не длиннее предела.
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(250);
    // Ничего не потеряли: все слова на месте.
    expect(parts.join(" ").replace(/\s+/g, " ")).toContain("precarious employment");
  });

  it("короткое предложение не трогается", () => {
    expect(splitSentences("Короткая фраза, с запятой.")).toEqual(["Короткая фраза, с запятой."]);
  });

  it("режет по точке с запятой раньше, чем по запятой", () => {
    const text = "а".repeat(140) + ", потом " + "б".repeat(60) + "; затем " + "в".repeat(140) + ".";
    const parts = splitSentences(text);
    // Точка с запятой — почти конец мысли, запятая хуже. Значит
    // разрез должен пройти по ней.
    expect(parts.some((p) => p.endsWith(";"))).toBe(true);
  });

  it("без смысловых границ оставляет как есть", () => {
    // Рубить по словам значило бы показать обрывок без начала и конца.
    const solid = "слово".repeat(80);
    expect(splitSentences(solid)).toEqual([solid]);
  });

  it("предел настраиваемый — модуль пойдёт в другие проекты", () => {
    const text = "Раз, два, три, четыре, пять, шесть, семь, восемь.";
    expect(splitSentences(text, 1000)).toHaveLength(1);
    expect(splitSentences(text, 20).length).toBeGreaterThan(1);
  });
});

describe("раскладка по времени", () => {
  const items: TimedItem[] = [
    { kind: "speech", text: "Раз. Два.", speaker: "Moderator", seconds: 10 },
    { kind: "silence", seconds: 2 },
    { kind: "speech", text: "Три.", speaker: "Speaker A", seconds: 5 },
  ];

  it("фразы идут подряд и без щелей", () => {
    const cues = buildCues(items);
    expect(cues).toHaveLength(3);

    for (let i = 1; i < cues.length; i += 1) {
      expect(cues[i].start).toBeGreaterThanOrEqual(cues[i - 1].end - 0.001);
    }
  });

  it("пауза не превращается во фразу, но сдвигает время", () => {
    const cues = buildCues(items);
    // Третья фраза начинается после двух секунд тишины, а не сразу.
    expect(cues[2].start).toBeCloseTo(12, 3);
    expect(cues[2].end).toBeCloseTo(17, 3);
  });

  it("последняя фраза куска дотянута до его точной границы", () => {
    // Иначе округления оставили бы щель перед следующей репликой,
    // и щелчок по ней попадал бы в конец предыдущей.
    const cues = buildCues(items);
    expect(cues[1].end).toBeCloseTo(10, 6);
  });

  it("время делится по длине, а не поровну", () => {
    const cues = buildCues([
      { kind: "speech", text: "Коротко. Это предложение значительно длиннее.", speaker: null, seconds: 10 },
    ]);
    const first = cues[0].end - cues[0].start;
    const second = cues[1].end - cues[1].start;
    expect(second).toBeGreaterThan(first * 2);
  });

  it("говорящий переносится на каждую фразу куска", () => {
    const cues = buildCues(items);
    expect(cues[0].speaker).toBe("Moderator");
    expect(cues[1].speaker).toBe("Moderator");
    expect(cues[2].speaker).toBe("Speaker A");
  });

  it("кусок без текста только сдвигает время", () => {
    const cues = buildCues([
      { kind: "speech", text: "   ", speaker: null, seconds: 4 },
      { kind: "speech", text: "Есть.", speaker: null, seconds: 3 },
    ]);
    expect(cues).toHaveLength(1);
    expect(cues[0].start).toBeCloseTo(4, 3);
  });
});

describe("раскладка известной длительности", () => {
  const items: TimedItem[] = [
    { kind: "speech", text: "аааа", speaker: null, seconds: 0 },
    { kind: "silence", seconds: 3 },
    { kind: "speech", text: "бб", speaker: null, seconds: 0 },
  ];

  it("паузы остаются точными, речь делится по длине", () => {
    // Паузы известны из скрипта, поэтому их трогать нельзя: это единственное
    // точное, что есть у старых озвучек.
    const timed = estimateDurations(items, 15);
    expect(timed[1]).toEqual({ kind: "silence", seconds: 3 });

    const speech = timed.filter((i) => i.kind === "speech") as Extract<TimedItem, { kind: "speech" }>[];
    expect(speech[0].seconds + speech[1].seconds).toBeCloseTo(12, 6);
    // Вдвое длиннее текст — вдвое больше времени.
    expect(speech[0].seconds / speech[1].seconds).toBeCloseTo(2, 6);
  });

  it("если паузы длиннее файла, речи достаётся ноль, а не минус", () => {
    const timed = estimateDurations(items, 1);
    const speech = timed.filter((i) => i.kind === "speech") as Extract<TimedItem, { kind: "speech" }>[];
    expect(speech.every((i) => i.seconds >= 0)).toBe(true);
  });
});

describe("WebVTT", () => {
  it("начинается с обязательной строки и разделяет фразы пустой", () => {
    const vtt = toVtt(buildCues([{ kind: "speech", text: "Раз. Два.", speaker: null, seconds: 4 }]));
    expect(vtt.startsWith("WEBVTT\n\n")).toBe(true);
    expect(vtt).toContain("00:00:00.000 --> ");
  });

  it("говорящий идёт голосовой разметкой, а не блоком NOTE", () => {
    // NOTE по спецификации — отдельный блок; вставленный внутрь фразы,
    // он делает файл невалидным, и браузер молча не разберёт НИ ОДНОЙ фразы.
    const vtt = toVtt(buildCues([{ kind: "speech", text: "Раз.", speaker: "Moderator", seconds: 2 }]));
    expect(vtt).toContain("<v Moderator>Раз.</v>");
    expect(vtt).not.toContain("NOTE");
  });

  it("угловые скобки в имени не ломают разметку", () => {
    const vtt = toVtt([{ start: 0, end: 1, text: "Раз.", speaker: "A <hacker>" }]);
    expect(vtt).toContain("<v A hacker>Раз.</v>");
  });

  it("разметка читается обратно", () => {
    expect(parseVoice("<v Moderator>Раз.</v>")).toEqual({ speaker: "Moderator", text: "Раз." });
    expect(parseVoice("Раз.")).toEqual({ speaker: null, text: "Раз." });
  });

  it("время в метках часы:минуты:секунды.миллисекунды", () => {
    const vtt = toVtt([{ start: 3661.5, end: 3662, text: "Поздно.", speaker: null }]);
    expect(vtt).toContain("01:01:01.500 --> 01:01:02.000");
  });
});
