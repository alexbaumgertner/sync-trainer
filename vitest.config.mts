import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Vite намеренно не читает `.env.local` в режиме test, а интеграционные тесты
// ходят в настоящую базу и без её адреса просто падают. Читаем сами, режимом
// development, и без префикса — нам нужны все переменные, а не только VITE_*.
const localEnv = loadEnv("development", dirname, "");

// Тесты создают и удаляют записи. Если в `.env.local` когда-нибудь окажется
// боевая строка подключения, они вычистят боевые данные — поэтому чужая база
// останавливает запуск здесь, а не после первого `delete`.
const dbHost = (() => {
  const url = localEnv.DATABASE_URI ?? localEnv.DATABASE_URL ?? localEnv.POSTGRES_URL;
  try {
    return url ? new URL(url).hostname : "";
  } catch {
    return "";
  }
})();
if (dbHost && !["localhost", "127.0.0.1", "::1", "postgres"].includes(dbHost)) {
  throw new Error(
    `Тесты пишут в базу и запускаются только на локальной: в .env.local указан узел ${dbHost}`,
  );
}

export default defineConfig({
  test: {
    // Тесты доступа ходят в настоящую базу: права Payload нельзя проверить
    // на моках, потому что проверяет их сам движок запросов.
    include: ["tests/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    env: { ...localEnv, NODE_ENV: "test" },
  },
  resolve: {
    alias: {
      "@": path.resolve(dirname, "src"),
      "@payload-config": path.resolve(dirname, "src/payload.config.ts"),
      "server-only": path.resolve(dirname, "tests/stubs/server-only.ts"),
    },
  },
});
