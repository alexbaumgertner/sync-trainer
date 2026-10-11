import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Испанский язык речи, пресет «Деловой перевод» и стилистики из админки.
 *
 *  - `es` в языке речи проекта и `business` в встроенных пресетах — два
 *    `ALTER TYPE ... ADD VALUE`. Локально их Payload через `push` молча не
 *    применяет (см. CLAUDE.md, «Ловушка со схемой»), поэтому и здесь, и там
 *    значения добавляются руками.
 *  - таблица `style_presets` — стилистики, которые администратор собирает сам.
 *    Списки там текстом по строке, поэтому дочерних таблиц нет.
 *  - `projects.custom_style_id` — необязательная связь. Колонка допускает
 *    NULL и при удалении стилистики обнуляется: проект не пропадает, а
 *    генерация откажет с понятным сообщением.
 *  - колонка в `payload_locked_documents_rels`: без неё Payload перестаёт
 *    сохранять документы любой коллекции (так однажды уже падал прод).
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_projects_source_lang" ADD VALUE IF NOT EXISTS 'es';`)
  await db.execute(sql`
   ALTER TYPE "public"."enum_projects_style_preset" ADD VALUE IF NOT EXISTS 'business';`)

  await db.execute(sql`
   CREATE TABLE IF NOT EXISTS "style_presets" (
     "id" serial PRIMARY KEY NOT NULL,
     "label" varchar NOT NULL,
     "setting" varchar NOT NULL,
     "register" varchar NOT NULL,
     "speaker_roles" varchar,
     "encouraged" varchar,
     "forbidden" varchar,
     "terminology_sources" varchar,
     "statistics" varchar,
     "avoid" varchar,
     "extra" varchar,
     "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
     "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
   );`)

  await db.execute(sql`
   CREATE INDEX IF NOT EXISTS "style_presets_updated_at_idx" ON "style_presets" ("updated_at");
   CREATE INDEX IF NOT EXISTS "style_presets_created_at_idx" ON "style_presets" ("created_at");`)

  await db.execute(sql`
   ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "custom_style_id" integer;`)

  await db.execute(sql`
   DO $$ BEGIN
     ALTER TABLE "projects" ADD CONSTRAINT "projects_custom_style_id_style_presets_id_fk"
       FOREIGN KEY ("custom_style_id") REFERENCES "public"."style_presets"("id")
       ON DELETE set null ON UPDATE no action;
   EXCEPTION WHEN duplicate_object THEN null; END $$;

   CREATE INDEX IF NOT EXISTS "projects_custom_style_idx" ON "projects" ("custom_style_id");`)

  await db.execute(sql`
   ALTER TABLE "payload_locked_documents_rels"
     ADD COLUMN IF NOT EXISTS "style_presets_id" integer;`)

  await db.execute(sql`
   DO $$ BEGIN
     ALTER TABLE "payload_locked_documents_rels"
       ADD CONSTRAINT "payload_locked_documents_rels_style_presets_fk"
       FOREIGN KEY ("style_presets_id") REFERENCES "public"."style_presets"("id")
       ON DELETE cascade ON UPDATE no action;
   EXCEPTION WHEN duplicate_object THEN null; END $$;

   CREATE INDEX IF NOT EXISTS "payload_locked_documents_rels_style_presets_id_idx"
     ON "payload_locked_documents_rels" ("style_presets_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // Значения из перечислений Postgres не убираются — см. 20260920_zz_glossary_step.
  await db.execute(sql`
   ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "style_presets_id";
   ALTER TABLE "projects" DROP COLUMN IF EXISTS "custom_style_id";
   DROP TABLE IF EXISTS "style_presets";`)
}
