import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * `user_id` в `activity` и `usage_events` становится необязательным.
 *
 * У обеих связей стоит `ON DELETE SET NULL`, а колонки были `NOT NULL` —
 * сочетание, при котором удаление пользователя падает на первой его записи.
 * То есть человека, попросившего себя удалить, удалить было нельзя.
 *
 * Поймано сквозным тестом на удалении пользователя. Модульные не заметили:
 * каждый чистил за собой в правильном порядке и до этого сочетания
 * не доходил.
 *
 * Обнуление выбрано вместо каскадного удаления сознательно. Воронка отвечает
 * на вопрос «сколько проектов дошло до озвучки», а расходы складываются
 * в общий лимит сервиса; ни то, ни другое не должно меняться задним числом
 * оттого, что кто-то ушёл. Связь с человеком при этом рвётся — для ушедшего
 * это ровно то, что нужно.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "activity" ALTER COLUMN "user_id" DROP NOT NULL;
   ALTER TABLE "usage_events" ALTER COLUMN "user_id" DROP NOT NULL;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // Обратный ход только для записей, у которых автор ещё известен:
  // осиротевшие строки вернуть в NOT NULL нечем.
  await db.execute(sql`
   DELETE FROM "activity" WHERE "user_id" IS NULL;
   DELETE FROM "usage_events" WHERE "user_id" IS NULL;
   ALTER TABLE "activity" ALTER COLUMN "user_id" SET NOT NULL;
   ALTER TABLE "usage_events" ALTER COLUMN "user_id" SET NOT NULL;`)
}
