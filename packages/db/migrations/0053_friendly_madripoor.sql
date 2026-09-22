CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"seats_allowed" integer,
	"cases_per_period_allowed" integer,
	"concurrent_open_cases_allowed" integer,
	"storage_bytes_allowed" bigint,
	"ai_allowance_units_allowed" integer,
	"period_days" integer DEFAULT 30 NOT NULL,
	"price_minor_units" integer,
	"currency" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_key_unique" UNIQUE("key"),
	CONSTRAINT "plans_price_currency_together" CHECK (("plans"."price_minor_units" is null) = ("plans"."currency" is null))
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"assigned_by_account_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_assigned_by_account_id_accounts_id_fk" FOREIGN KEY ("assigned_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subscriptions_organization_idx" ON "subscriptions" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_one_current_per_org" ON "subscriptions" USING btree ("organization_id") WHERE "subscriptions"."ended_at" is null;--> statement-breakpoint
-- Seed the three catalog templates COM-01 names (PRD §12: "Provide Traveller
-- Free and manually activated Agency Starter/Pro templates"). Every number
-- below besides Traveller Free's storage figure (which reuses the value
-- already enforced today as QUOTA_MAX_ACCOUNT_EVIDENCE_MB's default, so it
-- does not silently contradict the one real limit that already exists) is a
-- clearly-provisional placeholder, NOT a product-owner pricing/capacity
-- decision -- the PRD is explicit that "numerical allowances/prices are
-- product-owner configuration, not invented market truth." price_minor_units
-- and currency are left NULL for all three rows deliberately, for the same
-- reason: this migration seeds the mechanism (a real, admin-editable plans
-- table), never a business decision nobody has actually made. See
-- packages/services/src/plans.ts's own doc comment and
-- docs/commercial-v1/requirements-ledger.md's COM-01 row.
INSERT INTO "plans" ("key", "name", "seats_allowed", "cases_per_period_allowed", "concurrent_open_cases_allowed", "storage_bytes_allowed", "ai_allowance_units_allowed", "period_days")
VALUES
  ('traveller_free', 'Traveller Free', 1, NULL, NULL, 104857600, NULL, 30),
  ('agency_starter', 'Agency Starter', 5, 25, 15, 5368709120, 1000, 30),
  ('agency_pro', 'Agency Pro', 20, 100, 60, 21474836480, 5000, 30)
ON CONFLICT ("key") DO NOTHING;