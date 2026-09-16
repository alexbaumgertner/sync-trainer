import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Запасные эквиваленты у термина глоссария.
 *
 * Схема списана с той, что Payload создаёт через `push` на локальной базе.
 * У массивов свои служебные колонки: `_order`, `_parent_id` и СТРОКОВЫЙ `id` —
 * сочинить это по памяти нельзя, и расхождение вылезло бы только в проде.
 *
 * `_parent_id` каскадный: удалили термин — ушли и его варианты.
 * `proposed_by_id` обнуляемый и НЕ обязательный: пустое значение означает
 * «предложила модель», и оно же спасает от той ловушки, на которой мы уже
 * трижды спотыкались, — `SET NULL` не ложится на `NOT NULL`.
 *
 * Колонки в `payload_locked_documents_rels` тут не нужно: массив — часть
 * коллекции, а не отдельная коллекция.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE IF NOT EXISTS "glossary_terms_variants" (
     "_order" integer NOT NULL,
     "_parent_id" integer NOT NULL,
     "id" varchar PRIMARY KEY NOT NULL,
     "text" varchar NOT NULL,
     "proposed_by_id" integer,
     "note" varchar,
     "at" timestamp(3) with time zone
   );`)

  await db.execute(sql`
   DO $$ BEGIN
     ALTER TABLE "glossary_terms_variants"
       ADD CONSTRAINT "glossary_terms_variants_parent_id_fk"
       FOREIGN KEY ("_parent_id") REFERENCES "public"."glossary_terms"("id")
       ON DELETE cascade ON UPDATE no action;
   EXCEPTION WHEN duplicate_object THEN null; END $$;

   DO $$ BEGIN
     ALTER TABLE "glossary_terms_variants"
       ADD CONSTRAINT "glossary_terms_variants_proposed_by_id_users_id_fk"
       FOREIGN KEY ("proposed_by_id") REFERENCES "public"."users"("id")
       ON DELETE set null ON UPDATE no action;
   EXCEPTION WHEN duplicate_object THEN null; END $$;`)

  await db.execute(sql`
   CREATE INDEX IF NOT EXISTS "glossary_terms_variants_order_idx"
     ON "glossary_terms_variants" ("_order");
   CREATE INDEX IF NOT EXISTS "glossary_terms_variants_parent_id_idx"
     ON "glossary_terms_variants" ("_parent_id");
   CREATE INDEX IF NOT EXISTS "glossary_terms_variants_proposed_by_idx"
     ON "glossary_terms_variants" ("proposed_by_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`DROP TABLE IF EXISTS "glossary_terms_variants";`)
}
