import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { type ReferenceKind, isIssuableReferenceCode, isValidReferenceCode } from '@visastack/core';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, describe, expect, it } from 'vitest';
import { migrationsFolder } from './paths';

const MIGRATION_TIMEOUT_MS = 120_000;
const folders: string[] = [];
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/** A copy of the shipped migrations with the journal cut after `lastTag`. */
function migrationsUpTo(lastTag: string): string {
  const folder = mkdtempSync(join(tmpdir(), 'vs-migrations-'));
  folders.push(folder);
  cpSync(migrationsFolder, folder, { recursive: true });
  const journalPath = join(folder, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: { tag: string }[];
  };
  const cut = journal.entries.findIndex((entry) => entry.tag === lastTag);
  if (cut < 0) throw new Error(`no migration ${lastTag}`);
  journal.entries = journal.entries.slice(0, cut + 1);
  writeFileSync(journalPath, JSON.stringify(journal));
  return folder;
}

describe('migration 0091: visible reference codes (ADR 0018)', () => {
  it(
    'gives every existing person, case, document and request one valid, issuable, unique code',
    async () => {
      const client = new PGlite();
      const db = drizzle(client);
      await migrate(db, { migrationsFolder: migrationsUpTo('0090_grant_case_exclusions') });

      // Records that exist before the migration, as on production.
      const one = async (query: string) =>
        ((await client.query<{ id: string }>(query)).rows[0] as { id: string }).id;
      const owner = await one(
        `insert into accounts (email) values ('o@example.test') returning id`,
      );
      const org = await one(`insert into organizations (name) values ('Agency A') returning id`);
      const applicants: string[] = [];
      for (let i = 0; i < 40; i += 1) {
        applicants.push(
          await one(
            `insert into applicants (owner_account_id, display_name) values ('${owner}', 'P${i}') returning id`,
          ),
        );
      }
      for (const applicant of applicants) {
        await client.query(
          `insert into missions (applicant_id, title) values ('${applicant}', 'Trip'), ('${applicant}', 'Study')`,
        );
        await client.query(
          `insert into documents (applicant_id, original_name) values ('${applicant}', 'passport.pdf')`,
        );
        await client.query(
          `insert into evidence_requests (applicant_id, organization_id, kind) values ('${applicant}', '${org}', 'DOCUMENT')`,
        );
      }

      await migrate(db, { migrationsFolder });

      const codes = (
        await client.query<{ kind: ReferenceKind; code: string; entity_id: string }>(
          'select kind, code, entity_id from reference_codes',
        )
      ).rows;
      const byKind = (kind: ReferenceKind) => codes.filter((c) => c.kind === kind);
      expect(byKind('P')).toHaveLength(40);
      expect(byKind('C')).toHaveLength(80);
      expect(byKind('D')).toHaveLength(40);
      expect(byKind('R')).toHaveLength(40);
      // The SQL check character agrees with the TypeScript one, and no reserved or
      // denylisted code was handed out.
      const wrong = codes.filter(
        (c) => !isValidReferenceCode(c.kind, c.code) || !isIssuableReferenceCode(c.code),
      );
      expect(wrong).toEqual([]);
      expect(codes.every((c) => c.code.length === 6)).toBe(true);
      expect(new Set(applicants)).toEqual(new Set(byKind('P').map((c) => c.entity_id)));
      // The temporary function is gone.
      const fn = await client.query(
        `select 1 from pg_proc where proname = 'visastack_reference_code_0091'`,
      );
      expect(fn.rows).toHaveLength(0);
    },
    MIGRATION_TIMEOUT_MS,
  );

  it(
    'refuses a malformed code and a second code for the same record',
    async () => {
      const client = new PGlite();
      await migrate(drizzle(client), { migrationsFolder });
      const id = '00000000-0000-4000-8000-000000000001';
      await expect(
        client.query(
          `insert into reference_codes (kind, code, entity_id) values ('C', 'OOPS!!', '${id}')`,
        ),
      ).rejects.toThrow();
      await client.query(
        `insert into reference_codes (kind, code, entity_id) values ('C', '00K2Q7', '${id}')`,
      );
      await expect(
        client.query(
          `insert into reference_codes (kind, code, entity_id) values ('C', '00K2Q8', '${id}')`,
        ),
      ).rejects.toThrow();
      // The same code under another type is a different code.
      await client.query(
        `insert into reference_codes (kind, code, entity_id) values ('D', '00K2Q7', '${id}')`,
      );
    },
    MIGRATION_TIMEOUT_MS,
  );
});
