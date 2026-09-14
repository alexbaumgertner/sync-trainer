import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { extractDocument, kindOf } from "@/lib/extract";

/**
 * Требование F2. Документы собираем прямо здесь: тест не должен зависеть
 * от внешних файлов, а секретные материалы в репозиторий класть нельзя.
 */

const SECRET = "гендерное равенство под давлением";

async function makeDocx(text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.folder("_rels")!.file(
    ".rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.folder("word")!.file(
    "document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

async function makePptx(slides: string[]): Promise<Buffer> {
  const zip = new JSZip();
  const folder = zip.folder("ppt")!.folder("slides")!;
  slides.forEach((text, index) => {
    folder.file(
      `slide${index + 1}.xml`,
      `<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    );
  });
  return zip.generateAsync({ type: "nodebuffer" });
}

async function makePdf(pages: number): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pages; i++) pdf.addPage([595, 842]);
  return Buffer.from(await pdf.save());
}

describe("определение типа", () => {
  it("узнаёт по MIME", () => {
    expect(kindOf("application/pdf", "x")).toBe("pdf");
    expect(
      kindOf(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "x",
      ),
    ).toBe("docx");
  });

  it("узнаёт по расширению, когда браузер прислал octet-stream", () => {
    expect(kindOf("application/octet-stream", "note.pptx")).toBe("pptx");
  });

  it("отвергает посторонние форматы", () => {
    expect(kindOf("image/png", "picture.png")).toBeNull();
    expect(kindOf("text/plain", "notes.txt")).toBeNull();
  });
});

describe("извлечение", () => {
  it("достаёт текст из DOCX", async () => {
    const result = await extractDocument(await makeDocx(SECRET), "docx");
    expect(result.text).toContain(SECRET);
    expect(result.pdfBytes).toBeNull();
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("достаёт текст из PPTX по слайдам и в правильном порядке", async () => {
    const result = await extractDocument(
      await makePptx(["Первый слайд", "Второй слайд", "Третий слайд"]),
      "pptx",
    );
    expect(result.text.indexOf("Первый")).toBeLessThan(result.text.indexOf("Второй"));
    expect(result.text.indexOf("Второй")).toBeLessThan(result.text.indexOf("Третий"));
    expect(result.pages).toBe(3);
  });

  it("у PDF считает страницы и не разбирает текст сам", async () => {
    const result = await extractDocument(await makePdf(7), "pdf");
    expect(result.pages).toBe(7);
    expect(result.text).toBe("");
    // Байты остаются для модели — она читает PDF лучше любого парсера
    expect(result.pdfBytes).not.toBeNull();
  });

  it("битый файл не роняет обработку", async () => {
    const junk = Buffer.from("это вообще не документ");
    await expect(extractDocument(junk, "pdf")).resolves.toMatchObject({ pages: null });
  });
});
