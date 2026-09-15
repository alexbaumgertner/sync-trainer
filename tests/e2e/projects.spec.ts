import { expect, test, type BrowserContext } from "@playwright/test";
import { getPayload } from "payload";
import config from "../../src/payload.config";
import { SESSION_COOKIE, issueToken } from "../../src/lib/session";

/**
 * Сквозной сценарий проекта: создать, открыть, удалить.
 *
 * Сессию выписываем тем же кодом, что и приложение, и кладём куку в браузер —
 * получить код из письма в сквозном тесте неоткуда, а проверять надо работу
 * со страницами, а не ещё раз вход (он покрыт отдельно).
 */

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const email = `e2e-projects-${stamp}@example.test`;
let userId: number;

async function signIn(context: BrowserContext) {
  const { token } = issueToken(userId);
  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value: token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
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
});

test.afterAll(async () => {
  const payload = await getPayload({ config });
  const projects = await payload.find({
    collection: "projects",
    where: { owner: { equals: userId } },
    limit: 100,
    overrideAccess: true,
  });
  for (const project of projects.docs) {
    await payload.delete({ collection: "projects", id: project.id, overrideAccess: true });
  }
  await payload.delete({ collection: "users", id: userId, overrideAccess: true });
});

test("проект создаётся, открывается и удаляется", async ({ page, context }) => {
  await signIn(context);

  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "Проекты" })).toBeVisible();
  await expect(page.getByText("Проектов пока нет")).toBeVisible();

  await page.getByRole("link", { name: "Создать первый" }).click();
  await expect(page.getByRole("heading", { name: "Новый проект" })).toBeVisible();

  const title = `Панель ${stamp}`;
  await page.getByLabel("Название").fill(title);
  await page.getByLabel("Событие").fill("Weaving Alliances");
  await page.getByLabel("Место").fill("Стамбул");
  await page.getByRole("button", { name: "Создать" }).click();

  // Карточка открылась сразу после создания
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText("Weaving Alliances")).toBeVisible();
  await expect(page.getByText("Файлы проекта")).toBeVisible();

  // И проект виден в списке
  await page.getByRole("link", { name: "← Ко всем проектам" }).click();
  await expect(page.getByRole("link", { name: title })).toBeVisible();

  // Удаление с подтверждением
  await page.getByRole("link", { name: title }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Удалить проект" }).click();

  await expect(page.getByText("Проектов пока нет")).toBeVisible();
});

test("страницы проектов закрыты без входа", async ({ page }) => {
  await page.goto("/projects");
  await expect(page.getByLabel("Почта")).toBeVisible();
});
