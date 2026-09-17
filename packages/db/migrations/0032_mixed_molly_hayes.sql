CREATE TYPE "public"."document_review_outcome" AS ENUM('PENDING', 'ACCEPTED', 'REPLACEMENT_REQUIRED', 'IRRELEVANT', 'DISPUTED');--> statement-breakpoint
CREATE TABLE "document_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"outcome" "document_review_outcome" NOT NULL,
	"reason" text,
	"reviewed_by_account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_reviews" ADD CONSTRAINT "document_reviews_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_reviews_document_idx" ON "document_reviews" USING btree ("document_id");