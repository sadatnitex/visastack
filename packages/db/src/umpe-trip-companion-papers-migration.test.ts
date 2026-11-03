import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrationsFolder } from './paths';
import { createMigratedPglite } from './testing';

/**
 * The UMPE UX6 package 4 migration (the papers a companion chose to show the organiser by name).
 * Found by what it creates, never by its number: the lead renumbers migrations in merge order.
 */
function paperStatements(): string[] {
  const file = readdirSync(migrationsFolder)
    .filter((name) => name.endsWith('.sql'))
    .find((name) =>
      readFileSync(join(migrationsFolder, name), 'utf8').includes(
        'CREATE TABLE IF NOT EXISTS "umpe_trip_companion_papers"',
      ),
    );
  if (!file) throw new Error('the trip companion papers migration is missing');
  return readFileSync(join(migrationsFolder, file), 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const GUEST = '22222222-2222-4222-8222-222222222222';
const APPLICANT = '44444444-4444-4444-8444-444444444444';
const TRIP = '33333333-3333-4333-8333-333333333333';
const COMPANION = '55555555-5555-4555-8555-555555555555';
const DOCUMENT = '66666666-6666-4666-8666-666666666666';

async function seeded() {
  const client = await createMigratedPglite();
  await client.exec(`
    insert into accounts (id, email) values ('${ACCOUNT}', 'org@example.com'), ('${GUEST}', 'guest@example.com');
    insert into applicants (id, owner_account_id, display_name) values ('${APPLICANT}', '${GUEST}', 'Guest');
    insert into documents (id, applicant_id, original_name, doc_type) values ('${DOCUMENT}', '${APPLICANT}', 'booking.pdf', 'FLIGHT_BOOKING');
    insert into umpe_trips (id, owner_account_id, title, destination, purpose, itinerary_ref)
      values ('${TRIP}', '${ACCOUNT}', 'Trip', 'Japan', 'Tourism', 'ref');
    insert into umpe_trip_companions (id, trip_id, display_name, state, joined_account_id, invited_by_account_id)
      values ('${COMPANION}', '${TRIP}', 'Friend', 'JOINED', '${GUEST}', '${ACCOUNT}');
  `);
  return client;
}

const pick = `insert into umpe_trip_companion_papers (companion_id, document_id) values ('${COMPANION}', '${DOCUMENT}')`;

describe('UMPE UX6 trip companion papers migration', () => {
  it('creates the table, its keys and indexes, and runs again without harm', async () => {
    const client = await createMigratedPglite();
    // The shipped migrations already ran it once; running every statement again must change nothing.
    for (const statement of paperStatements()) await client.exec(statement);
    const columns = await client.query<{ name: string }>(
      `select column_name as name from information_schema.columns where table_name = 'umpe_trip_companion_papers' order by 1`,
    );
    expect(columns.rows.map((r) => r.name)).toEqual([
      'companion_id',
      'created_at',
      'document_id',
      'id',
    ]);
    const keys = await client.query<{ name: string }>(
      `select conname as name from pg_constraint where conrelid = 'umpe_trip_companion_papers'::regclass order by 1`,
    );
    expect(keys.rows.map((r) => r.name)).toEqual([
      'umpe_trip_companion_papers_companion_fk',
      'umpe_trip_companion_papers_document_id_documents_id_fk',
      'umpe_trip_companion_papers_pair_unique',
      'umpe_trip_companion_papers_pkey',
    ]);
    const indexes = await client.query<{ name: string }>(
      `select indexname as name from pg_indexes where tablename = 'umpe_trip_companion_papers' order by 1`,
    );
    expect(indexes.rows.map((r) => r.name)).toEqual(
      expect.arrayContaining([
        'umpe_trip_companion_papers_companion_idx',
        'umpe_trip_companion_papers_document_idx',
      ]),
    );
  });

  it('is additive: the migration touches only its own table', () => {
    for (const statement of paperStatements()) {
      expect(statement).not.toMatch(/\b(DROP|TRUNCATE)\b|\bDELETE\s+FROM\b|\bUPDATE\s+"/i);
      expect(statement).not.toMatch(/ALTER TABLE "(?!umpe_trip_companion_papers")/);
    }
  });

  it('names every constraint and index within the 63 characters a name may have, so the guarded re-run can match them', () => {
    const names = paperStatements().flatMap((statement) =>
      [...statement.matchAll(/"(umpe_trip_companion_papers_[a-z_]+)"/g)].map((m) => m[1] ?? ''),
    );
    expect(names.length).toBeGreaterThan(4);
    for (const name of names) expect(name.length, name).toBeLessThanOrEqual(63);
  });

  it('holds one choice per companion and paper, and refuses a made-up companion or paper', async () => {
    const client = await seeded();
    await client.exec(pick);
    await expect(client.exec(pick)).rejects.toThrow();
    await expect(
      client.exec(
        `insert into umpe_trip_companion_papers (companion_id, document_id) values ('${GUEST}', '${DOCUMENT}')`,
      ),
    ).rejects.toThrow();
    await expect(
      client.exec(
        `insert into umpe_trip_companion_papers (companion_id, document_id) values ('${COMPANION}', '${GUEST}')`,
      ),
    ).rejects.toThrow();
  });

  it('goes with the paper when the paper is deleted, and with the companion row', async () => {
    const client = await seeded();
    await client.exec(pick);
    await client.exec(`delete from documents where id = '${DOCUMENT}'`);
    expect((await client.query('select 1 from umpe_trip_companion_papers')).rows).toHaveLength(0);
    await client.exec(
      `insert into documents (id, applicant_id, original_name, doc_type) values ('${DOCUMENT}', '${APPLICANT}', 'booking.pdf', 'FLIGHT_BOOKING')`,
    );
    await client.exec(pick);
    await client.exec(`delete from umpe_trip_companions where id = '${COMPANION}'`);
    expect((await client.query('select 1 from umpe_trip_companion_papers')).rows).toHaveLength(0);
    // The paper itself is untouched by a choice going away.
    expect((await client.query('select 1 from documents')).rows).toHaveLength(1);
  });
});
