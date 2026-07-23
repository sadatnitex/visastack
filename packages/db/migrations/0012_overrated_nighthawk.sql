CREATE TYPE "public"."extraction_run_status" AS ENUM('SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."name_version_decision" AS ENUM('PENDING', 'ACCEPTED_UNCHANGED', 'ACCEPTED_EDITED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."processing_run_status" AS ENUM('RUNNING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TABLE "document_classifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"extraction_run_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"classified_type" text,
	"confidence" integer NOT NULL,
	"review_required" boolean DEFAULT true NOT NULL,
	"rationale" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_name_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"proposed_name" text NOT NULL,
	"final_name" text,
	"decision" "name_version_decision" DEFAULT 'PENDING' NOT NULL,
	"decided_by_account_id" uuid,
	"reason" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_name_versions_doc_version_unique" UNIQUE("document_id","version_number")
);
--> statement-breakpoint
CREATE TABLE "extraction_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"processing_run_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"parser_name" text NOT NULL,
	"parser_version" text NOT NULL,
	"status" "extraction_run_status" NOT NULL,
	"extracted_text" text,
	"truncated" boolean DEFAULT false NOT NULL,
	"page_count" integer,
	"confidence" integer,
	"warnings" jsonb,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processing_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_version_id" uuid NOT NULL,
	"status" "processing_run_status" DEFAULT 'RUNNING' NOT NULL,
	"pipeline_version" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"error_code" text
);
--> statement-breakpoint
ALTER TABLE "document_classifications" ADD CONSTRAINT "document_classifications_extraction_run_id_extraction_runs_id_fk" FOREIGN KEY ("extraction_run_id") REFERENCES "public"."extraction_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_classifications" ADD CONSTRAINT "document_classifications_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_name_versions" ADD CONSTRAINT "document_name_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_name_versions" ADD CONSTRAINT "document_name_versions_decided_by_account_id_accounts_id_fk" FOREIGN KEY ("decided_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_processing_run_id_processing_runs_id_fk" FOREIGN KEY ("processing_run_id") REFERENCES "public"."processing_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_runs" ADD CONSTRAINT "processing_runs_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_classifications_document_version_idx" ON "document_classifications" USING btree ("document_version_id");--> statement-breakpoint
CREATE INDEX "document_name_versions_document_idx" ON "document_name_versions" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "extraction_runs_document_version_idx" ON "extraction_runs" USING btree ("document_version_id");--> statement-breakpoint
CREATE INDEX "processing_runs_document_version_idx" ON "processing_runs" USING btree ("document_version_id");