import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Коллекция `activity` — продуктовая воронка (слой 2 метрик).
 *
 * Схема не сочинена, а списана с той, что Payload создаёт через `push` на
 * локальной базе: у него свои умолчания (`ON DELETE SET NULL` у связей,
 * индексы на `created_at` и `updated_at`, отдельный тип-перечисление), и
 * расхождение с ними вылезло бы только в проде.
 *
 * Служебная таблица блокировок правится здесь же, в одном файле. Payload
 * держит в `payload_locked_documents_rels` по колонке на каждую коллекцию
 * и опрашивает их ВСЕ при любой записи; в прошлый раз я про это забыл и
 * положил прод. Отдельной миграцией не делаю намеренно — разнеси их, и
 * однажды применится только первая.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   DO $$ BEGIN
     CREATE TYPE "public"."enum_activity_step" AS ENUM(
       'project_created', 'document_uploaded', 'script_generated',
       'audio_generated', 'glossary_exported', 'debrief_filled',
       'engagement_created', 'invite_sent', 'invite_accepted');
   EXCEPTION WHEN duplicate_object THEN null; END $$;`)

  await db.execute(sql`
   CREATE TABLE IF NOT EXISTS "activity" (
     "id" serial PRIMARY KEY NOT NULL,
     "user_id" integer NOT NULL,
     "project_id" integer,
     "step" "enum_activity_step" NOT NULL,
     "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
     "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
   );`)

  await db.execute(sql`
   DO $$ BEGIN
     ALTER TABLE "activity" ADD CONSTRAINT "activity_user_id_users_id_fk"
       FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
       ON DELETE set null ON UPDATE no action;
   EXCEPTION WHEN duplicate_object THEN null; END $$;

   DO $$ BEGIN
     ALTER TABLE "activity" ADD CONSTRAINT "activity_project_id_projects_id_fk"
       FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id")
       ON DELETE set null ON UPDATE no action;
   EXCEPTION WHEN duplicate_object THEN null; END $$;`)

  await db.execute(sql`
   CREATE INDEX IF NOT EXISTS "activity_user_idx" ON "activity" ("user_id");
   CREATE INDEX IF NOT EXISTS "activity_project_idx" ON "activity" ("project_id");
   CREATE INDEX IF NOT EXISTS "activity_step_idx" ON "activity" ("step");
   CREATE INDEX IF NOT EXISTS "activity_updated_at_idx" ON "activity" ("updated_at");
   CREATE INDEX IF NOT EXISTS "activity_created_at_idx" ON "activity" ("created_at");`)

  await db.execute(sql`
   ALTER TABLE "payload_locked_documents_rels"
     ADD COLUMN IF NOT EXISTS "activity_id" integer;`)

  await db.execute(sql`
   DO $$ BEGIN
     ALTER TABLE "payload_locked_documents_rels"
       ADD CONSTRAINT "payload_locked_documents_rels_activity_fk"
       FOREIGN KEY ("activity_id") REFERENCES "public"."activity"("id")
       ON DELETE cascade ON UPDATE no action;
   EXCEPTION WHEN duplicate_object THEN null; END $$;

   CREATE INDEX IF NOT EXISTS "payload_locked_documents_rels_activity_id_idx"
     ON "payload_locked_documents_rels" ("activity_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "activity_id";
   DROP TABLE IF EXISTS "activity";
   DROP TYPE IF EXISTS "public"."enum_activity_step";`)
}
