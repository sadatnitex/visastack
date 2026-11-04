import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrationsFolder } from './paths';
import { createMigratedPglite } from './testing';

/**
 * Lane D: the exact copies of evidence requests (two new tables, nothing changed in an existing
 * one). Found by what it creates, never by its number: the lead renumbers migrations in merge order.
 */
function migrationFile(): string {
  const file = readdirSync(migrationsFolder)
    .filter((name) => name.endsWith('.sql'))
    .find((name) =>
      readFileSync(join(migrationsFolder, name), 'utf8').includes(
        'CREATE TABLE IF NOT EXISTS "evidence_request_submissions"',
      ),
    );
  if (!file) throw new Error('the evidence request submissions migration is missing');
  return readFileSync(join(migrationsFolder, file), 'utf8');
}

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const APPLICANT = '22222222-2222-4222-8222-222222222222';
const ORG = '33333333-3333-4333-8333-333333333333';
const DOCUMENT = '44444444-4444-4444-8444-444444444444';
const STORAGE = '55555555-5555-4555-8555-555555555555';
const VERSION = '66666666-6666-4666-8666-666666666666';
const REQUEST = '77777777-7777-4777-8777-777777777777';

async function seeded() {
  const client = await createMigratedPglite();
  await client.exec(`
    insert into accounts (id, email) values ('${ACCOUNT}', 'owner@example.com');
    insert into applicants (id, owner_account_id, display_name) values ('${APPLICANT}', '${ACCOUNT}', 'Synthetic');
    insert into organizations (id, name) values ('${ORG}', 'Harbor');
    insert into documents (id, applicant_id, original_name, doc_type) values ('${DOCUMENT}', '${APPLICANT}', 'a.pdf', 'bank_statement');
    insert into storage_objects (id, bucket, object_key) values ('${STORAGE}', 'CLEAN', 'k-1');
    insert into document_versions (id, document_id, version_number, storage_object_id) values ('${VERSION}', '${DOCUMENT}', 1, '${STORAGE}');
    insert into evidence_requests (id, organization_id, applicant_id, kind, doc_type) values ('${REQUEST}', '${ORG}', '${APPLICANT}', 'DOCUMENT', 'bank_statement');
  `);
  return client;
}

const insertSend = (round: number, key: string) => `
  insert into evidence_request_submissions
    (evidence_request_id, round_no, document_id, document_version_id, storage_object_id, version_number, title_at_send, sent_by_account_id, idempotency_key)
  values ('${REQUEST}', ${round}, '${DOCUMENT}', '${VERSION}', '${STORAGE}', 1, 'a.pdf', '${ACCOUNT}', '${key}')`;

describe('Lane D evidence request submissions migration', () => {
  it('creates two tables and changes no existing table', async () => {
    const sql = migrationFile();
    const touched = [
      ...sql.matchAll(/(?:CREATE TABLE IF NOT EXISTS|ALTER TABLE) "([a-z_]+)"/g),
    ].map((m) => m[1]);
    expect(new Set(touched)).toEqual(
      new Set(['evidence_request_submissions', 'evidence_request_decision_submissions']),
    );
    expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN|ALTER COLUMN/);
  });

  it('can be run again from the top without harm, statement by statement', async () => {
    const client = await seeded();
    await client.exec(insertSend(1, 'k1'));
    // The shipped run already applied it once; production runs each statement on its own.
    for (let run = 0; run < 2; run += 1) {
      for (const statement of migrationFile().split('--> statement-breakpoint')) {
        if (statement.trim().length > 0) await client.exec(statement);
      }
    }
    const left = await client.query<{ sends: number }>(
      'select count(*)::int as sends from evidence_request_submissions',
    );
    expect(left.rows[0]?.sends).toBe(1);
    await expect(
      client.exec("update evidence_request_submissions set title_at_send = 'b.pdf'"),
    ).rejects.toThrow(/never changed/);
    const triggers = await client.query<{ n: number }>(
      "select count(*)::int as n from pg_trigger where tgname like 'evidence_request%no_update'",
    );
    expect(triggers.rows[0]?.n).toBe(2);
  });

  it('keeps one send per round and one send per retry key on a request', async () => {
    const client = await seeded();
    await client.exec(insertSend(1, 'k1'));
    await expect(client.exec(insertSend(1, 'k2'))).rejects.toThrow();
    await expect(client.exec(insertSend(2, 'k1'))).rejects.toThrow();
    await client.exec(insertSend(2, 'k2'));
  });

  it('refuses any change to a send or a link, and removes both with the request', async () => {
    const client = await seeded();
    await client.exec(insertSend(1, 'k1'));
    await expect(
      client.exec(`update evidence_request_submissions set title_at_send = 'b.pdf'`),
    ).rejects.toThrow(/never changed/);
    const send = await client.query<{ id: string }>('select id from evidence_request_submissions');
    const submissionId = send.rows[0]?.id ?? '';
    await client.exec(`
      insert into evidence_request_decisions (id, evidence_request_id, outcome, decided_by_account_id)
      values ('88888888-8888-4888-8888-888888888888', '${REQUEST}', 'ACCEPTED', '${ACCOUNT}');
      insert into evidence_request_decision_submissions (decision_id, submission_id)
      values ('88888888-8888-4888-8888-888888888888', '${submissionId}');
    `);
    await expect(
      client.exec('update evidence_request_decision_submissions set submission_id = submission_id'),
    ).rejects.toThrow(/never changed/);
    await client.exec(`delete from evidence_requests where id = '${REQUEST}'`);
    const left = await client.query(
      'select (select count(*) from evidence_request_submissions) as sends, (select count(*) from evidence_request_decision_submissions) as links',
    );
    expect(left.rows[0]).toMatchObject({ sends: 0, links: 0 });
  });

  it('allows one decision per send at the database itself', async () => {
    const client = await seeded();
    await client.exec(insertSend(1, 'k1'));
    const send = await client.query<{ id: string }>('select id from evidence_request_submissions');
    const submissionId = send.rows[0]?.id ?? '';
    await client.exec(`
      insert into evidence_request_decisions (id, evidence_request_id, outcome, decided_by_account_id) values
        ('88888888-8888-4888-8888-888888888888', '${REQUEST}', 'NEEDS_REPLACEMENT', '${ACCOUNT}'),
        ('99999999-9999-4999-8999-999999999999', '${REQUEST}', 'ACCEPTED', '${ACCOUNT}');
      insert into evidence_request_decision_submissions (decision_id, submission_id)
      values ('88888888-8888-4888-8888-888888888888', '${submissionId}');
    `);
    await expect(
      client.exec(
        `insert into evidence_request_decision_submissions (decision_id, submission_id) values ('99999999-9999-4999-8999-999999999999', '${submissionId}')`,
      ),
    ).rejects.toThrow();
  });
});
