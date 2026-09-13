import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    // Тесты доступа ходят в настоящую базу: права Payload нельзя проверить
    // на моках, потому что проверяет их сам движок запросов.
    include: ["tests/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    env: { NODE_ENV: "test" },
  },
  resolve: {
    alias: {
      "@": path.resolve(dirname, "src"),
      "@payload-config": path.resolve(dirname, "src/payload.config.ts"),
      "server-only": path.resolve(dirname, "tests/stubs/server-only.ts"),
    },
  },
});
