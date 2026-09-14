import { describe, expect, it } from "vitest";
import JSZip from "jszip";

const { glossaryToCsv, glossaryToXlsx } = await import("@/lib/glossary-export");
type Row = Parameters<typeof glossaryToCsv>[0][number];

const LABELS = { source: "English", target: "Русский" };

const row = (over: Partial<Row> = {}): Row => ({
  source: "concessional finance",
  target: "льготное финансирование",
  note: "условия лучше рыночных",
  status: "verified",
  ...over,
});

/** Читает лист обратно: значения ячеек по строкам, как их увидит импортёр. */
async function readSheet(buffer: Buffer): Promise<string[][]> {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  return [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((r) =>
    [...r[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((c) =>
      c[1]
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&"),
    ),
  );
}

describe("XLSX для InterpretBank", () => {
  it("содержит ровно те части, которых ждёт читатель таблиц", async () => {
    const zip = await JSZip.loadAsync(await glossaryToXlsx([row()], LABELS));
    for (const part of [
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/worksheets/sheet1.xml",
    ]) {
      expect(zip.file(part), `нет части ${part}`).not.toBeNull();
    }
  });

  it("один лист: импортируется только первый", async () => {
    const zip = await JSZip.loadAsync(await glossaryToXlsx([row()], LABELS));
    const workbook = await zip.file("xl/workbook.xml")!.async("string");
    expect([...workbook.matchAll(/<sheet /g)]).toHaveLength(1);
  });

  it("три колонки, в первой строке названия языков", async () => {
    const sheet = await readSheet(await glossaryToXlsx([row()], LABELS));
    expect(sheet[0]).toEqual(["English", "Русский", "Info"]);
    expect(sheet[1]).toHaveLength(3);
    expect(sheet[1][0]).toBe("concessional finance");
    expect(sheet[1][1]).toBe("льготное финансирование");
  });

  it("непроверенный термин помечен, выверенный — нет", async () => {
    const sheet = await readSheet(
      await glossaryToXlsx(
        [
          row({ source: "graduation", status: "suggested", note: null }),
          row({ source: "headroom", status: "suggested", note: "запас капитала" }),
          row({ source: "basis points", status: "verified", note: "базисные пункты" }),
          row({ source: "relay", status: "from-practice", note: null }),
        ],
        LABELS,
      ),
    );
    expect(sheet[1][2]).toBe("не подтверждён");
    expect(sheet[2][2]).toBe("запас капитала · не подтверждён");
    expect(sheet[3][2]).toBe("базисные пункты");
    expect(sheet[4][2]).toBe("");
  });

  it("спецсимволы XML не ломают файл", async () => {
    const sheet = await readSheet(
      await glossaryToXlsx(
        [row({ source: 'R&D <"ключ">', target: "НИОКР & прочее", note: null })],
        LABELS,
      ),
    );
    expect(sheet[1][0]).toBe('R&D <"ключ">');
    expect(sheet[1][1]).toBe("НИОКР & прочее");
  });

  it("управляющие символы вычищаются — из-за одного файл не открылся бы", async () => {
    const dirty = "термин\u0007\u0000";
    const sheet = await readSheet(
      await glossaryToXlsx([row({ source: dirty, note: "строка\nвторая" })], LABELS),
    );
    expect(sheet[1][0]).toBe("термин");
    expect(sheet[1][2]).toBe("строка вторая");
    // Проверяем и байты: экранирование могло бы их спрятать, а не убрать.
    const zip = await JSZip.loadAsync(await glossaryToXlsx([row({ source: dirty })], LABELS));
    const xml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
        expect(xml).not.toMatch(/[\x00-\x08\x0B\x0C\x0E-\x1F]/);
  });

  it("пустой перевод не выбрасывает термин из выгрузки", async () => {
    const sheet = await readSheet(await glossaryToXlsx([row({ target: null })], LABELS));
    expect(sheet).toHaveLength(2);
    expect(sheet[1][1]).toBe("");
  });
});

describe("CSV", () => {
  it("начинается с BOM — иначе Excel съест кириллицу", () => {
    expect(glossaryToCsv([row()], LABELS).charCodeAt(0)).toBe(0xfeff);
  });

  it("несёт происхождение отдельной колонкой (D3)", () => {
    const csv = glossaryToCsv(
      [row({ status: "suggested" }), row({ source: "relay", status: "from-practice" })],
      LABELS,
    );
    const lines = csv.replace(/^﻿/, "").trimEnd().split("\r\n");
    expect(lines[0]).toBe('"English","Русский","Примечание","Происхождение"');
    expect(lines[1]).toContain('"предложен моделью"');
    expect(lines[2]).toContain('"из практики"');
  });

  it("кавычки в термине удваиваются, а не рвут строку", () => {
    const csv = glossaryToCsv([row({ source: 'так называемый "выпуск"' })], LABELS);
    expect(csv).toContain('"так называемый ""выпуск"""');
    expect(csv.trimEnd().split("\r\n")).toHaveLength(2);
  });
});
