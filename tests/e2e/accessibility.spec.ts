import { expect, test, type BrowserContext } from "@playwright/test";
import { getPayload } from "payload";
import config from "../../src/payload.config";
import { SESSION_COOKIE, issueToken } from "../../src/lib/session";
import { artifactPath, putArtifact } from "../../src/lib/artifacts";

/**
 * Ориентиры страницы и объявления вслух.
 *
 * Lighthouse отмечал отсутствие `<main>` единственным провалом доступности:
 * без него человеку со скринридером нечем перепрыгнуть шапку, и он проходит
 * логотип, заголовок, две ссылки и адрес почты заново на каждой странице.
 *
 * Вторая половина важнее и в Lighthouse не видна вовсе. Синтез аудио идёт
 * минутами в фоне, и об окончании работы страница сообщала только тем, что
 * файл появлялся на экране. Живая область это озвучивает.
 */

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const email = `e2e-a11y-${stamp}@example.test`;
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
  const user = await payload.create({
    collection: "users",
    data: { email, role: "interpreter" },
    overrideAccess: true,
  });
  userId = user.id;

  const project = await payload.create({
    collection: "projects",
    data: {
      title: `Доступность ${stamp}`,
      owner: userId,
      sourceLang: "en",
      targetLang: "ru",
      stylePreset: "un",
      status: "draft",
    },
    overrideAccess: true,
  });
  projectId = project.id;

  // Редактор скрипта появляется, только когда у проекта есть SSML: без него
  // страница предлагает загрузить документ, и проверять было бы нечего.
  const blobPath = artifactPath(projectId, "ssml.ssml");
  const ssml = '<speak><voice name="A">Проверка.</voice></speak>';
  await putArtifact(blobPath, ssml, "application/ssml+xml");
  await payload.create({
    collection: "artifacts",
    data: { project: projectId, kind: "ssml", blobPath, bytes: ssml.length },
    overrideAccess: true,
  });
});

test.afterAll(async () => {
  const payload = await getPayload({ config });
  await payload.delete({ collection: "projects", id: projectId, overrideAccess: true }).catch(() => {});
  await payload.delete({ collection: "users", id: userId, overrideAccess: true }).catch(() => {});
});

test.describe("ориентиры страницы", () => {
  test("вход: ровно один main", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("main")).toHaveCount(1);
  });

  test("страница проекта: main, header и навигация с подписью", async ({ page, context }) => {
    await signIn(context);
    await page.goto(`/projects/${projectId}`);

    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.locator("header")).toHaveCount(1);
    // Подпись у навигации нужна, когда навигаций станет больше одной:
    // «навигация» и «навигация» на выбор — это не выбор.
    await expect(page.getByRole("navigation", { name: "Разделы" })).toBeAttached();
  });
});

test.describe("объявления вслух", () => {
  test("живая область есть в разметке до того, как в ней появится текст", async ({
    page,
    context,
  }) => {
    // Главное свойство, и его легко потерять: область, добавленную в разметку
    // ВМЕСТЕ с текстом, скринридеры объявляют ненадёжно. Поэтому она должна
    // быть на странице с самого начала и пустой.
    await signIn(context);
    await page.goto(`/projects/${projectId}/script`);

    const live = page.locator('[aria-live="polite"]');
    await expect(live).toHaveCount(1);
    await expect(live).toBeAttached();
    await expect(live).toHaveText("");
  });

  test("окончание синтеза объявляется", async ({ page, context }) => {
    await signIn(context);

    // Подменяем опрос состояния: сначала «идёт», потом «готово». Живой синтез
    // стоил бы денег и минут, а проверяем мы здесь не синтез, а объявление.
    let calls = 0;
    await page.route(`**/api/projects/${projectId}/generations`, async (route) => {
      calls += 1;
      const audio =
        calls <= 1
          ? { status: "running", stale: false, error: null }
          : { status: "done", stale: false, error: null };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ generations: { audio } }),
      });
    });

    await page.goto(`/projects/${projectId}/script`);

    // Область — обёртка над видимыми блоками, поэтому сперва в ней
    // оказывается текст «работа идёт», а затем — объявление об окончании,
    // которого на экране нет вовсе: файл просто появляется на странице.
    const live = page.locator('[aria-live="polite"]');
    await expect(live).toHaveText(/Работа идёт на сервере/, { timeout: 15_000 });
    await expect(live).toHaveText(/Аудио готово/, { timeout: 15_000 });
  });
});
