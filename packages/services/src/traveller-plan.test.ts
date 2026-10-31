import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import type { Db } from './db';
import { TRAVELLER_PLAN_KEY } from './entitlements';
import { getTravellerPlanSummary, travellerPlansEnabled } from './traveller-plan';

let db: Db;

beforeEach(async () => {
  const client = await createMigratedPglite();
  db = drizzle(client, { schema }) as unknown as Db;
}, 60_000);

async function traveller(email: string): Promise<string> {
  const account = await provisionAccount(db, { email });
  if (!isOk(account)) throw new Error('provision failed');
  return account.value.id;
}

describe('getTravellerPlanSummary', () => {
  it('names the traveller plan and gives its own rule for each AI feature', async () => {
    const accountId = await traveller('plan@example.com');
    const summary = await getTravellerPlanSummary(db, { actorAccountId: accountId });
    expect(summary.plan?.key).toBe(TRAVELLER_PLAN_KEY);
    expect(summary.plan?.name.length).toBeGreaterThan(0);
    expect(summary.features?.ai_automatic_reading).toEqual(
      expect.objectContaining({ included: expect.any(Boolean) }),
    );
  });

  it('is the same for every traveller: it reads no one else’s records', async () => {
    const one = await getTravellerPlanSummary(db, {
      actorAccountId: await traveller('one@example.com'),
    });
    const two = await getTravellerPlanSummary(db, {
      actorAccountId: await traveller('two@example.com'),
    });
    expect(two).toEqual(one);
  });
});

describe('travellerPlansEnabled (ADR 0025 section 9)', () => {
  it('is off unless TRAVELLER_PLANS_ENABLED is the word true', () => {
    expect(travellerPlansEnabled({})).toBe(false);
    for (const off of ['', 'false', 'TRUE', 'yes', '1', 'on', 'truee']) {
      expect(travellerPlansEnabled({ TRAVELLER_PLANS_ENABLED: off }), off).toBe(false);
    }
    expect(travellerPlansEnabled({ TRAVELLER_PLANS_ENABLED: 'true' })).toBe(true);
    expect(travellerPlansEnabled({ TRAVELLER_PLANS_ENABLED: ' true ' })).toBe(true);
  });
});
