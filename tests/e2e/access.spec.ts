import { expect, test } from "@playwright/test";

/**
 * Проверяем не вёрстку, а границу доступа: закрытые страницы и API не должны
 * отдавать ничего без входа. Это то, что ломается незаметно при рефакторинге.
 */

test.describe("доступ без входа", () => {
  test("главная показывает форму пароля, а не студию", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByLabel("Пароль")).toBeVisible();
    await expect(page.getByText("Загрузить пример")).toHaveCount(0);
  });

  for (const path of ["/api/usage", "/api/voices"]) {
    test(`${path} отвечает 401`, async ({ request }) => {
      const response = await request.get(path);
      expect(response.status()).toBe(401);
    });
  }

  test("/api/tts отвечает 401", async ({ request }) => {
    const response = await request.post("/api/tts", {
      data: { script: "test", mode: "single", voice: "en-US-Neural2-F" },
    });
    expect(response.status()).toBe(401);
  });

  test("админка Payload требует входа", async ({ page }) => {
    await page.goto("/admin");
    // Payload сам уводит на форму входа или на создание первого пользователя
    await expect(page).toHaveURL(/\/admin\/(login|create-first-user)/);
  });
});

test.describe("вход", () => {
  test("неверный пароль отклоняется", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Пароль").fill("заведомо-неверный");
    await page.getByRole("button", { name: "Войти" }).click();
    await expect(page.getByText("Неверный пароль")).toBeVisible();
  });
});
