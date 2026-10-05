ALTER TABLE "product_events" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "product_events" ADD COLUMN "dimension" text;--> statement-breakpoint
ALTER TABLE "product_events" ADD COLUMN "metric_value" bigint;--> statement-breakpoint
ALTER TABLE "product_events" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "product_events" ADD CONSTRAINT "product_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_events_org_time_idx" ON "product_events" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "product_events_dedupe_key_uidx" ON "product_events" USING btree ("dedupe_key");--> statement-breakpoint
ALTER TABLE "product_events" ADD CONSTRAINT "product_events_dimension_token" CHECK ("product_events"."dimension" is null or "product_events"."dimension" ~ '^[A-Z][A-Z0-9_]{0,39}$');--> statement-breakpoint
ALTER TABLE "product_events" ADD CONSTRAINT "product_events_metric_non_negative" CHECK ("product_events"."metric_value" is null or "product_events"."metric_value" >= 0);