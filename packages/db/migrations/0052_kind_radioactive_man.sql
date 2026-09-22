ALTER TYPE "public"."notification_delivery_status" ADD VALUE 'CANCELLED';--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "resource_id" text;--> statement-breakpoint
CREATE INDEX "notifications_resource_idx" ON "notifications" USING btree ("resource_id","status");