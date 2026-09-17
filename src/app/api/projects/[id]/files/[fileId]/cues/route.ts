import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { payloadClient } from "@/lib/payload";
import { readArtifact } from "@/lib/artifacts";
import { insideProject } from "@/lib/artifact-path";
import { buildCues, estimateDurations, toVtt, type TimedItem } from "@/lib/cues";
import { parseScript, planSynthesis, ssmlToSpoken } from "@/lib/ssml";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Карта времени: текст, разложенный по звуку, в формате WebVTT.
 *
 * Отдаётся браузеру через `<track kind="metadata">` — он разбирает формат
 * сам, поэтому разбора в коде нет вовсе.
 *
 * Два источника, и разница между ними существенная:
 *
 *  1. Точная карта, снятая при синтезе. Границы реплик известны по кадрам
 *     MP3 каждого куска; внутри реплики предложения раскладываются по длине,
 *     и ошибка не накапливается — на каждой следующей реплике отсчёт
 *     начинается заново.
 *  2. Приблизительная, собранная на ходу из скрипта и общей длительности.
 *     Нужна для озвучек, сделанных до появления карты. Здесь ошибка
 *     НАКАПЛИВАЕТСЯ: точных границ нет. Годится найти место и переслушать,
 *     не годится называться точной — поэтому ответ помечен заголовком.
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

  // Подрезаем только для проверки на пустоту: сам файл отдаём как есть,
  // чтобы он побайтово совпадал с тем, что сняли при синтезе.
  const stored = artifact.cuesVtt ?? "";
  if (stored.trim()) return vttResponse(stored, "exact");

  // Точной карты нет — собираем приблизительную из скрипта проекта.
  const estimated = await estimateFromScript(payload, Number(id), artifact.durationSec ?? null);
  if (!estimated) {
    return NextResponse.json({ error: "Карты времени нет." }, { status: 404 });
  }
  return vttResponse(estimated, "estimated");
}

const vttResponse = (vtt: string, precision: "exact" | "estimated") =>
  new Response(vtt, {
    headers: {
      "Content-Type": "text/vtt; charset=utf-8",
      // Материалы заказчика на диск браузера не кладём — как и сам звук.
      "Cache-Control": "private, no-store",
      // Чтобы страница могла честно сказать, точна подсветка или нет.
      "X-Cues-Precision": precision,
    },
  });

/**
 * Приблизительная карта из SSML-артефакта проекта.
 *
 * Паузы берём точными — они заданы в скрипте; остаток времени раскладываем
 * по длине реплик.
 */
async function estimateFromScript(
  payload: Awaited<ReturnType<typeof payloadClient>>,
  projectId: number,
  durationSec: number | null,
): Promise<string | null> {
  if (!durationSec || durationSec <= 0) return null;

  const ssmlArtifact = await payload.find({
    collection: "artifacts",
    where: { and: [{ project: { equals: projectId } }, { kind: { equals: "ssml" } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  });

  const doc = ssmlArtifact.docs[0];
  if (!doc || !insideProject(doc.blobPath, projectId)) return null;

  const body = await readArtifact(doc.blobPath);
  if (!body) return null;

  const parsed = parseScript(body.toString("utf8"));
  // Режим `text`: именно так синтезируют голоса Chirp, которыми озвучено
  // всё существующее. Подписи говорящих оставляем — в SSML-артефакте они
  // есть, а снимались они только при выборе голосов по ролям.
  const plan = planSynthesis(parsed.blocks, { format: "text" });

  const items: TimedItem[] = plan.map((item) =>
    item.type === "silence"
      ? { kind: "silence", seconds: item.seconds }
      : {
          kind: "speech",
          text: item.format === "ssml" ? ssmlToSpoken(item.content) : item.content,
          speaker: item.speaker,
          seconds: 0,
        },
  );

  const cues = buildCues(estimateDurations(items, durationSec));
  return cues.length ? toVtt(cues) : null;
}
