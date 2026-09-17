import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * U3: синтез идёт в фоне, вкладку можно закрыть.
 *
 * Проверяется не «есть кнопка», а то, от чего зависит обещание: маршрут
 * отвечает до окончания работы, работа доводится до конца сама, а состояние
 * лежит в базе — единственном месте, которое переживёт закрытую вкладку.
 */

/** Отпускается вручную — так воспроизводится «ответ ушёл, работа ещё идёт». */
let release: (() => void) | undefined;
let synthCalls = 0;
let failSynthesis = false;

vi.mock("@/lib/google-tts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/google-tts")>();
  return {
    ...actual,
    hasCredentials: () => true,
    synthesizePlan: async () => {
      synthCalls += 1;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      if (failSynthesis) throw new Error("Google отказал");
      // Форма ответа: файл плюс длительность каждого куска — из них
      // собирается карта времени для подсветки текста.
      return { audio: Buffer.from([0xff, 0xf3, 0x48, 0xc4]), itemSeconds: [1] };
    },
  };
});

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: sessionToken }) }),
  headers: async () => new Headers(),
}));

const { payloadClient } = await import("@/lib/payload");
const { issueToken } = await import("@/lib/session");
const { runAudioJob } = await import("@/lib/audio-job");
const { latestGenerations, activeGeneration, failStaleGenerations, STALE_AFTER_MS } =
  await import("@/lib/generations");
const { GET: readState } = await import("@/app/api/projects/[id]/generations/route");
const { POST: synthesize } = await import("@/app/api/projects/[id]/audio/route");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let sessionToken = "";
let userId: number;
let projectId: number;
let payload: Awaited<ReturnType<typeof payloadClient>>;

const SSML = '<speak><prosody rate="100%"><p>Chair: Good morning.</p></prosody></speak>';

const state = () =>
  readState(new Request("http://localhost/x"), {
    params: Promise.resolve({ id: String(projectId) }),
  });

const startJob = async () => {
  const generation = await payload.create({
    collection: "generations",
    data: { project: projectId, kind: "audio", status: "running" },
    overrideAccess: true,
  });
  const { validateForSynthesis } = await import("@/lib/ssml");
  const check = validateForSynthesis(SSML, { format: "text" });

  const finished = runAudioJob({
    payload,
    generationId: generation.id,
    projectId,
    projectTitle: "Фон",
    userId,
    plan: check.plan,
    defaultVoice: "en-GB-Chirp3-HD-Charon",
    speakerVoices: {},
    speakingRate: undefined,
    usedVoices: ["en-GB-Chirp3-HD-Charon"],
    billableChars: check.billableChars,
    costUsd: 0.01,
  });
  return { generationId: generation.id, finished };
};

beforeAll(async () => {
  payload = await payloadClient();
  const user = await payload.create({
    collection: "users",
    data: { email: `bg-${stamp}@example.test`, role: "interpreter" },
    overrideAccess: true,
  });
  userId = user.id;
  sessionToken = issueToken(userId).token;

  const project = await payload.create({
    collection: "projects",
    data: {
      title: `Фон ${stamp}`,
      owner: userId,
      sourceLang: "en",
      targetLang: "ru",
      stylePreset: "un",
      status: "scripted",
    },
    overrideAccess: true,
  });
  projectId = project.id;
});

beforeEach(async () => {
  synthCalls = 0;
  release = undefined;
  failSynthesis = false;
  await payload.delete({
    collection: "generations",
    where: { project: { equals: projectId } },
    overrideAccess: true,
  });
});

afterAll(async () => {
  await payload.delete({ collection: "projects", id: projectId, overrideAccess: true }).catch(() => {});
  await payload.delete({ collection: "users", id: userId, overrideAccess: true }).catch(() => {});
});

