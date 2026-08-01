CREATE TYPE "public"."processing_job_type" AS ENUM('INTAKE');--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD COLUMN "job_type" "processing_job_type" DEFAULT 'INTAKE' NOT NULL;--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD COLUMN "processing_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD COLUMN "lease_owner" text;--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD COLUMN "heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD COLUMN "error_code" text;--> statement-breakpoint
-- Backfill existing rows before enforcing NOT NULL/UNIQUE. Never assume no
-- pre-existing duplicate document_version_id rows exist — closing exactly
-- that gap is this migration's purpose, so the backfilled key includes each
-- row's own id to guarantee uniqueness regardless. New rows inserted by the
-- application use the clean documentVersionId:jobType:processingVersion
-- form going forward (packages/services/src/jobs.ts).
UPDATE "processing_jobs" SET "idempotency_key" = "document_version_id"::text || ':' || "job_type"::text || ':' || "processing_version"::text || ':' || "id"::text WHERE "idempotency_key" IS NULL;--> statement-breakpoint
ALTER TABLE "processing_jobs" ALTER COLUMN "idempotency_key" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "processing_jobs_lease_expires_idx" ON "processing_jobs" USING btree ("status","lease_expires_at");--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_idempotency_key_unique" UNIQUE("idempotency_key");