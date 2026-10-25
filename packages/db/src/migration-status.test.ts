import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { describe, expect, it } from 'vitest';
import { type MigrationJournalEntry, getMigrationStatus } from './migration-status';
import { migrationsFolder } from './paths';
import * as schema from './schema';

function shippedJournal(): MigrationJournalEntry[] {
  const raw = readFileSync(`${migrationsFolder}/meta/_journal.json`, 'utf8');
  return (JSON.parse(raw) as { entries: MigrationJournalEntry[] }).entries;
}

describe('getMigrationStatus', () => {
  it('reports every shipped migration as pending on a database that was never migrated', async () => {
    const db = drizzle(new PGlite(), { schema });
    const journal = shippedJournal();
    const status = await getMigrationStatus(db, journal);
    expect(status).toMatchObject({ expected: journal.length, applied: 0 });
    expect(status.pending).toHaveLength(journal.length);
    expect(status.pending[0]).toBe(journal[0]?.tag);
  });

  it('reports nothing pending once the shipped migrations have been applied', async () => {
    const db = drizzle(new PGlite(), { schema });
    await migrate(db, { migrationsFolder });
    const journal = shippedJournal();
    const status = await getMigrationStatus(db, journal);
    expect(status).toEqual({ expected: journal.length, applied: journal.length, pending: [] });
  });

  it('names the migrations a newer build ships that the database does not have yet', async () => {
    const db = drizzle(new PGlite(), { schema });
    await migrate(db, { migrationsFolder });
    const journal = shippedJournal();
    const newestWhen = Math.max(...journal.map((e) => e.when));
    const newer = [
      ...journal,
      { tag: '9998_added_later', when: newestWhen + 1_000 },
      { tag: '9999_added_last', when: newestWhen + 2_000 },
    ];
    const status = await getMigrationStatus(db, newer);
    expect(status.expected).toBe(journal.length + 2);
    expect(status.applied).toBe(journal.length);
    expect(status.pending).toEqual(['9998_added_later', '9999_added_last']);
  });

  it('detects a database that is behind the build, as production was when 0078 to 0082 were missing', async () => {
    const db = drizzle(new PGlite(), { schema });
    await migrate(db, { migrationsFolder });
    const journal = shippedJournal();
    // Forget the last three migrations, as if the migrate workflow had not run for them.
    const last = [...journal].sort((a, b) => a.when - b.when).slice(-3);
    await db.execute(
      sql`delete from drizzle.__drizzle_migrations where created_at >= ${last[0]?.when ?? 0}`,
    );
    const status = await getMigrationStatus(db, journal);
    expect(status.applied).toBe(journal.length - 3);
    expect(status.pending).toEqual(last.map((e) => e.tag));
  });

  it('does not hide a failure that is not the missing migrations table', async () => {
    const broken = {
      execute: async () => {
        throw new Error('connection terminated unexpectedly');
      },
    };
    await expect(getMigrationStatus(broken, shippedJournal())).rejects.toThrow(
      'connection terminated',
    );
  });
});
