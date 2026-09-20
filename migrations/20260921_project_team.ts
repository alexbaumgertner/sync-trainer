import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Состав кабины у проекта (L1) и подпись правившего термин (K5).
 *
 * Команда у проекта — про будущее, в отличие от команды записи о работе:
 * она нужна не для истории, а для доступа. Глоссарий проекта выверяют
 * между собой те, кто пойдёт с ним в кабину, и права на это выдаёт
 * именно эта таблица.
 *
 * `user_id` — `ON DELETE SET NULL`: удаление учётной записи коллеги не
 * должно стирать его имя из чужого проекта. Имя остаётся текстом, связь
 * исчезает — и доступ вместе с ней.
 *
 * Имя файла с датой следующего дня, чтобы встать после всех сегодняшних:
 * Payload применяет миграции по алфавиту, а `projects` должна существовать
 * раньше этой таблицы.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE IF NOT EXISTS "projects_team" (
     "_order" integer NOT NULL,
     "_parent_id" integer NOT NULL,
     "id" varchar PRIMARY KEY NOT NULL,
     "name" varchar NOT NULL,
     "email" varchar,
     "user_id" integer,
     "booth" varchar
   );`)

  await db.execute(sql`
   DO $$ BEGIN
     ALTER TABLE "projects_team" ADD CONSTRAINT "projects_team_parent_id_fk"
       FOREIGN KEY ("_parent_id") REFERENCES "public"."projects"("id")
       ON DELETE cascade ON UPDATE no action;
   EXCEPTION WHEN duplicate_object THEN null; END $$;`)

  await db.execute(sql`
   DO $$ BEGIN
     ALTER TABLE "projects_team" ADD CONSTRAINT "projects_team_user_id_fk"
       FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
       ON DELETE set null ON UPDATE no action;
   EXCEPTION WHEN duplicate_object THEN null; END $$;`)

  await db.execute(sql`
   CREATE INDEX IF NOT EXISTS "projects_team_order_idx" ON "projects_team" ("_order");`)
  await db.execute(sql`
   CREATE INDEX IF NOT EXISTS "projects_team_parent_id_idx" ON "projects_team" ("_parent_id");`)
  await db.execute(sql`
   CREATE INDEX IF NOT EXISTS "projects_team_user_idx" ON "projects_team" ("user_id");`)

  // K5: подпись последнего правившего. Обнуляемая и SET NULL — иначе
  // пользователя, правившего чужой глоссарий, нельзя будет удалить.
  await db.execute(sql`
   ALTER TABLE "glossary_terms" ADD COLUMN IF NOT EXISTS "edited_by_id" integer;`)

  await db.execute(sql`
   DO $$ BEGIN
     ALTER TABLE "glossary_terms" ADD CONSTRAINT "glossary_terms_edited_by_id_users_id_fk"
       FOREIGN KEY ("edited_by_id") REFERENCES "public"."users"("id")
       ON DELETE set null ON UPDATE no action;
   EXCEPTION WHEN duplicate_object THEN null; END $$;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "glossary_terms" DROP COLUMN IF EXISTS "edited_by_id";`)
  await db.execute(sql`
   DROP TABLE IF EXISTS "projects_team";`)
}
