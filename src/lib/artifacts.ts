// Без пометки server-only намеренно: модуль зовёт хук коллекции, а конфигурация
// Payload исполняется в том числе вне Next.
import fs from "node:fs/promises";
import path from "node:path";
import { del, get, put } from "@vercel/blob";

/**
 * Файлы проектов: скрипты, SSML, аудио, выгрузки глоссария.
 *
 * На Vercel это приватный Blob, локально — каталог `.data/artifacts`.
 * Второй путь нужен, чтобы разработка работала без облачного стора;
 * выбор делается по наличию токена, а не по флагу.
 */

const localRoot = () => path.join(process.cwd(), ".data", "artifacts");

const blobEnabled = (): boolean => Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());

export const artifactPath = (projectId: number, name: string): string =>
  `projects/${projectId}/${name}`;

export async function putArtifact(
  blobPath: string,
  body: Buffer | string,
  contentType: string,
): Promise<{ bytes: number }> {
  const bytes = Buffer.isBuffer(body) ? body.byteLength : Buffer.byteLength(body);

  if (blobEnabled()) {
    await put(blobPath, body, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType,
    });
    return { bytes };
  }

  const file = path.join(localRoot(), blobPath);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body);
  return { bytes };
}

export async function readArtifact(blobPath: string): Promise<Buffer | null> {
  if (blobEnabled()) {
    const result = await get(blobPath, { access: "private", useCache: false });
    if (!result) return null;
    return Buffer.from(await new Response(result.stream).arrayBuffer());
  }

  try {
    return await fs.readFile(path.join(localRoot(), blobPath));
  } catch {
    return null;
  }
}

/**
 * F4: удаление проекта должно уносить файлы, а не только строки в базе.
 * Ошибки здесь не должны срывать удаление — иначе проект останется навсегда
 * из-за одного недоступного файла.
 */
export async function deleteArtifacts(blobPaths: string[]): Promise<void> {
  if (!blobPaths.length) return;

  if (blobEnabled()) {
    await del(blobPaths);
    return;
  }

  await Promise.all(
    blobPaths.map((blobPath) =>
      fs.rm(path.join(localRoot(), blobPath), { force: true }).catch(() => {}),
    ),
  );
}

/** Удаляет весь каталог проекта — на случай файлов, не попавших в базу. */
export async function deleteProjectFolder(projectId: number): Promise<void> {
  if (blobEnabled()) return;
  await fs.rm(path.join(localRoot(), "projects", String(projectId)), {
    recursive: true,
    force: true,
  }).catch(() => {});
}
