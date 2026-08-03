CREATE TABLE "pilot_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"invited_by_account_id" uuid,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	"revoked_at" timestamp with time zone,
	"revoked_by_account_id" uuid,
	"revoked_reason" text,
	"accepted_at" timestamp with time zone,
	"accepted_account_id" uuid
);
--> statement-breakpoint
ALTER TABLE "platform_roles" DROP CONSTRAINT "platform_roles_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "platform_roles" ALTER COLUMN "account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pilot_invitations" ADD CONSTRAINT "pilot_invitations_invited_by_account_id_accounts_id_fk" FOREIGN KEY ("invited_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_invitations" ADD CONSTRAINT "pilot_invitations_revoked_by_account_id_accounts_id_fk" FOREIGN KEY ("revoked_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_invitations" ADD CONSTRAINT "pilot_invitations_accepted_account_id_accounts_id_fk" FOREIGN KEY ("accepted_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pilot_invitations_email_idx" ON "pilot_invitations" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "pilot_invitations_active_unique_idx" ON "pilot_invitations" USING btree ("email") WHERE "pilot_invitations"."revoked_at" is null and "pilot_invitations"."accepted_at" is null;--> statement-breakpoint
ALTER TABLE "platform_roles" ADD CONSTRAINT "platform_roles_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Data migration, hand-written (not drizzle-kit generated): on an already-
-- populated database, migration 0019 created "platform_roles" with no
-- uniqueness constraint, and the previous grantPlatformRole implementation
-- inserted a new row on every repeated submission — duplicate active
-- (account_id, role) rows are a valid state real released code could have
-- produced. Creating the unique index below without cleaning these up first
-- would abort this migration and block deployment. Keep exactly the
-- earliest active grant per (account_id, role) — by assigned_at, then id as
-- a stable tiebreak — and properly revoke (never delete) every later
-- duplicate, preserving full history (Codex review, PR #65).
UPDATE "platform_roles" AS p
SET "revoked_at" = now(),
    "revoked_reason" = 'deduplicated: superseded by an earlier active grant for the same account and role'
WHERE p."revoked_at" IS NULL
  AND p."account_id" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "platform_roles" AS earlier
    WHERE earlier."account_id" = p."account_id"
      AND earlier."role" = p."role"
      AND earlier."revoked_at" IS NULL
      AND earlier."id" <> p."id"
      AND (earlier."assigned_at", earlier."id") < (p."assigned_at", p."id")
  );--> statement-breakpoint
CREATE UNIQUE INDEX "platform_roles_active_unique_idx" ON "platform_roles" USING btree ("account_id","role") WHERE "platform_roles"."revoked_at" is null;