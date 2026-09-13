import { NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { currentUser } from "@/lib/auth";
import { payloadClient } from "@/lib/payload";
import { extractDocument, kindOf, MAX_UPLOAD_BYTES } from "@/lib/extract";
import { presetById } from "@/presets";
import { generateScript, glossaryToCsv, scriptToMarkdown } from "@/lib/script-generation";
import { geminiConfigured, explainGeminiError, NO_GEMINI_KEY } from "@/lib/gemini";
import { artifactPath, putArtifact } from "@/lib/artifacts";
import { budgetBlock, readUsage, recordUsage } from "@/lib/usage";
import type { Trap } from "@/lib/prompt";

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
 *
 * Генерация скрипта идёт здесь же, в одном запросе. Иначе никак: оригинал
 * удаляется сразу после разбора, а держать его между запросами негде —
 * в serverless нет общей памяти, и хранить документ было бы ровно тем,
 * от чего мы отказались.
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
  let rawParams: Record<string, unknown> = {};

  const contentType = request.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("application/json")) {
      const body = (await request.json()) as {
        url?: string;
        pathname?: string;
        params?: Record<string, unknown>;
      };
      rawParams = body.params ?? {};
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
      rawParams = {
        durationMin: form.get("durationMin"),
        speakers: form.get("speakers"),
        termDensity: form.get("termDensity"),
        rate: form.get("rate"),
        traps: form.getAll("traps"),
      };
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

  let genParams: {
    durationMin: number;
    speakers: number;
    termDensity: number;
    traps: Trap[];
    rate: string;
  };
  try {
    genParams = {
      durationMin: clamp(Number(rawParams.durationMin), 5, 30, 20),
      speakers: clamp(Number(rawParams.speakers), 2, 6, 5),
      termDensity: clamp(Number(rawParams.termDensity), 20, 60, 40),
      traps: Array.isArray(rawParams.traps) ? (rawParams.traps as Trap[]) : [],
      rate: typeof rawParams.rate === "string" && rawParams.rate ? rawParams.rate : "105%",
    };
  } catch {
    await purgeOriginal();
    return NextResponse.json({ error: "Неверные параметры генерации." }, { status: 400 });
  }

  if (!geminiConfigured()) {
    await purgeOriginal();
    return NextResponse.json({ error: NO_GEMINI_KEY }, { status: 503 });
  }

  const preset = presetById(project.stylePreset);
  if (!preset) {
    await purgeOriginal();
    return NextResponse.json({ error: "Пресет проекта не найден." }, { status: 400 });
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

    // Бюджет проверяем до обращения к модели, а не после: заявка уже стоит денег.
    const summary = await readUsage(user.id, user.isAdmin);
    const blocked = budgetBlock(summary, 0.1);
    if (blocked) {
      await purgeOriginal();
      return NextResponse.json({ error: blocked }, { status: 402 });
    }

    const generation = await payload.create({
      collection: "generations",
      data: {
        project: project.id,
        kind: "script",
        params: { ...genParams, preset: preset.id, sourceLang: project.sourceLang },
        status: "running",
      },
      overrideAccess: true,
    });

    let outcome;
    try {
      outcome = await generateScript({
        preset,
        params: {
          sourceLang: project.sourceLang,
          targetLang: project.targetLang,
          ...genParams,
        },
        documentText: extracted.text || undefined,
        pdfBytes: extracted.pdfBytes,
        eventName: project.eventName ?? undefined,
      });
    } catch (error) {
      await payload.update({
        collection: "generations",
        id: generation.id,
        data: { status: "failed", error: explainGeminiError(error) },
        overrideAccess: true,
      });
      await purgeOriginal();
      return NextResponse.json({ error: explainGeminiError(error) }, { status: 502 });
    }

    // Оригинал больше не нужен ни для чего (F1).
    await purgeOriginal();

    const { script } = outcome;
    const files: { kind: "script" | "ssml" | "glossary"; body: string; type: string }[] = [
      { kind: "script", body: scriptToMarkdown(script), type: "text/markdown" },
      { kind: "ssml", body: script.ssml, type: "application/ssml+xml" },
      { kind: "glossary", body: glossaryToCsv(script), type: "text/csv" },
    ];

    for (const file of files) {
      if (!file.body) continue;
      const blobPath = artifactPath(project.id, `${file.kind}.${file.kind === "glossary" ? "csv" : file.kind === "ssml" ? "ssml" : "md"}`);
      const { bytes } = await putArtifact(blobPath, file.body, file.type);
      await payload.create({
        collection: "artifacts",
        data: { project: project.id, generation: generation.id, kind: file.kind, blobPath, bytes },
        overrideAccess: true,
      });
    }

    for (const item of script.glossary) {
      await payload.create({
        collection: "glossary-terms",
        data: {
          project: project.id,
          sourceTerm: item.source,
          targetTerm: item.target,
          note: item.note,
          status: "suggested",
        },
        overrideAccess: true,
      });
    }

    await payload.update({
      collection: "generations",
      id: generation.id,
      data: {
        status: "done",
        model: outcome.model,
        chars: outcome.inputTokens + outcome.outputTokens,
        costUsd: outcome.costUsd,
      },
      overrideAccess: true,
    });

    await payload.update({
      collection: "projects",
      id: project.id,
      data: { status: "scripted" },
      overrideAccess: true,
    });

    await recordUsage({
      userId: user.id,
      projectId: project.id,
      kind: "script",
      chars: outcome.inputTokens + outcome.outputTokens,
      costUsd: outcome.costUsd,
      tier: outcome.model,
    });

    return NextResponse.json({
      id: document.id,
      filename,
      kind: extracted.kind,
      pages: extracted.pages,
      extractedChars: extracted.kind === "pdf" ? null : extracted.text.length,
      title: script.title,
      segments: script.segments.length,
      glossary: script.glossary.length,
      costUsd: outcome.costUsd,
      warnings: outcome.warnings,
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

const clamp = (value: number, min: number, max: number, fallback: number): number =>
  Number.isFinite(value) ? Math.min(Math.max(value, min), max) : fallback;
