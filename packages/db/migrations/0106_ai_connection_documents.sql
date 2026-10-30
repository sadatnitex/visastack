-- Written to be re-runnable: production applies each statement on its own, so a run
-- interrupted part way must be able to start again from the top.
-- AI app original files (S20, ADR 0021 extension "Original Files"). Additive: one new table, the
-- documents a person chose for one AI connection and how each may be given (a Safe Copy, the
-- default, or the Original). No existing table gains a column and no existing row changes.
-- Until this runs, get_document_file answers "not available yet", the "Original Files" choices are
-- shown turned off, and everything else works as before. After it runs, AI App Original Files
-- stays off until the platform owner turns it on in AI Features (no row is written here).
CREATE TABLE IF NOT EXISTS "ai_connection_documents" (
	"connection_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"variant" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_connection_documents_pkey" PRIMARY KEY("connection_id","document_id"),
	CONSTRAINT "ai_connection_documents_variant" CHECK ("ai_connection_documents"."variant" in ('SAFE_COPY', 'ORIGINAL'))
);
--> statement-breakpoint
DO $fk$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_connection_documents_connection_id_ai_connections_id_fk') THEN
		ALTER TABLE "ai_connection_documents" ADD CONSTRAINT "ai_connection_documents_connection_id_ai_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."ai_connections"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $fk$;
--> statement-breakpoint
DO $fk$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_connection_documents_document_id_documents_id_fk') THEN
		ALTER TABLE "ai_connection_documents" ADD CONSTRAINT "ai_connection_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $fk$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_connection_documents_document_idx" ON "ai_connection_documents" USING btree ("document_id");
--> statement-breakpoint
-- A connection may name only documents of its own record: the document's record must be the
-- connection's record, on every insert and on every change of either link.
CREATE OR REPLACE FUNCTION "ai_connection_documents_same_record"() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM "ai_connections" c
		JOIN "documents" d ON d."applicant_id" = c."applicant_id"
		WHERE c."id" = NEW."connection_id" AND d."id" = NEW."document_id"
	) THEN
		RAISE EXCEPTION 'an AI connection may only name documents of its own record'
			USING ERRCODE = 'check_violation';
	END IF;
	RETURN NEW;
END
$fn$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "ai_connection_documents_same_record" ON "ai_connection_documents";
--> statement-breakpoint
CREATE TRIGGER "ai_connection_documents_same_record" BEFORE INSERT OR UPDATE OF "connection_id", "document_id" ON "ai_connection_documents"
	FOR EACH ROW EXECUTE FUNCTION "ai_connection_documents_same_record"();
