import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Паролей больше нет — убираем поля локальной стратегии Payload.
 *
 * Вход был один и тот же (код на почту), а парольная дверь стояла рядом
 * и не знала ни наших ограничителей частоты, ни одинаковых ответов.
 * Хеши при этом лежали в базе, а с появлением резервного копирования —
 * в каждой копии.
 *
 * `email` остаётся: он переобъявлен как собственное поле коллекции с той же
 * уникальностью. Индекс `users_email_idx` уже существует и не пересоздаётся.
 *
 * Обратная миграция возвращает колонки пустыми. Восстановить сами пароли она
 * не может и не должна: их хеши стёрты, и это ровно то, чего мы добивались.
 * После отката вход по паролю не заработает, пока кто-нибудь не задаст пароли
 * заново — но заработает вход по коду, то есть без доступа не останется никто.
 */
const COLUMNS = [
  'hash',
  'salt',
  'login_attempts',
  'lock_until',
  'reset_password_token',
  'reset_password_expiration',
]

export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const column of COLUMNS) {
    await db.execute(sql.raw(`ALTER TABLE "users" DROP COLUMN IF EXISTS "${column}"`))
  }
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "hash" varchar,
      ADD COLUMN IF NOT EXISTS "salt" varchar,
      ADD COLUMN IF NOT EXISTS "login_attempts" numeric DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "lock_until" timestamp(3) with time zone,
      ADD COLUMN IF NOT EXISTS "reset_password_token" varchar,
      ADD COLUMN IF NOT EXISTS "reset_password_expiration" timestamp(3) with time zone;`)
}
