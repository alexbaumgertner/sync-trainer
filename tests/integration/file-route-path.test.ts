import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Второй заслон на выдаче файла (Б2 аудита).
 *
 * Коллекция кривой путь больше не принимает — значит завести такую строку
 * через Payload нельзя вовсе, и этот тест портит путь запросом прямо в базу.
 * Так и должно быть: маршрут защищается не от того, что мы умеем записать
 * сегодня, а от строки, которая окажется в базе завтра — через новую дыру,
 * миграцию или правку руками. Проверка у самого чтения — последняя, где
 * это ещё можно поймать.
 */

let sessionToken = "";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: sessionToken }) }),
  headers: async () => new Headers(),
}));

const { payloadClient } = await import("@/lib/payload");
const { issueToken } = await import("@/lib/session");
const { artifactPath } = await import("@/lib/artifact-path");
const { putArtifact } = await import("@/lib/artifacts");
const { GET } = await import("@/app/api/projects/[id]/files/[fileId]/route");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let payload: Awaited<ReturnType<typeof payloadClient>>;
let victim: number;
let attacker: number;
let victimProject: number;
let attackerProject: number;
let artifactId: number;

const call = (projectId: number, fileId: number) =>
  GET(new Request("http://localhost/x"), {
    params: Promise.resolve({ id: String(projectId), fileId: String(fileId) }),
  });

beforeAll(async () => {
  payload = await payloadClient();

  const makeUser = async (tag: string) =>
    (
      await payload.create({
        collection: "users",
        data: { email: `fr-${tag}-${stamp}@example.test`, role: "interpreter" },
        overrideAccess: true,
      })
    ).id as number;

  const makeProject = async (owner: number, title: string) =>
    (
      await payload.create({
        collection: "projects",
        data: {
          title,
          owner,
          sourceLang: "en",
          targetLang: "ru",
          stylePreset: "un",
          status: "draft",
        },
        overrideAccess: true,
      })
    ).id as number;

  victim = await makeUser("victim");
  attacker = await makeUser("attacker");
  victimProject = await makeProject(victim, `Жертва ${stamp}`);
  attackerProject = await makeProject(attacker, `Атакующий ${stamp}`);

  // У жертвы лежит сгенерированный скрипт по предсказуемому пути
  await putArtifact(artifactPath(victimProject, "script.md"), "СЕКРЕТ ЖЕРТВЫ", "text/markdown");

  // Законный артефакт атакующего в его собственном проекте
  artifactId = (
    await payload.create({
      collection: "artifacts",
      data: {
        project: attackerProject,
        kind: "script",
        blobPath: artifactPath(attackerProject, "script.md"),
        bytes: 13,
      },
      overrideAccess: true,
    })
  ).id as number;
  await putArtifact(artifactPath(attackerProject, "script.md"), "своё", "text/markdown");
});

afterAll(async () => {
  for (const id of [victimProject, attackerProject]) {
    await payload.delete({ collection: "projects", id, overrideAccess: true }).catch(() => {});
  }
  for (const id of [victim, attacker]) {
    await payload.delete({ collection: "users", id, overrideAccess: true }).catch(() => {});
  }
});

describe("выдача файла", () => {
  it("свой файл отдаётся", async () => {
    sessionToken = issueToken(attacker).token;
    const response = await call(attackerProject, artifactId);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("своё");
  });

  it("чужой путь в собственной строке не отдаёт чужой файл", async () => {
    // Портим путь в обход Payload — иначе хук коллекции такую строку не пустит.
    await payload.db.drizzle.execute(
      `update artifacts set blob_path = '${artifactPath(victimProject, "script.md")}' where id = ${artifactId}`,
    );

    const poisoned = await payload.findByID({
      collection: "artifacts",
      id: artifactId,
      depth: 0,
      overrideAccess: true,
    });
    expect(poisoned.blobPath).toBe(artifactPath(victimProject, "script.md"));

    sessionToken = issueToken(attacker).token;
    const response = await call(attackerProject, artifactId);

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("СЕКРЕТ");
  });
});
