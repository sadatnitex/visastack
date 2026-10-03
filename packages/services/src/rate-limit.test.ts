import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './db';
import {
  RATE_LIMITS,
  RATE_LIMIT_BUCKET_RETENTION_MS,
  checkRateLimit,
  checkRateLimits,
  pruneExpiredRateLimitBuckets,
} from './rate-limit';

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

  it('uses a plain-language label in the refusal when one is given, and never leaks the internal action name', async () => {
    const config = { limit: 1, windowMs: 60_000 };
    const now = new Date('2026-01-01T00:00:00.000Z');
    const input = { subjectId: 'acct-1', action: 'org_invitation.create', label: 'invitation' };
    await checkRateLimit(db, input, config, now);
    const refused = await checkRateLimit(db, input, config, now);

    expect(refused.allowed).toBe(false);
    if (refused.allowed) return;
    expect(refused.reason).toBe(
      'too many invitation requests in a short time - please try again later',
    );
    expect(refused.reason).not.toContain('org_invitation');
  });

  it('keeps the original message when no label is given, so existing callers are unchanged', async () => {
    const config = { limit: 1, windowMs: 60_000 };
    const now = new Date('2026-01-01T00:00:00.000Z');
    const input = { subjectId: 'acct-1', action: 'grant.create' };
    await checkRateLimit(db, input, config, now);
    const refused = await checkRateLimit(db, input, config, now);

    if (refused.allowed) throw new Error('expected a refusal');
    expect(refused.reason).toContain('too many grant create actions');
  });
});

describe('checkRateLimits - several buckets, actor first (Part 9 SEC-02)', () => {
  let db: Db;

  beforeEach(async () => {
    db = await freshDb();
  });

  const now = new Date('2026-01-01T00:00:00.000Z');
  const actor = {
    input: { subjectId: 'actor-1', action: 'thing.create' },
    config: { limit: 2, windowMs: 60_000 },
  };
  const org = {
    input: { subjectId: 'org-1', action: 'thing.create.org' },
    config: { limit: 5, windowMs: 60_000 },
  };

  async function bucketCount(subjectId: string): Promise<number | undefined> {
    const [row] = await db
      .select()
      .from(schema.rateLimitBuckets)
      .where(eq(schema.rateLimitBuckets.subjectId, subjectId));
    return row?.count;
  }

  it('allows while every bucket is under its limit, counting each', async () => {
    const decision = await checkRateLimits(db, [actor, org], now);

    expect(decision.allowed).toBe(true);
    expect(await bucketCount('actor-1')).toBe(1);
    expect(await bucketCount('org-1')).toBe(1);
  });

  it("refuses on the first exceeded bucket and does NOT increment the later ones (a refused actor cannot drain the org's allowance)", async () => {
    await checkRateLimits(db, [actor, org], now);
    await checkRateLimits(db, [actor, org], now);
    // The actor's own limit (2) is now spent; the org has used 2 of 5.
    const refused = await checkRateLimits(db, [actor, org], now);
    const refusedAgain = await checkRateLimits(db, [actor, org], now);

    expect(refused.allowed).toBe(false);
    expect(refusedAgain.allowed).toBe(false);
    expect(await bucketCount('org-1')).toBe(2);
  });

  it('refuses when only the later (organization) bucket is exceeded', async () => {
    const tightOrg = { ...org, config: { limit: 1, windowMs: 60_000 } };
    await checkRateLimits(db, [actor, tightOrg], now);
    const refused = await checkRateLimits(db, [actor, tightOrg], now);

    expect(refused.allowed).toBe(false);
  });
});

describe('pruneExpiredRateLimitBuckets (Part 9 SEC-02)', () => {
  let db: Db;

  beforeEach(async () => {
    db = await freshDb();
  });

  const hourMs = 60 * 60 * 1000;

  async function seedBucket(subjectId: string, windowStart: Date): Promise<void> {
    await db
      .insert(schema.rateLimitBuckets)
      .values({ subjectId, action: 'thing.create', windowStart, count: 1 });
  }

  it('deletes buckets whose window ended before the retention cutoff and keeps the rest', async () => {
    const now = new Date('2026-01-10T12:00:00.000Z');
    await seedBucket('ancient', new Date(now.getTime() - 48 * hourMs));
    await seedBucket('just-expired', new Date(now.getTime() - 25 * hourMs));
    await seedBucket('recent', new Date(now.getTime() - 23 * hourMs));
    await seedBucket('current', new Date(now.getTime() - 30 * 60 * 1000));

    const removed = await pruneExpiredRateLimitBuckets(db, now);

    expect(removed).toBe(2);
    const remaining = (await db.select().from(schema.rateLimitBuckets))
      .map((row) => row.subjectId)
      .sort();
    expect(remaining).toEqual(['current', 'recent']);
  });

  it('never removes a bucket that a live limit could still read (retention is far longer than any window)', async () => {
    const longestConfiguredWindow = Math.max(...Object.values(RATE_LIMITS).map((c) => c.windowMs));
    expect(RATE_LIMIT_BUCKET_RETENTION_MS).toBeGreaterThan(longestConfiguredWindow);
  });

  it('is a no-op on an empty table', async () => {
    expect(await pruneExpiredRateLimitBuckets(db)).toBe(0);
  });
});
