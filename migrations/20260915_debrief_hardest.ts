import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * `went_well` → `hardest`.
 *
 * Спецификация (E3) просит спрашивать, что было труднее всего, а в схеме
 * стояло «что прошло хорошо». Разница не косметическая: из этого поля растёт
 * промт следующей генерации (E4), и «всё прошло отлично» не подсказывает, что
 * генерировать дальше, а «путались в цифрах» — подсказывает.
 *
 * Именно переименование, а не удаление с созданием: если разборы уже написаны,
 * терять их нельзя, а текст в обоих случаях свободный.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "debriefs" RENAME COLUMN "went_well" TO "hardest";`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "debriefs" RENAME COLUMN "hardest" TO "went_well";`)
}
