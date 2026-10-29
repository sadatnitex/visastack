import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { describe, expect, it } from 'vitest';
import { migrationsFolder } from './paths';

const MIGRATION_TIMEOUT_MS = 120_000;

describe('migration 0102: safe copy masks', () => {
  it(
    'creates the table, is safe to run again, holds one row per page, and goes with the version',
    async () => {
      const client = new PGlite();
      await migrate(drizzle(client), { migrationsFolder });

      // Production applies each statement on its own; running the whole file again must not fail.
      const sql = readFileSync(join(migrationsFolder, '0102_redaction_masks.sql'), 'utf8');
      for (const statement of sql.split('--> statement-breakpoint')) await client.exec(statement);

      const one = async (text: string): Promise<string> => {
        const id = (await client.query<{ id: string }>(text)).rows[0]?.id;
        if (!id) throw new Error(`no row from: ${text}`);
        return id;
      };
      const account = await one(
        `insert into accounts (email) values ('mask-migration@example.test') returning id`,
      );
      const applicant = await one(
        `insert into applicants (owner_account_id, display_name) values ('${account}', 'Synthetic Traveller') returning id`,
      );
      const documentId = await one(
        `insert into documents (applicant_id, original_name) values ('${applicant}', 'synthetic.pdf') returning id`,
      );
      const storage = await one(
        `insert into storage_objects (bucket, object_key) values ('CLEAN', 'mask-migration-key') returning id`,
      );
      const version = await one(
        `insert into document_versions (document_id, storage_object_id) values ('${documentId}', '${storage}') returning id`,
      );

      const revision = '00000000-0000-4000-8000-0000000000aa';
      const mask = (page: number, boxes: string, source = 'OWNER') =>
        client.query(
          `insert into redaction_masks (document_version_id, page, boxes, source, created_by_account_id, mask_revision)
           values ('${version}', ${page}, '${boxes}'::jsonb, '${source}', '${account}', '${revision}')`,
        );
      await mask(1, '[{"x":0.1,"y":0.1,"w":0.2,"h":0.05}]');
      await mask(2, '[]', 'SUGGESTED_ACCEPTED');
      // One row per page of a version.
      await expect(mask(1, '[]')).rejects.toThrow();
      // Pages 1 to 20 only, known sources only, a list of at most 200 boxes.
      await expect(mask(0, '[]')).rejects.toThrow();
      await expect(mask(21, '[]')).rejects.toThrow();
      await expect(mask(3, '[]', 'AUTOMATIC')).rejects.toThrow();
      await expect(mask(3, '{"x":1}')).rejects.toThrow();
      const tooMany = JSON.stringify(
        Array.from({ length: 201 }, () => ({ x: 0, y: 0, w: 1, h: 1 })),
      );
      await expect(mask(3, tooMany)).rejects.toThrow();

      // A drawn page records its derived file, type, size and page size together, or none of them.
      const derived = await one(
        `insert into storage_objects (bucket, object_key) values ('CLEAN', 'safe-copy/derived') returning id`,
      );
      const drawn = (fields: string) =>
        client.query(`update redaction_masks set ${fields} where page = 1`);
      await expect(drawn(`rendered_storage_object_id = '${derived}'`)).rejects.toThrow();
      await expect(
        drawn(
          `rendered_storage_object_id = '${derived}', rendered_content_type = 'text/html', rendered_byte_size = 10, rendered_width_pt = 612, rendered_height_pt = 792, rendered_at = now()`,
        ),
      ).rejects.toThrow();
      await drawn(
        `rendered_storage_object_id = '${derived}', rendered_content_type = 'image/jpeg', rendered_byte_size = 10, rendered_width_pt = 612, rendered_height_pt = 792, rendered_at = now()`,
      );
      // Erasing the derived file's registration clears the link rather than failing.
      await client.query(`delete from storage_objects where id = '${derived}'`);
      const cleared = await client.query<{ id: string | null }>(
        'select rendered_storage_object_id as id from redaction_masks where page = 1',
      );
      expect(cleared.rows[0]?.id).toBeNull();
      // The new erasure reason exists.
      const reasons = await client.query<{ v: string }>(
        'select unnest(enum_range(null::erasure_job_reason))::text as v',
      );
      expect(reasons.rows.map((r) => r.v)).toContain('SAFE_COPY_REMOVAL');

      // Masks go with their version: removing the document removes them.
      await client.query(`delete from documents where id = '${documentId}'`);
      expect((await client.query('select id from redaction_masks')).rows).toEqual([]);
    },
    MIGRATION_TIMEOUT_MS,
  );

  it(
    'brings a table made by the earlier draft of 0102 up to date, keeping its boxes as preparing',
    async () => {
      const client = new PGlite();
      await migrate(drizzle(client), { migrationsFolder });
      // Put back the earlier draft's shape: no revisions, no stored drawings, no pending drawing.
      await client.exec('drop table redaction_masks');
      for (const statement of EARLIER_DRAFT.split('--> statement-breakpoint')) {
        await client.exec(statement);
      }
      const one = async (text: string): Promise<string> => {
        const id = (await client.query<{ id: string }>(text)).rows[0]?.id;
        if (!id) throw new Error(`no row from: ${text}`);
        return id;
      };
      const account = await one(
        `insert into accounts (email) values ('mask-draft@example.test') returning id`,
      );
      const applicant = await one(
        `insert into applicants (owner_account_id, display_name) values ('${account}', 'Synthetic Traveller') returning id`,
      );
      const documentId = await one(
        `insert into documents (applicant_id, original_name) values ('${applicant}', 'synthetic.pdf') returning id`,
      );
      const storage = await one(
        `insert into storage_objects (bucket, object_key) values ('CLEAN', 'mask-draft-key') returning id`,
      );
      const version = await one(
        `insert into document_versions (document_id, storage_object_id) values ('${documentId}', '${storage}') returning id`,
      );
      for (const page of [1, 2]) {
        await client.query(
          `insert into redaction_masks (document_version_id, page, boxes, source, created_by_account_id)
           values ('${version}', ${page}, '[]'::jsonb, 'OWNER', '${account}')`,
        );
      }

      // The shipped file, statement by statement, twice: the second run must change nothing.
      const sql = readFileSync(join(migrationsFolder, '0102_redaction_masks.sql'), 'utf8');
      for (let run = 0; run < 2; run++) {
        for (const statement of sql.split('--> statement-breakpoint')) await client.exec(statement);
      }

      const columns = await client.query<{ name: string; nullable: string }>(
        `select column_name as name, is_nullable as nullable from information_schema.columns
         where table_name = 'redaction_masks'`,
      );
      const byName = new Map(columns.rows.map((row) => [row.name, row.nullable]));
      for (const name of [
        'mask_revision',
        'rendered_storage_object_id',
        'rendered_content_type',
        'rendered_byte_size',
        'rendered_width_pt',
        'rendered_height_pt',
        'rendered_at',
        'pending_storage_object_id',
      ]) {
        expect(byName.has(name)).toBe(true);
      }
      expect(byName.get('mask_revision')).toBe('NO');
      // The draft's boxes are kept under one revision per version, with nothing drawn yet.
      const kept = await client.query<{ revision: string; drawn: string | null }>(
        `select mask_revision as revision, rendered_storage_object_id as drawn from redaction_masks
         where document_version_id = '${version}' order by page`,
      );
      expect(kept.rows).toHaveLength(2);
      expect(new Set(kept.rows.map((row) => row.revision)).size).toBe(1);
      expect(kept.rows.every((row) => row.drawn === null)).toBe(true);

      // The later constraints and links are in force.
      const derived = await one(
        `insert into storage_objects (bucket, object_key) values ('CLEAN', 'safe-copy/draft') returning id`,
      );
      await expect(
        client.query(
          `update redaction_masks set rendered_storage_object_id = '${derived}' where page = 1`,
        ),
      ).rejects.toThrow();
      await expect(
        client.query(
          `update redaction_masks set pending_storage_object_id = '00000000-0000-4000-8000-000000000999' where page = 1`,
        ),
      ).rejects.toThrow();
      await client.query(
        `update redaction_masks set pending_storage_object_id = '${derived}' where page = 1`,
      );
      await client.query(`delete from storage_objects where id = '${derived}'`);
      const pending = await client.query<{ id: string | null }>(
        'select pending_storage_object_id as id from redaction_masks where page = 1',
      );
      expect(pending.rows[0]?.id).toBeNull();
      const indexes = await client.query<{ name: string }>(
        `select indexname as name from pg_indexes where tablename = 'redaction_masks'`,
      );
      expect(indexes.rows.map((row) => row.name)).toEqual(
        expect.arrayContaining([
          'redaction_masks_created_by_idx',
          'redaction_masks_rendered_object_idx',
          'redaction_masks_pending_object_idx',
        ]),
      );
    },
    MIGRATION_TIMEOUT_MS,
  );
});

