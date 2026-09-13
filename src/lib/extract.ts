// Без пометки server-only намеренно: модуль нужен и маршрутам, и скриптам.
import crypto from "node:crypto";

/**
 * Извлечение содержимого из загруженного документа.
 *
 * Требование F2: извлечённый текст никуда не сохраняется — он живёт только
 * в возвращаемом значении, пока идёт обработка. Наружу из этого модуля
 * попадают лишь метаданные, которые не раскрывают содержимого.
 *
 * PDF не разбираем: его понимает сама модель, и собственный парсер только
 * испортил бы вёрстку таблиц и колонок. Считаем только число страниц.
 */

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const ACCEPTED = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
} as const;

export type DocumentKind = (typeof ACCEPTED)[keyof typeof ACCEPTED];

export interface Extracted {
  kind: DocumentKind;
  /** Текст для модели. Для PDF пусто: документ уходит в модель целиком. */
  text: string;
  /** Байты исходника — нужны только для PDF, который читает сама модель. */
  pdfBytes: Buffer | null;
  pages: number | null;
  sha256: string;
}

export function kindOf(mime: string, filename: string): DocumentKind | null {
  const byMime = ACCEPTED[mime as keyof typeof ACCEPTED];
  if (byMime) return byMime;

  // Браузеры иногда присылают octet-stream — тогда смотрим на расширение.
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "pdf" || ext === "docx" || ext === "pptx") return ext;
  return null;
}

export async function extractDocument(
  buffer: Buffer,
  kind: DocumentKind,
): Promise<Extracted> {
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");

  if (kind === "pdf") {
    const { PDFDocument } = await import("pdf-lib");
    let pages: number | null = null;
    try {
      const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
      pages = pdf.getPageCount();
    } catch {
      // Битый или защищённый PDF: число страниц неизвестно, но отдать модели
      // его всё ещё можно — пусть решает она.
      pages = null;
    }
    return { kind, text: "", pdfBytes: buffer, pages, sha256 };
  }

  if (kind === "docx") {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer });
    return { kind, text: normalize(value), pdfBytes: null, pages: null, sha256 };
  }

  return { ...(await extractPptx(buffer)), sha256 };
}

/**
 * PPTX — это zip с XML слайдов; текст лежит в элементах <a:t>.
 * Отдельная библиотека ради этого не нужна и добавила бы зависимость,
 * которую пришлось бы поддерживать.
 */
async function extractPptx(buffer: Buffer): Promise<Omit<Extracted, "sha256">> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);

  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b));

  const slides: string[] = [];
  for (const name of slideNames) {
    const xml = await zip.files[name].async("string");
    const pieces = [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map((m) => unescapeXml(m[1]));
    const text = normalize(pieces.join(" "));
    if (text) slides.push(text);
  }

  return {
    kind: "pptx",
    text: slides.join("\n\n"),
    pdfBytes: null,
    pages: slideNames.length || null,
  };
}

const slideNumber = (name: string): number => Number(name.match(/slide(\d+)\.xml$/)?.[1] ?? 0);

const unescapeXml = (value: string): string =>
  value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

const normalize = (value: string): string =>
  value
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
