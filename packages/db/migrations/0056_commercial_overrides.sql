CREATE TABLE "commercial_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"granted_by_account_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"start_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expiry_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_account_id" uuid,
	"revoked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_overrides_expiry_after_start" CHECK ("commercial_overrides"."expiry_at" > "commercial_overrides"."start_at"),
	CONSTRAINT "commercial_overrides_max_duration" CHECK (extract(epoch from ("commercial_overrides"."expiry_at" - "commercial_overrides"."start_at")) <= 2592000)
);
--> statement-breakpoint
ALTER TABLE "commercial_overrides" ADD CONSTRAINT "commercial_overrides_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_overrides" ADD CONSTRAINT "commercial_overrides_granted_by_account_id_accounts_id_fk" FOREIGN KEY ("granted_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_overrides" ADD CONSTRAINT "commercial_overrides_revoked_by_account_id_accounts_id_fk" FOREIGN KEY ("revoked_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commercial_overrides_organization_idx" ON "commercial_overrides" USING btree ("organization_id");