/** The earlier draft of 0102 (before mask revisions and stored drawings), as it was first written. */
const EARLIER_DRAFT = `CREATE TABLE IF NOT EXISTS "redaction_masks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_version_id" uuid NOT NULL,
	"page" integer NOT NULL,
	"boxes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text NOT NULL,
	"created_by_account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "redaction_masks_version_page_unique" UNIQUE("document_version_id","page"),
	CONSTRAINT "redaction_masks_page_range" CHECK ("redaction_masks"."page" between 1 and 20),
	CONSTRAINT "redaction_masks_source_known" CHECK ("redaction_masks"."source" in ('OWNER', 'SUGGESTED_ACCEPTED')),
	CONSTRAINT "redaction_masks_boxes_shape" CHECK (case when jsonb_typeof("redaction_masks"."boxes") = 'array' then jsonb_array_length("redaction_masks"."boxes") <= 200 else false end)
);
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "redaction_masks" ADD CONSTRAINT "redaction_masks_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
DO $fk$ BEGIN
	ALTER TABLE "redaction_masks" ADD CONSTRAINT "redaction_masks_created_by_account_id_accounts_id_fk" FOREIGN KEY ("created_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $fk$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "redaction_masks_created_by_idx" ON "redaction_masks" USING btree ("created_by_account_id");
`;
