import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Отметка о привязке карты времени к паузам в звуке.
 *
 * У карт, снятых раньше, фразы внутри реплики разложены пропорционально
 * длине текста, и подсветка уходит вперёд: на реплике в минуту это
 * десяток секунд. Пересчитать их можно без нового синтеза — паузы есть
 * в самом файле, — но декодировать MP3 на каждый запрос незачем. Отметка
 * и говорит, что пересчёт уже был.
 *
 * `false` по умолчанию: все существующие озвучки пересчёта ещё не знали.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "artifacts" ADD COLUMN IF NOT EXISTS "cues_aligned" boolean DEFAULT false;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "artifacts" DROP COLUMN IF EXISTS "cues_aligned";`)
}
