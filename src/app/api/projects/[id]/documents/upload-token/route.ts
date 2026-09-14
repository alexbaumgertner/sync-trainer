import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { currentUser } from "@/lib/auth";
import { payloadClient } from "@/lib/payload";
import { ACCEPTED, MAX_UPLOAD_BYTES } from "@/lib/extract";

export const runtime = "nodejs";

/**
 * Токен для загрузки файла прямо из браузера в Blob.
 *
 * Нужен потому, что тело запроса к функции Vercel ограничено 4.5 МБ, а
 * конференционный PDF бывает и на 20. Через сервер такой файл не пройдёт,
 * поэтому браузер кладёт его в хранилище сам, а сервер получает только путь.
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

  try {
    const result = await handleUpload({
      request,
      body: (await request.json()) as HandleUploadBody,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: Object.keys(ACCEPTED),
        maximumSizeInBytes: MAX_UPLOAD_BYTES,
        addRandomSuffix: true,
        // Токен действует минуты, а не бессрочно: он даёт право записи.
        validUntil: Date.now() + 10 * 60 * 1000,
        tokenPayload: JSON.stringify({ projectId: project.id, userId: user.id }),
      }),
      onUploadCompleted: async () => {
        // Обработка запускается отдельным запросом от клиента: сюда Vercel
        // достучится только на публичном адресе, а на localhost — нет.
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
