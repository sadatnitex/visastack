ALTER TABLE "erasure_jobs" ADD COLUMN "lease_owner" text;--> statement-breakpoint
ALTER TABLE "erasure_jobs" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
-- Deliberately NO backfill UPDATE here (Codex review, PR-B1, round 2): this
-- repo's build command runs this migration BEFORE `next build`
-- (apps/web/vercel.json), so the OLD deployment is still live and serving
-- while this statement executes — a CLAIMED/DELETED row at this exact
-- moment may belong to a genuinely still-running old-code worker, not an
-- orphan. Immediately resetting it to PENDING here would let a second
-- old-code invocation claim and process the SAME job concurrently (the old
-- code's writes are gated only by row id, with no status/lease check at
-- all), recreating the double-processing hazard leasing exists to prevent
-- — via the migration itself, in the one place this repo has no lease-based
-- protection to rely on yet. Leaving these rows untouched (lease_owner/
-- lease_expires_at simply NULL, since the columns are new) lets
-- `claimErasureJobs`'s own age-gated reclaim (packages/services/src/erasure.ts)
-- handle them the exact same safe way it handles any other lease-less row:
-- only once `claimedAt` is old enough that no legitimate worker — old code
-- or new — could still be genuinely mid-flight on it.
CREATE INDEX "erasure_jobs_lease_expires_idx" ON "erasure_jobs" USING btree ("status","lease_expires_at");