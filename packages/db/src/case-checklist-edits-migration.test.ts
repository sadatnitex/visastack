import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrationsFolder } from './paths';
import { createMigratedPglite } from './testing';

/**
 * Edits a traveller makes to the checklist on their own case (one new table, nothing changed in an
 * existing one). Found by what it creates, never by its number: migrations are renumbered in merge
 * order.
 */
function migrationFile(): string {
  const file = readdirSync(migrationsFolder)
    .filter((name) => name.endsWith('.sql'))
    .find((name) =>
      readFileSync(join(migrationsFolder, name), 'utf8').includes(
        'CREATE TABLE IF NOT EXISTS "case_checklist_edits"',
      ),
    );
  if (!file) throw new Error('the case checklist edits migration is missing');
  return readFileSync(join(migrationsFolder, file), 'utf8');
}

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const APPLICANT = '22222222-2222-4222-8222-222222222222';
const PACK = '33333333-3333-4333-8333-333333333333';
const VERSION = '44444444-4444-4444-8444-444444444444';
const ITEM = '55555555-5555-4555-8555-555555555555';
const OTHER_ITEM = '66666666-6666-4666-8666-666666666666';
const MISSION = '77777777-7777-4777-8777-777777777777';

async function seeded() {
  const client = await createMigratedPglite();
  await client.exec(`
    insert into accounts (id, email) values ('${ACCOUNT}', 'owner@example.com');
    insert into applicants (id, owner_account_id, display_name) values ('${APPLICANT}', '${ACCOUNT}', 'Synthetic');
    insert into packs (id, key, name) values ('${PACK}', 'synthetic.edits.1', 'Synthetic Pack');
    insert into pack_versions (id, pack_id, version, status) values ('${VERSION}', '${PACK}', 1, 'PUBLISHED');
    insert into pack_requirements (id, pack_version_id, kind, doc_type, citation, optional)
      values ('${ITEM}', '${VERSION}', 'DOCUMENT', 'PASSPORT', 'Synthetic rule', false),
             ('${OTHER_ITEM}', '${VERSION}', 'DOCUMENT', 'PHOTO', 'Synthetic rule', false);
    insert into missions (id, applicant_id, title) values ('${MISSION}', '${APPLICANT}', 'Synthetic case');
  `);
  return client;
}

const reword = (item: string, wording: string) => `
  insert into case_checklist_edits (mission_id, applicant_id, kind, pack_requirement_id, wording)
  values ('${MISSION}', '${APPLICANT}', 'REWORD', '${item}', '${wording}')`;
const own = (wording: string, extra = '') => `
  insert into case_checklist_edits (mission_id, applicant_id, kind, wording${extra ? ', done_at' : ''})
  values ('${MISSION}', '${APPLICANT}', 'OWN_ITEM', '${wording}'${extra ? `, ${extra}` : ''})`;

describe('case checklist edits migration', () => {
  it('creates one table and changes no existing table', () => {
    const sql = migrationFile();
    const touched = [
      ...sql.matchAll(/(?:CREATE TABLE IF NOT EXISTS|ALTER TABLE) "([a-z_]+)"/g),
    ].map((m) => m[1]);
    expect(new Set(touched)).toEqual(new Set(['case_checklist_edits']));
    expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN|ALTER COLUMN/);
  });

  it('can be run again from the top without harm, statement by statement', async () => {
    const client = await seeded();
    await client.exec(reword(ITEM, 'My own words'));
    for (let run = 0; run < 2; run += 1) {
      for (const statement of migrationFile().split('--> statement-breakpoint')) {
        if (statement.trim().length > 0) await client.exec(statement);
      }
    }
    const left = await client.query<{ n: number }>(
      'select count(*)::int as n from case_checklist_edits',
    );
    expect(left.rows[0]?.n).toBe(1);
    const fks = await client.query<{ n: number }>(
      "select count(*)::int as n from pg_constraint where contype = 'f' and conrelid = 'case_checklist_edits'::regclass",
    );
    expect(fks.rows[0]?.n).toBe(4);
  });

  it('allows one reword per item and as many own items as the service lets through', async () => {
    const client = await seeded();
    await client.exec(reword(ITEM, 'One'));
    await client.exec(reword(OTHER_ITEM, 'Two'));
    await expect(client.exec(reword(ITEM, 'Again'))).rejects.toThrow(/reword_unique/);
    await client.exec(own('Call the bank'));
    await client.exec(own('Call the bank'));
    const rows = await client.query<{ n: number }>(
      'select count(*)::int as n from case_checklist_edits',
    );
    expect(rows.rows[0]?.n).toBe(4);
  });

  it('refuses a row of the wrong shape', async () => {
    const client = await seeded();
    // A reword must name an item; an own item must not.
    await expect(
      client.exec(`insert into case_checklist_edits (mission_id, applicant_id, kind, wording)
        values ('${MISSION}', '${APPLICANT}', 'REWORD', 'No item')`),
    ).rejects.toThrow(/shape/);
    await expect(
      client.exec(`insert into case_checklist_edits (mission_id, applicant_id, kind, pack_requirement_id, wording)
        values ('${MISSION}', '${APPLICANT}', 'OWN_ITEM', '${ITEM}', 'Has an item')`),
    ).rejects.toThrow(/shape/);
    await expect(
      client.exec(`insert into case_checklist_edits (mission_id, applicant_id, kind, wording)
        values ('${MISSION}', '${APPLICANT}', 'HIDE', 'Nope')`),
    ).rejects.toThrow(/kind_known/);
    // Only an own item can be ticked off.
    await expect(
      client.exec(`insert into case_checklist_edits (mission_id, applicant_id, kind, pack_requirement_id, wording, done_at)
        values ('${MISSION}', '${APPLICANT}', 'REWORD', '${ITEM}', 'Done?', now())`),
    ).rejects.toThrow(/done_own_only/);
    await client.exec(own('Ticked', 'now()'));
  });

  it('refuses empty, blank and over-long wording', async () => {
    const client = await seeded();
    await expect(client.exec(own(''))).rejects.toThrow(/wording_length/);
    await expect(client.exec(own('   '))).rejects.toThrow(/wording_length/);
    await expect(client.exec(own('a'.repeat(401)))).rejects.toThrow(/wording_length/);
    await client.exec(own('a'.repeat(400)));
  });

  it('removes its rows with the case, the traveller or the item', async () => {
    const client = await seeded();
    await client.exec(reword(ITEM, 'One'));
    await client.exec(own('Mine'));
    await client.exec(`delete from pack_requirements where id = '${ITEM}'`);
    const afterItem = await client.query<{ n: number }>(
      'select count(*)::int as n from case_checklist_edits',
    );
    expect(afterItem.rows[0]?.n).toBe(1);
    await client.exec(`delete from missions where id = '${MISSION}'`);
    const afterCase = await client.query<{ n: number }>(
      'select count(*)::int as n from case_checklist_edits',
    );
    expect(afterCase.rows[0]?.n).toBe(0);
  });
});
