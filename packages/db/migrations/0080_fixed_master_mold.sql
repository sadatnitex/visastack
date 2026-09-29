CREATE TYPE "public"."classification_source" AS ENUM('DETERMINISTIC', 'AI_APPROVED');--> statement-breakpoint
CREATE TABLE "ai_classification_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_version_id" uuid NOT NULL,
	"applicant_id" uuid NOT NULL,
	"status" "ai_extraction_run_status" NOT NULL,
	"model_version" text NOT NULL,
	"prompt_version" text NOT NULL,
	"schema_version" text,
	"cost_units" integer DEFAULT 0 NOT NULL,
	"provider" text,
	"provider_request_id" text,
	"input_units" integer,
	"output_units" integer,
	"cached_units" integer,
	"latency_ms" integer,
	"error_code" text,
	"cache_key" text,
	"served_from_cache_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_type_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ai_classification_run_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"applicant_id" uuid NOT NULL,
	"suggested_type" text NOT NULL,
	"confidence" integer NOT NULL,
	"rationale" text,
	"status" "proposal_status" DEFAULT 'PENDING' NOT NULL,
	"decided_by_account_id" uuid,
	"decided_at" timestamp with time zone,
	"classification_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_classifications" ADD COLUMN "source" "classification_source" DEFAULT 'DETERMINISTIC' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_classification_runs" ADD CONSTRAINT "ai_classification_runs_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_classification_runs" ADD CONSTRAINT "ai_classification_runs_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_type_proposals" ADD CONSTRAINT "document_type_proposals_ai_classification_run_id_ai_classification_runs_id_fk" FOREIGN KEY ("ai_classification_run_id") REFERENCES "public"."ai_classification_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_type_proposals" ADD CONSTRAINT "document_type_proposals_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_type_proposals" ADD CONSTRAINT "document_type_proposals_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_type_proposals" ADD CONSTRAINT "document_type_proposals_decided_by_account_id_accounts_id_fk" FOREIGN KEY ("decided_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_type_proposals" ADD CONSTRAINT "document_type_proposals_classification_id_document_classifications_id_fk" FOREIGN KEY ("classification_id") REFERENCES "public"."document_classifications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_classification_runs_document_version_idx" ON "ai_classification_runs" USING btree ("document_version_id");--> statement-breakpoint
CREATE INDEX "ai_classification_runs_applicant_idx" ON "ai_classification_runs" USING btree ("applicant_id");--> statement-breakpoint
CREATE INDEX "ai_classification_runs_cache_key_idx" ON "ai_classification_runs" USING btree ("cache_key");--> statement-breakpoint
CREATE INDEX "document_type_proposals_document_version_idx" ON "document_type_proposals" USING btree ("document_version_id");--> statement-breakpoint
CREATE INDEX "document_type_proposals_applicant_status_idx" ON "document_type_proposals" USING btree ("applicant_id","status");