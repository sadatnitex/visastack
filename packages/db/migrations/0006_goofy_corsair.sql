CREATE TYPE "public"."pack_version_status" AS ENUM('DRAFT', 'APPROVED', 'PUBLISHED', 'DEPRECATED');--> statement-breakpoint
CREATE TYPE "public"."requirement_kind" AS ENUM('FIELD', 'DOCUMENT');--> statement-breakpoint
CREATE TABLE "mission_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mission_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"checksum" text NOT NULL,
	"created_by_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mission_snapshots_mission_version_unique" UNIQUE("mission_id","version")
);
--> statement-breakpoint
CREATE TABLE "pack_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pack_version_id" uuid NOT NULL,
	"kind" "requirement_kind" NOT NULL,
	"field_key" text,
	"doc_type" text,
	"citation" text NOT NULL,
	"optional" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pack_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pack_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "pack_version_status" DEFAULT 'DRAFT' NOT NULL,
	"manifest" jsonb,
	"checksum" text,
	"approved_by_account_id" uuid,
	"approved_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pack_versions_pack_version_unique" UNIQUE("pack_id","version")
);
--> statement-breakpoint
CREATE TABLE "packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"owner_organization_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "packs_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "missions" ADD COLUMN "pack_version_id" uuid;--> statement-breakpoint
ALTER TABLE "mission_snapshots" ADD CONSTRAINT "mission_snapshots_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_requirements" ADD CONSTRAINT "pack_requirements_pack_version_id_pack_versions_id_fk" FOREIGN KEY ("pack_version_id") REFERENCES "public"."pack_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_versions" ADD CONSTRAINT "pack_versions_pack_id_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packs" ADD CONSTRAINT "packs_owner_organization_id_organizations_id_fk" FOREIGN KEY ("owner_organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pack_requirements_version_idx" ON "pack_requirements" USING btree ("pack_version_id");