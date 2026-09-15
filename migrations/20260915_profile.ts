import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Профиль переводчика (P1–P3).
 *
 * Схема списана с той, что Payload создаёт сам через `push` на локальной базе,
 * а не сочинена по памяти: у массивов свои служебные колонки (`_order`,
 * `_parent_id`, строковый `id`), и расхождение вылезло бы только в проде.
 *
 * Перечисление языков profile-уровня шире языков генерации: тренажёр умеет
 * то, на что есть пресеты и голоса, а переводчик работает с чем работает.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   DO $$ BEGIN
     CREATE TYPE "public"."enum_users_language_pairs_source" AS ENUM('ru','en','de','fr','es','it','pt','tr','zh','ar','uk','pl');
   EXCEPTION WHEN duplicate_object THEN null; END $$;

   DO $$ BEGIN
     CREATE TYPE "public"."enum_users_language_pairs_target" AS ENUM('ru','en','de','fr','es','it','pt','tr','zh','ar','uk','pl');
   EXCEPTION WHEN duplicate_object THEN null; END $$;

   ALTER TABLE "users"
     ADD COLUMN IF NOT EXISTS "city" varchar,
     ADD COLUMN IF NOT EXISTS "bio" varchar,
     ADD COLUMN IF NOT EXISTS "visibility_city" boolean DEFAULT false,
     ADD COLUMN IF NOT EXISTS "visibility_bio" boolean DEFAULT false,
     ADD COLUMN IF NOT EXISTS "visibility_language_pairs" boolean DEFAULT false,
     ADD COLUMN IF NOT EXISTS "visibility_specializations" boolean DEFAULT false,
     ADD COLUMN IF NOT EXISTS "visibility_memberships" boolean DEFAULT false;

   CREATE TABLE IF NOT EXISTS "users_language_pairs" (
     "_order" integer NOT NULL,
     "_parent_id" integer NOT NULL,
     "id" varchar PRIMARY KEY NOT NULL,
     "source" "public"."enum_users_language_pairs_source" NOT NULL,
     "target" "public"."enum_users_language_pairs_target" NOT NULL
   );

   CREATE TABLE IF NOT EXISTS "users_specializations" (
     "_order" integer NOT NULL,
     "_parent_id" integer NOT NULL,
     "id" varchar PRIMARY KEY NOT NULL,
     "name" varchar NOT NULL
   );

   CREATE TABLE IF NOT EXISTS "users_memberships" (
     "_order" integer NOT NULL,
     "_parent_id" integer NOT NULL,
     "id" varchar PRIMARY KEY NOT NULL,
     "name" varchar NOT NULL
   );`)

  // Внешние ключи и индексы отдельно: DO-блоки выше уже отработали, и
  // повторный запуск не должен спотыкаться о существующее ограничение.
  for (const table of ['users_language_pairs', 'users_specializations', 'users_memberships']) {
    await db.execute(
      sql.raw(`
      DO $$ BEGIN
        ALTER TABLE "${table}" ADD CONSTRAINT "${table}_parent_id_fk"
          FOREIGN KEY ("_parent_id") REFERENCES "public"."users"("id")
          ON DELETE cascade ON UPDATE no action;
      EXCEPTION WHEN duplicate_object THEN null; END $$;

      CREATE INDEX IF NOT EXISTS "${table}_order_idx" ON "${table}" ("_order");
      CREATE INDEX IF NOT EXISTS "${table}_parent_id_idx" ON "${table}" ("_parent_id");`),
    )
  }
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE IF EXISTS "users_language_pairs";
   DROP TABLE IF EXISTS "users_specializations";
   DROP TABLE IF EXISTS "users_memberships";

   DROP TYPE IF EXISTS "public"."enum_users_language_pairs_source";
   DROP TYPE IF EXISTS "public"."enum_users_language_pairs_target";

   ALTER TABLE "users"
     DROP COLUMN IF EXISTS "city",
     DROP COLUMN IF EXISTS "bio",
     DROP COLUMN IF EXISTS "visibility_city",
     DROP COLUMN IF EXISTS "visibility_bio",
     DROP COLUMN IF EXISTS "visibility_language_pairs",
     DROP COLUMN IF EXISTS "visibility_specializations",
     DROP COLUMN IF EXISTS "visibility_memberships";`)
}
