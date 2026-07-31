CREATE TABLE "document_scan_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_version_id" uuid NOT NULL,
	"scanner_name" text NOT NULL,
	"scanner_version" text NOT NULL,
	"safe" boolean NOT NULL,
	"detail" text,
	"scanned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_scan_results" ADD CONSTRAINT "document_scan_results_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_scan_results_document_version_idx" ON "document_scan_results" USING btree ("document_version_id");