import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import type { Db } from './db';
import {
  DEFAULT_EXPIRY_REMINDER_THRESHOLD_DAYS,
  classifyExpiry,
  classifyStaleness,
  getReminderThresholds,
  isValidDocumentDateString,
  listDocumentExpiryPolicies,
  parseDocumentDate,
  setDocumentExpiryPolicy,
} from './expiry';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe('classifyExpiry', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');

  it('is unknown for a null date - never fabricated', () => {
    expect(classifyExpiry(null, now)).toEqual({
      urgency: 'unknown',
      daysRemaining: null,
      thresholdCrossed: null,
    });
  });

  it('is ok when comfortably beyond every threshold', () => {
    const result = classifyExpiry(new Date(now.getTime() + 200 * DAY_MS), now);
    expect(result.urgency).toBe('ok');
    expect(result.daysRemaining).toBe(200);
    expect(result.thresholdCrossed).toBeNull();
  });

  it('is expired once the date has passed, with a negative daysRemaining', () => {
    const result = classifyExpiry(new Date(now.getTime() - 5 * DAY_MS), now);
    expect(result.urgency).toBe('expired');
    expect(result.daysRemaining).toBe(-5);
    expect(result.thresholdCrossed).toBeNull();
  });

  it('is a reminder at exactly the 90-day default threshold, crossing 90 not 60', () => {
    const result = classifyExpiry(new Date(now.getTime() + 90 * DAY_MS), now);
    expect(result.urgency).toBe('reminder');
    expect(result.thresholdCrossed).toBe(90);
  });

  it('crosses the nearest still-uncrossed threshold, not the widest one', () => {
    const result = classifyExpiry(new Date(now.getTime() + 45 * DAY_MS), now);
    expect(result.urgency).toBe('reminder');
    expect(result.thresholdCrossed).toBe(60);
  });

  it('crosses the 0-day ("expiry date") threshold on the day itself', () => {
    const result = classifyExpiry(now, now);
    expect(result.urgency).toBe('reminder');
    expect(result.daysRemaining).toBe(0);
    expect(result.thresholdCrossed).toBe(0);
  });

  it('honors a docType-specific override ladder instead of the default', () => {
    // 10 days out: inside a narrow [14, 3] override, so a reminder fires.
    const narrow = classifyExpiry(new Date(now.getTime() + 10 * DAY_MS), now, [14, 3]);
    expect(narrow.urgency).toBe('reminder');
    expect(narrow.thresholdCrossed).toBe(14);

    // 50 days out: beyond the narrow override's own widest threshold (ok),
    // but still inside the wider platform default's 90-day window (reminder)
    // - the same date, two different verdicts, purely from which ladder is in effect.
    const wideDefault = classifyExpiry(new Date(now.getTime() + 50 * DAY_MS), now);
    expect(wideDefault.urgency).toBe('reminder');
    const narrowOverride = classifyExpiry(new Date(now.getTime() + 50 * DAY_MS), now, [14, 3]);
    expect(narrowOverride.urgency).toBe('ok');
  });
});

describe('classifyStaleness', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');

  it('is not_applicable when the requirement carries no freshness rule', () => {
    expect(classifyStaleness(new Date(now.getTime() - 400 * DAY_MS), null, now)).toEqual({
      status: 'not_applicable',
      ageDays: null,
    });
  });

  it('is unknown when a rule exists but the document has no recorded date - never fabricated', () => {
    expect(classifyStaleness(null, 90, now)).toEqual({ status: 'unknown', ageDays: null });
  });

  it('is fresh when the document date is inside the window', () => {
    const result = classifyStaleness(new Date(now.getTime() - 30 * DAY_MS), 90, now);
    expect(result.status).toBe('fresh');
    expect(result.ageDays).toBe(30);
  });

  it('is stale once the document date falls outside the window', () => {
    const result = classifyStaleness(new Date(now.getTime() - 91 * DAY_MS), 90, now);
    expect(result.status).toBe('stale');
    expect(result.ageDays).toBe(91);
  });

  it('treats exactly maxAgeDays old as still fresh (boundary is inclusive)', () => {
    const result = classifyStaleness(new Date(now.getTime() - 90 * DAY_MS), 90, now);
    expect(result.status).toBe('fresh');
  });
});

