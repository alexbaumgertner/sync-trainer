import { NextResponse } from "next/server";
import { del, get } from "@vercel/blob";
import { currentUser } from "@/lib/auth";
import { payloadClient } from "@/lib/payload";
import { recordStep } from "@/lib/activity";
import { extractDocument, kindOf, MAX_UPLOAD_BYTES } from "@/lib/extract";
import { extractParticipants } from "@/lib/participants";
import { geminiConfigured, explainGeminiError, NO_GEMINI_KEY } from "@/lib/gemini";
import { budgetBlock, readUsage, recordUsage } from "@/lib/usage";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Разбор списка участников (L4).
 *
 * Синхронно, в отличие от сборки глоссария: список короткий, вызов быстрый,
 * и держать ради него запись о фоновой работе значило бы усложнять на
 * ровном месте. Файл при этом НЕ сохраняется — он нужен ровно на время
 * разбора, а участники и так третьи лица без согласия на хранение (L5).
 *
 * Два пути входа, как у документов, и по той же причине: тело запроса к
 * функции Vercel ограничено 4.5 МБ. Найдено живым использованием — программа
 * конференции в PDF весит больше, и маршрут отвечал 413 ещё до того, как
 * запрос доходил до нашего кода. Поэтому на Vercel браузер кладёт файл
 * в хранилище сам, а сюда присылает путь; временная копия убирается сразу
 * после разбора.
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

  let buffer: Buffer;
  let filename: string;
  let mime: string;
  let stagingPath: string | null = null;

  const contentType = request.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("application/json")) {
      const body = (await request.json()) as { pathname?: string; filename?: string };
      if (!body.pathname) {
        return NextResponse.json({ error: "Не передан путь загруженного файла." }, { status: 400 });
      }

      // Путь приходит из браузера, доверять ему нельзя: без проверки сюда
      // можно передать путь чужого проекта, и сервер прочитает его своим
      // токеном. Та же проверка, что у документов.
      const inProject = body.pathname.startsWith(`uploads/${project.id}/`);
      const climbsOut = body.pathname.split("/").includes("..");
      if (!inProject || climbsOut) {
        return NextResponse.json({ error: "Путь не относится к проекту." }, { status: 400 });
      }

      stagingPath = body.pathname;
      const stored = await get(stagingPath, { access: "private", useCache: false });
      if (!stored) {
        return NextResponse.json({ error: "Загруженный файл недоступен." }, { status: 400 });
      }
      buffer = Buffer.from(await new Response(stored.stream).arrayBuffer());
      filename = body.filename ?? stagingPath.split("/").pop() ?? "list";
      mime = stored.blob.contentType || "application/octet-stream";
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

  /** Список участников не хранится: он нужен ровно на время разбора (L5). */
  const purgeStaging = async () => {
    if (!stagingPath) return;
    const path = stagingPath;
    stagingPath = null;
    await del(path).catch((error: unknown) => {
      console.error("[participants] не удалось убрать временную копию", error);
    });
  };

  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    await purgeStaging();
    return NextResponse.json({ error: "Файл больше 25 МБ." }, { status: 413 });
  }

  const kind = kindOf(mime, filename);
  if (!kind) {
    await purgeStaging();
    return NextResponse.json({ error: "Поддерживаются PDF, DOCX и PPTX." }, { status: 415 });
  }

  let summary;
  try {
    summary = await readUsage(user.id, user.isAdmin);
  } catch (error) {
    console.error("[participants] не удалось прочитать расходы", error);
    await purgeStaging();
    return NextResponse.json(
      { error: "Не удалось проверить бюджет, разбор остановлен. Попробуйте позже." },
      { status: 503 },
    );
  }

  // B5: тот же месячный лимит, что у глоссария, скрипта и аудио.
  const blocked = budgetBlock(summary, 0.05);
  if (blocked) {
    await purgeStaging();
    return NextResponse.json({ error: blocked }, { status: 402 });
  }

  try {
    const extracted = await extractDocument(buffer, kind);
    // Разобрали — временная копия больше не нужна ни при каком исходе.
    await purgeStaging();

    const outcome = await extractParticipants({
      text: extracted.text || undefined,
      pdfBytes: extracted.pdfBytes,
      eventName: project.eventName ?? undefined,
    });

    // Уже названных не задваиваем: список присылают дважды чаще, чем кажется.
    const known = new Set(
      (project.participants ?? []).map((person) => person.name.trim().toLowerCase()),
    );
    const fresh = outcome.participants.filter((person) => !known.has(person.name.toLowerCase()));

    await payload.update({
      collection: "projects",
      id: projectId,
      data: { participants: [...(project.participants ?? []), ...fresh] },
      overrideAccess: true,
    });

    await recordUsage({
      userId: user.id,
      projectId,
      kind: "participants",
      chars: outcome.inputTokens + outcome.outputTokens,
      costUsd: outcome.costUsd,
      tier: outcome.model,
    });

    await recordStep(payload, "participants_imported", { user: user.id, project: projectId });

    return NextResponse.json({
      added: fresh.length,
      skipped: outcome.participants.length - fresh.length,
      unknown: fresh.filter((person) => person.pronunciationUnknown).length,
      costUsd: outcome.costUsd,
    });
  } catch (error) {
    console.error("[participants] разбор не удался", error);
    await purgeStaging();
    return NextResponse.json({ error: explainGeminiError(error) }, { status: 502 });
  }
}
