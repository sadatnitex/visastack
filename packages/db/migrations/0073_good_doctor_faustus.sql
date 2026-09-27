ALTER TABLE "ai_extraction_runs" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "ai_extraction_runs" ADD COLUMN "provider_request_id" text;--> statement-breakpoint
ALTER TABLE "ai_extraction_runs" ADD COLUMN "input_units" integer;--> statement-breakpoint
ALTER TABLE "ai_extraction_runs" ADD COLUMN "output_units" integer;--> statement-breakpoint
ALTER TABLE "ai_extraction_runs" ADD COLUMN "cached_units" integer;--> statement-breakpoint
ALTER TABLE "ai_extraction_runs" ADD COLUMN "latency_ms" integer;