describe('parseDocumentDate / isValidDocumentDateString', () => {
  it('parses a strict YYYY-MM-DD string', () => {
    const parsed = parseDocumentDate('2025-06-15');
    expect(parsed?.toISOString()).toBe('2025-06-15T00:00:00.000Z');
  });

  it('rejects malformed or absent input rather than guessing', () => {
    expect(parseDocumentDate(null)).toBeNull();
    expect(parseDocumentDate(undefined)).toBeNull();
    expect(parseDocumentDate('')).toBeNull();
    expect(parseDocumentDate('15 June 2025')).toBeNull();
    expect(parseDocumentDate('2025/06/15')).toBeNull();
    expect(parseDocumentDate('not-a-date')).toBeNull();
  });

  it('accepts a valid past date and rejects a future one', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    expect(isValidDocumentDateString('2025-06-15', now)).toBe(true);
    expect(isValidDocumentDateString('2026-06-15', now)).toBe(false);
  });

  it('accepts today itself as valid', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    expect(isValidDocumentDateString('2026-01-01', now)).toBe(true);
  });
});

describe('document expiry policy (DB-backed)', () => {
  let db: Db;
  let actorAccountId: string;

  beforeEach(async () => {
    db = await freshDb();
    const provisioned = await provisionAccount(db, { email: 'admin@example.com' });
    if (!isOk(provisioned)) throw new Error('provision failed');
    actorAccountId = provisioned.value.id;
  });

  it('falls back to the platform default when no override or docType is configured', async () => {
    expect(await getReminderThresholds(db, null)).toEqual(DEFAULT_EXPIRY_REMINDER_THRESHOLD_DAYS);
    expect(await getReminderThresholds(db, 'passport')).toEqual(
      DEFAULT_EXPIRY_REMINDER_THRESHOLD_DAYS,
    );
  });

  it('rejects an empty docType or a malformed threshold list', async () => {
    const badDocType = await setDocumentExpiryPolicy(db, {
      actorAccountId,
      docType: '   ',
      thresholdDays: [30],
    });
    expect(badDocType.ok).toBe(false);

    const badThresholds = await setDocumentExpiryPolicy(db, {
      actorAccountId,
      docType: 'bank_statement',
      thresholdDays: [],
    });
    expect(badThresholds.ok).toBe(false);

    const negativeThreshold = await setDocumentExpiryPolicy(db, {
      actorAccountId,
      docType: 'bank_statement',
      thresholdDays: [30, -1],
    });
    expect(negativeThreshold.ok).toBe(false);
  });

  it('saves an override, applies it, de-duplicates and sorts descending, and lets a later call replace it', async () => {
    const saved = await setDocumentExpiryPolicy(db, {
      actorAccountId,
      docType: 'bank_statement',
      thresholdDays: [7, 30, 30, 0],
    });
    expect(saved.ok).toBe(true);
    if (saved.ok) expect(saved.value.thresholdDays).toEqual([30, 7, 0]);

    expect(await getReminderThresholds(db, 'bank_statement')).toEqual([30, 7, 0]);
    // An unrelated docType is unaffected.
    expect(await getReminderThresholds(db, 'passport')).toEqual(
      DEFAULT_EXPIRY_REMINDER_THRESHOLD_DAYS,
    );

    const replaced = await setDocumentExpiryPolicy(db, {
      actorAccountId,
      docType: 'bank_statement',
      thresholdDays: [14],
    });
    expect(replaced.ok).toBe(true);
    expect(await getReminderThresholds(db, 'bank_statement')).toEqual([14]);

    const policies = await listDocumentExpiryPolicies(db);
    expect(policies).toHaveLength(1);
    expect(policies[0]?.docType).toBe('bank_statement');
  });
});
