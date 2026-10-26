-- Written to be re-runnable: production applies each statement on its own
-- (neon-http migrator), so a run interrupted after this point must be able to
-- start again from the top.
DO $type$ BEGIN
	CREATE TYPE "public"."reference_kind" AS ENUM('P', 'C', 'D', 'R');
EXCEPTION WHEN duplicate_object THEN NULL;
END $type$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reference_codes" (
	"kind" "reference_kind" NOT NULL,
	"code" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reference_codes_pkey" PRIMARY KEY("kind","code"),
	CONSTRAINT "reference_codes_kind_entity_unique" UNIQUE("kind","entity_id"),
	CONSTRAINT "reference_codes_code_format" CHECK ("reference_codes"."code" ~ '^[0-9A-HJKMNP-TV-Z]{6,8}$')
);--> statement-breakpoint
-- Backfill, hand-written (not drizzle-kit generated): every person, case,
-- document and agency request that exists when this runs gets its visible
-- reference code (ADR 0018). The function computes exactly the check
-- character of packages/core/src/reference-code.ts (Damm over GF(32),
-- x^5 + x^2 + 1, seeded with the type letter) and skips the same codes the
-- application never issues; packages/db/src/reference-codes-migration.test.ts
-- runs every backfilled code through the TypeScript parser. Entropy comes from
-- gen_random_uuid() (the first five bytes, which are fully random). A code
-- clash retries with a fresh code. The function is dropped at the end.
CREATE OR REPLACE FUNCTION "visastack_reference_code_0091"("kind_letter" text) RETURNS text
LANGUAGE plpgsql VOLATILE AS $fn$
DECLARE
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  entropy bytea;
  payload text;
  state integer;
  i integer;
  candidate text;
BEGIN
  LOOP
    entropy := uuid_send(gen_random_uuid());
    payload := '';
    FOR i IN 0..4 LOOP
      payload := payload || substr(alphabet, (get_byte(entropy, i) & 31) + 1, 1);
    END LOOP;
    state := strpos(alphabet, kind_letter) - 1;
    FOR i IN 1..5 LOOP
      state := state << 1;
      IF (state & 32) <> 0 THEN state := state # 37; END IF;
      state := state # (strpos(alphabet, substr(payload, i, 1)) - 1);
    END LOOP;
    state := state << 1;
    IF (state & 32) <> 0 THEN state := state # 37; END IF;
    candidate := payload || substr(alphabet, state + 1, 1);
    CONTINUE WHEN candidate LIKE '00%'
      OR candidate ~ '^(.)\1*$'
      OR translate(candidate, '0134578', 'OIEASTB') ~ '(ASS|SEX|SHIT|DICK|COCK|PORN|NAZI|FAG|KKK|PISS|TIT|BOOB|PENIS|HORNY|RAPE|DIE|DEAD|KYS|WTF|XXX|MAGI|CHOD|HARAMI|KHANKI|BESHYA|MARA)';
    RETURN candidate;
  END LOOP;
END;
$fn$;
--> statement-breakpoint
DO $backfill$
DECLARE
  item record;
  candidate text;
BEGIN
  -- Holds new person, case, document and request rows back until the backfill
  -- commits, so a record created at this exact moment (whose transaction saw
  -- no registry yet) is either finished and backfilled here, or waits and
  -- gets its code when it is created. Reads are not blocked.
  LOCK TABLE "applicants", "missions", "documents", "evidence_requests" IN SHARE MODE;
  FOR item IN
    SELECT 'P'::text AS kind_letter, "id" FROM "applicants"
    UNION ALL SELECT 'C', "id" FROM "missions"
    UNION ALL SELECT 'D', "id" FROM "documents"
    UNION ALL SELECT 'R', "id" FROM "evidence_requests"
  LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM "reference_codes"
      WHERE "kind" = item.kind_letter::"reference_kind" AND "entity_id" = item."id"
    );
    LOOP
      candidate := "visastack_reference_code_0091"(item.kind_letter);
      INSERT INTO "reference_codes" ("kind", "code", "entity_id")
      VALUES (item.kind_letter::"reference_kind", candidate, item."id")
      ON CONFLICT DO NOTHING;
      EXIT WHEN FOUND OR EXISTS (
        SELECT 1 FROM "reference_codes"
        WHERE "kind" = item.kind_letter::"reference_kind" AND "entity_id" = item."id"
      );
    END LOOP;
  END LOOP;
END;
$backfill$;
--> statement-breakpoint
DROP FUNCTION IF EXISTS "visastack_reference_code_0091"(text);
