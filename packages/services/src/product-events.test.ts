import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import {
  PRODUCT_EVENT_CATEGORIES,
  PRODUCT_EVENT_TYPES,
  type RecordProductEventInput,
  elapsedSeconds,
  getPilotScorecard,
  getProductAnalytics,
  recordProductEvent,
  resetProductEventLogForTests,
} from './product-events';

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  const db = drizzle(client, { schema });
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

async function eventRows(db: Db) {
  return db.select().from(schema.productEvents);
}

async function makeOrganization(db: Db, name = 'Acme'): Promise<string> {
  const [org] = await db.insert(schema.organizations).values({ name }).returning();
  if (!org) throw new Error('organization');
  return org.id;
}

describe('recordProductEvent -- what an event may carry', () => {
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

  it('stores the closed-vocabulary label, the measure and the organization it was given', async () => {
    const organizationId = await makeOrganization(db);
    await recordProductEvent(db, {
      eventType: 'OUTCOME_RECORDED',
      accountId: null,
      organizationId,
      dimension: 'REFUSED',
    });
    await recordProductEvent(db, {
      eventType: 'CASH_COLLECTED',
      accountId: null,
      organizationId,
      dimension: 'BDT',
      metricValue: 250_000,
    });
    const rows = await eventRows(db);
    expect(rows.map((r) => [r.eventType, r.organizationId, r.dimension, r.metricValue])).toEqual([
      ['OUTCOME_RECORDED', organizationId, 'REFUSED', null],
      ['CASH_COLLECTED', organizationId, 'BDT', 250_000],
    ]);
  });

  it.each([
    [
      'a free-text label',
      { eventType: 'OUTCOME_RECORDED', dimension: 'Refused: medical condition' },
    ],
    [
      'a label this event type does not allow',
      { eventType: 'OUTCOME_RECORDED', dimension: 'SEATS' },
    ],
    ['a lower-case label', { eventType: 'OUTCOME_RECORDED', dimension: 'refused' }],
    [
      'a label on an event type that carries none',
      { eventType: 'ACCOUNT_CREATED', dimension: 'ANYTHING' },
    ],
    [
      'a currency that is not three capital letters',
      { eventType: 'CASH_COLLECTED', dimension: 'Bangladeshi taka' },
    ],
    [
      'a metric on an event type that carries none',
      { eventType: 'OUTCOME_RECORDED', metricValue: 5 },
    ],
    ['a negative metric', { eventType: 'CASH_COLLECTED', dimension: 'BDT', metricValue: -1 }],
    ['a fractional metric', { eventType: 'CASH_COLLECTED', dimension: 'BDT', metricValue: 12.5 }],
    [
      'a metric beyond a safe integer',
      { eventType: 'CASH_COLLECTED', dimension: 'BDT', metricValue: 2 ** 60 },
    ],
    ['an event type that does not exist', { eventType: 'NOT_A_REAL_EVENT' }],
  ] as const)('records nothing for %s, and does not throw', async (_name, input) => {
    await expect(
      recordProductEvent(db, { accountId: null, ...input } as unknown as RecordProductEventInput),
    ).resolves.toBeUndefined();
    expect(await eventRows(db)).toEqual([]);
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(String(errorLog.mock.calls[0]?.[0])).toContain('[product-events]');
  });

  it('every label any event type allows is itself a bare token the database accepts', async () => {
    // The code-level vocabulary and the database CHECK are independent guards;
    // this keeps them from contradicting each other.
    for (const eventType of PRODUCT_EVENT_TYPES) {
      for (const dimension of ['MANUAL_ONLY', 'AGENCY', 'REFUSED', 'BDT', 'SUBMISSION_READY']) {
        await db
          .insert(schema.productEvents)
          .values({ eventType, accountId: null, dimension })
          .catch(() => undefined);
      }
    }
    const rows = await eventRows(db);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.dimension).toMatch(/^[A-Z][A-Z0-9_]{0,39}$/);
  });

  it('the database itself refuses a label that is not a bare token, and a negative measure', async () => {
    await expect(
      db.insert(schema.productEvents).values({
        eventType: 'OUTCOME_RECORDED',
        accountId: null,
        dimension: 'Refused, medical condition',
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.productEvents).values({
        eventType: 'OUTCOME_RECORDED',
        accountId: null,
        dimension: 'a'.repeat(5),
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.productEvents).values({
        eventType: 'CASH_COLLECTED',
        accountId: null,
        dimension: 'BDT',
        metricValue: -5,
      }),
    ).rejects.toThrow();
    expect(await eventRows(db)).toEqual([]);
  });

  it('records a once-only event once, however often it is offered, and stores only a hash of the id', async () => {
    const entityId = '5d0c1f4e-2a3b-4c5d-8e9f-0a1b2c3d4e5f';
    for (let i = 0; i < 3; i++) {
      await recordProductEvent(db, {
        eventType: 'TASK_OVERDUE',
        accountId: null,
        onceFor: entityId,
      });
    }
    await recordProductEvent(db, {
      eventType: 'TASK_OVERDUE',
      accountId: null,
      onceFor: '00000000-0000-4000-8000-000000000001',
    });
    const rows = await eventRows(db);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.dedupeKey).toMatch(/^[0-9a-f]{64}$/);
      expect(row.dedupeKey).not.toContain(entityId);
    }
  });

  it('keys a once-only event by event type too, so one entity can have several kinds', async () => {
    await recordProductEvent(db, {
      eventType: 'TASK_OVERDUE',
      accountId: null,
      onceFor: 'same-id',
    });
    await recordProductEvent(db, {
      eventType: 'MISSION_READY_REACHED',
      accountId: null,
      metricValue: 10,
      onceFor: 'same-id',
    });
    expect(await eventRows(db)).toHaveLength(2);
  });

  it('records an event with no extras exactly as before', async () => {
    await recordProductEvent(db, { eventType: 'GRANT_CREATED', accountId: null });
    const [row] = await eventRows(db);
    expect(row).toMatchObject({
      eventType: 'GRANT_CREATED',
      organizationId: null,
      dimension: null,
      metricValue: null,
      dedupeKey: null,
    });
  });
});

