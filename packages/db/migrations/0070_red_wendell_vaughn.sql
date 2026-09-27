CREATE TYPE "public"."account_export_job_status" AS ENUM('PENDING', 'CLAIMED', 'READY', 'FAILED', 'EXPIRED');--> statement-breakpoint
CREATE TABLE "account_export_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"status" "account_export_job_status" DEFAULT 'PENDING' NOT NULL,
	"bucket" "storage_bucket",
	"object_key" text,
	"encryption_nonce" "bytea",
	"encryption_key_version" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_export_jobs" ADD CONSTRAINT "account_export_jobs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_export_jobs_status_available_idx" ON "account_export_jobs" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "account_export_jobs_account_idx" ON "account_export_jobs" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "account_export_jobs_status_expires_idx" ON "account_export_jobs" USING btree ("status","expires_at");