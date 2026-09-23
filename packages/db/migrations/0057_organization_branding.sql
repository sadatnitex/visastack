ALTER TABLE "organizations" ADD COLUMN "accent_color" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "logo_object_key" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "logo_content_type" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_accent_color_format" CHECK ("organizations"."accent_color" is null or "organizations"."accent_color" ~ '^#[0-9a-fA-F]{6}$');--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_logo_fields_together" CHECK (("organizations"."logo_object_key" is null) = ("organizations"."logo_content_type" is null));