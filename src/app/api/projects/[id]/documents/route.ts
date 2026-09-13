import { NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { currentUser } from "@/lib/auth";
import { payloadClient } from "@/lib/payload";
import { extractDocument, kindOf, MAX_UPLOAD_BYTES } from "@/lib/extract";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Обработка загруженного документа.
 *
 * Требования F1–F2. Оригинал удаляется сразу после разбора, извлечённый текст
 * никуда не пишется: в базу попадают только метаданные и его длина.
 *
 * Два пути входа. На Vercel файл приезжает в Blob из браузера, и сюда приходит
 * только путь к нему. Локально, где предела в 4.5 МБ нет, файл можно прислать
 * прямо в теле запроса — тогда он вообще нигде не сохраняется.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Нужно войти." }, { status: 401 });

  const { id } = await params;
  const payload = await payloadClient();

  const project = await payload
    .findByID({ collection: "projects", id: Number(id), depth: 0, overrideAccess: true })
    .catch(() => null);
  const ownerId = typeof project?.owner === "object" ? project.owner?.id : project?.owner;
  if (!project || ownerId !== user.id) {
    return NextResponse.json({ error: "Проект не найден." }, { status: 404 });
  }

  let buffer: Buffer;
  let filename: string;
  let mime: string;
  let blobUrl: string | null = null;

  const contentType = request.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("application/json")) {
      const body = (await request.json()) as { url?: string; pathname?: string };
      if (!body.url) {
        return NextResponse.json({ error: "Не передан адрес загруженного файла." }, { status: 400 });
      }
      blobUrl = body.url;
      const response = await fetch(body.url);
      if (!response.ok) {
        return NextResponse.json({ error: "Загруженный файл недоступен." }, { status: 400 });
      }
      buffer = Buffer.from(await response.arrayBuffer());
      filename = (body.pathname ?? body.url).split("/").pop() ?? "document";
      mime = response.headers.get("content-type") ?? "application/octet-stream";
    } else {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "Файл не передан." }, { status: 400 });
      }
      buffer = Buffer.from(await file.arrayBuffer());
      filename = file.name;
      mime = file.type;
    }
  } catch (error) {
    return NextResponse.json(
      { error: "Не удалось прочитать файл.", detail: (error as Error).message },
      { status: 400 },
    );
  }

  /** F1: оригинал уходит из хранилища и при успехе, и при ошибке. */
  const purgeOriginal = async () => {
    if (!blobUrl) return;
    await del(blobUrl).catch((error: unknown) => {
      console.error("[documents] не удалось удалить оригинал", error);
    });
  };

  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    await purgeOriginal();
    return NextResponse.json({ error: "Файл больше 25 МБ." }, { status: 413 });
  }

  const kind = kindOf(mime, filename);
  if (!kind) {
    await purgeOriginal();
    return NextResponse.json(
      { error: "Поддерживаются PDF, DOCX и PPTX." },
      { status: 415 },
    );
  }

  try {
    const extracted = await extractDocument(buffer, kind);

    // В базу идут только метаданные. Ни текста, ни байтов исходника (F2).
    const document = await payload.create({
      collection: "documents",
      data: {
        project: project.id,
        filename,
        mime,
        bytes: buffer.byteLength,
        sha256: extracted.sha256,
        pages: extracted.pages,
        extractedChars: extracted.kind === "pdf" ? null : extracted.text.length,
        purgedAt: new Date().toISOString(),
      },
      overrideAccess: true,
    });

    await purgeOriginal();

    return NextResponse.json({
      id: document.id,
      filename,
      kind: extracted.kind,
      pages: extracted.pages,
      extractedChars: extracted.kind === "pdf" ? null : extracted.text.length,
    });
  } catch (error) {
    await purgeOriginal();
    console.error("[documents] обработка не удалась", error);
    return NextResponse.json(
      { error: "Не удалось разобрать документ.", detail: (error as Error).message },
      { status: 422 },
    );
  }
}
