CREATE TYPE "public"."erasure_job_reason" AS ENUM('ACCOUNT_DELETION', 'RETENTION_PURGE');--> statement-breakpoint
CREATE TYPE "public"."erasure_job_status" AS ENUM('PENDING', 'CLAIMED', 'DELETED', 'VERIFIED', 'FAILED', 'BLOCKED_BY_HOLD');--> statement-breakpoint
CREATE TABLE "erasure_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reason" "erasure_job_reason" NOT NULL,
	"status" "erasure_job_status" DEFAULT 'PENDING' NOT NULL,
	"bucket" "storage_bucket" NOT NULL,
	"object_key" text NOT NULL,
	"expected_hash" text,
	"storage_object_id" uuid NOT NULL,
	"document_id" uuid,
	"applicant_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "erasure_jobs_status_available_idx" ON "erasure_jobs" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "erasure_jobs_storage_object_idx" ON "erasure_jobs" USING btree ("storage_object_id");