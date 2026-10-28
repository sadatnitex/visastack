import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { describe, expect, it } from 'vitest';
import { migrationsFolder } from './paths';

const MIGRATION_TIMEOUT_MS = 120_000;
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

describe('migration 0101: private calendar subscription links', () => {
  it(
    'creates the table, is safe to run again, and holds one hashed link per traveller',
    async () => {
      const client = new PGlite();
      await migrate(drizzle(client), { migrationsFolder });

      // Production applies each statement on its own; running the whole file again must not fail.
      const sql = readFileSync(join(migrationsFolder, '0101_calendar_feeds.sql'), 'utf8');
      for (const statement of sql.split('--> statement-breakpoint')) await client.exec(statement);

      const account = (
        await client.query<{ id: string }>(
          `insert into accounts (email) values ('feed-migration@example.test') returning id`,
        )
      ).rows[0]?.id;
      const applicant = (
        await client.query<{ id: string }>(
          `insert into applicants (owner_account_id, display_name) values ('${account}', 'Synthetic Traveller') returning id`,
        )
      ).rows[0]?.id;
      expect(account && applicant).toBeTruthy();

      const feed = (hash: string) =>
        client.query(
          `insert into calendar_feeds (applicant_id, owner_account_id, secret_hash)
           values ('${applicant}', '${account}', '${hash}')`,
        );
      await feed(HASH_A);
      // One link per traveller: a second row is refused (a new link replaces the hash instead).
      await expect(feed(HASH_B)).rejects.toThrow();
      // Only a SHA-256 in lower-case hex is ever stored, never a usable secret.
      await client.query('delete from calendar_feeds');
      await expect(feed('not-a-hash')).rejects.toThrow();
      await expect(feed('A'.repeat(64))).rejects.toThrow();

      // The link goes with the traveller, and with the account that made it.
      await feed(HASH_A);
      await client.query(`delete from applicants where id = '${applicant}'`);
      expect((await client.query('select id from calendar_feeds')).rows).toEqual([]);
    },
    MIGRATION_TIMEOUT_MS,
  );
});
