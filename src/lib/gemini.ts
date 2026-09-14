// Без пометки server-only намеренно: модуль нужен и маршрутам, и скриптам.
import { GoogleGenAI } from "@google/genai";

/**
 * Клиент Gemini.
 *
 * Ключ отдельный от Text-to-Speech: там сервис-аккаунт, здесь ключ API.
 * Модель вынесена в переменную окружения — линейка обновляется быстрее,
 * чем мы будем выпускать релизы.
 */

export const DEFAULT_MODEL = "gemini-3.7-flash";

export const modelName = (): string => process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;

export const geminiConfigured = (): boolean => Boolean(process.env.GEMINI_API_KEY?.trim());

export const NO_GEMINI_KEY =
  "GEMINI_API_KEY не задан. Генерация скрипта отключена: включите Generative Language API " +
  "в проекте Google Cloud и создайте ключ.";

let client: GoogleGenAI | null = null;

export function gemini(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error(NO_GEMINI_KEY);
  client ??= new GoogleGenAI({ apiKey });
  return client;
}

/**
 * Цена за миллион токенов, USD. Ориентировочно — сверяйтесь с прайсом Google.
 * Неизвестная модель считается по самому дорогому известному тарифу: лучше
 * завысить оценку расхода, чем занизить и проскочить лимит.
 */
const PRICES: Record<string, { input: number; output: number }> = {
  "gemini-3.8-flash": { input: 0.75, output: 3.75 },
  "gemini-3.7-flash": { input: 0.75, output: 3.75 },
  "gemini-3.6-flash": { input: 0.75, output: 3.75 },
  "gemini-3.1-pro": { input: 2, output: 12 },
};

const FALLBACK_PRICE = { input: 2, output: 12 };

export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const price = PRICES[model] ?? FALLBACK_PRICE;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

/** Понятное объяснение типовых отказов. */
export function explainGeminiError(error: unknown): string {
  const message = (error as { message?: string })?.message ?? String(error);

  if (message.includes(NO_GEMINI_KEY)) return NO_GEMINI_KEY;
  if (/API key not valid|API_KEY_INVALID/i.test(message)) {
    return "Ключ Gemini недействителен. Проверьте GEMINI_API_KEY.";
  }
  if (/not found|NOT_FOUND|is not supported/i.test(message)) {
    return `Модель «${modelName()}» недоступна для этого ключа. Задайте другую в GEMINI_MODEL. Ответ Google: ${message}`;
  }
  if (/quota|RESOURCE_EXHAUSTED|429/i.test(message)) {
    return `Квота Gemini исчерпана. Ответ Google: ${message}`;
  }
  if (/SAFETY|blocked/i.test(message)) {
    return "Модель отказалась отвечать на этот материал. Попробуйте другой документ.";
  }
  return message;
}
