// Без пометки server-only: модуль чистый, его гоняют и тесты, и маршрут.
import JSZip from "jszip";

/**
 * Выгрузка глоссария: CSV для человека и XLSX для InterpretBank.
 *
 * Почему XLSX, а не .tbx. У InterpretBank есть свой `.tbx` («Export glossary |
 * INTERPRETBANK (.tbx)»), но его строение нигде не описано, а сочинять чужой
 * формат вслепую — значит отдать переводчику файл, который не откроется.
 * Зато импорт из таблиц документирован и прост: «two or three columns
 * (language one and two and, optional, a short info column)», первый лист,
 * первая строка может содержать названия языков и отключается галочкой
 * «Exclude first row».
 *
 * Отсюда и форма файла: ровно три колонки, один лист, заголовок с названиями
 * языков — по нему InterpretBank определяет языки колонок.
 */

export interface GlossaryRow {
  source: string;
  target: string | null;
  note: string | null;
  status: "suggested" | "verified" | "from-practice";
  /** Запасные эквиваленты. В кабине они важнее примечания */
  variants?: string[];
}

export interface GlossaryLabels {
  /** название языка исходной речи, например «English» */
  source: string;
  /** название языка перевода, например «Русский» */
  target: string;
}

/**
 * Термин, предложенный моделью и никем не проверенный, в кабине опасен:
 * выглядит он ровно так же, как выверенный. Поэтому пометка едет в колонку
 * с примечанием — единственную, которую InterpretBank покажет рядом.
 */
const UNVERIFIED = "не подтверждён";

/**
 * Всё, что должно оказаться в единственной колонке примечаний.
 *
 * Варианты идут ПЕРВЫМИ, раньше примечания и пометки. В кабине читают по
 * диагонали и не дочитывают: если у термина есть второй эквивалент, увидеть
 * его надо в первую секунду, а не после оговорки о том, где он уместен.
 */
const infoFor = (row: GlossaryRow): string => {
  const parts: string[] = [];

  const variants = (row.variants ?? []).map((v) => v.trim()).filter(Boolean);
  if (variants.length) parts.push(`ещё: ${variants.join(" / ")}`);

  const note = row.note?.trim();
  if (note) parts.push(note);

  if (row.status === "suggested") parts.push(UNVERIFIED);

  return parts.join(" · ");
};

// ───────────────────────────── CSV ─────────────────────────────

const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;

const STATUS_CSV: Record<GlossaryRow["status"], string> = {
  suggested: "предложен моделью",
  verified: "подтверждён",
  "from-practice": "из практики",
};

/**
 * CSV несёт происхождение отдельной колонкой (D3): он для архива и для
 * человека, а не для импорта, и урезать его до трёх колонок незачем.
 *
 * Впереди BOM. Без него Excel на Windows читает UTF-8 как cp1251, и кириллица
 * превращается в кракозябры — а глоссарий у нас как раз русский.
 */
export function glossaryToCsv(rows: GlossaryRow[], labels: GlossaryLabels): string {
  // Колонок здесь не три, а пять: CSV для архива и для человека, и запасные
  // эквиваленты в нём стоят отдельно, а не свёрнуты в примечание. Сворачивать
  // приходится только в файле для InterpretBank — там колонок ровно три.
  const header = [labels.source, labels.target, "Примечание", "Происхождение", "Варианты"];
  const body = rows.map((row) =>
    [
      row.source,
      row.target ?? "",
      row.note ?? "",
      STATUS_CSV[row.status],
      (row.variants ?? []).join(" / "),
    ]
      .map(csvCell)
      .join(","),
  );
  return "﻿" + [header.map(csvCell).join(","), ...body].join("\r\n") + "\r\n";
}

// ───────────────────────────── XLSX ─────────────────────────────

const xmlEscape = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * XML таблицы не допускает управляющих символов, а они приезжают из документов
 * вместе с текстом. Один такой символ — и файл не открывается вовсе, поэтому
 * чистим до записи, а не надеемся, что их не будет. Табуляция и переводы строк
 * допустимы, но в ячейке из них толку нет — сводим к пробелу.
 */
const CONTROL = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
const WHITESPACE = /\s+/g;
const clean = (value: string) => value.replace(CONTROL, "").replace(WHITESPACE, " ").trim();

const COLUMNS = ["A", "B", "C"] as const;

const sheetRow = (index: number, cells: string[]): string => {
  const r = index + 1;
  const body = cells
    .map(
      (value, i) =>
        `<c r="${COLUMNS[i]}${r}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(clean(value))}</t></is></c>`,
    )
    .join("");
  return `<row r="${r}">${body}</row>`;
};

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const NS_CT = "http://schemas.openxmlformats.org/package/2006/content-types";

/**
 * Собираем таблицу вручную, без библиотеки: для плоского списка из трёх колонок
 * это пять коротких файлов в zip, а зависимость пришлось бы тащить и обновлять.
 * Строки пишутся как `inlineStr`, поэтому таблица общих строк не нужна вовсе.
 */
export async function glossaryToXlsx(
  rows: GlossaryRow[],
  labels: GlossaryLabels,
): Promise<Buffer> {
  const data = [
    sheetRow(0, [labels.source, labels.target, "Info"]),
    ...rows.map((row, i) => sheetRow(i + 1, [row.source, row.target ?? "", infoFor(row)])),
  ].join("");

  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `${XML}<Types xmlns="${NS_CT}">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `</Types>`,
  );
  zip.folder("_rels")!.file(
    ".rels",
    `${XML}<Relationships xmlns="${NS_PKG_REL}">` +
      `<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`,
  );

  const xl = zip.folder("xl")!;
  // Единственный лист: «only the first sheet of your Excel file will be imported».
  xl.file(
    "workbook.xml",
    `${XML}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
      `<sheets><sheet name="Glossary" sheetId="1" r:id="rId1"/></sheets>` +
      `</workbook>`,
  );
  xl.folder("_rels")!.file(
    "workbook.xml.rels",
    `${XML}<Relationships xmlns="${NS_PKG_REL}">` +
      `<Relationship Id="rId1" Type="${NS_REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
      `</Relationships>`,
  );
  xl.folder("worksheets")!.file(
    "sheet1.xml",
    `${XML}<worksheet xmlns="${NS_MAIN}"><sheetData>${data}</sheetData></worksheet>`,
  );

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
