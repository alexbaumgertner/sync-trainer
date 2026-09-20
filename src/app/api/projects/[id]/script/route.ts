import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { payloadClient } from "@/lib/payload";
import { artifactPath, putArtifact, readArtifact } from "@/lib/artifacts";
import { recordStep } from "@/lib/activity";
import { debriefNotesFor } from "@/lib/debrief-notes";
import { extractDocument, kindOf } from "@/lib/extract";
import { generateScript, glossaryToCsv, scriptToMarkdown } from "@/lib/script-generation";
import { geminiConfigured, explainGeminiError, NO_GEMINI_KEY } from "@/lib/gemini";
import { presetById } from "@/presets";
import { activeGeneration, failStaleGenerations } from "@/lib/generations";
import { runAfterResponse } from "@/lib/background";
import { addNewTerms } from "@/lib/glossary-store";
import { budgetBlock, readUsage, recordUsage } from "@/lib/usage";
import type { Trap } from "@/lib/prompt";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Генерация тренировочного скрипта (N3–N7).
 *
 * Отдельный маршрут, а не довесок к загрузке документа, и это главное
 * изменение релиза. Раньше скрипт рождался вместе с документом, а глоссарий
 * приезжал к нему прицепом — значит выверка терминов руками ни на что не
 * влияла. Теперь порядок обратный: сначала глоссарий, потом скрипт, и
 * выверенные эквиваленты уходят в промт заданием (N4).
 *
 * Работа идёт после ответа, как сборка глоссария и синтез: полторы минуты
 * держать вкладку открытой человек не обязан.
 */
