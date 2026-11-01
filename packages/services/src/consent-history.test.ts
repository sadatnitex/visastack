import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { listConsentHistory, setConsent } from './consent';
import type { Db } from './db';

/** WP-SB1: consent history read a page at a time; the export keeps the whole list. */

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, { schema }) as unknown as Db;
}

describe('listConsentHistory pages (WP-SB1)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  async function account(email: string) {
    const provisioned = await provisionAccount(db, { email });
    if (!isOk(provisioned)) throw new Error('provision failed');
    return provisioned.value.id;
  }

  async function seed(accountId: string, count: number) {
    await db.insert(schema.consentRecords).values(
      Array.from({ length: count }, (_, i) => ({
        accountId,
        type: 'MARKETING' as const,
        grantedAt: i % 2 === 0 ? new Date() : null,
        revokedAt: i % 2 === 0 ? null : new Date(),
        // Pairs share one instant, so the id settles the order.
        createdAt: new Date(Date.UTC(2026, 0, 1) + Math.floor(i / 2) * 1000),
      })),
    );
  }

  it('returns the whole list without options, as the export expects', async () => {
    const id = await account('consent-all@example.test');
    await seed(id, 120);
    expect(await listConsentHistory(db, id)).toHaveLength(120);
  });

  it('pages newest first with no gap or repeat and ignores a foreign cursor', async () => {
    const ana = await account('consent-ana@example.test');
    const ben = await account('consent-ben@example.test');
    await seed(ana, 120);
    await setConsent(db, { actorAccountId: ben, accountId: ben, type: 'SHARING', granted: true });

    const ids: string[] = [];
    const sizes: number[] = [];
    let before: string | undefined;
    for (let i = 0; i < 5; i += 1) {
      const page = await listConsentHistory(db, ana, before ? { before } : {});
      sizes.push(page.items.length);
      ids.push(...page.items.map((row) => row.id));
      expect(page.items.every((row) => row.accountId === ana)).toBe(true);
      if (!page.nextCursor) break;
      before = page.nextCursor;
    }
    expect(sizes).toEqual([50, 50, 20]);
    expect(new Set(ids).size).toBe(120);
    const rows = await db
      .select()
      .from(schema.consentRecords)
      .where(eq(schema.consentRecords.accountId, ana));
    const expected = [...rows]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
      .map((row) => row.id);
    expect(ids).toEqual(expected);

    const anaFirst = await listConsentHistory(db, ana, { limit: 1 });
    const crossed = await listConsentHistory(db, ben, { before: anaFirst.nextCursor ?? '' });
    expect(crossed.items).toHaveLength(1);
    expect(crossed.items[0]?.accountId).toBe(ben);
    expect(crossed.nextCursor).toBeNull();
  });
});
