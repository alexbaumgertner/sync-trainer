// Без пометки server-only: разбор текста чистый, его гоняют и тесты.

/**
 * Разбор строк с недостающими терминами (E2).
 *
 * Пишет это человек сразу после события, усталый, в свободной форме. Значит
 * разделитель может быть любым из привычных — тире, дефис, двоеточие, — а
 * может и не быть вовсе: тогда термин записан, а перевод человек подставит
 * позже. Терять такую строку нельзя, это самые ценные термины из всех:
 * они добыты в бою, а не предложены моделью.
 */

export interface ParsedTerm {
  source: string;
  target: string | null;
}

/** Длинное тире, короткое тире, дефис с пробелами, двоеточие, табуляция. */
const SEPARATOR = /\s+[—–]\s+|\s+-\s+|\s*:\s+|\t+/;

export function parseMissingTerms(input: string): ParsedTerm[] {
  const seen = new Set<string>();
  const terms: ParsedTerm[] = [];

  for (const line of input.split(/\r?\n/)) {
    // Маркеры списка человек ставит машинально — они не часть термина.
    const clean = line.trim().replace(/^[-*•·]\s+/, "").trim();
    if (!clean) continue;

    const match = SEPARATOR.exec(clean);
    const source = (match ? clean.slice(0, match.index) : clean).trim();
    const target = match ? clean.slice(match.index + match[0].length).trim() : "";
    if (!source) continue;

    // Один и тот же термин, записанный дважды, — это одна строка в глоссарии.
    const key = source.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    terms.push({ source, target: target || null });
  }

  return terms;
}
