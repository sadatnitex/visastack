CREATE TABLE "agency_collection_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"recipient_email_hint" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by_id" uuid,
	"created_by_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_opened_at" timestamp with time zone,
	CONSTRAINT "agency_collection_links_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "agency_collection_links_token_hash" CHECK ("agency_collection_links"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "agency_collection_links_email_cap" CHECK (coalesce(char_length("agency_collection_links"."recipient_email_hint"), 0) <= 320)
);
--> statement-breakpoint
CREATE TABLE "agency_collection_request_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"revision_no" integer NOT NULL,
	"pack_version_id" uuid,
	"pack_checksum" text,
	"items" jsonb NOT NULL,
	"brand_snapshot" jsonb,
	"content_sha256" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"issued_by_account_id" uuid NOT NULL,
	CONSTRAINT "agency_collection_request_revisions_number" UNIQUE("request_id","revision_no"),
	CONSTRAINT "agency_collection_request_revisions_number_positive" CHECK ("agency_collection_request_revisions"."revision_no" >= 1),
	CONSTRAINT "agency_collection_request_revisions_pack_pair" CHECK (("agency_collection_request_revisions"."pack_version_id" is null) = ("agency_collection_request_revisions"."pack_checksum" is null)),
	CONSTRAINT "agency_collection_request_revisions_sha256" CHECK ("agency_collection_request_revisions"."content_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "agency_collection_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_by_account_id" uuid,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"destination" text NOT NULL,
	"route" text,
	"purpose" text,
	"travel_from" date,
	"travel_to" date,
	"due_at" timestamp with time zone,
	"nationality" text,
	"residence" text,
	"application_place" text,
	"recipient_name_hint" text,
	"recipient_email_hint" text,
	"draft_pack_version_id" uuid,
	"draft_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"current_revision_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agency_collection_requests_status_known" CHECK ("agency_collection_requests"."status" in ('DRAFT', 'SENT', 'REVOKED', 'CLOSED')),
	CONSTRAINT "agency_collection_requests_destination_iso2" CHECK ("agency_collection_requests"."destination" ~ '^[A-Z]{2}$'),
	CONSTRAINT "agency_collection_requests_text_caps" CHECK (coalesce(char_length("agency_collection_requests"."route"), 0) <= 200 and coalesce(char_length("agency_collection_requests"."purpose"), 0) <= 200 and coalesce(char_length("agency_collection_requests"."nationality"), 0) <= 100 and coalesce(char_length("agency_collection_requests"."residence"), 0) <= 100 and coalesce(char_length("agency_collection_requests"."application_place"), 0) <= 100 and coalesce(char_length("agency_collection_requests"."recipient_name_hint"), 0) <= 200 and coalesce(char_length("agency_collection_requests"."recipient_email_hint"), 0) <= 320),
	CONSTRAINT "agency_collection_requests_travel_order" CHECK ("agency_collection_requests"."travel_from" is null or "agency_collection_requests"."travel_to" is null or "agency_collection_requests"."travel_from" <= "agency_collection_requests"."travel_to")
);
--> statement-breakpoint
ALTER TABLE "agency_collection_links" ADD CONSTRAINT "agency_collection_links_request_id_agency_collection_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."agency_collection_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_collection_links" ADD CONSTRAINT "agency_collection_links_revision_id_agency_collection_request_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."agency_collection_request_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_collection_links" ADD CONSTRAINT "agency_collection_links_created_by_account_id_accounts_id_fk" FOREIGN KEY ("created_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_collection_request_revisions" ADD CONSTRAINT "agency_collection_request_revisions_request_id_agency_collection_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."agency_collection_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_collection_request_revisions" ADD CONSTRAINT "agency_collection_request_revisions_pack_version_id_pack_versions_id_fk" FOREIGN KEY ("pack_version_id") REFERENCES "public"."pack_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_collection_requests" ADD CONSTRAINT "agency_collection_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_collection_requests" ADD CONSTRAINT "agency_collection_requests_created_by_account_id_accounts_id_fk" FOREIGN KEY ("created_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_collection_requests" ADD CONSTRAINT "agency_collection_requests_draft_pack_version_id_pack_versions_id_fk" FOREIGN KEY ("draft_pack_version_id") REFERENCES "public"."pack_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agency_collection_links_request_idx" ON "agency_collection_links" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "agency_collection_links_revision_idx" ON "agency_collection_links" USING btree ("revision_id");--> statement-breakpoint
CREATE INDEX "agency_collection_links_creator_idx" ON "agency_collection_links" USING btree ("created_by_account_id");--> statement-breakpoint
CREATE INDEX "agency_collection_request_revisions_pack_idx" ON "agency_collection_request_revisions" USING btree ("pack_version_id");--> statement-breakpoint
CREATE INDEX "agency_collection_request_revisions_issuer_idx" ON "agency_collection_request_revisions" USING btree ("issued_by_account_id");--> statement-breakpoint
CREATE INDEX "agency_collection_requests_org_idx" ON "agency_collection_requests" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "agency_collection_requests_creator_idx" ON "agency_collection_requests" USING btree ("created_by_account_id");--> statement-breakpoint
CREATE INDEX "agency_collection_requests_pack_idx" ON "agency_collection_requests" USING btree ("draft_pack_version_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION "visastack_agency_collection_revisions_guard"() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
	RAISE EXCEPTION 'agency_collection_request_revisions: an issued revision is never changed or removed' USING ERRCODE = 'restrict_violation';
END;
$fn$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "agency_collection_revisions_append_only" ON "agency_collection_request_revisions";
--> statement-breakpoint
CREATE TRIGGER "agency_collection_revisions_append_only" BEFORE UPDATE OR DELETE ON "agency_collection_request_revisions" FOR EACH ROW EXECUTE FUNCTION "visastack_agency_collection_revisions_guard"();
