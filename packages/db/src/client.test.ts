import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { describe, expect, it } from 'vitest';
import { checkConnection, isSchemaApplied, resolveDatabaseUrl } from './client';
import * as schema from './schema';

const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

describe('db client probes', () => {
  it('checkConnection succeeds on a live database', async () => {
    const db = drizzle(new PGlite(), { schema });
    expect(await checkConnection(db)).toBe(true);
  });

  it('isSchemaApplied is false before migration and true after', async () => {
    const db = drizzle(new PGlite(), { schema });
    expect(await isSchemaApplied(db)).toBe(false);
    await migrate(db, { migrationsFolder });
    expect(await isSchemaApplied(db)).toBe(true);
  });
});

describe('resolveDatabaseUrl', () => {
  it('prefers DATABASE_URL', () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: 'a', POSTGRES_URL: 'b' })).toBe('a');
  });

  it('falls back to Neon/Vercel integration names', () => {
    expect(resolveDatabaseUrl({ POSTGRES_URL: 'b' })).toBe('b');
    expect(resolveDatabaseUrl({ POSTGRES_URL_NON_POOLING: 'c' })).toBe('c');
  });

  it('ignores empty strings and returns undefined when none are set', () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: '' })).toBeUndefined();
    expect(resolveDatabaseUrl({})).toBeUndefined();
  });
});
