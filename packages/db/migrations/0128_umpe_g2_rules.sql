-- Written to be re-runnable: production applies each statement on its own, so a run
-- interrupted part way must be able to start again from the top.
-- Rules gap closure (UMPE G2). One new provenance word, two side tables and one widened check;
-- nothing existing is rewritten. pack_requirement_details holds a requirement's rule category
-- (R02), how a document must be provided (R12), when its source's rule took effect (R08) and how
-- long it must stay valid after the trip (R22). pack_route_conditions holds the application posts
-- and trip start window one pack version is for (R05). Both belong to a pack version, change only
-- while it is a draft, and enter its manifest checksum only when present. FIELD_OBSERVATION marks
-- an item seen in VisaStack cases, never an official requirement (S08). umpe_package_changes may
-- now record CASE_DETAILS_CHANGED (the linked checklist no longer fits the case's post or dates).
-- The check is widened first, so the code that writes the new kind (which waits for the tables)
-- never meets the old check. Until this runs the code finds the tables missing and behaves as before.
ALTER TYPE "public"."requirement_provenance" ADD VALUE IF NOT EXISTS 'FIELD_OBSERVATION';--> statement-breakpoint
ALTER TABLE "umpe_package_changes" DROP CONSTRAINT IF EXISTS "umpe_package_changes_kind_known";--> statement-breakpoint
ALTER TABLE "umpe_package_changes" ADD CONSTRAINT "umpe_package_changes_kind_known" CHECK ("umpe_package_changes"."kind" in ('NEWER_DOCUMENT', 'FACT_CHANGED', 'EVIDENCE_EXPIRED', 'PACK_CHANGED', 'PACK_WITHDRAWN', 'SOURCE_CHANGING', 'CASE_DETAILS_CHANGED'));--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pack_requirement_details" (
	"pack_requirement_id" uuid PRIMARY KEY NOT NULL,
	"category" text,
	"accepted_form" text,
	"translation_needed" boolean,
	"original_needed" boolean,
	"statement_period_months" integer,
	"valid_months_after_travel" integer,
	"effective_since" timestamp with time zone,
	"updated_by_account_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pack_requirement_details_category_known" CHECK ("pack_requirement_details"."category" is null or "pack_requirement_details"."category" in ('IDENTITY_TRAVEL_DOCUMENTS', 'IMMIGRATION_HISTORY', 'DECLARATIONS_CIRCUMSTANCES', 'FINANCIAL_MEANS', 'EMPLOYMENT_BUSINESS', 'EDUCATION_ACADEMIC', 'FAMILY_SPONSORSHIP', 'JOURNEY_ITINERARY', 'MEDICAL_HEALTH', 'FORMS_PROCEDURES', 'ROUTE_SPECIFIC_OTHER')),
	CONSTRAINT "pack_requirement_details_accepted_form_known" CHECK ("pack_requirement_details"."accepted_form" is null or "pack_requirement_details"."accepted_form" in ('DIGITAL_COPY', 'PRINTED_COPY', 'CERTIFIED_COPY', 'NOTARISED_COPY')),
	CONSTRAINT "pack_requirement_details_statement_period_range" CHECK ("pack_requirement_details"."statement_period_months" is null or "pack_requirement_details"."statement_period_months" between 1 and 60),
	CONSTRAINT "pack_requirement_details_valid_after_travel_range" CHECK ("pack_requirement_details"."valid_months_after_travel" is null or "pack_requirement_details"."valid_months_after_travel" between 0 and 120)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pack_route_conditions" (
	"pack_version_id" uuid PRIMARY KEY NOT NULL,
	"consular_posts" text[],
	"travel_from" date,
	"travel_until" date,
	"updated_by_account_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pack_route_conditions_window_order" CHECK ("pack_route_conditions"."travel_from" is null or "pack_route_conditions"."travel_until" is null or "pack_route_conditions"."travel_from" <= "pack_route_conditions"."travel_until")
);
--> statement-breakpoint
DO $fk$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pack_requirement_details_pack_requirement_id_pack_requirements_id_fk') THEN
		ALTER TABLE "pack_requirement_details" ADD CONSTRAINT "pack_requirement_details_pack_requirement_id_pack_requirements_id_fk" FOREIGN KEY ("pack_requirement_id") REFERENCES "public"."pack_requirements"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pack_requirement_details_updated_by_account_id_accounts_id_fk') THEN
		ALTER TABLE "pack_requirement_details" ADD CONSTRAINT "pack_requirement_details_updated_by_account_id_accounts_id_fk" FOREIGN KEY ("updated_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pack_route_conditions_pack_version_id_pack_versions_id_fk') THEN
		ALTER TABLE "pack_route_conditions" ADD CONSTRAINT "pack_route_conditions_pack_version_id_pack_versions_id_fk" FOREIGN KEY ("pack_version_id") REFERENCES "public"."pack_versions"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pack_route_conditions_updated_by_account_id_accounts_id_fk') THEN
		ALTER TABLE "pack_route_conditions" ADD CONSTRAINT "pack_route_conditions_updated_by_account_id_accounts_id_fk" FOREIGN KEY ("updated_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $fk$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pack_requirement_details_updated_by_idx" ON "pack_requirement_details" USING btree ("updated_by_account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pack_route_conditions_updated_by_idx" ON "pack_route_conditions" USING btree ("updated_by_account_id");
