import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Статус «напомнили» для участника команды (C6).
 *
 * В R2-3 перечисление заводилось «сразу со всеми значениями, чтобы не делать
 * вторую миграцию» — и всё равно понадобилась вторая: напоминанию нужен свой
 * статус, иначе оно уходило бы каждые сутки. Урок простой: угадать полный
 * набор значений заранее не вышло, и закладываться на это не стоило.
 *
 * Обратной миграции у добавления значения в enum нет: PostgreSQL не умеет
 * удалять значение, а пересоздавать тип с переносом данных ради отката —
 * риск больше пользы. Откат оставляет значение на месте; на работу прежнего
 * кода оно не влияет.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_engagements_team_status" ADD VALUE IF NOT EXISTS 'reminded' AFTER 'invited';`)
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  // Намеренно пусто: см. пояснение выше.
}
