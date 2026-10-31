import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it } from 'vitest';
import { migrationsFolder } from './paths';

const MIGRATION_TIMEOUT_MS = 120_000;
const FILE = '0113_resource_lifecycle.sql';

describe('migration 0113: resource lifecycle', () => {
  let client: PGlite;
  const one = async (text: string): Promise<string> => {
    const id = (await client.query<{ id: string }>(text)).rows[0]?.id;
    if (!id) throw new Error(`no row from: ${text}`);
    return id;
  };
  let account: string;
  let applicant: string;
  let documentId: string;

  beforeAll(async () => {
    client = new PGlite();
    await migrate(drizzle(client), { migrationsFolder });
    account = await one(
      `insert into accounts (email) values ('lifecycle-migration@example.test') returning id`,
    );
    applicant = await one(
      `insert into applicants (owner_account_id, display_name) values ('${account}', 'Synthetic Traveller') returning id`,
    );
    documentId = await one(
      `insert into documents (applicant_id, original_name) values ('${applicant}', 'synthetic.pdf') returning id`,
    );
  }, MIGRATION_TIMEOUT_MS);

  const receipt = (status = 'SCHEDULED', code = 'D-7K2Q9M') =>
    one(
      `insert into deletion_receipts (applicant_id, subject_kind, subject_code, path, requested_by_account_id, requested_at, status)
       values ('${applicant}', 'DOCUMENT', '${code}', 'DUPLICATE', '${account}', now(), '${status}') returning id`,
    );

  it(
    'is safe to run again from the top, statement by statement',
    async () => {
      const sql = readFileSync(join(migrationsFolder, FILE), 'utf8');
      for (const statement of sql.split('--> statement-breakpoint')) await client.exec(statement);
      const tables = await client.query<{ name: string }>(
        `select table_name as name from information_schema.tables
         where table_name in ('document_lifecycle', 'applicant_lifecycle', 'document_removal_requests', 'deletion_receipts')
         order by table_name`,
      );
      expect(tables.rows.map((row) => row.name)).toEqual([
        'applicant_lifecycle',
        'deletion_receipts',
        'document_lifecycle',
        'document_removal_requests',
      ]);
      const reasons = await client.query<{ value: string }>(
        `select unnest(enum_range(null::erasure_job_reason))::text as value`,
      );
      expect(reasons.rows.map((row) => row.value)).toContain('DOCUMENT_REMOVAL');
    },
    MIGRATION_TIMEOUT_MS,
  );

  it('keeps deleted, path and purge time together on a document', async () => {
    await expect(
      client.query(
        `insert into document_lifecycle (document_id, applicant_id, deleted_at) values ('${documentId}', '${applicant}', now())`,
      ),
    ).rejects.toThrow();
    await expect(
      client.query(
        `insert into document_lifecycle (document_id, applicant_id, deleted_at, delete_path, purge_after)
         values ('${documentId}', '${applicant}', now(), 'SOMETHING', now())`,
      ),
    ).rejects.toThrow();
    await client.query(
      `insert into document_lifecycle (document_id, applicant_id, archived_at) values ('${documentId}', '${applicant}', now())`,
    );
    await client.query(
      `update document_lifecycle set deleted_at = now(), delete_path = 'DUPLICATE', purge_after = now() + interval '30 days'
       where document_id = '${documentId}'`,
    );
  });

  it('allows one pending removal request per document and only known values', async () => {
    const request = (status: string, reason = 'NO_LONGER_NEEDED', code = 'D-7K2Q9M') =>
      client.query(
        `insert into document_removal_requests (applicant_id, document_id, document_code, reason, status, requested_at)
         values ('${applicant}', '${documentId}', '${code}', '${reason}', '${status}', now())`,
      );
    await request('PENDING');
    await expect(request('PENDING')).rejects.toThrow();
    await request('DECLINED');
    await expect(request('WAITING')).rejects.toThrow();
    await expect(request('CANCELLED', 'BECAUSE')).rejects.toThrow();
    await expect(request('CANCELLED', 'OTHER', 'Passport 1234')).rejects.toThrow();
  });

  it('refuses an edit of what a removal record says', async () => {
    const id = await receipt();
    await expect(
      client.query(`update deletion_receipts set subject_code = 'D-AAAAAA' where id = '${id}'`),
    ).rejects.toThrow(/cannot be edited/);
    await expect(
      client.query(`update deletion_receipts set path = 'REQUEST' where id = '${id}'`),
    ).rejects.toThrow(/cannot be edited/);
    await expect(
      client.query(`update deletion_receipts set requested_by_account_id = null where id = '${id}'`),
    ).rejects.toThrow(/who asked/);
  });

  it('moves status only forward', async () => {
    const id = await receipt();
    await expect(
      client.query(`update deletion_receipts set status = 'REMOVED' where id = '${id}'`),
    ).rejects.toThrow(/cannot move/);
    await client.query(`update deletion_receipts set status = 'REMOVING' where id = '${id}'`);
    await expect(
      client.query(`update deletion_receipts set status = 'SCHEDULED' where id = '${id}'`),
    ).rejects.toThrow(/cannot move/);
    await client.query(`update deletion_receipts set status = 'BLOCKED' where id = '${id}'`);
    await client.query(`update deletion_receipts set status = 'REMOVING' where id = '${id}'`);
    await client.query(
      `update deletion_receipts set status = 'REMOVED', verified_gone_at = now() where id = '${id}'`,
    );
    await expect(
      client.query(`update deletion_receipts set status = 'REMOVING' where id = '${id}'`),
    ).rejects.toThrow(/cannot move/);
    await expect(
      client.query(
        `update deletion_receipts set verified_gone_at = now() + interval '1 day' where id = '${id}'`,
      ),
    ).rejects.toThrow(/verified time/);
    const restored = await receipt();
    await client.query(`update deletion_receipts set status = 'RESTORED' where id = '${restored}'`);
    await expect(
      client.query(`update deletion_receipts set status = 'REMOVING' where id = '${restored}'`),
    ).rejects.toThrow(/cannot move/);
  });

  it('lets effects only gain keys', async () => {
    const id = await receipt();
    await client.query(
      `update deletion_receipts set effects = '{"casesSwitched":["C-7K2Q9M"]}'::jsonb where id = '${id}'`,
    );
    await client.query(
      `update deletion_receipts set effects = effects || '{"sharesAffected":2}'::jsonb where id = '${id}'`,
    );
    await expect(
      client.query(`update deletion_receipts set effects = '{}'::jsonb where id = '${id}'`),
    ).rejects.toThrow(/only be added/);
    await expect(
      client.query(
        `update deletion_receipts set effects = effects || '{"sharesAffected":3}'::jsonb where id = '${id}'`,
      ),
    ).rejects.toThrow(/only be added/);
    await expect(
      client.query(`update deletion_receipts set effects = '[]'::jsonb where id = '${id}'`),
    ).rejects.toThrow();
  });

  it('refuses a direct delete, and goes only with the whole record', async () => {
    const id = await receipt();
    await expect(client.query(`delete from deletion_receipts where id = '${id}'`)).rejects.toThrow(
      /cannot be deleted/,
    );
    await expect(
      client.query(
        `insert into deletion_receipts (applicant_id, subject_kind, subject_code, path, requested_at, status)
         values ('${applicant}', 'DOCUMENT', 'Passport 12345678', 'DUPLICATE', now(), 'SCHEDULED')`,
      ),
    ).rejects.toThrow();

    // Deleting the account that asked clears that name and nothing else.
    const other = await one(
      `insert into accounts (email) values ('lifecycle-other@example.test') returning id`,
    );
    const asked = await one(
      `insert into deletion_receipts (applicant_id, subject_kind, subject_code, path, requested_by_account_id, requested_at, status)
       values ('${applicant}', 'DOCUMENT', 'D-7K2Q9N', 'REQUEST', '${other}', now(), 'SCHEDULED') returning id`,
    );
    await client.query(`delete from accounts where id = '${other}'`);
    const cleared = await client.query<{ who: string | null }>(
      `select requested_by_account_id as who from deletion_receipts where id = '${asked}'`,
    );
    expect(cleared.rows[0]?.who).toBeNull();

    await client.query(`delete from applicants where id = '${applicant}'`);
    const left = await client.query<{ n: number }>(
      `select count(*)::int as n from deletion_receipts where applicant_id = '${applicant}'`,
    );
    expect(left.rows[0]?.n).toBe(0);
  });
});
