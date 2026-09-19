import { NextResponse } from "next/server";
import { del, get } from "@vercel/blob";
import { currentUser } from "@/lib/auth";
import { payloadClient } from "@/lib/payload";
import { recordStep } from "@/lib/activity";
import { extractDocument, kindOf, MAX_UPLOAD_BYTES } from "@/lib/extract";
import { artifactPath, putArtifact } from "@/lib/artifacts";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Загрузка материалов события.
 *
 * Только загрузка. Раньше этот же запрос сразу генерировал скрипт — и в этом
 * была поломка всего порядка работы: скрипт рождался вместе с документом, а
 * глоссарий приезжал к нему прицепом, поэтому выверка терминов руками ни на
 * что не влияла. Теперь загрузка кончается загрузкой, а дальше человек сам
 * решает: сначала собрать глоссарий (N1), потом по нему — скрипт (N3).
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
  let force = false;

  const contentType = request.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("application/json")) {
      const body = (await request.json()) as {
        pathname?: string;
        filename?: string;
        force?: boolean;
      };
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

    await recordStep(payload, "document_uploaded", { user: user.id, project: project.id });

    return NextResponse.json({
      id: document.id,
      filename,
      kind: extracted.kind,
      pages: extracted.pages,
      extractedChars: extracted.kind === "pdf" ? null : extracted.text.length,
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
