/**
 * Разбор заголовка `Range` (RFC 9110, §14).
 *
 * Без поддержки диапазонов браузер НЕ УМЕЕТ перематывать звук: он просит
 * кусок с нужного места, получает в ответ весь файл с кодом 200 и делает
 * единственный доступный вывод — перемотка невозможна. Ползунок при этом
 * двигается, время меняется, а звук продолжает идти с прежнего места.
 * Ровно это и нашлось живым использованием.
 *
 * Разбираем сами, а не берём готовое: правил здесь на тридцать строк,
 * а зависимость пришлось бы тащить в серверный бандл.
 */

export type RangeResult =
  | { kind: "full" }
  | { kind: "partial"; start: number; end: number }
  /** Начало за концом файла: по спецификации это 416, а не «отдать всё» */
  | { kind: "unsatisfiable" };

export function parseRange(header: string | null, size: number): RangeResult {
  if (!header || size <= 0) return { kind: "full" };

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  // Несколько диапазонов в одном запросе (`bytes=0-99,200-299`) браузеры
  // для медиа не шлют. Отвечаем целым файлом — это разрешено и честнее,
  // чем собирать multipart ради случая, которого не бывает.
  if (!match) return { kind: "full" };

  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return { kind: "full" };

  if (rawStart === "") {
    // `bytes=-500` — последние 500 байт.
    const length = Number(rawEnd);
    if (!Number.isFinite(length) || length <= 0) return { kind: "unsatisfiable" };
    return { kind: "partial", start: Math.max(0, size - length), end: size - 1 };
  }

  const start = Number(rawStart);
  if (!Number.isFinite(start) || start >= size) return { kind: "unsatisfiable" };

  // `bytes=1000-` — от места и до конца.
  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (end < start) return { kind: "unsatisfiable" };

  return { kind: "partial", start, end };
}

export const contentRange = (start: number, end: number, size: number): string =>
  `bytes ${start}-${end}/${size}`;
