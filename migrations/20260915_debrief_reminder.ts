import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Отметка о напоминании про разбор (E5).
 *
 * Нужна, чтобы напомнить ровно один раз: суточный крон иначе писал бы
 * каждый день, пока разбор не заполнят, и это было бы не напоминание,
 * а преследование.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "debrief_reminded_at" timestamp(3) with time zone;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "projects" DROP COLUMN IF EXISTS "debrief_reminded_at";`)
}
