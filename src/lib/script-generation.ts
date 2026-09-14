// Без пометки server-only намеренно: модуль нужен и маршрутам, и скриптам.
import { Type } from "@google/genai";
import { gemini, modelName, estimateCostUsd } from "./gemini";
import { buildScriptPrompt, type PromptContext } from "./prompt";
import { parseScript, planChunks, GOOGLE_MAX_INPUT_BYTES } from "./ssml";

/**
 * Генерация скрипта.
 *
 * Ответ запрашивается по схеме (G1), а не свободным текстом: разбор
 * свободного ответа на скрипт, SSML и глоссарий ломается на первом же
 * неожиданном форматировании, а мы обещали десять генераций подряд
 * без единой ошибки разбора.
 */

export interface ScriptSegment {
  speaker: string;
  timecode: string;
  text: string;
}

export interface GlossaryItem {
  source: string;
  target: string;
  note?: string;
}

export interface ScriptResult {
  title: string;
  speakers: string[];
  segments: ScriptSegment[];
  ssml: string;
  glossary: GlossaryItem[];
}

export interface GenerationOutcome {
  script: ScriptResult;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Замечания о качестве ответа: не ошибки, но стоит показать человеку. */
  warnings: string[];
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, description: "Название панели на языке скрипта" },
    speakers: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Имена или роли говорящих в порядке появления",
    },
    segments: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          speaker: { type: Type.STRING },
          timecode: { type: Type.STRING, description: "мм:сс от начала" },
          text: { type: Type.STRING },
        },
        required: ["speaker", "timecode", "text"],
      },
    },
    glossary: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          source: { type: Type.STRING },
          target: { type: Type.STRING },
          note: { type: Type.STRING },
        },
        required: ["source", "target"],
      },
    },
  },
  required: ["title", "speakers", "segments", "glossary"],
} as const;

export interface GenerateArgs extends PromptContext {
  /** Байты PDF: модель читает документ сама, парсер его только испортил бы. */
  pdfBytes?: Buffer | null;
}

