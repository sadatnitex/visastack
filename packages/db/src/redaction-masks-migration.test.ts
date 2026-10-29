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

      const mask = (page: number, boxes: string, source = 'OWNER') =>
        client.query(
          `insert into redaction_masks (document_version_id, page, boxes, source, created_by_account_id)
           values ('${version}', ${page}, '${boxes}'::jsonb, '${source}', '${account}')`,
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

      // Masks go with their version: removing the document removes them.
      await client.query(`delete from documents where id = '${documentId}'`);
      expect((await client.query('select id from redaction_masks')).rows).toEqual([]);
    },
    MIGRATION_TIMEOUT_MS,
  );
});
