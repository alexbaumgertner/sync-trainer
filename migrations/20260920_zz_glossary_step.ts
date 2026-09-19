import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Сборка глоссария — отдельный шаг (N1–N2).
 *
 * Три перечисления, и все три обязательны. Добавить значение в TypeScript
 * и забыть `ALTER TYPE` — проверенный способ положить запись в проде,
 * оставив тесты зелёными: локально тип держит `push`, и расхождение
 * всплывает только на боевой базе. На этом уже спотыкались с шагом
 * `rating_given`.
 *
 * Значения не удаляются в `down`: Postgres не умеет убирать значение из
 * перечисления, а пересоздавать тип под откат опаснее, чем оставить лишнее
 * значение неиспользованным.
 *
 * Имя с `zz`, чтобы встать после `20260920_document_sources`: Payload
 * применяет миграции по алфавиту.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  // Шаг воронки между «документ загружен» и «скрипт сгенерирован».
  await db.execute(sql`
   ALTER TYPE "public"."enum_activity_step" ADD VALUE IF NOT EXISTS 'glossary_built';`)

  // Вид работы: у сборки глоссария своя запись, как у скрипта и аудио.
  await db.execute(sql`
   ALTER TYPE "public"."enum_generations_kind" ADD VALUE IF NOT EXISTS 'glossary' BEFORE 'script';`)

  // B4: свой вид расхода. Лимит общий (B5), но статья отдельная — иначе
  // в отчёте о расходах сборка глоссария выглядела бы генерацией скрипта.
  await db.execute(sql`
   ALTER TYPE "public"."enum_usage_events_kind" ADD VALUE IF NOT EXISTS 'glossary' BEFORE 'script';`)
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  // Значение из перечисления Postgres не убирается. Откат оставляет их
  // на месте: неиспользованное значение безвредно, пересоздание типа — нет.
}
