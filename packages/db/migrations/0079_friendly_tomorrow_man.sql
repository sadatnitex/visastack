ALTER TABLE "ai_extraction_runs" ADD COLUMN "triggered_by_run_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_provider_configs" ADD COLUMN "fallback_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_provider_configs" ADD COLUMN "fallback_provider_config_id" uuid;--> statement-breakpoint
ALTER TABLE "ocr_runs" ADD COLUMN "triggered_by_run_id" uuid;--> statement-breakpoint
CREATE INDEX "ai_extraction_runs_triggered_by_idx" ON "ai_extraction_runs" USING btree ("triggered_by_run_id");--> statement-breakpoint
CREATE INDEX "ocr_runs_triggered_by_idx" ON "ocr_runs" USING btree ("triggered_by_run_id");