import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrationsFolder } from './paths';
import { createMigratedPglite } from './testing';

/**
 * The exact saved value sent in answer to a detail request (two new tables, nothing changed in an
 * existing one). Found by what it creates, never by its number: the lead renumbers migrations in
 * merge order.
 */
function migrationFile(): string {
  const file = readdirSync(migrationsFolder)
    .filter((name) => name.endsWith('.sql'))
    .find((name) =>
      readFileSync(join(migrationsFolder, name), 'utf8').includes(
        'CREATE TABLE IF NOT EXISTS "evidence_request_fact_submissions"',
      ),
    );
  if (!file) throw new Error('the evidence request fact submissions migration is missing');
  return readFileSync(join(migrationsFolder, file), 'utf8');
}

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const APPLICANT = '22222222-2222-4222-8222-222222222222';
const ORG = '33333333-3333-4333-8333-333333333333';
const FIELD = '44444444-4444-4444-8444-444444444444';
const FACT = '55555555-5555-4555-8555-555555555555';
const VERSION_1 = '66666666-6666-4666-8666-666666666661';
const VERSION_2 = '66666666-6666-4666-8666-666666666662';
const REQUEST = '77777777-7777-4777-8777-777777777777';
const DECISION = '88888888-8888-4888-8888-888888888888';

async function seeded() {
  const client = await createMigratedPglite();
  await client.exec(`
    insert into accounts (id, email) values ('${ACCOUNT}', 'owner@example.com');
    insert into applicants (id, owner_account_id, display_name) values ('${APPLICANT}', '${ACCOUNT}', 'Synthetic');
    insert into organizations (id, name) values ('${ORG}', 'Harbor');
    insert into field_definitions (id, key, data_type) values ('${FIELD}', 'phone', 'TEXT');
    insert into facts (id, applicant_id, field_definition_id) values ('${FACT}', '${APPLICANT}', '${FIELD}');
    insert into fact_versions (id, fact_id, value) values ('${VERSION_1}', '${FACT}', '+8801700000111'), ('${VERSION_2}', '${FACT}', '+8801700000222');
    insert into evidence_requests (id, organization_id, applicant_id, kind, field_key) values ('${REQUEST}', '${ORG}', '${APPLICANT}', 'FIELD', 'phone');
  `);
  return client;
}

const insertSend = (round: number, key: string, version = VERSION_1) => `
  insert into evidence_request_fact_submissions
    (evidence_request_id, round_no, fact_id, fact_version_id, field_key_at_send, sent_by_account_id, idempotency_key)
  values ('${REQUEST}', ${round}, '${FACT}', '${version}', 'phone', '${ACCOUNT}', '${key}')`;

describe('evidence request fact submissions migration', () => {
  it('creates two tables and changes no existing table', () => {
    const sql = migrationFile();
    const touched = [
      ...sql.matchAll(/(?:CREATE TABLE IF NOT EXISTS|ALTER TABLE) "([a-z_]+)"/g),
    ].map((m) => m[1]);
    expect(new Set(touched)).toEqual(
      new Set(['evidence_request_fact_submissions', 'evidence_request_decision_fact_submissions']),
    );
    expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN|ALTER COLUMN/);
  });

  it('can be run again from the top without harm, statement by statement', async () => {
    const client = await seeded();
    await client.exec(insertSend(1, 'k1'));
    for (let run = 0; run < 2; run += 1) {
      for (const statement of migrationFile().split('--> statement-breakpoint')) {
        if (statement.trim().length > 0) await client.exec(statement);
      }
    }
    const left = await client.query<{ sends: number }>(
      'select count(*)::int as sends from evidence_request_fact_submissions',
    );
    expect(left.rows[0]?.sends).toBe(1);
    const triggers = await client.query<{ n: number }>(
      "select count(*)::int as n from pg_trigger where tgname in ('evidence_request_fact_submissions_no_update', 'evidence_request_decision_fact_submissions_no_update')",
    );
    expect(triggers.rows[0]?.n).toBe(2);
  });

  it('keeps one send per round and one send per retry key on a request', async () => {
    const client = await seeded();
    await client.exec(insertSend(1, 'k1'));
    await expect(client.exec(insertSend(1, 'k2'))).rejects.toThrow();
    await expect(client.exec(insertSend(2, 'k1', VERSION_2))).rejects.toThrow();
    await client.exec(insertSend(2, 'k2', VERSION_2));
  });

  it('refuses any change to a send or a link, and removes both with the request', async () => {
    const client = await seeded();
    await client.exec(insertSend(1, 'k1'));
    await expect(
      client.exec(`update evidence_request_fact_submissions set fact_version_id = '${VERSION_2}'`),
    ).rejects.toThrow(/never changed/);
    const send = await client.query<{ id: string }>(
      'select id from evidence_request_fact_submissions',
    );
    const submissionId = send.rows[0]?.id ?? '';
    await client.exec(`
      insert into evidence_request_decisions (id, evidence_request_id, outcome, decided_by_account_id)
      values ('${DECISION}', '${REQUEST}', 'ACCEPTED', '${ACCOUNT}');
      insert into evidence_request_decision_fact_submissions (decision_id, submission_id)
      values ('${DECISION}', '${submissionId}');
    `);
    await expect(
      client.exec(
        'update evidence_request_decision_fact_submissions set submission_id = submission_id',
      ),
    ).rejects.toThrow(/never changed/);
    await client.exec(`delete from evidence_requests where id = '${REQUEST}'`);
    const left = await client.query(
      'select (select count(*) from evidence_request_fact_submissions) as sends, (select count(*) from evidence_request_decision_fact_submissions) as links',
    );
    expect(left.rows[0]).toMatchObject({ sends: 0, links: 0 });
  });

  it('allows one decision per send at the database itself', async () => {
    const client = await seeded();
    await client.exec(insertSend(1, 'k1'));
    const send = await client.query<{ id: string }>(
      'select id from evidence_request_fact_submissions',
    );
    const submissionId = send.rows[0]?.id ?? '';
    await client.exec(`
      insert into evidence_request_decisions (id, evidence_request_id, outcome, decided_by_account_id) values
        ('${DECISION}', '${REQUEST}', 'NEEDS_REPLACEMENT', '${ACCOUNT}'),
        ('99999999-9999-4999-8999-999999999999', '${REQUEST}', 'ACCEPTED', '${ACCOUNT}');
      insert into evidence_request_decision_fact_submissions (decision_id, submission_id)
      values ('${DECISION}', '${submissionId}');
    `);
    await expect(
      client.exec(
        `insert into evidence_request_decision_fact_submissions (decision_id, submission_id) values ('99999999-9999-4999-8999-999999999999', '${submissionId}')`,
      ),
    ).rejects.toThrow();
  });

  it('keeps the pinned version row itself unchanged when the detail is edited later', async () => {
    const client = await seeded();
    await client.exec(insertSend(1, 'k1'));
    const pinned = await client.query<{ value: string }>(
      'select fv.value from evidence_request_fact_submissions s join fact_versions fv on fv.id = s.fact_version_id',
    );
    expect(pinned.rows[0]?.value).toBe('+8801700000111');
  });
});
