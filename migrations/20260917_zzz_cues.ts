import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Карта времени у озвучки: текст, разложенный по звуку, в формате WebVTT.
 *
 * Хранится готовым файлом, а не нашей структурой: WebVTT разбирает сам
 * браузер через `<track kind="metadata">`, поэтому разбора в коде нет
 * вовсе, и тот же файл годится любому другому проигрывателю.
 *
 * Колонка обнуляемая: у озвучек, сделанных раньше, карты нет и взять её
 * негде — после склейки границы реплик восстановимы только приблизительно.
 * Маршрут в этом случае считает приблизительную на ходу.
 *
 * Имя с `zzz`, чтобы встать после `20260917_zz_waveform`: Payload применяет
 * миграции по алфавиту, а обе правят одну таблицу.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "artifacts" ADD COLUMN IF NOT EXISTS "cues_vtt" varchar;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "artifacts" DROP COLUMN IF EXISTS "cues_vtt";`)
}
