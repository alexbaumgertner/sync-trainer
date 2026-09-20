import { expect, test, type BrowserContext } from "@playwright/test";
import { getPayload } from "payload";
import config from "../../src/payload.config";
import { SESSION_COOKIE, issueToken } from "../../src/lib/session";

/**
 * Правка глоссария на собранном приложении.
 *
 * Модульные тесты проверяют действия напрямую и не видят того, что между
 * ними и человеком: раскрывается ли строка, уходит ли форма, возвращается ли
 * страница с новым содержимым. Ровно здесь и ломается при перестановке кода.
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
      data: { email: `e2e-gloss-${stamp}@example.test`, displayName: "Хозяйка", role: "interpreter" },
      overrideAccess: true,
    })
  ).id as number;

  projectId = (
    await payload.create({
      collection: "projects",
      data: {
        title: `Глоссарий ${stamp}`,
        owner: userId,
        sourceLang: "en",
        targetLang: "ru",
        stylePreset: "un",
        status: "draft",
      },
      overrideAccess: true,
    })
  ).id as number;

  await payload.create({
    collection: "glossary-terms",
    data: {
      scope: "project",
      project: projectId,
      sourceTerm: "civic space",
      targetTerm: "гражданское пространство",
      status: "suggested",
    },
    overrideAccess: true,
  });
});

test.afterAll(async () => {
  const payload = await getPayload({ config });
  await payload.delete({ collection: "projects", id: projectId, overrideAccess: true }).catch(() => {});
  await payload.delete({ collection: "users", id: userId, overrideAccess: true }).catch(() => {});
});

test("термин правится, и пометка «предложен моделью» слетает", async ({ page, context }) => {
  await signIn(context);
  await page.goto(`/projects/${projectId}/glossary`);

  await expect(page.getByText("предложен моделью")).toBeVisible();

  await page.getByRole("button", { name: "Править" }).click();
  const target = page.getByLabel("Эквивалент").first();
  await target.fill("пространство гражданского общества");
  await page.getByRole("button", { name: "Сохранить" }).click();

  await expect(page.getByText("пространство гражданского общества")).toBeVisible();
  // Человек написал перевод своей рукой — подтверждения он не требует,
  // и в выгрузке пометки «не подтверждён» у него уже не будет.
  await expect(page.getByText("предложен моделью")).toHaveCount(0);
});

test("вариант добавляется с автором и становится основным", async ({ page, context }) => {
  await signIn(context);
  await page.goto(`/projects/${projectId}/glossary`);

  await page.getByRole("button", { name: "Править" }).click();
  await page.getByLabel("Запасной эквивалент").fill("гражданское пространство");
  await page.getByLabel("Когда он уместен").fill("в отчётах ООН");
  await page.getByRole("button", { name: "Добавить вариант" }).click();

  const variant = page.locator("li", { hasText: "вариант:" }).first();
  await expect(variant).toContainText("гражданское пространство");
  await expect(variant).toContainText("вы");
  await expect(variant).toContainText("в отчётах ООН");

  await page.getByRole("button", { name: "сделать основным" }).first().click();

  // Прежний эквивалент не исчез, а стал вариантом: выбор обратим.
  await expect(page.locator("li", { hasText: "вариант:" }).first()).toContainText(
    "пространство гражданского общества",
  );
});

test("термин заводится руками и сразу без пометки", async ({ page, context }) => {
  await signIn(context);
  await page.goto(`/projects/${projectId}/glossary`);

  await page.getByRole("button", { name: "Добавить термин" }).click();
  await page.getByLabel("Термин").last().fill("relay");
  await page.getByLabel("Эквивалент").last().fill("перевод через пилот");
  await page.getByRole("button", { name: "Добавить", exact: true }).click();

  await expect(page.getByText("relay")).toBeVisible();
  await expect(page.getByText("перевод через пилот")).toBeVisible();
  await expect(page.getByText("предложен моделью")).toHaveCount(0);
});

test("на карточке проекта глоссарий стоит выше файлов", async ({ page, context }) => {
  // I1: порядок на странице — это и есть порядок работы. Проверяем именно
  // взаимное расположение, а не наличие заголовков: пока глоссарий стоял
  // последним, он и читался как побочный продукт озвучки.
  await signIn(context);
  await page.goto(`/projects/${projectId}`);

  const headings = await page.getByRole("heading", { level: 2 }).allTextContents();
  const documents = headings.indexOf("Исходные документы");
  const glossary = headings.indexOf("Глоссарий");
  const files = headings.indexOf("Файлы проекта");

  expect(documents).toBeGreaterThanOrEqual(0);
  expect(glossary).toBeGreaterThan(documents);
  expect(files).toBeGreaterThan(glossary);
});

test("глоссарий правится прямо на карточке проекта и там же остаётся", async ({ page, context }) => {
  // I2: раскрыть, поправить и остаться. Раньше правка уносила на отдельную
  // страницу — то есть со страницы, где человек работает, на другую.
  await signIn(context);
  await page.goto(`/projects/${projectId}`);

  await page.getByText("Открыть и править").click();

  const row = page.locator("li", { hasText: "civic space" }).first();
  await row.getByRole("button", { name: "Править" }).click();
  await row.getByLabel("Эквивалент", { exact: true }).fill("пространство гражданского участия");
  await row.getByRole("button", { name: "Сохранить" }).click();

  // Сначала дожидаемся самой правки в разметке: без этого следующий щелчок
  // уходит в страницу, которую вот-вот заменят, и пропадает.
  const saved = page.getByText("пространство гражданского участия");
  await expect(saved).toBeAttached();

  // Вернулись на карточку проекта, а не уехали на страницу глоссария
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}(#glossary)?$`));

  // Редактор после возврата свёрнут — раскрываем и убеждаемся, что правка легла
  await page.getByText("Открыть и править").click();
  await expect(saved).toBeVisible();
});

test("кнопка сборки не работает без материалов и говорит почему", async ({ page, context }) => {
  await signIn(context);
  await page.goto(`/projects/${projectId}`);

  const build = page.getByRole("button", { name: /Собрать глоссарий|Дособрать по материалам/ });
  await expect(build).toBeDisabled();
  await expect(
    page.getByText("Сначала загрузите материалы события — собирать не из чего."),
  ).toBeVisible();
});
