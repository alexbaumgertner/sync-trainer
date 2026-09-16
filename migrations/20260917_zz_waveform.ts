import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Форма волны и длительность у артефакта.
 *
 * `peaks` — `jsonb`, потому что так его создаёт Payload для поля `json`;
 * это массив из двух тысяч целых 0–100, около восьми килобайт на запись.
 * Считается один раз при первом показе проигрывателя: расшифровывать
 * восемнадцать минут в браузере нельзя, там это сотня мегабайт в памяти
 * вкладки, а на сервере — треть секунды.
 *
 * `duration_sec` — `numeric`, как и прочие числовые поля у Payload.
 * Длительность берётся у расшифровщика, а не считается из битрейта: на этом
 * уже обжигались, у MPEG-2 своя таблица, и ошибка вышла ровно вдвое.
 *
 * Обе колонки обнуляемые: у записей, сделанных до сегодня, их нет, и это
 * нормально — заполнятся при первом открытии проигрывателя.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "artifacts" ADD COLUMN IF NOT EXISTS "peaks" jsonb;
   ALTER TABLE "artifacts" ADD COLUMN IF NOT EXISTS "duration_sec" numeric;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "artifacts" DROP COLUMN IF EXISTS "peaks";
   ALTER TABLE "artifacts" DROP COLUMN IF EXISTS "duration_sec";`)
}
