// Без пометки server-only: модуль зовут маршрут и тесты.
import { Type } from "@google/genai";
import { gemini, modelName, estimateCostUsd } from "./gemini";
import { buildGlossaryPrompt, type GlossaryPromptContext } from "./prompt";

/**
 * Извлечение глоссария из материалов события (N2).
 *
 * Отдельный вызов модели, а не поле в ответе генерации скрипта. Разница не
 * техническая: пока термины приезжали прицепом к скрипту, выверка их руками
 * ни на что не влияла — скрипт уже был написан, а перегенерация выбрасывала
 * правки. Теперь порядок обратный, и глоссарий идёт первым.
 *
 * Ответ по схеме (G1), как и у скрипта: разбор свободного текста ломается
 * на первом же неожиданном форматировании.
 */

export interface GlossaryCandidate {
  source: string;
  target: string;
  note?: string;
}

export interface GlossaryOutcome {
  terms: GlossaryCandidate[];
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
    terms: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          source: { type: Type.STRING, description: "Исходная форма, как в документе" },
          target: { type: Type.STRING, description: "Эквивалент на языке перевода" },
          note: { type: Type.STRING, description: "Расшифровка, оговорка — можно пусто" },
        },
        required: ["source", "target"],
      },
    },
  },
  required: ["terms"],
} as const;

export interface ExtractGlossaryArgs extends GlossaryPromptContext {
  /** Байты PDF по одному на документ: их модель читает сама (N2а). */
  pdfFiles?: { filename: string; bytes: Buffer }[];
}

export async function extractGlossary(args: ExtractGlossaryArgs): Promise<GlossaryOutcome> {
  const prompt = buildGlossaryPrompt(args);
  const model = modelName();

  // Все документы одним запросом: термин, встреченный в двух презентациях,
  // должен попасть в глоссарий один раз, а для этого модель обязана видеть
  // событие целиком (N2а).
  const parts: object[] = [];
  for (const file of args.pdfFiles ?? []) {
    parts.push({
      inlineData: { mimeType: "application/pdf", data: file.bytes.toString("base64") },
    });
  }
  parts.push({ text: prompt });

  const response = await gemini().models.generateContent({
    model,
    contents: [{ role: "user", parts }],
    config: { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA },
  });

  const raw = response.text;
  if (!raw) throw new Error("Модель вернула пустой ответ.");

  let parsed: { terms?: GlossaryCandidate[] };
  try {
    parsed = JSON.parse(raw) as { terms?: GlossaryCandidate[] };
  } catch (error) {
    throw new Error(
      `Ответ модели не разобрался как JSON, хотя запрашивался по схеме: ${(error as Error).message}`,
    );
  }

  const terms = normalize(parsed.terms ?? []);
  const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;

  return {
    terms,
    model,
    inputTokens,
    outputTokens,
    costUsd: estimateCostUsd(model, inputTokens, outputTokens),
    warnings: inspect(terms, args),
  };
}

/**
 * Приводим ответ к пригодному виду, не доверяя модели на слово.
 *
 * Главное здесь — схлопывание повторов. Просьба «не дублируй» в промте
 * соблюдается не всегда, а два одинаковых термина в кабине читаются как
 * ошибка выверки: человек ищет, чем они различаются, и не находит.
 */
function normalize(raw: GlossaryCandidate[]): GlossaryCandidate[] {
  const seen = new Set<string>();
  const terms: GlossaryCandidate[] = [];

  for (const item of raw) {
    const source = item?.source?.trim();
    const target = item?.target?.trim();
    if (!source || !target) continue;

    const key = source.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    terms.push({ source, target, note: item.note?.trim() || undefined });
  }

  return terms;
}

/**
 * Замечания к результату. Не ошибки: вызов уже оплачен, и отклонять его
 * из-за недобора было бы расточительством. Но человек должен видеть, что
 * получил не то, что просил, — особенно здесь, где по глоссарию он потом
 * готовится.
 */
function inspect(terms: GlossaryCandidate[], args: ExtractGlossaryArgs): string[] {
  const warnings: string[] = [];

  if (terms.length < args.termTarget * 0.5) {
    warnings.push(
      `Модель нашла ${terms.length} терминов вместо примерно ${args.termTarget}. ` +
        "Возможно, в материалах мало терминологии — или их не удалось прочитать.",
    );
  }

  const withoutNote = terms.filter((term) => !term.note).length;
  if (terms.length > 0 && withoutNote === terms.length) {
    warnings.push("Ни у одного термина нет примечания — расшифровки аббревиатур проверьте сами.");
  }

  return warnings;
}
