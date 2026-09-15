import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Записи о проведённой работе (W1–W5).
 *
 * Схема списана с той, что Payload создаёт через `push` на локальной базе.
 *
 * Внешний ключ на проект — `ON DELETE SET NULL`, а не каскад: удаление проекта
 * не должно стирать запись о конференции, которая действительно была. Проект —
 * это подготовка, запись — факт, и факт переживает подготовку. Ради этого
 * `project_id` и сделан необязательным (W2).
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   DO $$ BEGIN
     CREATE TYPE "public"."enum_engagements_mode" AS ENUM('simultaneous','rsi','consecutive','whispered');
   EXCEPTION WHEN duplicate_object THEN null; END $$;

   DO $$ BEGIN
     CREATE TYPE "public"."enum_engagements_source_lang" AS ENUM('ru','en','de','fr','es','it','pt','tr','zh','ar','uk','pl');
   EXCEPTION WHEN duplicate_object THEN null; END $$;

   DO $$ BEGIN
     CREATE TYPE "public"."enum_engagements_target_lang" AS ENUM('ru','en','de','fr','es','it','pt','tr','zh','ar','uk','pl');
   EXCEPTION WHEN duplicate_object THEN null; END $$;

   DO $$ BEGIN
     CREATE TYPE "public"."enum_engagements_visibility" AS ENUM('private','team');
   EXCEPTION WHEN duplicate_object THEN null; END $$;

   CREATE TABLE IF NOT EXISTS "engagements" (
     "id" serial PRIMARY KEY NOT NULL,
     "owner_id" integer NOT NULL,
     "project_id" integer,
     "title" varchar NOT NULL,
     "organizer" varchar,
     "held_on" timestamp(3) with time zone NOT NULL,
     "location" varchar,
     "mode" "public"."enum_engagements_mode" DEFAULT 'simultaneous' NOT NULL,
     "source_lang" "public"."enum_engagements_source_lang" NOT NULL,
     "target_lang" "public"."enum_engagements_target_lang" NOT NULL,
     "went_how" numeric,
     "went_text" varchar,
     "visibility" "public"."enum_engagements_visibility" DEFAULT 'team' NOT NULL,
     "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
     "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
   );

   CREATE TABLE IF NOT EXISTS "engagements_speakers" (
     "_order" integer NOT NULL,
     "_parent_id" integer NOT NULL,
     "id" varchar PRIMARY KEY NOT NULL,
     "name" varchar NOT NULL,
     "organization" varchar
   );`)

  await db.execute(sql`
   DO $$ BEGIN
     ALTER TABLE "engagements" ADD CONSTRAINT "engagements_owner_id_fk"
       FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id")
       ON DELETE set null ON UPDATE no action;
   EXCEPTION WHEN duplicate_object THEN null; END $$;

   DO $$ BEGIN
     ALTER TABLE "engagements" ADD CONSTRAINT "engagements_project_id_fk"
       FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id")
       ON DELETE set null ON UPDATE no action;
   EXCEPTION WHEN duplicate_object THEN null; END $$;

   DO $$ BEGIN
     ALTER TABLE "engagements_speakers" ADD CONSTRAINT "engagements_speakers_parent_id_fk"
       FOREIGN KEY ("_parent_id") REFERENCES "public"."engagements"("id")
       ON DELETE cascade ON UPDATE no action;
   EXCEPTION WHEN duplicate_object THEN null; END $$;

   CREATE INDEX IF NOT EXISTS "engagements_owner_idx" ON "engagements" ("owner_id");
   CREATE INDEX IF NOT EXISTS "engagements_project_idx" ON "engagements" ("project_id");
   CREATE INDEX IF NOT EXISTS "engagements_updated_at_idx" ON "engagements" ("updated_at");
   CREATE INDEX IF NOT EXISTS "engagements_created_at_idx" ON "engagements" ("created_at");
   CREATE INDEX IF NOT EXISTS "engagements_speakers_order_idx" ON "engagements_speakers" ("_order");
   CREATE INDEX IF NOT EXISTS "engagements_speakers_parent_id_idx" ON "engagements_speakers" ("_parent_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE IF EXISTS "engagements_speakers";
   DROP TABLE IF EXISTS "engagements";
   DROP TYPE IF EXISTS "public"."enum_engagements_mode";
   DROP TYPE IF EXISTS "public"."enum_engagements_source_lang";
   DROP TYPE IF EXISTS "public"."enum_engagements_target_lang";
   DROP TYPE IF EXISTS "public"."enum_engagements_visibility";`)
}
