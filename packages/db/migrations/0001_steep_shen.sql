CREATE TYPE "public"."grant_status" AS ENUM('PENDING_ACCEPTANCE', 'ACTIVE', 'PAUSED', 'REVOKED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."mission_state" AS ENUM('DRAFT', 'IN_PROGRESS', 'READY_FOR_REVIEW', 'UNDER_REVIEW', 'READY_TO_EXPORT', 'LOCKED', 'CLOSED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"applicant_id" uuid NOT NULL,
	"recipient_account_id" uuid,
	"recipient_organization_id" uuid,
	"mission_id" uuid,
	"actions" "permission_action"[] NOT NULL,
	"categories" text[],
	"purpose" text NOT NULL,
	"status" "grant_status" DEFAULT 'PENDING_ACCEPTANCE' NOT NULL,
	"accepted_at" timestamp with time zone,
	"start_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expiry_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grants_recipient_present" CHECK ("grants"."recipient_account_id" is not null or "grants"."recipient_organization_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "missions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"applicant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"destination" text,
	"purpose" text,
	"state" "mission_state" DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_recipient_account_id_accounts_id_fk" FOREIGN KEY ("recipient_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_recipient_organization_id_organizations_id_fk" FOREIGN KEY ("recipient_organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "grants_applicant_idx" ON "grants" USING btree ("applicant_id");