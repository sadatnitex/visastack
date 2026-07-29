CREATE TYPE "public"."ai_extraction_run_status" AS ENUM('SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."proposal_type" AS ENUM('NEW', 'MATCH', 'UPDATE', 'CONFLICT', 'UNMAPPED', 'UNCERTAIN');--> statement-breakpoint
CREATE TABLE "ai_extraction_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_version_id" uuid NOT NULL,
	"applicant_id" uuid NOT NULL,
	"status" "ai_extraction_run_status" NOT NULL,
	"model_version" text NOT NULL,
	"prompt_version" text NOT NULL,
	"cost_units" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"field_proposal_id" uuid NOT NULL,
	"fact_id" uuid NOT NULL,
	"previous_fact_version_id" uuid NOT NULL,
	"new_fact_version_id" uuid NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "correction_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"field_proposal_id" uuid NOT NULL,
	"original_value" text,
	"corrected_value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"field_proposal_id" uuid NOT NULL,
	"snippet" text NOT NULL,
	"char_start" integer,
	"char_end" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "field_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ai_extraction_run_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"applicant_id" uuid NOT NULL,
	"type" "proposal_type" NOT NULL,
	"field_key" text,
	"value" text,
	"confidence" integer NOT NULL,
	"rationale" text,
	"status" "proposal_status" DEFAULT 'PENDING' NOT NULL,
	"decided_by_account_id" uuid,
	"decided_at" timestamp with time zone,
	"fact_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_extraction_runs" ADD CONSTRAINT "ai_extraction_runs_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_extraction_runs" ADD CONSTRAINT "ai_extraction_runs_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflicts" ADD CONSTRAINT "conflicts_field_proposal_id_field_proposals_id_fk" FOREIGN KEY ("field_proposal_id") REFERENCES "public"."field_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflicts" ADD CONSTRAINT "conflicts_fact_id_facts_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."facts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflicts" ADD CONSTRAINT "conflicts_previous_fact_version_id_fact_versions_id_fk" FOREIGN KEY ("previous_fact_version_id") REFERENCES "public"."fact_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflicts" ADD CONSTRAINT "conflicts_new_fact_version_id_fact_versions_id_fk" FOREIGN KEY ("new_fact_version_id") REFERENCES "public"."fact_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction_feedback" ADD CONSTRAINT "correction_feedback_field_proposal_id_field_proposals_id_fk" FOREIGN KEY ("field_proposal_id") REFERENCES "public"."field_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_locations" ADD CONSTRAINT "evidence_locations_field_proposal_id_field_proposals_id_fk" FOREIGN KEY ("field_proposal_id") REFERENCES "public"."field_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_proposals" ADD CONSTRAINT "field_proposals_ai_extraction_run_id_ai_extraction_runs_id_fk" FOREIGN KEY ("ai_extraction_run_id") REFERENCES "public"."ai_extraction_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_proposals" ADD CONSTRAINT "field_proposals_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_proposals" ADD CONSTRAINT "field_proposals_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_proposals" ADD CONSTRAINT "field_proposals_decided_by_account_id_accounts_id_fk" FOREIGN KEY ("decided_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_proposals" ADD CONSTRAINT "field_proposals_fact_version_id_fact_versions_id_fk" FOREIGN KEY ("fact_version_id") REFERENCES "public"."fact_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_extraction_runs_document_version_idx" ON "ai_extraction_runs" USING btree ("document_version_id");--> statement-breakpoint
CREATE INDEX "ai_extraction_runs_applicant_idx" ON "ai_extraction_runs" USING btree ("applicant_id");--> statement-breakpoint
CREATE INDEX "conflicts_field_proposal_idx" ON "conflicts" USING btree ("field_proposal_id");--> statement-breakpoint
CREATE INDEX "conflicts_fact_idx" ON "conflicts" USING btree ("fact_id");--> statement-breakpoint
CREATE INDEX "correction_feedback_field_proposal_idx" ON "correction_feedback" USING btree ("field_proposal_id");--> statement-breakpoint
CREATE INDEX "evidence_locations_field_proposal_idx" ON "evidence_locations" USING btree ("field_proposal_id");--> statement-breakpoint
CREATE INDEX "field_proposals_document_version_idx" ON "field_proposals" USING btree ("document_version_id");--> statement-breakpoint
CREATE INDEX "field_proposals_applicant_status_idx" ON "field_proposals" USING btree ("applicant_id","status");