export async function POST(
  request: Request,
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

  let raw: Record<string, unknown> = {};
  try {
    raw = (await request.json()) as Record<string, unknown>;
  } catch {
    // Пустое тело — не ошибка: значения по умолчанию заданы ниже.
  }

  const genParams = {
    durationMin: clamp(Number(raw.durationMin), 5, 30, 20),
    speakers: clamp(Number(raw.speakers), 2, 6, 5),
    termDensity: clamp(Number(raw.termDensity), 20, 60, 40),
    traps: Array.isArray(raw.traps) ? (raw.traps as Trap[]) : [],
    rate: typeof raw.rate === "string" && raw.rate ? raw.rate : "100%",
  };

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
      { error: "Сначала загрузите материалы события: генерировать не по чему." },
      { status: 400 },
    );
  }

  // N3: без глоссария скрипта не бывает. Это не придирка к порядку кнопок —
  // весь смысл в том, что речь строится вокруг выверенных терминов.
  const glossary = await payload.find({
    collection: "glossary-terms",
    where: { project: { equals: projectId } },
    sort: "sourceTerm",
    limit: 500,
    depth: 0,
    overrideAccess: true,
  });

  if (glossary.docs.length === 0) {
    return NextResponse.json(
      { error: "Сначала соберите глоссарий: скрипт строится вокруг его терминов." },
      { status: 400 },
    );
  }

  let summary;
  try {
    summary = await readUsage(user.id, user.isAdmin);
  } catch (error) {
    console.error("[script] не удалось прочитать расходы", error);
    return NextResponse.json(
      { error: "Не удалось проверить бюджет, генерация остановлена. Попробуйте позже." },
      { status: 503 },
    );
  }

  const blocked = budgetBlock(summary, 0.1);
  if (blocked) return NextResponse.json({ error: blocked }, { status: 402 });

  await failStaleGenerations(payload, projectId);
  const running = await activeGeneration(payload, projectId, "script");
  if (running) {
    return NextResponse.json(
      { error: "Скрипт уже генерируется. Дождитесь окончания.", generationId: running.id },
      { status: 409 },
    );
  }

  const generation = await payload.create({
    collection: "generations",
    data: {
      project: projectId,
      kind: "script",
      params: { ...genParams, preset: preset.id, sourceLang: project.sourceLang },
      status: "running",
    },
    overrideAccess: true,
  });

  runAfterResponse(async () => {
    try {
      // Документы читаем здесь же. Извлечённый текст не сохраняется никуда
      // (F2 в силе): он живёт только внутри этой работы.
      let documentText = "";
      let pdfBytes: Buffer | null = null;

      for (const doc of documents.docs) {
        if (!doc.blobPath) continue;
        const bytes = await readArtifact(doc.blobPath);
        if (!bytes) continue;
        const kind = kindOf(doc.mime ?? "", doc.filename);
        if (!kind) continue;

        const extracted = await extractDocument(bytes, kind);
        // PDF читает сама модель, и файлом уходит только первый: класть в
        // один запрос все презентации события — это мегабайты на вызов,
        // а скрипту, в отличие от глоссария, нужна повестка, а не полнота.
        if (extracted.pdfBytes && !pdfBytes) pdfBytes = extracted.pdfBytes;
        else if (extracted.text) {
          documentText += `${documentText ? "\n\n" : ""}## ${doc.filename}\n${extracted.text}`;
        }
      }

      // E4: чему научили прошлые события. Отказ здесь не повод срывать
      // генерацию — без выводов скрипт просто будет обычным.
      const debriefNotes = await debriefNotesFor(payload, user.id, projectId).catch(
        (error: unknown) => {
          console.error("[script] не удалось собрать выводы из разборов", error);
          return [] as string[];
        },
      );

      const outcome = await generateScript({
        preset,
        params: {
          sourceLang: project.sourceLang,
          targetLang: project.targetLang,
          ...genParams,
        },
        documentText: documentText || undefined,
        pdfBytes,
        eventName: project.eventName ?? undefined,
        debriefNotes,
        // N4–N5: выверенное человеком помечено и переписыванию не подлежит.
        glossary: glossary.docs.map((term) => ({
          source: term.sourceTerm,
          target: term.targetTerm ?? null,
          locked: term.status !== "suggested",
        })),
      });

      const { script } = outcome;

      /**
       * Порядок здесь важен: сначала слить новые термины, потом собирать
       * файлы. Иначе в скрипт и выгрузку попадёт не глоссарий проекта, а
       * горстка новых кандидатов от модели — ровно та поломка, которую
       * нашёл живой прогон.
       */
      await addNewTerms(
        payload,
        projectId,
        script.glossary,
        glossary.docs.map((term) => term.sourceTerm),
      );

      const full = await payload.find({
        collection: "glossary-terms",
        where: { project: { equals: projectId } },
        sort: "sourceTerm",
        limit: 500,
        depth: 0,
        overrideAccess: true,
      });
      const terms = full.docs.map((term) => ({
        source: term.sourceTerm,
        target: term.targetTerm ?? "",
        note: term.note ?? undefined,
      }));

     const files: { kind: "script" | "ssml" | "glossary"; body: string; type: string }[] = [
        { kind: "script", body: scriptToMarkdown(script, { glossary: terms }), type: "text/markdown" },
        { kind: "ssml", body: script.ssml, type: "application/ssml+xml" },
        { kind: "glossary", body: glossaryToCsv(terms), type: "text/csv" },
      ];

      // Пути артефактов постоянны, и вторая генерация перезаписывает файл.
      // Прежние строки после этого указывают на новый файл, но показывают
      // старый размер — список врёт о том, что скачаешь.
      const stale = await payload.find({
        collection: "artifacts",
        where: {
          and: [
            { project: { equals: projectId } },
            { kind: { in: ["script", "ssml", "glossary"] } },
          ],
        },
        limit: 100,
        depth: 0,
        overrideAccess: true,
      });
      for (const old of stale.docs) {
        await payload.delete({ collection: "artifacts", id: old.id, overrideAccess: true });
      }

      for (const file of files) {
        if (!file.body) continue;
        const name =
          file.kind === "glossary" ? "glossary.csv" : file.kind === "ssml" ? "ssml.ssml" : "script.md";
        const blobPath = artifactPath(projectId, name);
        const { bytes } = await putArtifact(blobPath, file.body, file.type);
        await payload.create({
          collection: "artifacts",
          data: { project: projectId, generation: generation.id, kind: file.kind, blobPath, bytes },
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
          params: {
            ...genParams,
            preset: preset.id,
            sourceLang: project.sourceLang,
            warnings: outcome.warnings,
          },
        },
        overrideAccess: true,
      });

      await payload.update({
        collection: "projects",
        id: projectId,
        data: { status: "scripted" },
        overrideAccess: true,
      });

      await recordUsage({
        userId: user.id,
        projectId,
        kind: "script",
        chars: outcome.inputTokens + outcome.outputTokens,
        costUsd: outcome.costUsd,
        tier: outcome.model,
      });

      await recordStep(payload, "script_generated", { user: user.id, project: projectId });
    } catch (error) {
      console.error("[script] генерация не удалась", error);
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

  return NextResponse.json(
    {
      generationId: generation.id,
      status: "running",
      documents: documents.docs.length,
      terms: glossary.docs.length,
    },
    { status: 202 },
  );
}

const clamp = (value: number, min: number, max: number, fallback: number): number =>
  Number.isFinite(value) ? Math.min(Math.max(value, min), max) : fallback;
