import { expect, test } from "@playwright/test";

/**
 * Проверяем границу доступа и сценарий входа целиком на собранном приложении:
 * именно это ломается незаметно при рефакторинге.
 */

test.describe("доступ без входа", () => {
  test("главная показывает вход по почте, а не студию", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByLabel("Почта")).toBeVisible();
    await expect(page.getByText("Загрузить пример")).toHaveCount(0);
  });

  for (const path of ["/api/usage", "/api/voices"]) {
    test(`${path} отвечает 401`, async ({ request }) => {
      expect((await request.get(path)).status()).toBe(401);
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
    await expect(page).toHaveURL(/\/admin\/(login|create-first-user)/);
  });
});

test.describe("вход по коду", () => {
  test("после ввода почты просит код", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Почта").fill(`e2e-${Date.now()}@example.test`);
    await page.getByRole("button", { name: "Получить код" }).click();

    await expect(page.getByLabel("Код из письма")).toBeVisible();
    // Формулировка не выдаёт, приглашён ли адрес (A4)
    await expect(page.getByText(/если этот адрес приглашён/)).toBeVisible();
  });

  test("неверный код отклоняется", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Почта").fill(`e2e-bad-${Date.now()}@example.test`);
    await page.getByRole("button", { name: "Получить код" }).click();

    await page.getByLabel("Код из письма").fill("000000");
    await page.getByRole("button", { name: "Войти" }).click();

    await expect(page.getByText(/Код неверный или истёк/)).toBeVisible();
  });

  test("можно вернуться к вводу адреса", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Почта").fill(`e2e-back-${Date.now()}@example.test`);
    await page.getByRole("button", { name: "Получить код" }).click();
    await page.getByRole("button", { name: "Ввести другой адрес" }).click();

    await expect(page.getByLabel("Почта")).toBeVisible();
  });
});

test.describe("приглашения", () => {
  test("недействительная ссылка объясняет, что делать", async ({ page }) => {
    await page.goto("/invite/заведомо-негодный-токен");
    await expect(page.getByText("Ссылка не сработала")).toBeVisible();
    await expect(page.getByRole("link", { name: "Ко входу" })).toBeVisible();
  });
});
