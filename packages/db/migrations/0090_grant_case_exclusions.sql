-- Per-case sharing exceptions (ADR 0017). Additive only: one new table and three unique
-- (id, applicant_id) pairs on its parents. Hand-ordered after drizzle-kit generate: the unique
-- pairs must exist before the composite foreign keys that reference them (a new pattern here:
-- each key names a parent AND its applicant, so the database refuses a row that mixes two
-- people). The pairs never reject an existing row because id is already each table's key.
ALTER TABLE "grants" ADD CONSTRAINT "grants_id_applicant_unique" UNIQUE("id","applicant_id");--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_id_applicant_unique" UNIQUE("id","applicant_id");--> statement-breakpoint
ALTER TABLE "sharing_invitations" ADD CONSTRAINT "sharing_invitations_id_applicant_unique" UNIQUE("id","applicant_id");--> statement-breakpoint
CREATE TABLE "grant_case_exclusions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grant_id" uuid,
	"sharing_invitation_id" uuid,
	"mission_id" uuid NOT NULL,
	"applicant_id" uuid NOT NULL,
	"created_by_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grant_case_exclusions_one_parent" CHECK (("grant_case_exclusions"."grant_id" is null) <> ("grant_case_exclusions"."sharing_invitation_id" is null))
);--> statement-breakpoint
ALTER TABLE "grant_case_exclusions" ADD CONSTRAINT "grant_case_exclusions_grant_id_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grant_case_exclusions" ADD CONSTRAINT "grant_case_exclusions_sharing_invitation_id_sharing_invitations_id_fk" FOREIGN KEY ("sharing_invitation_id") REFERENCES "public"."sharing_invitations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grant_case_exclusions" ADD CONSTRAINT "grant_case_exclusions_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grant_case_exclusions" ADD CONSTRAINT "grant_case_exclusions_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grant_case_exclusions" ADD CONSTRAINT "grant_case_exclusions_created_by_account_id_accounts_id_fk" FOREIGN KEY ("created_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grant_case_exclusions" ADD CONSTRAINT "grant_case_exclusions_grant_applicant_fk" FOREIGN KEY ("grant_id","applicant_id") REFERENCES "public"."grants"("id","applicant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grant_case_exclusions" ADD CONSTRAINT "grant_case_exclusions_invitation_applicant_fk" FOREIGN KEY ("sharing_invitation_id","applicant_id") REFERENCES "public"."sharing_invitations"("id","applicant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grant_case_exclusions" ADD CONSTRAINT "grant_case_exclusions_mission_applicant_fk" FOREIGN KEY ("mission_id","applicant_id") REFERENCES "public"."missions"("id","applicant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "grant_case_exclusions_grant_mission_unique" ON "grant_case_exclusions" USING btree ("grant_id","mission_id") WHERE "grant_case_exclusions"."grant_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "grant_case_exclusions_invitation_mission_unique" ON "grant_case_exclusions" USING btree ("sharing_invitation_id","mission_id") WHERE "grant_case_exclusions"."sharing_invitation_id" is not null;--> statement-breakpoint
CREATE INDEX "grant_case_exclusions_applicant_idx" ON "grant_case_exclusions" USING btree ("applicant_id");--> statement-breakpoint
CREATE INDEX "grant_case_exclusions_mission_idx" ON "grant_case_exclusions" USING btree ("mission_id");