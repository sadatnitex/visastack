CREATE TYPE "public"."applicant_relationship" AS ENUM('SELF', 'FAMILY_MEMBER', 'MINOR_GUARDIAN');--> statement-breakpoint
CREATE TYPE "public"."audit_method" AS ENUM('MANUAL', 'DOCUMENT', 'API', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."audit_result" AS ENUM('ALLOWED', 'DENIED');--> statement-breakpoint
CREATE TYPE "public"."consent_type" AS ENUM('CORE_PROCESSING', 'AI_EXTRACTION', 'SHARING', 'MARKETING');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('OWNER', 'ADMIN', 'CASE_MANAGER', 'REVIEWER');--> statement-breakpoint
CREATE TYPE "public"."organization_status" AS ENUM('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'REJECTED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."permission_action" AS ENUM('VIEW_METADATA', 'PREVIEW', 'COMMENT', 'PROPOSE_EDIT', 'APPROVE_EDIT', 'DOWNLOAD_ORIGINAL', 'DOWNLOAD_REDACTED', 'DOWNLOAD_PACK', 'EXPORT_PROFILE', 'SHARE', 'MANAGE');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "applicants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_account_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"relationship" "applicant_relationship" DEFAULT 'SELF' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_events" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_type" text NOT NULL,
	"actor_account_id" uuid,
	"actor_role" text,
	"action" "permission_action",
	"result" "audit_result",
	"method" "audit_method",
	"applicant_id" uuid,
	"resource_type" text,
	"resource_id" text,
	"mission_id" uuid,
	"grant_id" uuid,
	"reason" text,
	"ip" text,
	"device" text,
	"metadata" jsonb,
	"prev_hash" text,
	"hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"type" "consent_type" NOT NULL,
	"granted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"role" "membership_role" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_account_org_unique" UNIQUE("account_id","organization_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" "organization_status" DEFAULT 'PENDING_VERIFICATION' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "applicants" ADD CONSTRAINT "applicants_owner_account_id_accounts_id_fk" FOREIGN KEY ("owner_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_account_id_accounts_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memberships" ADD CONSTRAINT "memberships_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_occurred_at_idx" ON "audit_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_applicant_idx" ON "audit_events" USING btree ("applicant_id");--> statement-breakpoint
CREATE RULE "audit_events_no_update" AS ON UPDATE TO "audit_events" DO INSTEAD NOTHING;--> statement-breakpoint
CREATE RULE "audit_events_no_delete" AS ON DELETE TO "audit_events" DO INSTEAD NOTHING;
