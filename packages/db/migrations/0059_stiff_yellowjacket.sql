ALTER TABLE "pack_versions" ADD COLUMN "route_description" text;--> statement-breakpoint
ALTER TABLE "pack_versions" ADD COLUMN "official_fee_minor_units" integer;--> statement-breakpoint
ALTER TABLE "pack_versions" ADD COLUMN "official_fee_currency" text;--> statement-breakpoint
ALTER TABLE "pack_versions" ADD COLUMN "official_fee_stale_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pack_versions" ADD COLUMN "official_channel_name" text;--> statement-breakpoint
ALTER TABLE "pack_versions" ADD COLUMN "official_channel_url" text;--> statement-breakpoint
ALTER TABLE "pack_versions" ADD COLUMN "official_reporting_url" text;--> statement-breakpoint
ALTER TABLE "pack_versions" ADD COLUMN "public_trust_published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pack_versions" ADD CONSTRAINT "pack_versions_official_fee_currency_together" CHECK (("pack_versions"."official_fee_minor_units" is null) = ("pack_versions"."official_fee_currency" is null));