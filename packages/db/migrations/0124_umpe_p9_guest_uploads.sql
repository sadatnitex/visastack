CREATE TABLE "agency_collection_guest_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"recipient_key" text NOT NULL,
	"upload_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text,
	"original_name" text NOT NULL,
	"safety_status" text DEFAULT 'RECEIVING' NOT NULL,
	"scanner_name" text,
	"scanner_version" text,
	"virus_scanned" boolean DEFAULT false NOT NULL,
	"checked_at" timestamp with time zone,
	"item_id" text,
	"mapping_source" text,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agency_collection_guest_files_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "agency_collection_guest_files_upload" UNIQUE("request_id","recipient_key","upload_id"),
	CONSTRAINT "agency_collection_guest_files_recipient_key" CHECK ("agency_collection_guest_files"."recipient_key" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "agency_collection_guest_files_sha256" CHECK ("agency_collection_guest_files"."sha256" is null or "agency_collection_guest_files"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "agency_collection_guest_files_status_known" CHECK ("agency_collection_guest_files"."safety_status" in ('RECEIVING', 'CLEAN', 'REJECTED')),
	CONSTRAINT "agency_collection_guest_files_mapping_known" CHECK ("agency_collection_guest_files"."mapping_source" is null or "agency_collection_guest_files"."mapping_source" in ('PROPOSED', 'GUEST')),
	CONSTRAINT "agency_collection_guest_files_caps" CHECK (char_length("agency_collection_guest_files"."original_name") between 1 and 180 and char_length("agency_collection_guest_files"."content_type") <= 100 and coalesce(char_length("agency_collection_guest_files"."item_id"), 0) <= 64 and "agency_collection_guest_files"."size_bytes" > 0)
);
--> statement-breakpoint
CREATE TABLE "agency_collection_guest_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"placed_by_account_id" uuid NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_by_account_id" uuid,
	"released_at" timestamp with time zone,
	CONSTRAINT "agency_collection_guest_holds_reason_cap" CHECK (char_length("agency_collection_guest_holds"."reason") between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "agency_collection_guest_submission_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"kind" text NOT NULL,
	"file_id" uuid,
	"file_sha256" text,
	"title" text,
	CONSTRAINT "agency_collection_guest_submission_items_one_line" UNIQUE NULLS NOT DISTINCT("submission_id","item_id","file_id"),
	CONSTRAINT "agency_collection_guest_submission_items_kind_known" CHECK ("agency_collection_guest_submission_items"."kind" in ('FILE', 'MISSING')),
	CONSTRAINT "agency_collection_guest_submission_items_target" CHECK (("agency_collection_guest_submission_items"."kind" = 'FILE' and "agency_collection_guest_submission_items"."file_id" is not null and "agency_collection_guest_submission_items"."file_sha256" ~ '^[0-9a-f]{64}$') or ("agency_collection_guest_submission_items"."kind" = 'MISSING' and "agency_collection_guest_submission_items"."file_id" is null and "agency_collection_guest_submission_items"."file_sha256" is null))
);
--> statement-breakpoint
CREATE TABLE "agency_collection_guest_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"recipient_key" text NOT NULL,
	"revision_no" integer NOT NULL,
	"submission_no" integer NOT NULL,
	"retention_days" integer NOT NULL,
	"consent_version" text NOT NULL,
	"content_sha256" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agency_collection_guest_submissions_number" UNIQUE("request_id","recipient_key","submission_no"),
	CONSTRAINT "agency_collection_guest_submissions_recipient_key" CHECK ("agency_collection_guest_submissions"."recipient_key" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "agency_collection_guest_submissions_sha256" CHECK ("agency_collection_guest_submissions"."content_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "agency_collection_guest_submissions_number_positive" CHECK ("agency_collection_guest_submissions"."submission_no" >= 1),
	CONSTRAINT "agency_collection_guest_submissions_retention_days" CHECK ("agency_collection_guest_submissions"."retention_days" in (3, 7, 15, 30, 60, 90, 180)),
	CONSTRAINT "agency_collection_guest_submissions_consent_cap" CHECK (char_length("agency_collection_guest_submissions"."consent_version") between 1 and 64)
);
--> statement-breakpoint
CREATE TABLE "agency_collection_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"source" text NOT NULL,
	"response_id" uuid,
	"guest_submission_id" uuid,
	"decision" text NOT NULL,
	"item_notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"decided_by_account_id" uuid NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agency_collection_reviews_decision_known" CHECK ("agency_collection_reviews"."decision" in ('RECEIVED', 'NEEDS_CORRECTION', 'ACCEPTED')),
	CONSTRAINT "agency_collection_reviews_target" CHECK (("agency_collection_reviews"."source" = 'account' and "agency_collection_reviews"."response_id" is not null and "agency_collection_reviews"."guest_submission_id" is null) or ("agency_collection_reviews"."source" = 'guest' and "agency_collection_reviews"."guest_submission_id" is not null and "agency_collection_reviews"."response_id" is null)),
	CONSTRAINT "agency_collection_reviews_note_cap" CHECK (coalesce(char_length("agency_collection_reviews"."note"), 0) <= 1000)
);
--> statement-breakpoint
ALTER TABLE "agency_collection_guest_sessions" ADD COLUMN "account_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agency_collection_guest_files" ADD CONSTRAINT "agency_collection_guest_files_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_collection_guest_files" ADD CONSTRAINT "agency_collection_guest_files_request_id_agency_collection_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."agency_collection_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_collection_guest_holds" ADD CONSTRAINT "agency_collection_guest_holds_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_collection_guest_holds" ADD CONSTRAINT "agency_collection_guest_holds_request_id_agency_collection_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."agency_collection_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_collection_guest_submission_items" ADD CONSTRAINT "agency_collection_guest_submission_items_submission_id_agency_collection_guest_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."agency_collection_guest_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_collection_guest_submission_items" ADD CONSTRAINT "agency_collection_guest_submission_items_file_id_agency_collection_guest_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."agency_collection_guest_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_collection_guest_submissions" ADD CONSTRAINT "agency_collection_guest_submissions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_collection_guest_submissions" ADD CONSTRAINT "agency_collection_guest_submissions_request_id_agency_collection_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."agency_collection_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_collection_guest_submissions" ADD CONSTRAINT "agency_collection_guest_submissions_revision_id_agency_collection_request_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."agency_collection_request_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_collection_reviews" ADD CONSTRAINT "agency_collection_reviews_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_collection_reviews" ADD CONSTRAINT "agency_collection_reviews_request_id_agency_collection_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."agency_collection_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_collection_reviews" ADD CONSTRAINT "agency_collection_reviews_response_id_agency_collection_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."agency_collection_responses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_collection_reviews" ADD CONSTRAINT "agency_collection_reviews_guest_submission_id_agency_collection_guest_submissions_id_fk" FOREIGN KEY ("guest_submission_id") REFERENCES "public"."agency_collection_guest_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agency_collection_guest_files_recipient_idx" ON "agency_collection_guest_files" USING btree ("request_id","recipient_key","created_at");--> statement-breakpoint
CREATE INDEX "agency_collection_guest_files_org_idx" ON "agency_collection_guest_files" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "agency_collection_guest_holds_request_idx" ON "agency_collection_guest_holds" USING btree ("request_id","released_at");--> statement-breakpoint
CREATE INDEX "agency_collection_guest_holds_org_idx" ON "agency_collection_guest_holds" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "agency_collection_guest_submission_items_submission_idx" ON "agency_collection_guest_submission_items" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "agency_collection_guest_submission_items_file_idx" ON "agency_collection_guest_submission_items" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "agency_collection_guest_submissions_org_idx" ON "agency_collection_guest_submissions" USING btree ("organization_id","request_id","submitted_at");--> statement-breakpoint
CREATE INDEX "agency_collection_guest_submissions_revision_idx" ON "agency_collection_guest_submissions" USING btree ("revision_id");--> statement-breakpoint
CREATE INDEX "agency_collection_reviews_response_idx" ON "agency_collection_reviews" USING btree ("response_id","decided_at");--> statement-breakpoint
CREATE INDEX "agency_collection_reviews_guest_idx" ON "agency_collection_reviews" USING btree ("guest_submission_id","decided_at");--> statement-breakpoint
CREATE INDEX "agency_collection_reviews_request_idx" ON "agency_collection_reviews" USING btree ("organization_id","request_id");
--> statement-breakpoint
-- A file a submission holds is checked at commit, so removing a whole request or agency (whose
-- cascades reach files and submission lines in either order) never trips over itself.
ALTER TABLE "agency_collection_guest_submission_items" ALTER CONSTRAINT "agency_collection_guest_submission_items_file_id_agency_collection_guest_files_id_fk" DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "visastack_agency_collection_guest_submission_guard"() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
	-- Removing the agency, the request or the revision (a cascade, one trigger level down) takes
	-- these rows with it, and so does the retention purge, which marks its own transaction. A direct
	-- change or delete never does.
	IF TG_OP = 'DELETE' AND (pg_trigger_depth() > 1 OR current_setting('visastack.guest_purge', true) = 'on') THEN
		RETURN OLD;
	END IF;
	RAISE EXCEPTION '%: a submitted guest answer is never changed or removed', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END;
$fn$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "agency_collection_guest_submissions_append_only" ON "agency_collection_guest_submissions";
--> statement-breakpoint
CREATE TRIGGER "agency_collection_guest_submissions_append_only" BEFORE UPDATE OR DELETE ON "agency_collection_guest_submissions" FOR EACH ROW EXECUTE FUNCTION "visastack_agency_collection_guest_submission_guard"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "agency_collection_guest_submission_items_append_only" ON "agency_collection_guest_submission_items";
--> statement-breakpoint
CREATE TRIGGER "agency_collection_guest_submission_items_append_only" BEFORE UPDATE OR DELETE ON "agency_collection_guest_submission_items" FOR EACH ROW EXECUTE FUNCTION "visastack_agency_collection_guest_submission_guard"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "visastack_agency_collection_review_guard"() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
	-- A decision is history: it goes only with the answer, request or agency it belongs to.
	IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
		RETURN OLD;
	END IF;
	RAISE EXCEPTION '%: a review decision is never changed or removed', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END;
$fn$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "agency_collection_reviews_append_only" ON "agency_collection_reviews";
--> statement-breakpoint
CREATE TRIGGER "agency_collection_reviews_append_only" BEFORE UPDATE OR DELETE ON "agency_collection_reviews" FOR EACH ROW EXECUTE FUNCTION "visastack_agency_collection_review_guard"();
