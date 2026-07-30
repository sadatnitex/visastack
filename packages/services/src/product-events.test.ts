import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { getPilotScorecard } from './product-events';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

describe('pilot product events — privacy-preserving usage measurement', () => {
  let db: Db;

  beforeEach(async () => {
    db = await freshDb();
  });

  it('records real milestones as a side effect of the actual services (no invented counts)', async () => {
    const provisioned = await provisionAccount(db, { email: 'scorecard@example.com' });
    if (!isOk(provisioned)) throw new Error('provision');
    const account = provisioned.value;
    await setConsent(db, {
      actorAccountId: account.id,
      accountId: account.id,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    const applicant = await createApplicant(db, {
      actorAccountId: account.id,
      ownerAccountId: account.id,
      displayName: 'Self',
    });
    expect(isOk(applicant)).toBe(true);

    const scorecard = await getPilotScorecard(db);
    const byType = new Map(scorecard.map((row) => [row.eventType, row]));
    expect(byType.get('ACCOUNT_CREATED')?.total).toBe(1);
    expect(byType.get('APPLICANT_CREATED')?.total).toBe(1);
    // Every known event type is present even at zero, never silently omitted.
    expect(byType.get('DOCUMENT_UPLOADED')?.total).toBe(0);
    expect(byType.get('GRANT_CREATED')?.total).toBe(0);
  });

  it('reports the last-7-days window separately from the all-time total', async () => {
    const now = new Date('2026-01-15T00:00:00.000Z');
    const eightDaysAgo = new Date('2026-01-07T00:00:00.000Z');
    const yesterday = new Date('2026-01-14T00:00:00.000Z');

    await db.insert(schema.productEvents).values([
      { eventType: 'GRANT_CREATED', accountId: null, occurredAt: eightDaysAgo },
      { eventType: 'GRANT_CREATED', accountId: null, occurredAt: yesterday },
    ]);

    const scorecard = await getPilotScorecard(db, now);
    const row = scorecard.find((r) => r.eventType === 'GRANT_CREATED');
    expect(row?.total).toBe(2);
    expect(row?.last7Days).toBe(1);
  });
});
