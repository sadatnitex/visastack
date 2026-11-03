CREATE TABLE "agency_member_capabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"capability" text NOT NULL,
	"granted_by_account_id" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agency_member_capabilities_unique" UNIQUE("membership_id","capability"),
	CONSTRAINT "agency_member_capabilities_known" CHECK ("agency_member_capabilities"."capability" in ('REQUEST_DOCUMENTS'))
);
--> statement-breakpoint
ALTER TABLE "agency_member_capabilities" ADD CONSTRAINT "agency_member_capabilities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_member_capabilities" ADD CONSTRAINT "agency_member_capabilities_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agency_member_capabilities_org_idx" ON "agency_member_capabilities" USING btree ("organization_id");