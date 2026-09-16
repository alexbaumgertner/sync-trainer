import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { payloadClient } from "@/lib/payload";
import { readArtifact } from "@/lib/artifacts";
import { insideProject } from "@/lib/artifact-path";
import { waveformFromMp3 } from "@/lib/waveform";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Форма волны для проигрывателя.
 *
 * Считается при первом обращении и запоминается в записи артефакта — дальше
 * маршрут отдаёт готовое. Так старые озвучки, сделанные до появления
 * проигрывателя, получают форму сами, без отдельного прохода по базе.
 *
 * Права проверяются ровно так же, как у выдачи файла, включая проверку пути:
 * отсюда читается тот же файл из хранилища, и послабление здесь открыло бы
 * ту же дыру с другой стороны.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Нужно войти." }, { status: 401 });

  const { id, fileId } = await params;
  const payload = await payloadClient();

  const artifact = await payload
    .findByID({
      collection: "artifacts",
      id: Number(fileId),
      depth: 0,
      user: { ...user, collection: "users" } as never,
      overrideAccess: false,
    })
    .catch(() => null);

  const projectId = typeof artifact?.project === "object" ? artifact.project?.id : artifact?.project;
  if (!artifact || projectId !== Number(id) || artifact.kind !== "audio") {
    return NextResponse.json({ error: "Файл не найден." }, { status: 404 });
  }

  if (!insideProject(artifact.blobPath, id)) {
    console.error("[peaks] путь артефакта вне проекта", { artifact: artifact.id, project: id });
    return NextResponse.json({ error: "Файл не найден." }, { status: 404 });
  }

  const stored = Array.isArray(artifact.peaks) ? (artifact.peaks as number[]) : null;
  if (stored?.length) {
    return NextResponse.json(
      { peaks: stored, durationSec: artifact.durationSec ?? null },
      // Форма волны неизменна для этого файла: пересчитывать её незачем,
      // а при перегенерации меняется и сам артефакт.
      { headers: { "Cache-Control": "private, max-age=86400" } },
    );
  }

  const body = await readArtifact(artifact.blobPath);
  if (!body) return NextResponse.json({ error: "Файл не найден." }, { status: 404 });

  try {
    const waveform = await waveformFromMp3(body);

    await payload.update({
      collection: "artifacts",
      id: artifact.id,
      data: { peaks: waveform.peaks, durationSec: waveform.durationSec },
      overrideAccess: true,
    });

    return NextResponse.json(waveform, {
      headers: { "Cache-Control": "private, max-age=86400" },
    });
  } catch (error) {
    // Без формы волны проигрыватель обязан работать: это украшение поверх
    // обычного <audio>, а не условие его работы.
    console.error("[peaks] не удалось построить форму волны", error);
    return NextResponse.json({ peaks: [], durationSec: null }, { status: 200 });
  }
}
