import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildConfig } from "payload";
import { postgresAdapter } from "@payloadcms/db-postgres";
import { lexicalEditor } from "@payloadcms/richtext-lexical";
import { resendAdapter } from "@payloadcms/email-resend";
import { collections } from "@/collections";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default buildConfig({
  // REST Payload уезжает с /api, иначе он перекрыл бы наши /api/tts и /api/usage.
  routes: { admin: "/admin", api: "/payload-api" },

  admin: {
    user: "users",
    importMap: { baseDir: path.resolve(dirname) },
    meta: { titleSuffix: "· Тренажёр синхрониста" },
  },

  collections,
  editor: lexicalEditor(),

  db: postgresAdapter({
    // Интеграция Postgres в Vercel подставляет переменную под своим именем,
    // поэтому принимаем все три и не заставляем дублировать её руками.
    pool: {
      connectionString:
        process.env.DATABASE_URI ??
        process.env.POSTGRES_URL ??
        process.env.DATABASE_URL ??
        "",
    },
    // Миграции хранятся в репозитории и применяются осознанно, а не на лету:
    // автоматическое изменение схемы в проде — способ потерять данные.
    push: process.env.NODE_ENV !== "production",
    migrationDir: path.resolve(dirname, "../migrations"),
  }),

  // Без ключа Payload печатает письма в консоль — в разработке это то,
  // что нужно, а в проде отсутствие ключа заметно сразу.
  ...(process.env.RESEND_API_KEY
    ? {
        email: resendAdapter({
          defaultFromAddress: process.env.EMAIL_FROM_ADDRESS ?? "noreply@example.com",
          defaultFromName: process.env.EMAIL_FROM_NAME ?? "Тренажёр синхрониста",
          apiKey: process.env.RESEND_API_KEY,
        }),
      }
    : {}),

  secret: process.env.PAYLOAD_SECRET ?? "",
  typescript: { outputFile: path.resolve(dirname, "payload-types.ts") },
  telemetry: false,

  // Загруженные документы удаляются после обработки (F1), но лимит нужен,
  // чтобы не принять 200 МБ в память.
  upload: { limits: { fileSize: 25 * 1024 * 1024 } },
});
