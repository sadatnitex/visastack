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
});
