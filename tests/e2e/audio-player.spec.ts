import { expect, test, type BrowserContext } from "@playwright/test";
import { getPayload } from "payload";
import config from "../../src/payload.config";
import { SESSION_COOKIE, issueToken } from "../../src/lib/session";
import { artifactPath, putArtifact } from "../../src/lib/artifacts";
import { Mp3Encoder } from "@breezystack/lamejs";

/**
 * Проигрыватель озвучки на странице проекта.
 *
 * Главное, что здесь проверяется: звук играет НЕ ДОЖИДАЯСЬ формы волны.
 * Форма — украшение поверх обычного <audio>, и если она однажды перестанет
 * приходить, человек этого не должен заметить иначе как отсутствием картинки.
 */

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
let userId: number;
let projectId: number;

async function signIn(context: BrowserContext) {
  const { token } = issueToken(userId);
  await context.addCookies([
    { name: SESSION_COOKIE, value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
}

test.beforeAll(async () => {
  const payload = await getPayload({ config });
  userId = (
    await payload.create({
      collection: "users",
      data: { email: `e2e-audio-${stamp}@example.test`, role: "interpreter" },
      overrideAccess: true,
    })
  ).id as number;

  projectId = (
    await payload.create({
      collection: "projects",
      data: {
        title: `Озвучка ${stamp}`,
        owner: userId,
        sourceLang: "en",
        targetLang: "ru",
        stylePreset: "un",
        status: "draft",
      },
      overrideAccess: true,
    })
  ).id as number;

  // Двенадцать секунд «речи с паузами», собранных прямо здесь: тон,
  // тишина, тон. Настоящей озвучке в репозитории не место — это чужие
  // материалы, — а плоская тишина не показала бы, что форма волны вообще
  // рисуется. `src/lib/silence.ts` помечен `server-only` и из теста
  // Playwright не импортируется, поэтому кодируем сами.
  const mp3 = (() => {
    const rate = 24000;
    const encoder = new Mp3Encoder(1, rate, 64);
    const parts: Buffer[] = [];
    const frame = new Int16Array(1152);
    for (let i = 0; i < Math.floor((rate * 12) / 1152); i += 1) {
      const second = Math.floor((i * 1152) / rate);
      const speaking = second % 3 !== 2;
      for (let n = 0; n < frame.length; n += 1) {
        const t = (i * 1152 + n) / rate;
        // Слегка гуляющая громкость: ровный тон дал бы кирпич,
        // а нам важно увидеть, что столбики разной высоты.
        const envelope = 0.55 + 0.45 * Math.sin(2 * Math.PI * 0.7 * t);
        frame[n] = speaking ? Math.round(Math.sin(2 * Math.PI * 200 * t) * 11000 * envelope) : 0;
      }
      const chunk = encoder.encodeBuffer(frame);
      if (chunk.length) parts.push(Buffer.from(chunk));
    }
    const tail = encoder.flush();
    if (tail.length) parts.push(Buffer.from(tail));
    return Buffer.concat(parts);
  })();
  const blobPath = artifactPath(projectId, "audio.mp3");
  await putArtifact(blobPath, mp3, "audio/mpeg");
  await payload.create({
    collection: "artifacts",
    data: { project: projectId, kind: "audio", blobPath, bytes: mp3.length },
    overrideAccess: true,
  });
});

test.afterAll(async () => {
  const payload = await getPayload({ config });
  await payload.delete({ collection: "projects", id: projectId, overrideAccess: true }).catch(() => {});
  await payload.delete({ collection: "users", id: userId, overrideAccess: true }).catch(() => {});
});

test("озвучка играет со страницы", async ({ page, context }) => {
  await signIn(context);
  await page.goto(`/projects/${projectId}`);

  const play = page.getByRole("button", { name: "Слушать" });
  await expect(play).toBeVisible();
  await play.click();

  await expect(page.getByRole("button", { name: "Пауза" })).toBeVisible();
  const playing = await page.evaluate(() => {
    const audio = document.querySelector("audio");
    return audio ? !audio.paused : false;
  });
  expect(playing).toBe(true);
});

test("звук не ждёт формы волны", async ({ page, context }) => {
  await signIn(context);
  // Форму волны не отдаём вовсе — проигрыватель обязан работать.
  await page.route("**/peaks", (route) => route.abort());
  await page.goto(`/projects/${projectId}`);

  await page.getByRole("button", { name: "Слушать" }).click();
  await expect(page.getByRole("button", { name: "Пауза" })).toBeVisible();
});

test("дорожка доступна с клавиатуры", async ({ page, context }) => {
  await signIn(context);
  await page.goto(`/projects/${projectId}`);

  const track = page.getByRole("slider");
  await expect(track).toBeVisible();
  // Скринридер должен объявлять положение во времени, а не «холст».
  await expect(track).toHaveAttribute("aria-valuetext", /0:00 из/);

  await track.focus();
  await page.keyboard.press("ArrowRight");
  await expect(track).toHaveAttribute("aria-valuenow", "5");

  await page.keyboard.press("ArrowLeft");
  await expect(track).toHaveAttribute("aria-valuenow", "0");
});

test("перемотка действительно двигает звук", async ({ page, context }) => {
  // Найдено живым использованием: ползунок двигался, время менялось,
  // а звук шёл с прежнего места — маршрут не поддерживал `Range`.
  // Поэтому проверяем не подпись под ползунком, а `currentTime` у самого
  // элемента, и не сразу, а после того как браузер подтвердит перемотку.
  await signIn(context);
  await page.goto(`/projects/${projectId}`);

  await page.getByRole("slider").waitFor();
  await page.waitForFunction(() => {
    const audio = document.querySelector("audio");
    return !!audio && Number.isFinite(audio.duration) && audio.duration > 1;
  });

  const seeked = await page.evaluate(async () => {
    const audio = document.querySelector("audio")!;
    const target = audio.duration * 0.75;
    await new Promise<void>((resolve) => {
      audio.addEventListener("seeked", () => resolve(), { once: true });
      audio.currentTime = target;
      setTimeout(resolve, 4000);
    });
    return { at: audio.currentTime, target };
  });

  expect(Math.abs(seeked.at - seeked.target)).toBeLessThan(1);
});

test("щелчок по дорожке перематывает", async ({ page, context }) => {
  await signIn(context);
  await page.goto(`/projects/${projectId}`);

  const track = page.getByRole("slider");
  await track.waitFor();
  await page.waitForFunction(() => {
    const audio = document.querySelector("audio");
    return !!audio && Number.isFinite(audio.duration) && audio.duration > 1;
  });

  const box = (await track.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);

  await expect
    .poll(async () => page.evaluate(() => document.querySelector("audio")?.currentTime ?? 0))
    .toBeGreaterThan(6);
});

test("скорость переключается", async ({ page, context }) => {
  await signIn(context);
  await page.goto(`/projects/${projectId}`);

  await page.getByRole("button", { name: "1.5×" }).click();
  const rate = await page.evaluate(() => document.querySelector("audio")?.playbackRate);
  expect(rate).toBe(1.5);
});

test("как это выглядит", async ({ page, context }) => {
  await signIn(context);
  await page.goto(`/projects/${projectId}`);
  await page.getByRole("slider").waitFor();
  await page.waitForTimeout(1500);
  await page.locator("section", { hasText: "Файлы проекта" }).screenshot({ path: "test-results/player.png" });
});
