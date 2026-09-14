import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { payloadClient } from "@/lib/payload";
import { artifactPath, putArtifact, readArtifact } from "@/lib/artifacts";
import { validateForSynthesis, speakingRateFrom } from "@/lib/ssml";
import { synthesizePlan, explainError, hasCredentials, NO_CREDENTIALS } from "@/lib/google-tts";
import { formatForVoices, estimateCostUsd, tierOf, TIER_LABEL, DEFAULT_VOICE } from "@/lib/voices";
import { budgetBlock, readUsage, recordUsage } from "@/lib/usage";
import { withId3, SYNTHETIC_NOTICE } from "@/lib/id3";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BILLABLE_CHARS = Number(process.env.TTS_MAX_CHARS ?? 120_000);

/**
 * Синтез аудио по SSML проекта. Отдельный шаг от генерации скрипта (G3):
 * скрипт стоит копейки, аудио — в десять раз дороже, и человек должен
 * прочитать первое, прежде чем платить за второе.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Нужно войти." }, { status: 401 });

  if (!hasCredentials()) {
    return NextResponse.json({ error: NO_CREDENTIALS }, { status: 503 });
  }

  const { id } = await params;
  const projectId = Number(id);
  const payload = await payloadClient();

  const project = await payload
    .findByID({ collection: "projects", id: projectId, depth: 0, overrideAccess: true })
    .catch(() => null);
  const ownerId = typeof project?.owner === "object" ? project.owner?.id : project?.owner;
  if (!project || ownerId !== user.id) {
    return NextResponse.json({ error: "Проект не найден." }, { status: 404 });
  }

  let body: { ssml?: string; voice?: string; speakerVoices?: Record<string, string> };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Ожидался JSON в теле запроса." }, { status: 400 });
  }

  // Разметка из тела запроса, если человек её правил (G4); иначе — из файла проекта.
  let ssml = body.ssml?.trim();
  if (!ssml) {
    const artifact = await payload.find({
      collection: "artifacts",
      where: { and: [{ project: { equals: projectId } }, { kind: { equals: "ssml" } }] },
      sort: "-createdAt",
      limit: 1,
      overrideAccess: true,
    });
    const stored = artifact.docs[0];
    if (!stored) {
      return NextResponse.json({ error: "У проекта нет SSML. Сначала сгенерируйте скрипт." }, { status: 400 });
    }
    ssml = (await readArtifact(stored.blobPath))?.toString("utf8") ?? "";
  }

  const defaultVoice = body.voice || DEFAULT_VOICE;
  const speakerVoices = body.speakerVoices ?? {};
  const usedVoices = [...new Set([defaultVoice, ...Object.values(speakerVoices)])];
  const format = formatForVoices(usedVoices);

  // G2: проверяем разметку до обращения к Google, а не после оплаченного отказа.
  const check = validateForSynthesis(ssml, {
    format,
    perSpeaker: Object.keys(speakerVoices).length > 0,
    stripLabels: Object.keys(speakerVoices).length > 0,
  });

  if (!check.ok) {
    return NextResponse.json(
      { error: "Разметка не годится для синтеза.", issues: check.errors },
      { status: 422 },
    );
  }

  if (check.billableChars > MAX_BILLABLE_CHARS) {
    return NextResponse.json(
      {
        error: `Скрипт на ${check.billableChars.toLocaleString("ru-RU")} тарифицируемых символов превышает лимит ${MAX_BILLABLE_CHARS.toLocaleString("ru-RU")}.`,
      },
      { status: 413 },
    );
  }

  const pendingUsd = estimateCostUsd(check.billableChars, usedVoices);

  let summary;
  try {
    summary = await readUsage(user.id, user.isAdmin);
  } catch (error) {
    console.error("[audio] не удалось прочитать расходы", error);
    return NextResponse.json(
      { error: "Не удалось проверить бюджет, синтез остановлен. Попробуйте позже." },
      { status: 503 },
    );
  }

  const blocked = budgetBlock(summary, pendingUsd);
  if (blocked) return NextResponse.json({ error: blocked }, { status: 402 });

  const generation = await payload.create({
    collection: "generations",
    data: {
      project: projectId,
      kind: "audio",
      params: { voices: usedVoices, format, chars: check.billableChars },
      status: "running",
    },
    overrideAccess: true,
  });

  try {
    // Темп задан в <prosody rate>. Голоса, принимающие SSML, читают его сами;
    // у остальных разметка срезается, и темп пропадает вместе с ней — тогда
    // он передаётся отдельным параметром. Передавать в обоих случаях нельзя:
    // множители перемножатся, и 105% превратятся в 110%.
    const speakingRate = format === "ssml" ? undefined : speakingRateFrom(check.rate);

    const audio = await synthesizePlan(check.plan, {
      defaultVoice,
      speakerVoices,
      speakingRate,
    });

    // G5: пометка о синтетичности живёт и в самом файле, а не только на экране.
    const tagged = withId3(audio, {
      title: project.title,
      comment: SYNTHETIC_NOTICE,
    });

    const blobPath = artifactPath(projectId, "audio.mp3");
    const { bytes } = await putArtifact(blobPath, tagged, "audio/mpeg");

    const existing = await payload.find({
      collection: "artifacts",
      where: { and: [{ project: { equals: projectId } }, { kind: { equals: "audio" } }] },
      limit: 10,
      overrideAccess: true,
    });
    for (const old of existing.docs) {
      await payload.delete({ collection: "artifacts", id: old.id, overrideAccess: true });
    }

    await payload.create({
      collection: "artifacts",
      data: { project: projectId, generation: generation.id, kind: "audio", blobPath, bytes },
      overrideAccess: true,
    });

    await payload.update({
      collection: "generations",
      id: generation.id,
      data: {
        status: "done",
        model: defaultVoice,
        chars: check.billableChars,
        costUsd: pendingUsd,
      },
      overrideAccess: true,
    });

    await payload.update({
      collection: "projects",
      id: projectId,
      data: { status: "ready" },
      overrideAccess: true,
    });

    await recordUsage({
      userId: user.id,
      projectId,
      kind: "audio",
      chars: check.billableChars,
      costUsd: pendingUsd,
      tier: TIER_LABEL[tierOf(defaultVoice)],
      voices: usedVoices,
    });

    return NextResponse.json({
      bytes,
      chunks: check.plan.filter((item) => item.type === "speech").length,
      chars: check.billableChars,
      costUsd: pendingUsd,
      seconds: Math.round(check.estimatedSeconds),
      warnings: check.warnings,
    });
  } catch (error) {
    await payload.update({
      collection: "generations",
      id: generation.id,
      data: { status: "failed", error: explainError(error) },
      overrideAccess: true,
    });
    console.error("[audio] синтез не удался", error);
    return NextResponse.json({ error: explainError(error) }, { status: 502 });
  }
}