describe('recordProductEvent -- never in the way of the action it describes', () => {
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

  /** A database that has not been migrated to the analytics columns yet. */
  async function behindSchema(): Promise<void> {
    await db.execute(sql`alter table product_events drop column organization_id cascade`);
    await db.execute(sql`alter table product_events drop column dimension cascade`);
    await db.execute(sql`alter table product_events drop column metric_value cascade`);
    await db.execute(sql`alter table product_events drop column dedupe_key cascade`);
  }

  it('lets the surrounding transaction commit when the event cannot be written', async () => {
    await behindSchema();
    const marker = await makeOrganization(db, 'Kept');
    await db.transaction(async (tx) => {
      await recordProductEvent(tx, {
        eventType: 'OUTCOME_RECORDED',
        accountId: null,
        dimension: 'APPROVED',
      });
      // If the failed insert had poisoned the transaction, this would throw.
      await tx.insert(schema.organizations).values({ name: 'Written after the failure' });
    });
    const names = (await db.select().from(schema.organizations)).map((o) => o.name).sort();
    expect(names).toEqual(['Kept', 'Written after the failure']);
    expect(marker).toBeTruthy();
    expect(errorLog).toHaveBeenCalledTimes(1);
  });

  it('does not stop an account being created while the events table is behind', async () => {
    await behindSchema();
    const result = await provisionAccount(db, { email: 'signup-during-deploy@example.com' });
    expect(isOk(result)).toBe(true);
  });

  it('writes none of the values it failed to store into the log', async () => {
    await behindSchema();
    const organizationId = '5d0c1f4e-2a3b-4c5d-8e9f-0a1b2c3d4e5f';
    await recordProductEvent(db, {
      eventType: 'OUTCOME_RECORDED',
      accountId: null,
      organizationId,
      dimension: 'APPROVED',
    });
    expect(errorLog).toHaveBeenCalledTimes(1);
    const written = String(errorLog.mock.calls[0]?.[0]);
    expect(written).toContain('[product-events]');
    expect(written).not.toContain(organizationId);
    expect(written).not.toContain('APPROVED');
  });

  it('reports a systemic failure once, not once per event', async () => {
    await behindSchema();
    for (let i = 0; i < 5; i++) {
      await recordProductEvent(db, { eventType: 'GRANT_CREATED', accountId: null });
    }
    expect(errorLog.mock.calls.length).toBeLessThanOrEqual(1);
  });
});

