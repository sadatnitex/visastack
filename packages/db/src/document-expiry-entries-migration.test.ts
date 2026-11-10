import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrationsFolder } from './paths';
import { createMigratedPglite } from './testing';

/**
 * Typed and read expiry dates of a document (one new table, nothing changed in an existing one).
 * Found by what it creates, never by its number: migrations are renumbered in merge order.
 */
function migrationFile(): string {
  const file = readdirSync(migrationsFolder)
    .filter((name) => name.endsWith('.sql'))
    .find((name) =>
      readFileSync(join(migrationsFolder, name), 'utf8').includes(
        'CREATE TABLE IF NOT EXISTS "document_expiry_entries"',
      ),
    );
  if (!file) throw new Error('the document expiry entries migration is missing');
  return readFileSync(join(migrationsFolder, file), 'utf8');
}

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const APPLICANT = '22222222-2222-4222-8222-222222222222';
const DOCUMENT = '33333333-3333-4333-8333-333333333333';

async function seeded() {
  const client = await createMigratedPglite();
  await client.exec(`
    insert into accounts (id, email) values ('${ACCOUNT}', 'owner@example.com');
    insert into applicants (id, owner_account_id, display_name) values ('${APPLICANT}', '${ACCOUNT}', 'Synthetic');
    insert into documents (id, applicant_id, original_name) values ('${DOCUMENT}', '${APPLICANT}', 'scan.pdf');
  `);
  return client;
}

const entry = (source: string, expiresOn: string | null, mirrored = false) => `
  insert into document_expiry_entries (document_id, expires_on, source, mirrored)
  values ('${DOCUMENT}', ${expiresOn ? `'${expiresOn}'` : 'null'}, '${source}', ${mirrored})`;

describe('document expiry entries migration', () => {
  it('creates one table and changes no existing table', () => {
    const sql = migrationFile();
    const touched = [
      ...sql.matchAll(/(?:CREATE TABLE IF NOT EXISTS|ALTER TABLE) "([a-z_]+)"/g),
    ].map((m) => m[1]);
    expect(new Set(touched)).toEqual(new Set(['document_expiry_entries']));
    expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN|ALTER COLUMN/);
  });

  it('can be run again from the top without harm, statement by statement', async () => {
    const client = await seeded();
    await client.exec(entry('TYPED', '2031-04-30', true));
    for (let run = 0; run < 2; run += 1) {
      for (const statement of migrationFile().split('--> statement-breakpoint')) {
        if (statement.trim().length > 0) await client.exec(statement);
      }
    }
    const left = await client.query<{ n: number }>(
      'select count(*)::int as n from document_expiry_entries',
    );
    expect(left.rows[0]?.n).toBe(1);
    const fks = await client.query<{ n: number }>(
      "select count(*)::int as n from pg_constraint where contype = 'f' and conrelid = 'document_expiry_entries'::regclass",
    );
    expect(fks.rows[0]?.n).toBe(2);
  });

  it('keeps the rules in the database: a known source, a read entry has a date, only typed dates mirror', async () => {
    const client = await seeded();
    await expect(client.exec(entry('GUESSED', '2031-04-30'))).rejects.toThrow();
    await expect(client.exec(entry('READ', null))).rejects.toThrow();
    await expect(client.exec(entry('READ', '2031-04-30', true))).rejects.toThrow();
    await expect(client.exec(entry('TYPED', null, true))).rejects.toThrow();
    await client.exec(entry('TYPED', null));
    await client.exec(entry('READ', '2031-04-30'));
    await client.exec(entry('TYPED', '2031-04-30', true));
  });

  it('goes with the document when it is erased', async () => {
    const client = await seeded();
    await client.exec(entry('TYPED', '2031-04-30', true));
    await client.exec(`update document_expiry_entries set entered_by_account_id = '${ACCOUNT}'`);
    await client.exec(`delete from documents where id = '${DOCUMENT}'`);
    const left = await client.query<{ n: number }>(
      'select count(*)::int as n from document_expiry_entries',
    );
    expect(left.rows[0]?.n).toBe(0);
  });
});
