CREATE TABLE "document_expiry_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doc_type" text NOT NULL,
	"threshold_days" integer[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_expiry_policies_doc_type_unique" UNIQUE("doc_type")
);
--> statement-breakpoint
ALTER TABLE "pack_requirements" ADD COLUMN "max_age_days" integer;