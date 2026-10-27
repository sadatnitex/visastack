import { isOk } from '@visastack/core';
import { DESTINATIONS } from '@visastack/core/destinations';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { provisionAccount } from './accounts';
import { recordCountryChecklistStarted } from './country-start';
import type { Db } from './db';
import {
  getPilotScorecard,
  getProductAnalytics,
  recordProductEvent,
  resetProductEventLogForTests,
} from './product-events';

/**
 * Growth G2: COUNTRY_CHECKLIST_STARTED. A signed-in person confirms a country in first run; one
 * event per account, labelled with the country code and nothing else.
 */

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, { schema }) as unknown as Db;
}

async function makeAccount(db: Db, email: string): Promise<string> {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision');
  return provisioned.value.id;
}

const countryEvents = (db: Db) =>
  db
    .select()
    .from(schema.productEvents)
    .then((rows) => rows.filter((row) => row.eventType === 'COUNTRY_CHECKLIST_STARTED'));

describe('recordCountryChecklistStarted', () => {
  let db: Db;
  let errorLog: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    db = await freshDb();
    resetProductEventLogForTests();
    errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    errorLog.mockRestore();
  });

  it('records the country code as the label, with no measure and no organization', async () => {
    const accountId = await makeAccount(db, 'g2-label@example.com');
    expect(await recordCountryChecklistStarted(db, { accountId, iso2: 'ca' })).toBe(true);
    const [row] = await countryEvents(db);
    expect(row).toMatchObject({
      eventType: 'COUNTRY_CHECKLIST_STARTED',
      accountId,
      organizationId: null,
      dimension: 'CA',
      metricValue: null,
    });
    expect(row?.dimension).toMatch(/^[A-Z][A-Z0-9_]{0,39}$/);
    expect(row?.dedupeKey).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.dedupeKey).not.toContain(accountId);
  });

  it('records once per account, whatever is confirmed afterwards', async () => {
    const accountId = await makeAccount(db, 'g2-once@example.com');
    await recordCountryChecklistStarted(db, { accountId, iso2: 'JP' });
    await recordCountryChecklistStarted(db, { accountId, iso2: 'JP' });
    await recordCountryChecklistStarted(db, { accountId, iso2: 'DE' });
    const rows = await countryEvents(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.dimension).toBe('JP');
  });

  it('records one event for each account', async () => {
    const first = await makeAccount(db, 'g2-a@example.com');
    const second = await makeAccount(db, 'g2-b@example.com');
    await recordCountryChecklistStarted(db, { accountId: first, iso2: 'JP' });
    await recordCountryChecklistStarted(db, { accountId: second, iso2: 'JP' });
    expect(await countryEvents(db)).toHaveLength(2);
  });

  it.each(['', 'ZZ', 'XX', 'Canada', 'C', 'CA; DROP TABLE', '12'])(
    'records nothing for %j, which is not a country we hold',
    async (iso2) => {
      const accountId = await makeAccount(db, 'g2-bad@example.com');
      expect(await recordCountryChecklistStarted(db, { accountId, iso2 })).toBe(false);
      expect(await countryEvents(db)).toEqual([]);
    },
  );

  it('records the codes of countries the checklist data holds, and logs no failure', async () => {
    for (const [index, destination] of DESTINATIONS.slice(0, 5).entries()) {
      const accountId = await makeAccount(db, `g2-each-${index}@example.com`);
      await recordCountryChecklistStarted(db, { accountId, iso2: destination.iso2 });
    }
    expect((await countryEvents(db)).map((row) => row.dimension)).toEqual(
      DESTINATIONS.slice(0, 5).map((destination) => destination.iso2),
    );
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('the event log itself refuses a label that is not a country code, and a measure', async () => {
    // The service never builds these; this pins the vocabulary, not the service.
    for (const dimension of ['Canada', 'ca', 'ZZ', 'CAN', 'US_OR_CA']) {
      await recordProductEvent(db, {
        eventType: 'COUNTRY_CHECKLIST_STARTED',
        accountId: null,
        dimension,
      });
    }
    await recordProductEvent(db, {
      eventType: 'COUNTRY_CHECKLIST_STARTED',
      accountId: null,
      dimension: 'CA',
      metricValue: 5,
    });
    expect(await countryEvents(db)).toEqual([]);
    expect(errorLog).toHaveBeenCalled();
  });

  it('shows up on the scorecard and in its own analytics category', async () => {
    const accountId = await makeAccount(db, 'g2-score@example.com');
    await recordCountryChecklistStarted(db, { accountId, iso2: 'JP' });
    const scorecard = await getPilotScorecard(db);
    expect(scorecard.find((row) => row.eventType === 'COUNTRY_CHECKLIST_STARTED')).toMatchObject({
      total: 1,
      last7Days: 1,
    });
    const analytics = await getProductAnalytics(db);
    if (!analytics.available) throw new Error('unavailable');
    expect(analytics.categories.find((c) => c.key === 'country_start')).toMatchObject({
      label: 'Country checklist started',
      total: 1,
    });
  });
});
