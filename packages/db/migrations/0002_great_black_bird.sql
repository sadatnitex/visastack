CREATE TYPE "public"."document_safety_status" AS ENUM('PENDING', 'SCANNING', 'CLEAN', 'QUARANTINED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."document_state" AS ENUM('UPLOADING', 'QUARANTINED', 'SCANNING', 'NORMALIZING', 'EXTRACTING', 'AWAITING_REVIEW', 'APPROVED', 'NEEDS_ATTENTION', 'FAILED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."storage_bucket" AS ENUM('QUARANTINE', 'CLEAN');--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version_number" integer DEFAULT 1 NOT NULL,
	"storage_object_id" uuid NOT NULL,
	"processing_status" "document_state" DEFAULT 'UPLOADING' NOT NULL,
	"safety_status" "document_safety_status" DEFAULT 'PENDING' NOT NULL,
	"size_bytes" bigint,
	"pages" integer,
	"sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_versions_doc_version_unique" UNIQUE("document_id","version_number")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"applicant_id" uuid NOT NULL,
	"approved_name" text,
	"original_name" text NOT NULL,
	"doc_type" text,
	"subject" text,
	"issuer" text,
	"document_date" text,
	"source" text,
	"uploader_account_id" uuid,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bucket" "storage_bucket" NOT NULL,
	"object_key" text NOT NULL,
	"content_hash" text,
	"size_bytes" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storage_objects_object_key_unique" UNIQUE("object_key")
);
--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_storage_object_id_storage_objects_id_fk" FOREIGN KEY ("storage_object_id") REFERENCES "public"."storage_objects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploader_account_id_accounts_id_fk" FOREIGN KEY ("uploader_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_versions_document_idx" ON "document_versions" USING btree ("document_id");