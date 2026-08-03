ALTER TABLE "erasure_jobs" ADD COLUMN "lease_owner" text;--> statement-breakpoint
ALTER TABLE "erasure_jobs" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
-- Data migration (Codex review, PR-B1): any row already sitting at CLAIMED
-- or DELETED predates leasing entirely, so it cannot possibly be a live
-- worker's in-flight claim (that worker's process ended with the previous
-- deploy) — it is orphaned by definition. Reset to PENDING so the new
-- reclaim logic never has to special-case "claimed but never had a lease"
-- as a third kind of stuck state; lease_owner/lease_expires_at are already
-- NULL for every pre-existing row (the columns did not exist before this
-- migration), so no further backfill of those columns is needed.
UPDATE "erasure_jobs" SET "status" = 'PENDING' WHERE "status" IN ('CLAIMED', 'DELETED');--> statement-breakpoint
CREATE INDEX "erasure_jobs_lease_expires_idx" ON "erasure_jobs" USING btree ("status","lease_expires_at");