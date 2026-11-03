import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { describe, expect, it } from 'vitest';
import { migrationsFolder } from './paths';

/**
 * UMPE G1 migration (number given by the lead in merge order): findings raised when a file is read
 * and the Which Person? holding state. Additive and re-runnable; nothing existing is touched.
 * Found by its tag suffix, so the number can change without editing this test.
 */

const MIGRATION_TIMEOUT_MS = 180_000;
const SUFFIX = '_umpe_g1_intake';
const TABLES = ['document_intake_exceptions', 'document_person_holds'];

function journal(): { entries: { tag: string }[] } {
  return JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8'));
}

function tag(): string {
  const entry = journal().entries.find((e) => e.tag.endsWith(SUFFIX));
  if (!entry) throw new Error(`no migration ending ${SUFFIX} in the journal`);
  return entry.tag;
}

function statements(): string[] {
  return readFileSync(join(migrationsFolder, `${tag()}.sql`), 'utf8').split(
    '--> statement-breakpoint',
  );
}

/** A copy of the migrations folder holding every migration before this one. */
function folderBefore(): string {
  const all = journal();
  const at = all.entries.findIndex((e) => e.tag === tag());
  const prior = all.entries.slice(0, at);
  const folder = mkdtempSync(join(tmpdir(), 'visastack-umpe-g1-'));
  mkdirSync(join(folder, 'meta'), { recursive: true });
  writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify({ ...all, entries: prior }));
  for (const entry of prior) {
    copyFileSync(join(migrationsFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  }
  return folder;
}

describe('migration: intake gap closure (UMPE G1)', () => {
  it(
    'runs twice, adds only the two new tables, and enforces their rules',
    async () => {
      const client = new PGlite();
      const folder = folderBefore();
      try {
        await migrate(drizzle(client), { migrationsFolder: folder });
        const listTables = () =>
          client.query<{ table_name: string }>(
            "select table_name from information_schema.tables where table_schema = 'public' order by 1",
          );
        const before = new Set((await listTables()).rows.map((r) => r.table_name));
        for (let run = 0; run < 2; run++) {
          for (const statement of statements()) await client.exec(statement);
        }
        const added = (await listTables()).rows
          .map((r) => r.table_name)
          .filter((t) => !before.has(t));
        expect(added).toEqual(TABLES);

        const account = await client.query<{ id: string }>(
          "insert into accounts (email) values ('g1-owner@example.invalid') returning id",
        );
        const accountId = account.rows[0]?.id;
        const applicant = await client.query<{ id: string }>(
          "insert into applicants (owner_account_id, display_name) values ($1, 'Synthetic Traveller') returning id",
          [accountId],
        );
        const applicantId = applicant.rows[0]?.id;
        const doc = await client.query<{ id: string }>(
          "insert into documents (applicant_id, original_name) values ($1, 'document.jpg') returning id",
          [applicantId],
        );
        const object = await client.query<{ id: string }>(
          "insert into storage_objects (bucket, object_key) values ('QUARANTINE', 'g1-object-1') returning id",
        );
        const version = await client.query<{ id: string }>(
          'insert into document_versions (document_id, storage_object_id) values ($1, $2) returning id',
          [doc.rows[0]?.id, object.rows[0]?.id],
        );

        // Findings: known kinds and statuses, once per version and kind.
        const insertFinding = (kind: string, status = 'PENDING') =>
          client.query(
            `insert into document_intake_exceptions
               (applicant_id, document_id, document_version_id, kind, status)
             values ($1, $2, $3, $4, $5)`,
            [applicantId, doc.rows[0]?.id, version.rows[0]?.id, kind, status],
          );
        await insertFinding('EXPIRED_ON_ARRIVAL');
        await expect(insertFinding('EXPIRED_ON_ARRIVAL')).rejects.toThrow();
        await expect(insertFinding('BLURRY')).rejects.toThrow();
        await expect(insertFinding('NO_READABLE_TEXT', 'RESOLVED')).rejects.toThrow();
        await insertFinding('NO_READABLE_TEXT');

        // Holds: one per account and upload id, known statuses and bases, a capped name.
        const uploadId = '6f1c2f4e-58a1-4b8e-9d7e-1f2a3b4c5d6e';
        const insertHold = (
          id: string,
          key: string,
          status = 'HELD',
          basis: string | null = 'NO_MATCH',
          name: string | null = null,
        ) =>
          client.query(
            `insert into document_person_holds
               (owner_account_id, upload_id, claim_token, object_key, content_type, size_bytes,
                status, proposal_basis, original_file_name)
             values ($1, $2, gen_random_uuid(), $3, 'application/pdf', 10, $4, $5, $6)`,
            [accountId, id, key, status, basis, name],
          );
        await insertHold(uploadId, 'held-1', 'HELD', 'NO_MATCH', 'family passports.pdf');
        await expect(insertHold(uploadId, 'held-2')).rejects.toThrow();
        await expect(
          insertHold('7f1c2f4e-58a1-4b8e-9d7e-1f2a3b4c5d6e', 'held-1'),
        ).rejects.toThrow();
        await expect(
          insertHold('8f1c2f4e-58a1-4b8e-9d7e-1f2a3b4c5d6e', 'held-3', 'MOVED'),
        ).rejects.toThrow();
        await expect(
          insertHold('9f1c2f4e-58a1-4b8e-9d7e-1f2a3b4c5d6e', 'held-4', 'HELD', 'GUESSED'),
        ).rejects.toThrow();
        await expect(
          insertHold(
            'af1c2f4e-58a1-4b8e-9d7e-1f2a3b4c5d6e',
            'held-5',
            'HELD',
            null,
            'x'.repeat(181),
          ),
        ).rejects.toThrow();

        // Deleting the traveller removes the findings; a hold outlives the person it proposed.
        await client.query('update document_person_holds set proposed_applicant_id = $1', [
          applicantId,
        ]);
        await client.query('delete from applicants where id = $1', [applicantId]);
        const findings = await client.query('select 1 from document_intake_exceptions');
        expect(findings.rows).toHaveLength(0);
        const kept = await client.query<{ proposed_applicant_id: string | null }>(
          'select proposed_applicant_id from document_person_holds',
        );
        expect(kept.rows).toEqual([{ proposed_applicant_id: null }]);

        // Removing the account leaves the hold without an owner, for the sweep to delete.
        await client.query('delete from accounts where id = $1', [accountId]);
        const orphan = await client.query<{ owner_account_id: string | null }>(
          'select owner_account_id from document_person_holds',
        );
        expect(orphan.rows).toEqual([{ owner_account_id: null }]);
      } finally {
        await client.close();
        rmSync(folder, { recursive: true, force: true });
      }
    },
    MIGRATION_TIMEOUT_MS,
  );
});
