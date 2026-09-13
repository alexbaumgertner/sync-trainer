import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { payloadClient } from "@/lib/payload";
import { readArtifact } from "@/lib/artifacts";

export const runtime = "nodejs";

const CONTENT_TYPES: Record<string, string> = {
  script: "text/markdown; charset=utf-8",
  ssml: "application/ssml+xml; charset=utf-8",
  audio: "audio/mpeg",
  glossary: "text/csv; charset=utf-8",
};

const EXTENSIONS: Record<string, string> = {
  script: "md",
  ssml: "ssml",
  audio: "mp3",
  glossary: "csv",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Нужно войти." }, { status: 401 });

  const { id, fileId } = await params;
  const payload = await payloadClient();

  // Права проверяет Payload: пользователь видит артефакт только своего проекта.
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
  if (!artifact || projectId !== Number(id)) {
    return NextResponse.json({ error: "Файл не найден." }, { status: 404 });
  }

  const body = await readArtifact(artifact.blobPath);
  if (!body) return NextResponse.json({ error: "Файл не найден." }, { status: 404 });

  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": CONTENT_TYPES[artifact.kind] ?? "application/octet-stream",
      "Content-Length": String(body.byteLength),
      "Content-Disposition": `attachment; filename="project-${id}-${artifact.kind}.${EXTENSIONS[artifact.kind] ?? "bin"}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
