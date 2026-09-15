import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Колонка `engagements_id` в служебной таблице блокировок Payload.
 *
 * Найдено живым использованием: сохранение профиля падало с
 * «column ... engagements_id does not exist». Payload держит в
 * `payload_locked_documents_rels` по колонке на каждую коллекцию и опрашивает
 * их ВСЕ при любой записи — даже когда правят пользователя, а не запись
 * о работе. Добавив коллекцию, я про эту таблицу забыл.
 *
 * Почему не поймали ни тесты, ни проверка миграции на чистой базе: локально
 * схему держит `push`, и колонку он дописывает сам. В проде идут только
 * миграции. Проверка «таблица engagements создалась» этого не покрывала —
 * смотреть надо было на служебные таблицы тоже.
 *
 * Имя файла с `zz`, чтобы миграция встала последней: Payload применяет их
 * по алфавиту, а таблица `engagements` должна существовать раньше.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "payload_locked_documents_rels"
     ADD COLUMN IF NOT EXISTS "engagements_id" integer;`)

  await db.execute(sql`
   DO $$ BEGIN
     ALTER TABLE "payload_locked_documents_rels"
       ADD CONSTRAINT "payload_locked_documents_rels_engagements_fk"
       FOREIGN KEY ("engagements_id") REFERENCES "public"."engagements"("id")
       ON DELETE cascade ON UPDATE no action;
   EXCEPTION WHEN duplicate_object THEN null; END $$;

   CREATE INDEX IF NOT EXISTS "payload_locked_documents_rels_engagements_id_idx"
     ON "payload_locked_documents_rels" ("engagements_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "payload_locked_documents_rels"
     DROP COLUMN IF EXISTS "engagements_id";`)
}
