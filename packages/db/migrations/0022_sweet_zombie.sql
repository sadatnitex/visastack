ALTER TABLE "ai_extraction_runs" ADD COLUMN "schema_version" text;--> statement-breakpoint
ALTER TABLE "ai_extraction_runs" ADD COLUMN "cache_key" text;--> statement-breakpoint
ALTER TABLE "ai_extraction_runs" ADD COLUMN "served_from_cache_run_id" uuid;--> statement-breakpoint
CREATE INDEX "ai_extraction_runs_cache_key_idx" ON "ai_extraction_runs" USING btree ("cache_key");