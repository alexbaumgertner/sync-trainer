import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Участники события и произношение их имён (L2–L5).
 *
 * Связи с учётными записями здесь нет намеренно, в отличие от состава
 * кабины: участники — третьи лица, их согласия на хранение у нас нет.
 * Только текст, и только на время жизни проекта — каскад по `_parent_id`
 * уносит их вместе с ним.
 *
 * `pronunciation_unknown` отдельным полем, а не пустой строкой в
 * `pronunciation`: «не выяснено» и «не заполнено» — разные состояния,
 * и первое нужно видеть списком перед событием.
 *
 * Имя с `zz`, чтобы встать после `20260921_project_team`: Payload
 * применяет миграции по алфавиту.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE IF NOT EXISTS "projects_participants" (
     "_order" integer NOT NULL,
     "_parent_id" integer NOT NULL,
     "id" varchar PRIMARY KEY NOT NULL,
     "name" varchar NOT NULL,
     "organization" varchar,
     "pronunciation" varchar,
     "pronunciation_unknown" boolean DEFAULT false,
     "note" varchar
   );`)

  await db.execute(sql`
   DO $$ BEGIN
     ALTER TABLE "projects_participants" ADD CONSTRAINT "projects_participants_parent_id_fk"
       FOREIGN KEY ("_parent_id") REFERENCES "public"."projects"("id")
       ON DELETE cascade ON UPDATE no action;
   EXCEPTION WHEN duplicate_object THEN null; END $$;`)

  await db.execute(sql`
   CREATE INDEX IF NOT EXISTS "projects_participants_order_idx" ON "projects_participants" ("_order");`)
  await db.execute(sql`
   CREATE INDEX IF NOT EXISTS "projects_participants_parent_id_idx" ON "projects_participants" ("_parent_id");`)

  // B4: разбор списка участников — платный вызов модели, и статья расхода
  // у него своя. Лимит при этом общий (B5).
  await db.execute(sql`
   ALTER TYPE "public"."enum_usage_events_kind" ADD VALUE IF NOT EXISTS 'participants';`)

  // Шаг воронки: разбор списка участников — отдельное действие, и в отчёте
  // о том, докуда доходят люди, он должен быть виден.
  await db.execute(sql`
   ALTER TYPE "public"."enum_activity_step" ADD VALUE IF NOT EXISTS 'participants_imported';`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE IF EXISTS "projects_participants";`)
  // Значение из перечисления Postgres не убирается — см. 20260920_zz_glossary_step.
}
