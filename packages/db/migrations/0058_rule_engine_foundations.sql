ALTER TYPE "public"."pack_version_status" ADD VALUE 'WITHDRAWN';--> statement-breakpoint
ALTER TABLE "pack_requirements" ADD COLUMN "condition" jsonb;--> statement-breakpoint
ALTER TABLE "pack_requirements" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "pack_requirements" ADD COLUMN "source_title" text;--> statement-breakpoint
ALTER TABLE "pack_requirements" ADD COLUMN "publisher" text;--> statement-breakpoint
ALTER TABLE "pack_requirements" ADD COLUMN "official_extract" text;--> statement-breakpoint
ALTER TABLE "pack_requirements" ADD COLUMN "interpretation" text;--> statement-breakpoint
ALTER TABLE "pack_requirements" ADD COLUMN "source_type" text;--> statement-breakpoint
ALTER TABLE "pack_requirements" ADD COLUMN "observed_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pack_requirements" ADD COLUMN "author_account_id" uuid;--> statement-breakpoint
ALTER TABLE "pack_requirements" ADD COLUMN "change_reason" text;--> statement-breakpoint
ALTER TABLE "pack_requirements" ADD COLUMN "source_inaccessible_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pack_versions" ADD COLUMN "authored_by_account_id" uuid;--> statement-breakpoint
ALTER TABLE "pack_versions" ADD COLUMN "next_review_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pack_versions" ADD COLUMN "review_interval_reason" text;--> statement-breakpoint
ALTER TABLE "pack_versions" ADD COLUMN "effective_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pack_versions" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pack_versions" ADD COLUMN "withdrawn_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pack_versions" ADD COLUMN "withdrawn_by_account_id" uuid;--> statement-breakpoint
ALTER TABLE "pack_versions" ADD COLUMN "withdrawn_reason" text;--> statement-breakpoint
ALTER TABLE "packs" ADD COLUMN "jurisdiction" text;--> statement-breakpoint
ALTER TABLE "packs" ADD COLUMN "route" text;--> statement-breakpoint
ALTER TABLE "packs" ADD COLUMN "purpose" text;--> statement-breakpoint
ALTER TABLE "packs" ADD COLUMN "nationality_applicability" text[];--> statement-breakpoint
ALTER TABLE "packs" ADD COLUMN "residence_applicability" text[];--> statement-breakpoint
ALTER TABLE "packs" ADD COLUMN "authoritative" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pack_requirements" ADD CONSTRAINT "pack_requirements_author_account_id_accounts_id_fk" FOREIGN KEY ("author_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_versions" ADD CONSTRAINT "pack_versions_authored_by_account_id_accounts_id_fk" FOREIGN KEY ("authored_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_versions" ADD CONSTRAINT "pack_versions_withdrawn_by_account_id_accounts_id_fk" FOREIGN KEY ("withdrawn_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;