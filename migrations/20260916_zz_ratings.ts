import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Оценки сгенерированного материала.
 *
 * Схема списана с той, что Payload создаёт через `push` на локальной базе,
 * а не сочинена: у него свои умолчания — `numeric` под числовое поле,
 * `ON DELETE SET NULL` у связей, индексы на обе временные колонки.
 *
 * В одном файле, кроме самой таблицы, ещё две вещи, и обе забывались раньше
 * с последствиями:
 *
 *  - колонка в `payload_locked_documents_rels`. Payload опрашивает там по
 *    колонке на каждую коллекцию ПРИ ЛЮБОЙ записи; в прошлый раз без неё
 *    перестал сохраняться профиль, и это был прод;
 *  - новое значение в типе шагов воронки. Добавить шаг в TypeScript и забыть
 *    `ALTER TYPE` — способ положить запись в проде, оставив тесты зелёными:
 *    локально тип держит `push`.
 *
 * Имя с `zz`, чтобы миграция встала последней: Payload применяет их по
 * алфавиту, а `generations` и `projects` должны существовать раньше.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   DO $$ BEGIN
     CREATE TYPE "public"."enum_ratings_target" AS ENUM('audio', 'glossary', 'script');
   EXCEPTION WHEN duplicate_object THEN null; END $$;`)

  await db.execute(sql`
   ALTER TYPE "public"."enum_activity_step" ADD VALUE IF NOT EXISTS 'rating_given';`)

  await db.execute(sql`
   CREATE TABLE IF NOT EXISTS "ratings" (
     "id" serial PRIMARY KEY NOT NULL,
     "project_id" integer NOT NULL,
     "generation_id" integer,
     "user_id" integer,
     "target" "enum_ratings_target" NOT NULL,
     "score" numeric NOT NULL,
     "note" varchar,
     "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
     "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
   );`)

  await db.execute(sql`
   DO $$ BEGIN
     ALTER TABLE "ratings" ADD CONSTRAINT "ratings_project_id_projects_id_fk"
       FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id")
       ON DELETE set null ON UPDATE no action;
   EXCEPTION WHEN duplicate_object THEN null; END $$;

   DO $$ BEGIN
     ALTER TABLE "ratings" ADD CONSTRAINT "ratings_generation_id_generations_id_fk"
       FOREIGN KEY ("generation_id") REFERENCES "public"."generations"("id")
       ON DELETE set null ON UPDATE no action;
   EXCEPTION WHEN duplicate_object THEN null; END $$;

   DO $$ BEGIN
     ALTER TABLE "ratings" ADD CONSTRAINT "ratings_user_id_users_id_fk"
       FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
       ON DELETE set null ON UPDATE no action;
   EXCEPTION WHEN duplicate_object THEN null; END $$;`)

  await db.execute(sql`
   CREATE INDEX IF NOT EXISTS "ratings_project_idx" ON "ratings" ("project_id");
   CREATE INDEX IF NOT EXISTS "ratings_generation_idx" ON "ratings" ("generation_id");
   CREATE INDEX IF NOT EXISTS "ratings_user_idx" ON "ratings" ("user_id");
   CREATE INDEX IF NOT EXISTS "ratings_target_idx" ON "ratings" ("target");
   CREATE INDEX IF NOT EXISTS "ratings_updated_at_idx" ON "ratings" ("updated_at");
   CREATE INDEX IF NOT EXISTS "ratings_created_at_idx" ON "ratings" ("created_at");`)

  await db.execute(sql`
   ALTER TABLE "payload_locked_documents_rels"
     ADD COLUMN IF NOT EXISTS "ratings_id" integer;`)

  await db.execute(sql`
   DO $$ BEGIN
     ALTER TABLE "payload_locked_documents_rels"
       ADD CONSTRAINT "payload_locked_documents_rels_ratings_fk"
       FOREIGN KEY ("ratings_id") REFERENCES "public"."ratings"("id")
       ON DELETE cascade ON UPDATE no action;
   EXCEPTION WHEN duplicate_object THEN null; END $$;

   CREATE INDEX IF NOT EXISTS "payload_locked_documents_rels_ratings_id_idx"
     ON "payload_locked_documents_rels" ("ratings_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // Значение из типа-перечисления обратно не убирается: Postgres этого
  // не умеет, а пересоздавать тип ради отката дороже, чем оставить лишнее.
  await db.execute(sql`
   ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "ratings_id";
   DROP TABLE IF EXISTS "ratings";
   DROP TYPE IF EXISTS "public"."enum_ratings_target";`)
}
