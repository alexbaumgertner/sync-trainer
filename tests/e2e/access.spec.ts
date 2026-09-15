import { expect, test } from "@playwright/test";
import { Client } from "pg";

/**
 * Проверяем границу доступа и сценарий входа целиком на собранном приложении:
 * именно это ломается незаметно при рефакторинге.
 */

/**
 * Ограничитель частоты кодов считает по базе, а не по памяти процесса, —
 * и прогоны копятся. Двадцати запросов с одного адреса сети в час хватает
 * примерно на семь прогонов подряд, после чего тест входа начинает падать
 * по собственному следу.
 *
 * Чистим только локальную тестовую базу и только здесь. Ослаблять сам
 * ограничитель ради тестов нельзя: он и есть то, что тут проверяется.
 */
test.beforeAll(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URI });
  await client.connect();
  try {
    await client.query("delete from otp_codes");
  } finally {
    await client.end();
  }
});

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

  test("синтез аудио отвечает 401", async ({ request }) => {
    const response = await request.post("/api/projects/1/audio", {
      data: { voice: "en-US-Neural2-F" },
    });
    expect(response.status()).toBe(401);
  });

  test("админка уводит на вход приложения", async ({ page }) => {
    // Тест ждал страниц Payload `/admin/login` и `/admin/create-first-user`.
    // Их больше нет: паролей в системе не осталось, а `src/proxy.ts`
    // разворачивает постороннего до отрисовки оболочки. Тест описывал
    // поведение, которого нет, и краснел с тех пор незамеченным —
    // сквозные проверки не входят в список перед коммитом.
    await page.goto("/admin");
    await expect(page).toHaveURL("/");
    await expect(page.getByLabel("Почта")).toBeVisible();
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
    // Подпись на кнопке сменилась вместе с отказом от паролей: ведёт она
    // не «ко входу» вообще, а именно ко входу по коду.
    await expect(page.getByRole("link", { name: "Войти по коду" })).toBeVisible();
  });
});
