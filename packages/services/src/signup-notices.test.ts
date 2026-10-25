import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './db';
import { pruneExpiredRateLimitBuckets } from './rate-limit';
import {
  SIGNUP_FORM_LIFETIME_MS,
  SIGNUP_PRIVACY_VERSION,
  SIGNUP_TERMS_VERSION,
  acknowledgeSignupNotices,
} from './signup-notices';

const now = Date.parse('2026-10-10T23:55:00Z');
const input = {
  formId: '58938bd1-e02f-452d-91e3-56cf91d00d3b',
  expiresAt: now + SIGNUP_FORM_LIFETIME_MS,
  termsVersion: SIGNUP_TERMS_VERSION,
  privacyVersion: SIGNUP_PRIVACY_VERSION,
};

describe('signup notice acknowledgement', () => {
  let db: Db;
  beforeEach(async () => {
    const handle = drizzle(await createMigratedPglite(), { schema });
    db = handle as unknown as Db;
  });

  it('records the exact versions without asserting verified identity or optional consent', async () => {
    expect(await acknowledgeSignupNotices(db, input, now)).toBe(true);
    const events = await db.select().from(schema.auditEvents);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: 'SIGNUP_NOTICES_ACKNOWLEDGED',
      actorAccountId: null,
      resourceId: input.formId,
      metadata: {
        termsVersion: SIGNUP_TERMS_VERSION,
        privacyVersion: SIGNUP_PRIVACY_VERSION,
        identityVerified: false,
      },
    });
    expect(await db.select().from(schema.consentRecords)).toHaveLength(0);
  });

  it('allows only one concurrent submission of a form', async () => {
    const accepted = await Promise.all([
      acknowledgeSignupNotices(db, input, now),
      acknowledgeSignupNotices(db, input, now),
    ]);
    expect(accepted.filter(Boolean)).toHaveLength(1);
    expect(await db.select().from(schema.auditEvents)).toHaveLength(1);
  });

  it('cannot replay a still-valid form across midnight or counter pruning', async () => {
    expect(await acknowledgeSignupNotices(db, input, now)).toBe(true);
    const afterMidnight = new Date('2026-10-11T00:05:00Z');
    await pruneExpiredRateLimitBuckets(db, afterMidnight);
    expect(await acknowledgeSignupNotices(db, input, afterMidnight.getTime())).toBe(false);
    expect(await db.select().from(schema.auditEvents)).toHaveLength(1);
  });

  it('refuses expired, invalid or obsolete notices before persisting anything', async () => {
    for (const bad of [
      { ...input, formId: 'not-a-form' },
      { ...input, expiresAt: now },
      { ...input, expiresAt: now + SIGNUP_FORM_LIFETIME_MS + 1 },
      { ...input, termsVersion: 'older' },
      { ...input, privacyVersion: 'older' },
    ])
      expect(await acknowledgeSignupNotices(db, bad, now)).toBe(false);
    expect(await db.select().from(schema.rateLimitBuckets)).toHaveLength(0);
    expect(await db.select().from(schema.auditEvents)).toHaveLength(0);
  });

  it('rolls back consumption when the audit cannot be persisted', async () => {
    await db.execute(sql`ALTER TABLE audit_events ADD CONSTRAINT refuse_signup_test
      CHECK (event_type <> 'SIGNUP_NOTICES_ACKNOWLEDGED')`);
    await expect(acknowledgeSignupNotices(db, input, now)).rejects.toThrow();
    expect(await db.select().from(schema.rateLimitBuckets)).toHaveLength(0);
    await db.execute(sql`ALTER TABLE audit_events DROP CONSTRAINT refuse_signup_test`);
    expect(await acknowledgeSignupNotices(db, input, now)).toBe(true);
  });
});
