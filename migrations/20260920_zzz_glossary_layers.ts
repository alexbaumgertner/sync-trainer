import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Три слоя глоссария (T1–T10).
 *
 * Связь с проектом перестаёт быть обязательной: у личного и общеприкладного
 * слоёв проекта нет. Это сокращение схемы, и локальный `push` на нём
 * останавливается, спрашивая подтверждение, — в неинтерактивном запуске
 * ответить некому (ловушка из CLAUDE.md). На проде схему меняет только эта
 * миграция, и вопросов она не задаёт.
 *
 * Значение `scope` проставляется всем существующим строкам как `project`:
 * до этой миграции других слоёв не было, и каждая строка лежала в проекте.
 * Поэтому колонка сразу NOT NULL — умолчание покрывает всю историю.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   DO $$ BEGIN
     CREATE TYPE "public"."enum_glossary_terms_scope" AS ENUM('project', 'personal', 'shared');
   EXCEPTION WHEN duplicate_object THEN null; END $$;`)

  await db.execute(sql`
   DO $$ BEGIN
     CREATE TYPE "public"."enum_glossary_terms_inherited_from" AS ENUM('personal', 'shared');
   EXCEPTION WHEN duplicate_object THEN null; END $$;`)

  await db.execute(sql`
   ALTER TABLE "glossary_terms" ALTER COLUMN "project_id" DROP NOT NULL;`)

  await db.execute(sql`
   ALTER TABLE "glossary_terms"
     ADD COLUMN IF NOT EXISTS "scope" "public"."enum_glossary_terms_scope" DEFAULT 'project' NOT NULL;`)

  await db.execute(sql`
   ALTER TABLE "glossary_terms" ADD COLUMN IF NOT EXISTS "owner_id" integer;`)

  // ON DELETE SET NULL на обнуляемой колонке — иначе пользователя с личным
  // глоссарием нельзя будет удалить. На этой связке уже спотыкались трижды
  // (см. docs/open-items.md), и тест `project-cascade` сторожит её повторение.
  await db.execute(sql`
   DO $$ BEGIN
     ALTER TABLE "glossary_terms"
       ADD CONSTRAINT "glossary_terms_owner_id_users_id_fk"
       FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id")
       ON DELETE SET NULL ON UPDATE NO ACTION;
   EXCEPTION WHEN duplicate_object THEN null; END $$;`)

  await db.execute(sql`
   ALTER TABLE "glossary_terms"
     ADD COLUMN IF NOT EXISTS "inherited_from" "public"."enum_glossary_terms_inherited_from";`)

  await db.execute(sql`
   ALTER TABLE "glossary_terms" ADD COLUMN IF NOT EXISTS "inherited_target" varchar;`)

  await db.execute(sql`
   CREATE INDEX IF NOT EXISTS "glossary_terms_scope_idx" ON "glossary_terms" ("scope");`)
  await db.execute(sql`
   CREATE INDEX IF NOT EXISTS "glossary_terms_owner_idx" ON "glossary_terms" ("owner_id");`)
  await db.execute(sql`
   CREATE INDEX IF NOT EXISTS "glossary_terms_source_term_idx" ON "glossary_terms" ("source_term");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "glossary_terms" DROP COLUMN IF EXISTS "inherited_target";`)
  await db.execute(sql`
   ALTER TABLE "glossary_terms" DROP COLUMN IF EXISTS "inherited_from";`)
  await db.execute(sql`
   ALTER TABLE "glossary_terms" DROP COLUMN IF EXISTS "owner_id";`)
  await db.execute(sql`
   ALTER TABLE "glossary_terms" DROP COLUMN IF EXISTS "scope";`)
  // project_id обратно в NOT NULL не возвращаем: к моменту отката в таблице
  // могут лежать строки личного слоя, и они его не переживут.
}
