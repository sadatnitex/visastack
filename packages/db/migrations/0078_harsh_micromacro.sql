CREATE TYPE "public"."ocr_run_status" AS ENUM('IN_FLIGHT', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TABLE "ocr_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_version_id" uuid NOT NULL,
	"applicant_id" uuid NOT NULL,
	"status" "ocr_run_status" NOT NULL,
	"provider" text NOT NULL,
	"model_version" text NOT NULL,
	"prompt_version" text NOT NULL,
	"extracted_text" text,
	"review_issues" jsonb,
	"cost_units" integer DEFAULT 0 NOT NULL,
	"input_units" integer,
	"output_units" integer,
	"provider_request_id" text,
	"latency_ms" integer,
	"error_code" text,
	"cache_key" text,
	"served_from_cache_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ocr_runs" ADD CONSTRAINT "ocr_runs_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ocr_runs" ADD CONSTRAINT "ocr_runs_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ocr_runs_document_version_idx" ON "ocr_runs" USING btree ("document_version_id");--> statement-breakpoint
CREATE INDEX "ocr_runs_applicant_idx" ON "ocr_runs" USING btree ("applicant_id");--> statement-breakpoint
CREATE INDEX "ocr_runs_cache_key_idx" ON "ocr_runs" USING btree ("cache_key");