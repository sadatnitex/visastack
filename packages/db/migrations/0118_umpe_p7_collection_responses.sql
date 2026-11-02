CREATE TABLE "agency_collection_response_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"response_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"kind" text NOT NULL,
	"document_id" uuid,
	"document_version_id" uuid,
	"fact_id" uuid,
	"fact_version_id" uuid,
	CONSTRAINT "agency_collection_response_items_one_line" UNIQUE("response_id","item_id","document_version_id","fact_version_id"),
	CONSTRAINT "agency_collection_response_items_kind_known" CHECK ("agency_collection_response_items"."kind" in ('DOCUMENT', 'FIELD', 'MISSING')),
	CONSTRAINT "agency_collection_response_items_target" CHECK (("agency_collection_response_items"."kind" = 'DOCUMENT' and "agency_collection_response_items"."document_id" is not null and "agency_collection_response_items"."document_version_id" is not null and "agency_collection_response_items"."fact_id" is null and "agency_collection_response_items"."fact_version_id" is null) or ("agency_collection_response_items"."kind" = 'FIELD' and "agency_collection_response_items"."fact_id" is not null and "agency_collection_response_items"."fact_version_id" is not null and "agency_collection_response_items"."document_id" is null and "agency_collection_response_items"."document_version_id" is null) or ("agency_collection_response_items"."kind" = 'MISSING' and "agency_collection_response_items"."document_id" is null and "agency_collection_response_items"."document_version_id" is null and "agency_collection_response_items"."fact_id" is null and "agency_collection_response_items"."fact_version_id" is null))
);
--> statement-breakpoint
CREATE TABLE "agency_collection_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"applicant_id" uuid NOT NULL,
	"submitted_by_account_id" uuid NOT NULL,
	"destination" text NOT NULL,
	"revision_no" integer NOT NULL,
	"consent_version" text NOT NULL,
	"content_sha256" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by_account_id" uuid,
	CONSTRAINT "agency_collection_responses_sha256" CHECK ("agency_collection_responses"."content_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "agency_collection_responses_consent_cap" CHECK (char_length("agency_collection_responses"."consent_version") between 1 and 64),
	CONSTRAINT "agency_collection_responses_withdrawal_pair" CHECK (("agency_collection_responses"."withdrawn_at" is null) = ("agency_collection_responses"."withdrawn_by_account_id" is null))
);
--> statement-breakpoint
ALTER TABLE "agency_collection_response_items" ADD CONSTRAINT "agency_collection_response_items_response_id_agency_collection_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."agency_collection_responses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_collection_response_items" ADD CONSTRAINT "agency_collection_response_items_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_collection_response_items" ADD CONSTRAINT "agency_collection_response_items_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_collection_response_items" ADD CONSTRAINT "agency_collection_response_items_fact_id_facts_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."facts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_collection_response_items" ADD CONSTRAINT "agency_collection_response_items_fact_version_id_fact_versions_id_fk" FOREIGN KEY ("fact_version_id") REFERENCES "public"."fact_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_collection_responses" ADD CONSTRAINT "agency_collection_responses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_collection_responses" ADD CONSTRAINT "agency_collection_responses_request_id_agency_collection_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."agency_collection_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_collection_responses" ADD CONSTRAINT "agency_collection_responses_revision_id_agency_collection_request_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."agency_collection_request_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_collection_responses" ADD CONSTRAINT "agency_collection_responses_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agency_collection_response_items_response_idx" ON "agency_collection_response_items" USING btree ("response_id");--> statement-breakpoint
CREATE INDEX "agency_collection_response_items_version_idx" ON "agency_collection_response_items" USING btree ("document_version_id");--> statement-breakpoint
CREATE INDEX "agency_collection_response_items_fact_version_idx" ON "agency_collection_response_items" USING btree ("fact_version_id");--> statement-breakpoint
CREATE INDEX "agency_collection_responses_request_idx" ON "agency_collection_responses" USING btree ("organization_id","request_id","submitted_at");--> statement-breakpoint
CREATE INDEX "agency_collection_responses_applicant_idx" ON "agency_collection_responses" USING btree ("applicant_id","submitted_at");--> statement-breakpoint
CREATE INDEX "agency_collection_responses_revision_idx" ON "agency_collection_responses" USING btree ("revision_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "visastack_agency_collection_responses_guard"() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
	-- Removing the person, the agency or the request (a cascade, one trigger level down) takes the
	-- response with it. A direct delete never does.
	IF TG_OP = 'DELETE' THEN
		IF pg_trigger_depth() > 1 THEN
			RETURN OLD;
		END IF;
		RAISE EXCEPTION 'agency_collection_responses: a submitted response is never removed' USING ERRCODE = 'restrict_violation';
	END IF;
	-- The only change ever made: recording a withdrawal, once.
	IF OLD.withdrawn_at IS NULL AND NEW.withdrawn_at IS NOT NULL AND NEW.withdrawn_by_account_id IS NOT NULL
		AND NEW.id = OLD.id AND NEW.organization_id = OLD.organization_id AND NEW.request_id = OLD.request_id
		AND NEW.revision_id = OLD.revision_id AND NEW.link_id = OLD.link_id AND NEW.applicant_id = OLD.applicant_id
		AND NEW.submitted_by_account_id = OLD.submitted_by_account_id AND NEW.destination = OLD.destination
		AND NEW.revision_no = OLD.revision_no AND NEW.consent_version = OLD.consent_version
		AND NEW.content_sha256 = OLD.content_sha256 AND NEW.submitted_at = OLD.submitted_at THEN
		RETURN NEW;
	END IF;
	RAISE EXCEPTION 'agency_collection_responses: a submitted response is never changed' USING ERRCODE = 'restrict_violation';
END;
$fn$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "agency_collection_responses_append_only" ON "agency_collection_responses";
--> statement-breakpoint
CREATE TRIGGER "agency_collection_responses_append_only" BEFORE UPDATE OR DELETE ON "agency_collection_responses" FOR EACH ROW EXECUTE FUNCTION "visastack_agency_collection_responses_guard"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "visastack_agency_collection_response_items_guard"() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
	IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
		RETURN OLD;
	END IF;
	RAISE EXCEPTION 'agency_collection_response_items: a submitted line is never changed or removed' USING ERRCODE = 'restrict_violation';
END;
$fn$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "agency_collection_response_items_append_only" ON "agency_collection_response_items";
--> statement-breakpoint
CREATE TRIGGER "agency_collection_response_items_append_only" BEFORE UPDATE OR DELETE ON "agency_collection_response_items" FOR EACH ROW EXECUTE FUNCTION "visastack_agency_collection_response_items_guard"();
