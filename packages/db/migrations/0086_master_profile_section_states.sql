CREATE TABLE "profile_field_exemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"applicant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"target_key" text NOT NULL,
	"created_by_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_field_exemptions_applicant_kind_target_unique" UNIQUE("applicant_id","kind","target_key")
);
--> statement-breakpoint
CREATE TABLE "profile_section_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"applicant_id" uuid NOT NULL,
	"section_key" text NOT NULL,
	"is_open" boolean NOT NULL,
	"updated_by_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_section_states_applicant_section_unique" UNIQUE("applicant_id","section_key")
);
--> statement-breakpoint
ALTER TABLE "profile_field_exemptions" ADD CONSTRAINT "profile_field_exemptions_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_field_exemptions" ADD CONSTRAINT "profile_field_exemptions_created_by_account_id_accounts_id_fk" FOREIGN KEY ("created_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_section_states" ADD CONSTRAINT "profile_section_states_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_section_states" ADD CONSTRAINT "profile_section_states_updated_by_account_id_accounts_id_fk" FOREIGN KEY ("updated_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "profile_field_exemptions_applicant_idx" ON "profile_field_exemptions" USING btree ("applicant_id");--> statement-breakpoint
CREATE INDEX "profile_section_states_applicant_idx" ON "profile_section_states" USING btree ("applicant_id");