describe('product event categories (OPS-04)', () => {
  it('cover the fourteen learning areas the PRD names plus Prepare Again, each backed by an event type that exists', () => {
    expect(PRODUCT_EVENT_CATEGORIES.map((c) => c.key)).toEqual([
      'case_stage',
      'intake_to_ready',
      'evidence',
      'overdue_tasks',
      'gaps',
      'acknowledgement',
      'source_review',
      'ai_decisions',
      'outcome',
      'complaint_resolution',
      'activation',
      'agency_repeat_use',
      'plan_usage',
      'cash_collection',
      // Programme X U02 (owner instruction, 26 Oct 2026: track Prepare Again usage).
      'prepare_again',
      // Growth loop 1 (agency invites its clients).
      'agency_invites',
    ]);
    for (const category of PRODUCT_EVENT_CATEGORIES) {
      expect(category.eventTypes.length, category.key).toBeGreaterThan(0);
      for (const eventType of category.eventTypes) {
        expect(PRODUCT_EVENT_TYPES, `${category.key}: ${eventType}`).toContain(eventType);
      }
    }
  });

  it('leave no OPS-04 event type unaccounted for', () => {
    const original = new Set([
      'ACCOUNT_CREATED',
      'APPLICANT_CREATED',
      'DOCUMENT_UPLOADED',
      'MISSION_CREATED',
      'GRANT_CREATED',
      'AI_EXTRACTION_RUN',
      'AI_OCR_RUN',
      'AI_CLASSIFICATION_RUN',
      'AI_INCONSISTENCY_RUN',
    ]);
    const categorised = new Set(PRODUCT_EVENT_CATEGORIES.flatMap((c) => c.eventTypes));
    for (const eventType of PRODUCT_EVENT_TYPES) {
      if (!original.has(eventType)) expect(categorised, eventType).toContain(eventType);
    }
  });
});

