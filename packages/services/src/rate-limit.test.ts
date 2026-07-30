import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { schema } from '@visastack/db';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './db';
import { checkRateLimit } from './rate-limit';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

describe('checkRateLimit — fixed-window anti-automation counter', () => {
  let db: Db;

  beforeEach(async () => {
    db = await freshDb();
  });

  it('allows calls up to the limit, then refuses further calls in the same window', async () => {
    const config = { limit: 3, windowMs: 60_000 };
    const now = new Date('2026-01-01T00:00:00.000Z');
    for (let i = 0; i < 3; i++) {
      const decision = await checkRateLimit(
        db,
        { subjectId: 'acct-1', action: 'grant.create' },
        config,
        now,
      );
      expect(decision.allowed).toBe(true);
    }
    const fourth = await checkRateLimit(
      db,
      { subjectId: 'acct-1', action: 'grant.create' },
      config,
      now,
    );
    expect(fourth.allowed).toBe(false);
    if (!fourth.allowed) {
      expect(fourth.reason).toContain('too many');
    }
  });

  it('tracks each subject independently', async () => {
    const config = { limit: 1, windowMs: 60_000 };
    const now = new Date('2026-01-01T00:00:00.000Z');
    const first = await checkRateLimit(
      db,
      { subjectId: 'acct-a', action: 'grant.create' },
      config,
      now,
    );
    const second = await checkRateLimit(
      db,
      { subjectId: 'acct-b', action: 'grant.create' },
      config,
      now,
    );
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
  });

  it('tracks each action independently for the same subject', async () => {
    const config = { limit: 1, windowMs: 60_000 };
    const now = new Date('2026-01-01T00:00:00.000Z');
    const grant = await checkRateLimit(
      db,
      { subjectId: 'acct-1', action: 'grant.create' },
      config,
      now,
    );
    const evidence = await checkRateLimit(
      db,
      { subjectId: 'acct-1', action: 'evidence.request' },
      config,
      now,
    );
    expect(grant.allowed).toBe(true);
    expect(evidence.allowed).toBe(true);
  });

  it('resets once the window rolls over', async () => {
    const config = { limit: 1, windowMs: 60_000 };
    const firstWindow = new Date('2026-01-01T00:00:00.000Z');
    const nextWindow = new Date('2026-01-01T00:01:00.000Z');
    const first = await checkRateLimit(
      db,
      { subjectId: 'acct-1', action: 'grant.create' },
      config,
      firstWindow,
    );
    const refused = await checkRateLimit(
      db,
      { subjectId: 'acct-1', action: 'grant.create' },
      config,
      firstWindow,
    );
    const afterReset = await checkRateLimit(
      db,
      { subjectId: 'acct-1', action: 'grant.create' },
      config,
      nextWindow,
    );
    expect(first.allowed).toBe(true);
    expect(refused.allowed).toBe(false);
    expect(afterReset.allowed).toBe(true);
  });
});
