import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Оригиналы документов остаются в хранилище (S2).
 *
 * F1 из R1 отменён: оригинал больше не удаляется через пятнадцать минут,
 * он живёт, пока владелец не удалит его руками. Отсюда колонка с путём —
 * раньше путь был не нужен, файла всё равно не существовало к моменту,
 * когда о нём могли спросить.
 *
 * Пустая колонка означает «оригинала нет»: так выглядят все документы,
 * загруженные до этой миграции, и документы, у которых оригинал удалили.
 * Различает эти два случая `purged_at`: он заполнен только там, где удалял
 * человек.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "blob_path" varchar;`)
  // S4: отметка о том, что удалить оригиналы уже предлагали. Без неё
  // предложение приходило бы каждые сутки, пока человек его не выполнит, —
  // а это ровно тот тон, из-за которого письма сервиса перестают читать.
  await db.execute(sql`
   ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "sources_reminded_at" timestamp(3) with time zone;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "documents" DROP COLUMN IF EXISTS "blob_path";`)
  await db.execute(sql`
   ALTER TABLE "projects" DROP COLUMN IF EXISTS "sources_reminded_at";`)
}
