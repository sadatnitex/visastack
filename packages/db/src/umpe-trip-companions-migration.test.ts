import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrationsFolder } from './paths';
import { createMigratedPglite } from './testing';

/**
 * The UMPE UX6 trip companions migration. Found by what it creates, never by its number: the lead
 * renumbers migrations in merge order.
 */
function companionStatements(): string[] {
  const file = readdirSync(migrationsFolder)
    .filter((name) => name.endsWith('.sql'))
    .find((name) =>
      readFileSync(join(migrationsFolder, name), 'utf8').includes(
        'CREATE TABLE IF NOT EXISTS "umpe_trip_companions"',
      ),
    );
  if (!file) throw new Error('the trip companions migration is missing');
  return readFileSync(join(migrationsFolder, file), 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const GUEST = '22222222-2222-4222-8222-222222222222';
const TRIP = '33333333-3333-4333-8333-333333333333';

async function seeded() {
  const client = await createMigratedPglite();
  await client.exec(`
    insert into accounts (id, email) values ('${ACCOUNT}', 'org@example.com'), ('${GUEST}', 'guest@example.com');
    insert into umpe_trips (id, owner_account_id, title, destination, purpose, itinerary_ref)
      values ('${TRIP}', '${ACCOUNT}', 'Trip', 'Japan', 'Tourism', 'ref');
  `);
  return client;
}

function row(fields: Record<string, string>): string {
  const base: Record<string, string> = {
    trip_id: `'${TRIP}'`,
    display_name: `'Friend'`,
    state: `'NAME_ONLY'`,
    invited_by_account_id: `'${ACCOUNT}'`,
    ...fields,
  };
  return `insert into umpe_trip_companions (${Object.keys(base).join(', ')}) values (${Object.values(base).join(', ')})`;
}

describe('UMPE UX6 trip companions migration', () => {
  it('creates the table with its checks and indexes, and runs again without harm', async () => {
    const client = await createMigratedPglite();
    for (const statement of companionStatements()) await client.exec(statement);
    const tables = await client.query<{ name: string }>(
      `select table_name as name from information_schema.tables where table_name = 'umpe_trip_companions'`,
    );
    expect(tables.rows).toHaveLength(1);
    const checks = await client.query<{ name: string }>(
      `select conname as name from pg_constraint where conrelid = 'umpe_trip_companions'::regclass and contype = 'c' order by 1`,
    );
    expect(checks.rows.map((r) => r.name)).toEqual([
      'umpe_trip_companions_email_shape',
      'umpe_trip_companions_name_cap',
      'umpe_trip_companions_share_level_known',
      'umpe_trip_companions_state_known',
      'umpe_trip_companions_token_only_when_invited',
    ]);
    const indexes = await client.query<{ name: string }>(
      `select indexname as name from pg_indexes where tablename = 'umpe_trip_companions' order by 1`,
    );
    expect(indexes.rows.map((r) => r.name)).toEqual(
      expect.arrayContaining([
        'umpe_trip_companions_joined_account_live',
        'umpe_trip_companions_live_email',
        'umpe_trip_companions_token_hash_unique',
        'umpe_trip_companions_trip_idx',
      ]),
    );
  });

  it('refuses unknown words, a long name, a mixed-case email and a link on a row that is not invited', async () => {
    const client = await seeded();
    await client.exec(row({}));
    await expect(client.exec(row({ state: `'WATCHING'` }))).rejects.toThrow();
    await expect(client.exec(row({ share_level: `'EVERYTHING'` }))).rejects.toThrow();
    await expect(client.exec(row({ display_name: `'${'x'.repeat(121)}'` }))).rejects.toThrow();
    await expect(client.exec(row({ display_name: `''` }))).rejects.toThrow();
    await expect(client.exec(row({ email: `'Mixed@Example.com'` }))).rejects.toThrow();
    // A link needs the INVITED state and a lapse time; no other state keeps one.
    await expect(client.exec(row({ token_hash: `'abc'` }))).rejects.toThrow();
    await expect(
      client.exec(row({ state: `'INVITED'`, email: `'a@example.com'` })),
    ).rejects.toThrow();
    await client.exec(
      row({
        state: `'INVITED'`,
        email: `'a@example.com'`,
        token_hash: `'abc'`,
        expires_at: 'now()',
      }),
    );
    // Hashes are unique.
    await expect(
      client.exec(
        row({
          state: `'INVITED'`,
          email: `'b@example.com'`,
          token_hash: `'abc'`,
          expires_at: 'now()',
        }),
      ),
    ).rejects.toThrow();
  });

  it('keeps one joined row per account and trip, and one live row per email and trip', async () => {
    const client = await seeded();
    await client.exec(row({ state: `'JOINED'`, joined_account_id: `'${GUEST}'` }));
    await expect(
      client.exec(row({ state: `'JOINED'`, joined_account_id: `'${GUEST}'` })),
    ).rejects.toThrow();
    // Someone who left may join again.
    await client.exec(row({ state: `'LEFT'`, joined_account_id: `'${GUEST}'` }));
    await client.exec(
      row({
        state: `'DECLINED'`,
        email: `'same@example.com'`,
      }),
    );
    await expect(
      client.exec(
        row({
          state: `'JOINED'`,
          email: `'same@example.com'`,
          joined_account_id: `'${ACCOUNT}'`,
        }),
      ),
    ).resolves.toBeDefined();
    await expect(
      client.exec(
        row({ state: `'JOINED'`, email: `'same@example.com'`, joined_account_id: 'null' }),
      ),
    ).rejects.toThrow();
  });

  it('follows its trip when the trip is deleted, and goes with the account when a joined companion is erased', async () => {
    const client = await seeded();
    await client.exec(row({ state: `'JOINED'`, joined_account_id: `'${GUEST}'` }));
    // A companion who deletes their account takes their row (email and confirmed name) with it.
    await client.exec(`delete from accounts where id = '${GUEST}'`);
    const erased = await client.query('select 1 from umpe_trip_companions');
    expect(erased.rows).toHaveLength(0);
    await client.exec(row({ state: `'NAME_ONLY'` }));
    await client.exec(`delete from umpe_trips where id = '${TRIP}'`);
    const gone = await client.query('select 1 from umpe_trip_companions');
    expect(gone.rows).toHaveLength(0);
  });
});
