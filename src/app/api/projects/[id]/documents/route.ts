import { NextResponse } from "next/server";
import { del, get } from "@vercel/blob";
import { debriefNotesFor } from "@/lib/debrief-notes";
import { currentUser } from "@/lib/auth";
import { payloadClient } from "@/lib/payload";
import { recordStep } from "@/lib/activity";
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
 * Требования S1–S6, I4. Оригинал остаётся в хранилище: F1 из R1 отменён.
 * Извлечённый текст по-прежнему никуда не пишется (F2) — в базу попадают
 * только метаданные, его длина и путь к оригиналу.
 *
 * Два пути входа. На Vercel файл приезжает в Blob из браузера, и сюда приходит
 * только путь к нему во временном каталоге `uploads/`. Локально, где предела
 * в 4.5 МБ нет, файл идёт прямо в теле запроса. Дальше пути сходятся: оригинал
 * ложится в каталог проекта рядом с его артефактами, а временная копия — если
 * она была — убирается.
 *
 * Каталог проекта, а не `uploads/`, выбран не из аккуратности: удаление
 * проекта чистит именно его, и оригинал, оставленный в стороне, пережил бы
 * проект, к которому относится.
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
  let blobPath: string | null = null;
  let rawParams: Record<string, unknown> = {};
  let force = false;

  const contentType = request.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("application/json")) {
      const body = (await request.json()) as {
        pathname?: string;
        filename?: string;
        force?: boolean;
        params?: Record<string, unknown>;
      };
      rawParams = body.params ?? {};
      force = Boolean(body.force);
      if (!body.pathname) {
        return NextResponse.json({ error: "Не передан путь загруженного файла." }, { status: 400 });
      }

      // Путь приходит из браузера, поэтому доверять ему нельзя: без этой
      // проверки сюда можно передать путь чужого проекта, и сервер прочитает
      // его своим токеном. Раньше здесь принимался произвольный адрес, и
      // сервер ходил по нему сам — это ещё и SSRF.
      const inProject = body.pathname.startsWith(`uploads/${project.id}/`);
      const climbsOut = body.pathname.split("/").includes("..");
      if (!inProject || climbsOut) {
        return NextResponse.json({ error: "Путь не относится к проекту." }, { status: 400 });
      }

      blobPath = body.pathname;
      // Приватный файл по ссылке не скачать — читаем через SDK.
      const stored = await get(blobPath, { access: "private", useCache: false });
      if (!stored) {
        return NextResponse.json({ error: "Загруженный файл недоступен." }, { status: 400 });
      }
      buffer = Buffer.from(await new Response(stored.stream).arrayBuffer());
      // Показываем имя, которое выбрал человек, а не путь в хранилище: к пути
      // приклеен случайный суффикс (`addRandomSuffix`), и в списке документов
      // он выглядел как часть названия файла.
      filename = safeFilename(body.filename) ?? blobPath.split("/").pop() ?? "document";
      mime = stored.blob.contentType || "application/octet-stream";
    } else {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "Файл не передан." }, { status: 400 });
      }
      buffer = Buffer.from(await file.arrayBuffer());
      filename = safeFilename(file.name) ?? "document";
      mime = file.type;
      force = form.get("force") === "1";
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

  /**
   * Уборка временной копии из `uploads/`.
   *
   * Это не удаление оригинала (S2), а уборка за пересылкой: браузер кладёт
   * файл во временный каталог, мы читаем его оттуда и переносим в каталог
   * проекта. Оставленная копия занимала бы место и пережила бы проект.
   */
  const purgeStaging = async () => {
    if (!blobPath) return;
    const path = blobPath;
    // Обнуляем до вызова: ниже по ветвям ошибок уборка зовётся ещё раз,
    // и повторное удаление уже удалённого пути — лишний поход в хранилище.
    blobPath = null;
    await del(path).catch((error: unknown) => {
      console.error("[documents] не удалось убрать временную копию", error);
    });
  };

  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    await purgeStaging();
    return NextResponse.json({ error: "Файл больше 25 МБ." }, { status: 413 });
  }

  const kind = kindOf(mime, filename);
  if (!kind) {
    await purgeStaging();
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
    await purgeStaging();
    return NextResponse.json({ error: "Неверные параметры генерации." }, { status: 400 });
  }

  if (!geminiConfigured()) {
    await purgeStaging();
    return NextResponse.json({ error: NO_GEMINI_KEY }, { status: 503 });
  }

  const preset = presetById(project.stylePreset);
  if (!preset) {
    await purgeStaging();
    return NextResponse.json({ error: "Пресет проекта не найден." }, { status: 400 });
  }

  try {
    const extracted = await extractDocument(buffer, kind);

    /**
     * I4: тот же файл второй раз.
     *
     * Раньше повторная загрузка молча запускала вторую генерацию и вторые
     * расходы — а повторяют её как раз тогда, когда первая, кажется, пропала:
     * человек ушёл со страницы и вернулся. Сверяем по отпечатку содержимого,
     * а не по имени: «presentation (1).pdf» — тот же файл.
     */
    if (!force) {
      const twin = await payload.find({
        collection: "documents",
        where: {
          and: [{ project: { equals: project.id } }, { sha256: { equals: extracted.sha256 } }],
        },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      });
      if (twin.docs.length > 0) {
        await purgeStaging();
        return NextResponse.json(
          {
            error: `«${twin.docs[0].filename}» уже загружен в этот проект.`,
            duplicate: true,
          },
          { status: 409 },
        );
      }
    }

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
      },
      overrideAccess: true,
    });

    /**
     * S2: оригинал переезжает в каталог проекта и остаётся там.
     *
     * Имя плоское и по идентификатору записи: слой доступа не пускает
     * вложенные каталоги внутрь проекта, а имя, данное человеком, могло бы
     * столкнуться с чужим. Не удалось сохранить — это не повод срывать
     * разбор: помечаем запись как оставшуюся без оригинала и идём дальше.
     */
    const sourcePath = artifactPath(project.id, `source-${document.id}.${extracted.kind}`);
    try {
      await putArtifact(sourcePath, buffer, mime || "application/octet-stream");
      await payload.update({
        collection: "documents",
        id: document.id,
        data: { blobPath: sourcePath },
        overrideAccess: true,
      });
    } catch (error) {
      console.error("[documents] не удалось сохранить оригинал", error);
      await payload.update({
        collection: "documents",
        id: document.id,
        data: { purgedAt: new Date().toISOString() },
        overrideAccess: true,
      });
    }

    // Временная копия больше не нужна: оригинал уже в каталоге проекта.
    await purgeStaging();

    // Бюджет проверяем до обращения к модели, а не после: заявка уже стоит денег.
    const summary = await readUsage(user.id, user.isAdmin);
    const blocked = budgetBlock(summary, 0.1);
    if (blocked) {
      await purgeStaging();
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
      // E4: чему научили прошлые события этого переводчика. Отказ здесь не
      // повод срывать генерацию — без выводов скрипт просто будет обычным.
      const debriefNotes = await debriefNotesFor(payload, user.id, project.id).catch(
        (error: unknown) => {
          console.error("[documents] не удалось собрать выводы из разборов", error);
          return [] as string[];
        },
      );

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
        debriefNotes,
      });
    } catch (error) {
      await payload.update({
        collection: "generations",
        id: generation.id,
        data: { status: "failed", error: explainGeminiError(error) },
        overrideAccess: true,
      });
      await purgeStaging();
      return NextResponse.json({ error: explainGeminiError(error) }, { status: 502 });
    }

    const { script } = outcome;
    const files: { kind: "script" | "ssml" | "glossary"; body: string; type: string }[] = [
      { kind: "script", body: scriptToMarkdown(script), type: "text/markdown" },
      { kind: "ssml", body: script.ssml, type: "application/ssml+xml" },
      { kind: "glossary", body: glossaryToCsv(script), type: "text/csv" },
    ];

    // Пути артефактов постоянны (`projects/3/script.md`), и вторая генерация
    // перезаписывает файл. Прежние строки после этого указывают на новый файл,
    // но показывают старый размер — список врёт о том, что скачаешь. Поэтому
    // старые записи убираем, как это делает озвучка.
    const stale = await payload.find({
      collection: "artifacts",
      where: {
        and: [
          { project: { equals: project.id } },
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
      const blobPath = artifactPath(project.id, `${file.kind}.${file.kind === "glossary" ? "csv" : file.kind === "ssml" ? "ssml" : "md"}`);
      const { bytes } = await putArtifact(blobPath, file.body, file.type);
      await payload.create({
        collection: "artifacts",
        data: { project: project.id, generation: generation.id, kind: file.kind, blobPath, bytes },
        overrideAccess: true,
      });
    }

    // Термин, уже лежащий в глоссарии, второй раз не заводим: при повторной
    // генерации он уехал бы в выгрузку для кабины дважды. И не переписываем:
    // существующий мог быть выверен человеком или добыт на событии, а это
    // ценнее свежей догадки модели.
    const known = new Set(
      (
        await payload.find({
          collection: "glossary-terms",
          where: { project: { equals: project.id } },
          limit: 5000,
          depth: 0,
          overrideAccess: true,
        })
      ).docs.map((term) => term.sourceTerm.trim().toLowerCase()),
    );

    for (const item of script.glossary) {
      const key = item.source.trim().toLowerCase();
      if (!key || known.has(key)) continue;
      known.add(key);
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

    await recordStep(payload, "document_uploaded", { user: user.id, project: project.id });
    await recordStep(payload, "script_generated", { user: user.id, project: project.id });

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
    await purgeStaging();
    console.error("[documents] обработка не удалась", error);
    return NextResponse.json(
      { error: "Не удалось разобрать документ.", detail: (error as Error).message },
      { status: 422 },
    );
  }
}

/**
 * Имя файла приходит из браузера и показывается в списке документов.
 * Разделители пути и управляющие символы убираем: на экран они попасть
 * не должны, а длину подрезаем, чтобы строка не разъезжалась.
 */
function safeFilename(raw: string | undefined): string | null {
  if (!raw) return null;
  const clean = raw
    .replace(/[\\/]/g, "-")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 180);
  return clean || null;
}

const clamp = (value: number, min: number, max: number, fallback: number): number =>
  Number.isFinite(value) ? Math.min(Math.max(value, min), max) : fallback;
