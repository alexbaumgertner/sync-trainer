import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { payloadClient } from "@/lib/payload";
import { latestGenerations } from "@/lib/generations";

export const runtime = "nodejs";

/**
 * Состояние фоновых работ проекта (U3).
 *
 * Страница опрашивает этот маршрут, пока идёт синтез, и спрашивает его при
 * открытии — именно поэтому вкладку можно закрыть и вернуться: состояние
 * живёт в базе, а не в памяти вкладки.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Нужно войти." }, { status: 401 });

  const { id } = await params;
  const projectId = Number(id);
  if (!Number.isInteger(projectId)) {
    return NextResponse.json({ error: "Проект не найден." }, { status: 404 });
  }

  const payload = await payloadClient();

  // Права проверяет Payload (D1): чужой проект просто не найдётся, и состояние
  // его работ наружу не попадёт.
  const project = await payload
    .findByID({
      collection: "projects",
      id: projectId,
      depth: 0,
      user: { ...user, collection: "users" } as never,
      overrideAccess: false,
    })
    .catch(() => null);
  if (!project) return NextResponse.json({ error: "Проект не найден." }, { status: 404 });

  const generations = await latestGenerations(payload, projectId);

  return NextResponse.json(
    { projectStatus: project.status, generations },
    // Состояние меняется под ногами — кэшировать его нельзя ни на шаг.
    { headers: { "cache-control": "no-store" } },
  );
}
