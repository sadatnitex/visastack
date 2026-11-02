-- Written to be re-runnable: production applies each statement on its own, so a run
-- interrupted part way must be able to start again from the top.
-- UMPE P1 honest necessity (ADR 0026 D2, D3). Additive only: three new types and five nullable
-- columns with no defaults, so no existing row changes. A pack requirement may now say how
-- necessary it is (necessity), who asked for it (provenance) and which group of alternatives it
-- belongs to (group_key with group_mode ANY_OF, set together). A pack version records which
-- manifest format its checksum used (manifest_format, NULL meaning the original format 1, which
-- every version approved before this keeps forever). Until this runs, the code reads every pack
-- as it does today and Pack Studio asks to wait before changing packs. Every statement gives up
-- after 5 seconds rather than queue the site behind a long-running query; a statement that gave
-- up is simply run again.
DO $ty$ BEGIN
	CREATE TYPE "public"."requirement_group_mode" AS ENUM('ANY_OF');
EXCEPTION WHEN duplicate_object THEN NULL;
END $ty$;
--> statement-breakpoint
DO $ty$ BEGIN
	CREATE TYPE "public"."requirement_necessity" AS ENUM('MANDATORY', 'CONDITIONAL', 'RECOMMENDED', 'OPTIONAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $ty$;
--> statement-breakpoint
DO $ty$ BEGIN
	CREATE TYPE "public"."requirement_provenance" AS ENUM('OFFICIAL', 'AGENCY_ADDED', 'AUTHORITY_REQUESTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $ty$;
--> statement-breakpoint
DO $col$ BEGIN
	PERFORM set_config('lock_timeout', '5s', true);
	ALTER TABLE "pack_requirements" ADD COLUMN IF NOT EXISTS "necessity" "requirement_necessity";
	ALTER TABLE "pack_requirements" ADD COLUMN IF NOT EXISTS "provenance" "requirement_provenance";
	ALTER TABLE "pack_requirements" ADD COLUMN IF NOT EXISTS "group_key" text;
	ALTER TABLE "pack_requirements" ADD COLUMN IF NOT EXISTS "group_mode" "requirement_group_mode";
	ALTER TABLE "pack_versions" ADD COLUMN IF NOT EXISTS "manifest_format" integer;
END $col$;
--> statement-breakpoint
-- A group key and its mode come together: added without scanning (NOT VALID), then validated.
DO $ck$ BEGIN
	PERFORM set_config('lock_timeout', '5s', true);
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pack_requirements_group_key_with_mode') THEN
		ALTER TABLE "pack_requirements" ADD CONSTRAINT "pack_requirements_group_key_with_mode" CHECK (("pack_requirements"."group_key" is null) = ("pack_requirements"."group_mode" is null)) NOT VALID;
	END IF;
END $ck$;
--> statement-breakpoint
DO $va$ BEGIN
	PERFORM set_config('lock_timeout', '5s', true);
	ALTER TABLE "pack_requirements" VALIDATE CONSTRAINT "pack_requirements_group_key_with_mode";
END $va$;
