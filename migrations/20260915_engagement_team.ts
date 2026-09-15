import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Команда события (W3, W6) и заготовка под подтверждение (R2-4).
 *
 * `status` заведён сразу со всеми значениями, хотя R2-3 пользуется одним
 * `listed`: добавление значения в enum — отдельная миграция, а лишняя
 * миграция ради строки, известной заранее, никому не нужна.
 *
 * `user_id` — `ON DELETE SET NULL`: удаление учётной записи коллеги не должно
 * стирать его имя из чужой записи о работе (D7). Имя остаётся текстом, связь
 * исчезает.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   DO $$ BEGIN
     CREATE TYPE "public"."enum_engagements_team_status" AS ENUM('listed','invited','confirmed','disputed','withdrawn');
   EXCEPTION WHEN duplicate_object THEN null; END $$;

   CREATE TABLE IF NOT EXISTS "engagements_team" (
     "_order" integer NOT NULL,
     "_parent_id" integer NOT NULL,
     "id" varchar PRIMARY KEY NOT NULL,
     "name" varchar NOT NULL,
     "email" varchar,
     "user_id" integer,
     "booth" varchar,
     "status" "public"."enum_engagements_team_status" DEFAULT 'listed' NOT NULL,
     "confirmed_at" timestamp(3) with time zone,
     "note" varchar
   );`)

  await db.execute(sql`
   DO $$ BEGIN
     ALTER TABLE "engagements_team" ADD CONSTRAINT "engagements_team_parent_id_fk"
       FOREIGN KEY ("_parent_id") REFERENCES "public"."engagements"("id")
       ON DELETE cascade ON UPDATE no action;
   EXCEPTION WHEN duplicate_object THEN null; END $$;

   DO $$ BEGIN
     ALTER TABLE "engagements_team" ADD CONSTRAINT "engagements_team_user_id_fk"
       FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
       ON DELETE set null ON UPDATE no action;
   EXCEPTION WHEN duplicate_object THEN null; END $$;

   CREATE INDEX IF NOT EXISTS "engagements_team_order_idx" ON "engagements_team" ("_order");
   CREATE INDEX IF NOT EXISTS "engagements_team_parent_id_idx" ON "engagements_team" ("_parent_id");
   CREATE INDEX IF NOT EXISTS "engagements_team_user_idx" ON "engagements_team" ("user_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE IF EXISTS "engagements_team";
   DROP TYPE IF EXISTS "public"."enum_engagements_team_status";`)
}