describe("синтез в фоне", () => {
  it("состояние видно, пока работа ещё идёт — на этом держится закрытие вкладки", async () => {
    const { finished } = await startJob();

    // Работа висит внутри synthesizePlan. Именно в этот момент человек
    // закрывает вкладку, и единственный способ узнать состояние — база.
    const during = await state();
    const body = (await during.json()) as {
      generations: { audio?: { status: string; stale: boolean } };
    };
    expect(body.generations.audio?.status).toBe("running");
    expect(body.generations.audio?.stale).toBe(false);

    release!();
    await finished;

    const after = await state();
    const done = (await after.json()) as {
      projectStatus: string;
      generations: { audio?: { status: string } };
    };
    expect(done.generations.audio?.status).toBe("done");
    expect(done.projectStatus).toBe("ready");
  });

  it("работа доводится до конца, даже если ответ давно ушёл", async () => {
    const { generationId, finished } = await startJob();
    release!();
    await finished;

    const artifacts = await payload.find({
      collection: "artifacts",
      where: { and: [{ project: { equals: projectId } }, { kind: { equals: "audio" } }] },
      overrideAccess: true,
    });
    expect(artifacts.docs).toHaveLength(1);

    const generation = await payload.findByID({
      collection: "generations",
      id: generationId,
      overrideAccess: true,
    });
    expect(generation.status).toBe("done");
    expect(generation.costUsd).toBeCloseTo(0.01, 5);
  });

  it("отказ записывается в базу, а не теряется вместе с ответом", async () => {
    failSynthesis = true;
    const { generationId, finished } = await startJob();
    release!();
    // Фоновая работа не имеет права выбрасывать наружу: ловить некому.
    await expect(finished).resolves.toBeUndefined();

    const generation = await payload.findByID({
      collection: "generations",
      id: generationId,
      overrideAccess: true,
    });
    expect(generation.status).toBe("failed");
    expect(generation.error).toBeTruthy();
  });

  it("повторный запуск отклоняется, пока работа идёт — иначе заплатим дважды", async () => {
    const { finished } = await startJob();

    const busy = await activeGeneration(payload, projectId, "audio");
    expect(busy).not.toBeNull();

    release!();
    await finished;
    expect(await activeGeneration(payload, projectId, "audio")).toBeNull();
  });
});

describe("маршрут синтеза", () => {
  const post = () =>
    synthesize(
      new Request("http://localhost/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ssml: SSML, voice: "en-GB-Chirp3-HD-Charon" }),
      }),
      { params: Promise.resolve({ id: String(projectId) }) },
    );

  it("отвечает 202 ДО того, как работа кончилась — ради этого всё и делалось", async () => {
    const response = await post();

    expect(response.status).toBe(202);
    const body = (await response.json()) as { generationId: number; status: string };
    expect(body.status).toBe("running");

    // Ответ уже у клиента, а синтез всё ещё висит внутри мока: значит вкладку
    // в этот момент можно закрыть. Без фоновой работы ответа бы ещё не было.
    expect(synthCalls).toBe(1);
    expect(release).toBeDefined();

    const generation = await payload.findByID({
      collection: "generations",
      id: body.generationId,
      overrideAccess: true,
    });
    expect(generation.status).toBe("running");

    release!();
    // Даём фоновой работе дописать результат.
    await vi.waitFor(async () => {
      const done = await payload.findByID({
        collection: "generations",
        id: body.generationId,
        overrideAccess: true,
      });
      expect(done.status).toBe("done");
    });
  });

  it("второй запуск во время работы отклоняется с 409", async () => {
    const first = await post();
    expect(first.status).toBe(202);

    const second = await post();
    expect(second.status).toBe(409);
    expect((await second.json()).error).toContain("уже идёт");
    // И денег не потратил: второго обращения к синтезу не было.
    expect(synthCalls).toBe(1);

    release!();
  });
});

describe("оборванная работа", () => {
  it("через порог считается прерванной, а не вечно идущей", async () => {
    await payload.create({
      collection: "generations",
      data: { project: projectId, kind: "audio", status: "running" },
      overrideAccess: true,
    });

    const later = Date.now() + STALE_AFTER_MS + 60_000;
    const stale = (await latestGenerations(payload, projectId, later)).audio;
    expect(stale?.status).toBe("running");
    expect(stale?.stale).toBe(true);

    // И не мешает запустить новую: иначе проект заклинило бы навсегда.
    expect(await activeGeneration(payload, projectId, "audio", later)).toBeNull();
  });

  it("закрывается отказом, чтобы не висеть в базе вечно", async () => {
    await payload.create({
      collection: "generations",
      data: { project: projectId, kind: "audio", status: "running" },
      overrideAccess: true,
    });

    const later = Date.now() + STALE_AFTER_MS + 60_000;
    expect(await failStaleGenerations(payload, projectId, later)).toBe(1);

    const closed = (await latestGenerations(payload, projectId, later)).audio;
    expect(closed?.status).toBe("failed");
    expect(closed?.error).toContain("прервана");
  });

  it("живую работу не трогает", async () => {
    const { finished } = await startJob();
    expect(await failStaleGenerations(payload, projectId)).toBe(0);
    release!();
    await finished;
  });
});