export async function generateScript(args: GenerateArgs): Promise<GenerationOutcome> {
  const prompt = buildScriptPrompt(args);
  const model = modelName();

  const parts: object[] = [];
  if (args.pdfBytes) {
    parts.push({
      inlineData: { mimeType: "application/pdf", data: args.pdfBytes.toString("base64") },
    });
  }
  parts.push({ text: prompt });

  const response = await gemini().models.generateContent({
    model,
    contents: [{ role: "user", parts }],
    config: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  const raw = response.text;
  if (!raw) throw new Error("Модель вернула пустой ответ.");

  let parsed: ScriptResult;
  try {
    parsed = JSON.parse(raw) as ScriptResult;
  } catch (error) {
    throw new Error(
      `Ответ модели не разобрался как JSON, хотя запрашивался по схеме: ${(error as Error).message}`,
    );
  }

  const script = normalize(parsed, args);
  const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;

  return {
    script,
    model,
    inputTokens,
    outputTokens,
    costUsd: estimateCostUsd(model, inputTokens, outputTokens),
    warnings: inspect(script, args),
  };
}

const escapeXml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Собираем SSML сами из реплик, а не берём у модели.
 *
 * Живой прогон показал, почему: модель вернула разметку без меток спикеров,
 * спикеры не распознались, и материал на пять минут озвучился одним голосом —
 * молча, без единой ошибки. У нас же есть структурированные реплики с автором
 * каждой, и собрать из них разметку надёжнее, чем просить об этом модель.
 *
 * Заодно снимается целый класс отказов: незакрытые теги, посторонние элементы,
 * потерянный <speak>. Модель отвечает за содержание, разметка — наша.
 */
function buildSsml(segments: ScriptSegment[], rate: string): string {
  const body = segments
    .map((segment) => {
      const speaker = segment.speaker?.trim();
      const text = escapeXml(segment.text.trim());
      // Метка спикера в тексте — то, по чему нарезка распознаёт говорящего
      // и раздаёт голоса. В text-режиме она снимается перед синтезом.
      return `<p>${speaker ? `${escapeXml(speaker)}: ` : ""}${text}</p>`;
    })
    .join('<break time="1.5s"/>');

  return `<speak><prosody rate="${escapeXml(rate)}">${body}</prosody></speak>`;
}

/** Приводим ответ к пригодному виду, не доверяя модели на слово. */
function normalize(parsed: ScriptResult, args: GenerateArgs): ScriptResult {
  const segments = (parsed.segments ?? []).filter((s) => s?.text?.trim());
  const glossary = (parsed.glossary ?? []).filter((g) => g?.source?.trim() && g?.target?.trim());

  return {
    title: parsed.title?.trim() || "Без названия",
    speakers: (parsed.speakers ?? []).filter(Boolean),
    segments,
    ssml: segments.length ? buildSsml(segments, args.params.rate) : "",
    glossary,
  };
}

/**
 * Замечания к результату. Не ошибки: генерация уже оплачена, отклонять её
 * из-за недобора терминов было бы расточительством. Но человек должен видеть,
 * что получил не то, что просил.
 */
function inspect(script: ScriptResult, args: GenerateArgs): string[] {
  const warnings: string[] = [];
  const { params } = args;

  if (script.glossary.length < params.termDensity) {
    warnings.push(
      `В глоссарии ${script.glossary.length} терминов вместо ${params.termDensity}.`,
    );
  }

  const words = script.segments.reduce((sum, s) => sum + s.text.split(/\s+/).length, 0);
  const expected = params.durationMin * 100;
  if (words < expected * 0.7) {
    warnings.push(
      `Текста примерно на ${Math.round(words / 100)} минут вместо ${params.durationMin}.`,
    );
  }

  const speakers = new Set(script.segments.map((s) => s.speaker));
  if (speakers.size < Math.min(params.speakers, 2)) {
    warnings.push(`Говорящих оказалось ${speakers.size} вместо ${params.speakers}.`);
  }

  // G2 начинается уже здесь: если SSML не режется, синтез потом не пройдёт.
  if (script.ssml) {
    try {
      const parsedSsml = parseScript(script.ssml);
      const chunks = planChunks(parsedSsml.blocks, { rate: parsedSsml.rate });
      const oversized = chunks.filter((c) => c.bytes > GOOGLE_MAX_INPUT_BYTES);
      if (oversized.length) {
        warnings.push(`${oversized.length} кусков SSML не влезают в лимит Google.`);
      }
      if (!chunks.length) warnings.push("Из SSML не получилось ни одного куска для синтеза.");
    } catch (error) {
      warnings.push(`SSML не разбирается: ${(error as Error).message}`);
    }
  } else {
    warnings.push("Модель не вернула SSML — синтез будет недоступен.");
  }

  return warnings;
}

/** Скрипт в читаемый Markdown — его и кладём в файлы проекта. */
export function scriptToMarkdown(script: ScriptResult, synthetic = true): string {
  const lines = [`# ${script.title}`, ""];

  if (synthetic) {
    lines.push(
      "> Материал синтетический: он сгенерирован для тренировки перевода.",
      "> Цифры и факты в нём выдуманы и не могут служить источником.",
      "",
    );
  }

  for (const segment of script.segments) {
    lines.push(`**${segment.speaker}** · ${segment.timecode}`, "", segment.text, "");
  }

  if (script.glossary.length) {
    lines.push("## Глоссарий", "", "| Термин | Эквивалент | Замечание |", "|---|---|---|");
    for (const item of script.glossary) {
      lines.push(`| ${item.source} | ${item.target} | ${item.note ?? ""} |`);
    }
  }

  return lines.join("\n");
}

export function glossaryToCsv(script: ScriptResult): string {
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  return [
    "source,target,note",
    ...script.glossary.map((item) =>
      [item.source, item.target, item.note ?? ""].map(escape).join(","),
    ),
  ].join("\n");
}
