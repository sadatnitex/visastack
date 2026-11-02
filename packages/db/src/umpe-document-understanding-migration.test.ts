import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { describe, expect, it } from 'vitest';
import { migrationsFolder } from './paths';

/**
 * UMPE P3 migration (number given by the lead in merge order): upload receipts and proposed
 * document relations. Additive and re-runnable; nothing existing is touched. Found by its tag
 * suffix, so the number can change without editing this test.
 */

const MIGRATION_TIMEOUT_MS = 180_000;
const SUFFIX = '_umpe_document_understanding';
const TABLES = ['document_relation_proposals', 'document_upload_receipts'];

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
  const folder = mkdtempSync(join(tmpdir(), 'visastack-umpe-p3-'));
  mkdirSync(join(folder, 'meta'), { recursive: true });
  writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify({ ...all, entries: prior }));
  for (const entry of prior) {
    copyFileSync(join(migrationsFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  }
  return folder;
}

describe('migration: document understanding (UMPE P3)', () => {
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

        // Synthetic owner, traveller, two documents with one version each.
        const account = await client.query<{ id: string }>(
          "insert into accounts (email) values ('p3-owner@example.invalid') returning id",
        );
        const accountId = account.rows[0]?.id;
        const applicant = await client.query<{ id: string }>(
          "insert into applicants (owner_account_id, display_name) values ($1, 'Synthetic Traveller') returning id",
          [accountId],
        );
        const applicantId = applicant.rows[0]?.id;
        const makeDocument = async (key: string) => {
          const doc = await client.query<{ id: string }>(
            "insert into documents (applicant_id, original_name) values ($1, 'document.jpg') returning id",
            [applicantId],
          );
          const object = await client.query<{ id: string }>(
            "insert into storage_objects (bucket, object_key) values ('QUARANTINE', $1) returning id",
            [key],
          );
          const version = await client.query<{ id: string }>(
            'insert into document_versions (document_id, storage_object_id) values ($1, $2) returning id',
            [doc.rows[0]?.id, object.rows[0]?.id],
          );
          return { documentId: doc.rows[0]?.id, versionId: version.rows[0]?.id };
        };
        const first = await makeDocument('p3-object-1');
        const second = await makeDocument('p3-object-2');

        // Receipts: one per account and upload id, known statuses, a capped name.
        const uploadId = '6f1c2f4e-58a1-4b8e-9d7e-1f2a3b4c5d6e';
        const insertReceipt = (id: string, status = 'PENDING', name: string | null = null) =>
          client.query(
            `insert into document_upload_receipts
               (account_id, applicant_id, upload_id, claim_token, status, original_file_name)
             values ($1, $2, $3, gen_random_uuid(), $4, $5)`,
            [accountId, applicantId, id, status, name],
          );
        await insertReceipt(uploadId, 'PENDING', 'bank statement march.pdf');
        await expect(insertReceipt(uploadId)).rejects.toThrow();
        await expect(
          insertReceipt('7f1c2f4e-58a1-4b8e-9d7e-1f2a3b4c5d6e', 'DONE'),
        ).rejects.toThrow();
        await expect(
          insertReceipt('8f1c2f4e-58a1-4b8e-9d7e-1f2a3b4c5d6e', 'PENDING', 'x'.repeat(181)),
        ).rejects.toThrow();

        // Relations: known relation and status, never a document related to itself, one per
        // new version.
        const insertRelation = (
          relation: string,
          related = second.documentId,
          status = 'PENDING',
        ) =>
          client.query(
            `insert into document_relation_proposals
               (applicant_id, document_id, document_version_id, related_document_id, relation,
                signals, status)
             values ($1, $2, $3, $4, $5, '["same_file"]'::jsonb, $6)`,
            [applicantId, first.documentId, first.versionId, related, relation, status],
          );
        await expect(insertRelation('MERGED')).rejects.toThrow();
        await expect(insertRelation('EXACT_DUPLICATE', first.documentId)).rejects.toThrow();
        await expect(
          insertRelation('EXACT_DUPLICATE', second.documentId, 'APPLIED'),
        ).rejects.toThrow();
        await insertRelation('EXACT_DUPLICATE');
        await expect(insertRelation('CORRECTED_SCAN')).rejects.toThrow();

        // Removing a document for good removes its receipt, and the private file name on it.
        await client.query(
          'update document_upload_receipts set document_id = $1, document_version_id = $2, status = $3',
          [second.documentId, second.versionId, 'COMPLETED'],
        );
        await client.query('delete from documents where id = $1', [second.documentId]);
        const receipts = await client.query('select 1 from document_upload_receipts');
        expect(receipts.rows).toHaveLength(0);
        await insertReceipt(uploadId, 'PENDING', 'kept until the traveller goes.pdf');

        // Deleting the traveller removes both kinds of row with it.
        await client.query('delete from applicants where id = $1', [applicantId]);
        const left = await client.query<{ n: number }>(
          `select (select count(*) from document_upload_receipts)::int
                + (select count(*) from document_relation_proposals)::int as n`,
        );
        expect(left.rows[0]?.n).toBe(0);
      } finally {
        await client.close();
        rmSync(folder, { recursive: true, force: true });
      }
    },
    MIGRATION_TIMEOUT_MS,
  );
});
