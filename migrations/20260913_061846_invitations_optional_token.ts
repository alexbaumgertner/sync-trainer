import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "invitations" ALTER COLUMN "token_hash" DROP NOT NULL;
  ALTER TABLE "invitations" ALTER COLUMN "expires_at" DROP NOT NULL;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "invitations" ALTER COLUMN "token_hash" SET NOT NULL;
  ALTER TABLE "invitations" ALTER COLUMN "expires_at" SET NOT NULL;`)
}
