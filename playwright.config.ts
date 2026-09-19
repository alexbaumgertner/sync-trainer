import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertLocalDatabase, loadLocalEnv } from "./tests/local-env";

/**
 * Окружение для прогона.
 *
 * `.env.local` читает только сервер Next, который мы поднимаем ниже, —
 * а сами тесты ходят в базу своим кодом, в этом процессе. Без этих строк
 * прогон падает шестью файлами сразу: `ECONNREFUSED :5432` при живой базе
 * на другом порту и «missing secret key».
 *
 * Уже заданное окружение сильнее файла: в CI переменные приходят снаружи,
 * и перебивать их файлом разработчика нельзя. Рабочие процессы наследуют
 * `process.env` родителя, поэтому достаточно заполнить его здесь.
 */
const dirname = path.dirname(fileURLToPath(import.meta.url));

for (const [key, value] of Object.entries(loadLocalEnv(dirname))) {
  process.env[key] ??= value;
}
// Проверяем то, с чем прогон реально пойдёт в базу, а не только файл:
// переменная из оболочки могла указать куда угодно.
assertLocalDatabase(process.env);

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Собранное приложение, а не dev: e2e должен проверять то, что поедет в прод.
    command: `npm run build && npx next start --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
