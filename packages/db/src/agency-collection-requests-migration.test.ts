import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { describe, expect, it } from 'vitest';
import { migrationsFolder } from './paths';

/**
 * The agency document request migration (UMPE P6, ADR 0026 D4). Found by its name, never its
 * number: the number is given when the lane lands. Three new tables with no person column, and an
 * issued revision that the database itself refuses to change or remove.
 */

const MIGRATION_TIMEOUT_MS = 180_000;
const NAME = '_agency_collection_requests';
const TABLES = [
  'agency_collection_links',
  'agency_collection_request_revisions',
  'agency_collection_requests',
];
/** Columns that would make a table applicant-owned for the access ratchet. None may appear. */
const OWNED_COLUMNS = [
  'applicant_id',
  'mission_id',
  'document_id',
  'document_version_id',
  'owner_account_id',
];

interface JournalEntry {
  readonly tag: string;
}

function journal(): { entries: JournalEntry[] } {
  return JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8'));
}

/** A copy of the migrations folder holding every migration up to (or before) this one. */
function folderUpTo(include: boolean): string {
  const full = journal();
  const at = full.entries.findIndex((e) => e.tag.endsWith(NAME));
  if (at === -1) throw new Error(`no migration named *${NAME} in the journal`);
  const entries = full.entries.slice(0, include ? at + 1 : at);
  const folder = mkdtempSync(join(tmpdir(), 'visastack-p6-'));
  mkdirSync(join(folder, 'meta'), { recursive: true });
  writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify({ ...full, entries }));
  for (const entry of entries) {
    copyFileSync(join(migrationsFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  }
  return folder;
}

describe('agency document request migration (UMPE P6)', () => {
  it(
    'adds only the three tables, with no person column, and keeps issued revisions append-only',
    async () => {
      const client = new PGlite();
      const before = folderUpTo(false);
      const after = folderUpTo(true);
      try {
        await migrate(drizzle(client), { migrationsFolder: before });
        const tablesBefore = await client.query<{ table_name: string }>(
          "select table_name from information_schema.tables where table_schema = 'public'",
        );
        await migrate(drizzle(client), { migrationsFolder: after });
        const tablesAfter = await client.query<{ table_name: string }>(
          "select table_name from information_schema.tables where table_schema = 'public' order by 1",
        );
        const known = new Set(tablesBefore.rows.map((r) => r.table_name));
        expect(tablesAfter.rows.map((r) => r.table_name).filter((t) => !known.has(t))).toEqual(
          TABLES,
        );
        const columns = await client.query<{ column_name: string }>(
          `select column_name from information_schema.columns
           where table_name in (${TABLES.map((t) => `'${t}'`).join(', ')})`,
        );
        expect(columns.rows.filter((r) => OWNED_COLUMNS.includes(r.column_name))).toEqual([]);

        const account = await client.query<{ id: string }>(
          "insert into accounts (email) values ('p6-admin@example.test') returning id",
        );
        const accountId = account.rows[0]?.id;
        const org = await client.query<{ id: string }>(
          "insert into organizations (name) values ('Synthetic Agency') returning id",
        );
        const orgId = org.rows[0]?.id;
        const insertRequest = (destination: string, status = 'DRAFT') =>
          client.query<{ id: string }>(
            `insert into agency_collection_requests (organization_id, created_by_account_id, destination, status)
             values ($1, $2, $3, $4) returning id`,
            [orgId, accountId, destination, status],
          );
        await expect(insertRequest('gb')).rejects.toThrow();
        await expect(insertRequest('GB', 'EXPIRED')).rejects.toThrow();
        const request = await insertRequest('GB');
        const requestId = request.rows[0]?.id;

        const sha = 'a'.repeat(64);
        const insertRevision = (no: number, packVersion: string | null, checksum: string | null) =>
          client.query<{ id: string }>(
            `insert into agency_collection_request_revisions
               (request_id, revision_no, pack_version_id, pack_checksum, items, content_sha256, issued_by_account_id)
             values ($1, $2, $3, $4, '[]'::jsonb, $5, $6) returning id`,
            [requestId, no, packVersion, checksum, sha, accountId],
          );
        // A pack checksum only with a pack, and the other way round.
        await expect(insertRevision(1, null, 'abc')).rejects.toThrow();
        const revision = await insertRevision(1, null, null);
        const revisionId = revision.rows[0]?.id;
        await expect(insertRevision(1, null, null)).rejects.toThrow();
        await insertRevision(2, null, null);

        // The database refuses to change or remove an issued revision.
        await expect(
          client.query(
            "update agency_collection_request_revisions set items = '[1]'::jsonb where id = $1",
            [revisionId],
          ),
        ).rejects.toThrow(/never changed or removed/);
        await expect(
          client.query('delete from agency_collection_request_revisions where id = $1', [
            revisionId,
          ]),
        ).rejects.toThrow(/never changed or removed/);

        // Links store a SHA-256 hex hash only.
        const insertLink = (hash: string) =>
          client.query(
            `insert into agency_collection_links (request_id, revision_id, token_hash, expires_at)
             values ($1, $2, $3, now() + interval '14 days')`,
            [requestId, revisionId, hash],
          );
        await expect(insertLink('raw-token-not-a-hash')).rejects.toThrow();
        await insertLink('b'.repeat(64));
        await expect(insertLink('b'.repeat(64))).rejects.toThrow();
      } finally {
        await client.close();
        rmSync(before, { recursive: true, force: true });
        rmSync(after, { recursive: true, force: true });
      }
    },
    MIGRATION_TIMEOUT_MS,
  );
});
