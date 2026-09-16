import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { recordStep } from "@/lib/activity";
import { payloadClient } from "@/lib/payload";
import { SOURCE_LANG_LABELS } from "@/lib/projects";
import {
  glossaryToCsv,
  glossaryToXlsx,
  type GlossaryLabels,
  type GlossaryRow,
} from "@/lib/glossary-export";

export const runtime = "nodejs";

const TARGET_LANG_LABELS: Record<string, string> = { ru: "Русский", en: "English" };

/** Имя файла попадает в кабину вместе с файлом — пусть будет читаемым. */
const slug = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "glossary";

/**
 * Выгрузка глоссария проекта (U2).
 *
 * `csv` — для архива и для человека, с происхождением каждого термина (D3).
 * `xlsx` — для импорта в InterpretBank, ровно в той форме, которую описывает
 * его документация: три колонки, один лист.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Нужно войти." }, { status: 401 });

  const format = new URL(request.url).searchParams.get("format") ?? "csv";
  if (format !== "csv" && format !== "xlsx") {
    return NextResponse.json({ error: "Формат: csv или xlsx." }, { status: 400 });
  }

  const { id } = await params;
  const projectId = Number(id);
  if (!Number.isInteger(projectId)) {
    return NextResponse.json({ error: "Проект не найден." }, { status: 404 });
  }

  const payload = await payloadClient();
  const asUser = { ...user, collection: "users" } as never;

  // Права проверяет Payload по описанию коллекции (D1): чужой проект
  // просто не найдётся, отдельной проверки владения здесь нет и быть не должно.
  const project = await payload
    .findByID({
      collection: "projects",
      id: projectId,
      depth: 0,
      user: asUser,
      overrideAccess: false,
    })
    .catch(() => null);
  if (!project) return NextResponse.json({ error: "Проект не найден." }, { status: 404 });

  const terms = await payload.find({
    collection: "glossary-terms",
    where: { project: { equals: projectId } },
    // Порядок важен: выверенное и добытое на событии идёт выше предложенного
    // моделью, чтобы в кабине сверху лежало то, чему можно верить.
    sort: ["status", "sourceTerm"],
    limit: 5000,
    depth: 0,
    user: asUser,
    overrideAccess: false,
  });

  if (!terms.docs.length) {
    return NextResponse.json({ error: "Глоссарий пуст — выгружать нечего." }, { status: 404 });
  }

  const rows: GlossaryRow[] = terms.docs.map((term) => ({
    source: term.sourceTerm,
    target: term.targetTerm ?? null,
    note: term.note ?? null,
    status: term.status,
    // Варианты едут в колонку примечаний: она единственная, которую
    // InterpretBank покажет рядом с термином. Вариант, оставшийся в
    // приложении, бесполезен — глоссарием пользуются в кабине.
    variants: (term.variants ?? [])
      .map((variant) => variant.text?.trim() ?? "")
      .filter(Boolean),
  }));

  const labels: GlossaryLabels = {
    source: SOURCE_LANG_LABELS[project.sourceLang] ?? project.sourceLang,
    target: TARGET_LANG_LABELS[project.targetLang] ?? project.targetLang,
  };

  await recordStep(payload, "glossary_exported", { user: user.id, project: project.id });

  const name = `${slug(project.title)}-glossary.${format}`;
  const disposition = `attachment; filename*=UTF-8''${encodeURIComponent(name)}`;

  if (format === "csv") {
    return new NextResponse(glossaryToCsv(rows, labels), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": disposition,
      },
    });
  }

  const xlsx = await glossaryToXlsx(rows, labels);
  return new NextResponse(new Uint8Array(xlsx), {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": disposition,
    },
  });
}
