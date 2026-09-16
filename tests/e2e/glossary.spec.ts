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