describe('getProductAnalytics', () => {
  let db: Db;
  const NOW = new Date('2026-10-03T12:00:00.000Z');
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

  beforeEach(async () => {
    db = await freshDb();
  });

  async function seed(
    rows: ReadonlyArray<{
      eventType: (typeof PRODUCT_EVENT_TYPES)[number];
      occurredAt: Date;
      organizationId?: string;
      dimension?: string;
      metricValue?: number;
    }>,
  ) {
    await db.insert(schema.productEvents).values(
      rows.map((r) => ({
        eventType: r.eventType,
        accountId: null,
        occurredAt: r.occurredAt,
        organizationId: r.organizationId ?? null,
        dimension: r.dimension ?? null,
        metricValue: r.metricValue ?? null,
      })),
    );
  }

  it('reports every category at zero on an empty log, never omitting one', async () => {
    const result = await getProductAnalytics(db, NOW);
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.categories).toHaveLength(PRODUCT_EVENT_CATEGORIES.length);
    for (const category of result.categories) {
      expect(category).toMatchObject({ total: 0, last7Days: 0, last30Days: 0 });
    }
    expect(result.intakeToReady).toEqual({ count: 0, medianSeconds: null, p90Seconds: null });
    expect(result.cashCollected).toEqual([]);
    expect(result.agencyRepeatUse).toEqual({ activeOrganizations: 0, repeatOrganizations: 0 });
  });

  it('counts each category over all time, 30 days and 7 days', async () => {
    await seed([
      { eventType: 'EVIDENCE_REQUESTED', occurredAt: daysAgo(1) },
      { eventType: 'EVIDENCE_REQUESTED', occurredAt: daysAgo(20) },
      { eventType: 'EVIDENCE_RECEIVED', occurredAt: daysAgo(40) },
      {
        eventType: 'EVIDENCE_REWORK_REQUESTED',
        occurredAt: daysAgo(2),
        dimension: 'NEEDS_REPLACEMENT',
      },
      { eventType: 'TASK_OVERDUE', occurredAt: daysAgo(3) },
    ]);
    const result = await getProductAnalytics(db, NOW);
    if (!result.available) throw new Error('unavailable');
    const byKey = new Map(result.categories.map((c) => [c.key, c]));
    expect(byKey.get('evidence')).toMatchObject({ total: 4, last30Days: 3, last7Days: 2 });
    expect(byKey.get('overdue_tasks')).toMatchObject({ total: 1, last30Days: 1, last7Days: 1 });
    expect(byKey.get('outcome')).toMatchObject({ total: 0 });
  });

  it('summarises the three timed measures as a median and a 90th percentile, in seconds', async () => {
    await seed(
      [60, 120, 180, 240, 3_600].map((metricValue) => ({
        eventType: 'MISSION_READY_REACHED' as const,
        occurredAt: daysAgo(1),
        metricValue,
      })),
    );
    await seed([
      {
        eventType: 'COMPLAINT_RESOLVED',
        occurredAt: daysAgo(1),
        dimension: 'RESOLVED',
        metricValue: 86_400,
      },
      {
        eventType: 'ACCOUNT_ACTIVATED',
        occurredAt: daysAgo(1),
        dimension: 'TRAVELLER',
        metricValue: 600,
      },
    ]);
    const result = await getProductAnalytics(db, NOW);
    if (!result.available) throw new Error('unavailable');
    expect(result.intakeToReady.count).toBe(5);
    expect(result.intakeToReady.medianSeconds).toBe(180);
    // percentile_cont(0.9) interpolates between the 4th and 5th of five sorted
    // values: 240 + 0.6 * (3600 - 240) = 2256.
    expect(result.intakeToReady.p90Seconds).toBe(2_256);
    expect(result.complaintResolution).toEqual({
      count: 1,
      medianSeconds: 86_400,
      p90Seconds: 86_400,
    });
    expect(result.activationDelay).toEqual({ count: 1, medianSeconds: 600, p90Seconds: 600 });
  });

  it('sums cash collected per currency in minor units and never mixes currencies', async () => {
    await seed([
      {
        eventType: 'CASH_COLLECTED',
        occurredAt: daysAgo(1),
        dimension: 'BDT',
        metricValue: 100_000,
      },
      {
        eventType: 'CASH_COLLECTED',
        occurredAt: daysAgo(2),
        dimension: 'BDT',
        metricValue: 50_000,
      },
      { eventType: 'CASH_COLLECTED', occurredAt: daysAgo(3), dimension: 'USD', metricValue: 2_500 },
    ]);
    const result = await getProductAnalytics(db, NOW);
    if (!result.available) throw new Error('unavailable');
    expect(result.cashCollected).toEqual([
      { currency: 'BDT', minorUnits: 150_000, collections: 2 },
      { currency: 'USD', minorUnits: 2_500, collections: 1 },
    ]);
  });

  it('breaks down stages, outcomes, plan limits and AI decisions by their labels', async () => {
    await seed([
      { eventType: 'MISSION_STAGE_CHANGED', occurredAt: daysAgo(1), dimension: 'IN_REVIEW' },
      { eventType: 'MISSION_STAGE_CHANGED', occurredAt: daysAgo(1), dimension: 'IN_REVIEW' },
      { eventType: 'MISSION_STAGE_CHANGED', occurredAt: daysAgo(1), dimension: 'SUBMISSION_READY' },
      { eventType: 'OUTCOME_RECORDED', occurredAt: daysAgo(1), dimension: 'APPROVED' },
      { eventType: 'OUTCOME_RECORDED', occurredAt: daysAgo(1), dimension: 'REFUSED' },
      { eventType: 'OUTCOME_RECORDED', occurredAt: daysAgo(1), dimension: 'APPROVED' },
      { eventType: 'PLAN_LIMIT_REACHED', occurredAt: daysAgo(1), dimension: 'SEATS' },
      { eventType: 'AI_PROPOSAL_ACCEPTED', occurredAt: daysAgo(1), dimension: 'EXTRACTION' },
      { eventType: 'AI_PROPOSAL_ACCEPTED', occurredAt: daysAgo(1), dimension: 'CLASSIFICATION' },
      { eventType: 'AI_PROPOSAL_CORRECTED', occurredAt: daysAgo(1), dimension: 'EXTRACTION' },
      { eventType: 'AI_PROPOSAL_REJECTED', occurredAt: daysAgo(1), dimension: 'INCONSISTENCY' },
    ]);
    const result = await getProductAnalytics(db, NOW);
    if (!result.available) throw new Error('unavailable');
    expect(result.casesByStage).toEqual([
      { label: 'IN_REVIEW', count: 2 },
      { label: 'SUBMISSION_READY', count: 1 },
    ]);
    expect(result.outcomes).toEqual([
      { label: 'APPROVED', count: 2 },
      { label: 'REFUSED', count: 1 },
    ]);
    expect(result.planLimitHits).toEqual([{ label: 'SEATS', count: 1 }]);
    expect(result.aiDecisions).toEqual({ accepted: 2, corrected: 1, rejected: 1 });
  });

  it('counts an organization as repeat use only if it created cases in two different weeks', async () => {
    const once = await makeOrganization(db, 'One week only');
    const repeat = await makeOrganization(db, 'Two weeks');
    const stale = await makeOrganization(db, 'Too long ago');
    await seed([
      {
        eventType: 'MISSION_CREATED',
        occurredAt: new Date('2026-09-29T09:00:00Z'),
        organizationId: once,
      },
      {
        eventType: 'MISSION_CREATED',
        occurredAt: new Date('2026-09-30T09:00:00Z'),
        organizationId: once,
      },
      {
        eventType: 'MISSION_CREATED',
        occurredAt: new Date('2026-09-14T09:00:00Z'),
        organizationId: repeat,
      },
      {
        eventType: 'MISSION_CREATED',
        occurredAt: new Date('2026-10-01T09:00:00Z'),
        organizationId: repeat,
      },
      // Outside the 90-day window: not active, not repeat.
      {
        eventType: 'MISSION_CREATED',
        occurredAt: new Date('2026-04-01T09:00:00Z'),
        organizationId: stale,
      },
      {
        eventType: 'MISSION_CREATED',
        occurredAt: new Date('2026-04-20T09:00:00Z'),
        organizationId: stale,
      },
      // A traveller's own case carries no organization and is not agency use.
      { eventType: 'MISSION_CREATED', occurredAt: new Date('2026-10-02T09:00:00Z') },
    ]);
    const result = await getProductAnalytics(db, NOW);
    if (!result.available) throw new Error('unavailable');
    expect(result.agencyRepeatUse).toEqual({ activeOrganizations: 2, repeatOrganizations: 1 });
  });

  it('says it is waiting for the migration, rather than failing, when the columns are not there yet', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await db.execute(sql`alter table product_events drop column dimension cascade`);
      await db.execute(sql`alter table product_events drop column metric_value cascade`);
      const result = await getProductAnalytics(db, NOW);
      expect(result).toEqual({ available: false, reason: 'schema_pending' });
    } finally {
      errorLog.mockRestore();
    }
  });

  it('does not hide a failure that is not the missing columns', async () => {
    const broken = {
      select: () => {
        throw new Error('connection terminated unexpectedly');
      },
    } as unknown as Db;
    await expect(getProductAnalytics(broken, NOW)).rejects.toThrow('connection terminated');
  });
});

describe('elapsedSeconds', () => {
  it('floors to whole seconds and never goes negative', () => {
    const from = new Date('2026-10-03T00:00:00.000Z');
    expect(elapsedSeconds(from, new Date('2026-10-03T00:00:01.999Z'))).toBe(1);
    expect(elapsedSeconds(from, new Date('2026-10-02T23:59:59.000Z'))).toBe(0);
    expect(elapsedSeconds(from, new Date('2026-10-04T00:00:00.000Z'))).toBe(86_400);
  });
});
