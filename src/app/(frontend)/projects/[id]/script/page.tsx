import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getProject } from "@/lib/projects";
import { readArtifact } from "@/lib/artifacts";
import { payloadClient } from "@/lib/payload";
import AppShell from "@/components/app-shell";
import ScriptEditor from "@/components/script-editor";

export const dynamic = "force-dynamic";

export default async function ScriptPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/");

  const { id } = await params;
  const projectId = Number(id);
  const detail = await getProject(projectId, user.id);
  if (!detail) notFound();

  const payload = await payloadClient();
  const artifacts = await payload.find({
    collection: "artifacts",
    where: { project: { equals: projectId } },
    sort: "-createdAt",
    limit: 50,
    overrideAccess: true,
  });

  const ssmlDoc = artifacts.docs.find((a) => a.kind === "ssml");
  const scriptDoc = artifacts.docs.find((a) => a.kind === "script");
  const audioDoc = artifacts.docs.find((a) => a.kind === "audio");

  const ssml = ssmlDoc ? ((await readArtifact(ssmlDoc.blobPath))?.toString("utf8") ?? "") : "";
  const markdown = scriptDoc ? ((await readArtifact(scriptDoc.blobPath))?.toString("utf8") ?? "") : "";

  return (
    <AppShell email={user.email} title={detail.project.title}>
      <div className="mb-5 flex flex-wrap items-center gap-3 text-xs text-neutral-500">
        <Link href={`/projects/${projectId}`} className="underline-offset-2 hover:underline">
          ← К проекту
        </Link>
        <span>·</span>
        <span>Язык речи: {detail.project.sourceLang.toUpperCase()}</span>
      </div>

      {!ssml ? (
        <div className="rounded-lg border border-dashed border-neutral-300 px-6 py-10 text-center dark:border-neutral-700">
          <p className="text-sm font-medium">Скрипта ещё нет</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-neutral-500 dark:text-neutral-400">
            Работа идёт по порядку: материалы события, глоссарий по ним, и уже
            из выверенного глоссария — скрипт. Всё это на карточке проекта.
          </p>
          <Link
            href={`/projects/${projectId}`}
            className="mt-5 inline-block rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            К проекту
          </Link>
        </div>
      ) : (
        <ScriptEditor
          projectId={projectId}
          sourceLang={detail.project.sourceLang}
          initialSsml={ssml}
          markdown={markdown}
          audioFileId={audioDoc?.id ?? null}
        />
      )}
    </AppShell>
  );
}
