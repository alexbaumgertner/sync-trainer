import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { payloadClient } from "@/lib/payload";
import { readArtifact } from "@/lib/artifacts";
import { recordStep } from "@/lib/activity";
import { extractDocument, kindOf } from "@/lib/extract";
import { extractGlossary } from "@/lib/glossary-generation";
import { geminiConfigured, explainGeminiError, NO_GEMINI_KEY } from "@/lib/gemini";
import { presetById } from "@/presets";
import { activeGeneration, failStaleGenerations } from "@/lib/generations";
import { runAfterResponse } from "@/lib/background";
import { budgetBlock, readUsage, recordUsage } from "@/lib/usage";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Ориентир по числу терминов. Тот же порядок, что у плотности в скрипте. */
const DEFAULT_TERM_TARGET = 40;

/**
 * Сборка глоссария по материалам проекта (N1–N2).
 *
 * Первый шаг работы, а не побочный продукт генерации скрипта. Отсюда и
 * отдельный маршрут: по нему переводчик собирает термины, выверяет их
 * руками, и только потом просит скрипт — который теперь эти термины
 * получает на вход (N4).
 *
 * Работа идёт после ответа (`runAfterResponse`), как у синтеза: сборка
 * занимает минуту с лишним, и держать всё это время вкладку открытой
 * человек не обязан. Состояние живёт в `generations`, поэтому, вернувшись,
 * он увидит, что сборка шла, и не станет загружать файл заново (I3).
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Нужно войти." }, { status: 401 });

  if (!geminiConfigured()) {
    return NextResponse.json({ error: NO_GEMINI_KEY }, { status: 503 });
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

  const preset = presetById(project.stylePreset);
  if (!preset) {
    return NextResponse.json({ error: "Пресет проекта не найден." }, { status: 400 });
  }

  // Собираем по тем документам, чьи оригиналы на месте. Удалённый оригинал
  // (S2) читать неоткуда — и это ровно то, о чём предупреждали при удалении.
  const documents = await payload.find({
    collection: "documents",
    where: { and: [{ project: { equals: projectId } }, { blobPath: { exists: true } }] },
    sort: "createdAt",
    limit: 20,
    depth: 0,
    overrideAccess: true,
  });

  if (documents.docs.length === 0) {
    return NextResponse.json(
      { error: "Сначала загрузите материалы события: собирать глоссарий не из чего." },
      { status: 400 },
    );
  }

  let summary;
  try {
    summary = await readUsage(user.id, user.isAdmin);
  } catch (error) {
    console.error("[glossary] не удалось прочитать расходы", error);
    return NextResponse.json(
      { error: "Не удалось проверить бюджет, сборка остановлена. Попробуйте позже." },
      { status: 503 },
    );
  }

  // B5: тот же месячный лимит, что у скрипта и аудио. Порядок величин у
  // сборки скриптовый, не звуковой — но проверять всё равно до вызова.
  const blocked = budgetBlock(summary, 0.1);
  if (blocked) return NextResponse.json({ error: blocked }, { status: 402 });

  await failStaleGenerations(payload, projectId);
  const running = await activeGeneration(payload, projectId, "glossary");
  if (running) {
    return NextResponse.json(
      { error: "Глоссарий уже собирается. Дождитесь окончания.", generationId: running.id },
      { status: 409 },
    );
  }

  const generation = await payload.create({
    collection: "generations",
    data: {
      project: projectId,
      kind: "glossary",
      params: { documents: documents.docs.length, preset: preset.id },
      status: "running",
    },
    overrideAccess: true,
  });

  runAfterResponse(async () => {
    try {
      // Читаем оригиналы и разбираем их здесь же: извлечённый текст не
      // сохраняется никуда (F2 в силе), он живёт только внутри этой работы.
      const texts: { filename: string; text: string }[] = [];
      const pdfFiles: { filename: string; bytes: Buffer }[] = [];

      for (const doc of documents.docs) {
        if (!doc.blobPath) continue;
        const bytes = await readArtifact(doc.blobPath);
        if (!bytes) {
          console.error("[glossary] оригинал недоступен", doc.id, doc.blobPath);
          continue;
        }
        const kind = kindOf(doc.mime ?? "", doc.filename);
        if (!kind) continue;

        const extracted = await extractDocument(bytes, kind);
        if (extracted.pdfBytes) {
          pdfFiles.push({ filename: doc.filename, bytes: extracted.pdfBytes });
        } else {
          texts.push({ filename: doc.filename, text: extracted.text });
        }
      }

      if (texts.length === 0 && pdfFiles.length === 0) {
        throw new Error("Ни один оригинал не удалось прочитать.");
      }

      // Уже заведённые термины: модель не предлагает их заново и не спорит
      // с эквивалентами. Выверенное человеком ценнее свежей догадки (N5).
      const existing = await payload.find({
        collection: "glossary-terms",
        where: { project: { equals: projectId } },
        limit: 5000,
        depth: 0,
        overrideAccess: true,
      });
      const known = existing.docs.map((term) => ({
        source: term.sourceTerm,
        target: term.targetTerm ?? null,
      }));

      const outcome = await extractGlossary({
        preset,
        sourceLang: project.sourceLang,
        targetLang: project.targetLang,
        termTarget: DEFAULT_TERM_TARGET,
        documents: [...texts, ...pdfFiles.map((file) => ({ filename: file.filename, text: "" }))],
        pdfFiles,
        known,
        eventName: project.eventName ?? undefined,
      });

      const seen = new Set(known.map((term) => term.source.trim().toLowerCase()));
      let added = 0;
      for (const term of outcome.terms) {
        const key = term.source.trim().toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        await payload.create({
          collection: "glossary-terms",
          data: {
            project: projectId,
            sourceTerm: term.source,
            targetTerm: term.target,
            note: term.note,
            status: "suggested",
          },
          overrideAccess: true,
        });
        added += 1;
      }

      await payload.update({
        collection: "generations",
        id: generation.id,
        data: {
          status: "done",
          model: outcome.model,
          chars: outcome.inputTokens + outcome.outputTokens,
          costUsd: outcome.costUsd,
          params: {
            documents: documents.docs.length,
            preset: preset.id,
            added,
            warnings: outcome.warnings,
          },
        },
        overrideAccess: true,
      });

      await recordUsage({
        userId: user.id,
        projectId,
        kind: "glossary",
        chars: outcome.inputTokens + outcome.outputTokens,
        costUsd: outcome.costUsd,
        tier: outcome.model,
      });

      await recordStep(payload, "glossary_built", { user: user.id, project: projectId });
    } catch (error) {
      console.error("[glossary] сборка не удалась", error);
      await payload
        .update({
          collection: "generations",
          id: generation.id,
          data: { status: "failed", error: explainGeminiError(error) },
          overrideAccess: true,
        })
        .catch(() => {});
    }
  });

  // 202: работа принята, но не сделана. Готовность узнаётся опросом
  // `GET /api/projects/:id/generations`.
  return NextResponse.json(
    { generationId: generation.id, status: "running", documents: documents.docs.length },
    { status: 202 },
  );
}
