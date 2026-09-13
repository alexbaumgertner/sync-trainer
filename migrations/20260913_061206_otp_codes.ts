import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "otp_codes" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"email" varchar NOT NULL,
  	"code_hash" varchar NOT NULL,
  	"expires_at" timestamp(3) with time zone NOT NULL,
  	"attempts" numeric DEFAULT 0 NOT NULL,
  	"consumed_at" timestamp(3) with time zone,
  	"request_ip" varchar,
  	"delivered" boolean DEFAULT false,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "otp_codes_id" integer;
  CREATE INDEX "otp_codes_email_idx" ON "otp_codes" USING btree ("email");
  CREATE INDEX "otp_codes_expires_at_idx" ON "otp_codes" USING btree ("expires_at");
  CREATE INDEX "otp_codes_request_ip_idx" ON "otp_codes" USING btree ("request_ip");
  CREATE INDEX "otp_codes_updated_at_idx" ON "otp_codes" USING btree ("updated_at");
  CREATE INDEX "otp_codes_created_at_idx" ON "otp_codes" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_otp_codes_fk" FOREIGN KEY ("otp_codes_id") REFERENCES "public"."otp_codes"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_otp_codes_id_idx" ON "payload_locked_documents_rels" USING btree ("otp_codes_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "otp_codes" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "otp_codes" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_otp_codes_fk";
  
  DROP INDEX "payload_locked_documents_rels_otp_codes_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "otp_codes_id";`)
}
