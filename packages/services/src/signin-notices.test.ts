import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { neonAccountExists, provisionNeonAccount } from './accounts-neon';
import type { Db } from './db';
import { SIGNIN_NOTICES_EVENT, acknowledgeSignInNotices } from './signin-notices';
import { SIGNUP_PRIVACY_VERSION, SIGNUP_TERMS_VERSION } from './signup-notices';

const now = new Date('2026-11-17T10:00:00Z');
const input = {
  neonUserId: 'neon-user-1',
  termsVersion: SIGNUP_TERMS_VERSION,
  privacyVersion: SIGNUP_PRIVACY_VERSION,
};

let db: Db;
beforeEach(async () => {
  db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
});

describe('agreement to the notices at sign-in', () => {
  it('records the identity and the exact versions in the audit log, linked to no account yet', async () => {
    expect(await acknowledgeSignInNotices(db, input, now)).toBe(true);
    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, SIGNIN_NOTICES_EVENT));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorAccountId: null,
      resourceType: 'neon_user',
      resourceId: 'neon-user-1',
      result: 'ALLOWED',
      metadata: {
        termsVersion: SIGNUP_TERMS_VERSION,
        privacyVersion: SIGNUP_PRIVACY_VERSION,
        signedIn: true,
      },
    });
    expect(await db.select().from(schema.consentRecords)).toHaveLength(0);
  });

  it('writes nothing for an old or altered version, or an unusable id', async () => {
    for (const bad of [
      { ...input, termsVersion: '2020-01-01.1' },
      { ...input, privacyVersion: 'x' },
      { ...input, neonUserId: '   ' },
      { ...input, neonUserId: 'a'.repeat(201) },
    ]) {
      expect(await acknowledgeSignInNotices(db, bad, now)).toBe(false);
    }
    expect(await db.select().from(schema.auditEvents)).toHaveLength(0);
  });

  it('allows a few tries and then stops one identity from filling the audit log', async () => {
    for (let n = 0; n < 5; n++) {
      expect(await acknowledgeSignInNotices(db, input, now)).toBe(true);
    }
    expect(await acknowledgeSignInNotices(db, input, now)).toBe(false);
    expect(await db.select().from(schema.auditEvents)).toHaveLength(5);
    // Someone else is not held back by it.
    expect(await acknowledgeSignInNotices(db, { ...input, neonUserId: 'neon-user-2' }, now)).toBe(
      true,
    );
  });
});

describe('neonAccountExists', () => {
  it('is false for a new identity and address, and true once an account holds either', async () => {
    const who = { neonUserId: 'neon-user-9', email: 'New.Person@Example.test' };
    expect(await neonAccountExists(db, who)).toBe(false);
    await provisionNeonAccount(db, { ...who, emailVerified: true });
    expect(await neonAccountExists(db, who)).toBe(true);
    // By identity alone, and by address alone (a different identity on a held address).
    expect(
      await neonAccountExists(db, { neonUserId: 'neon-user-9', email: 'other@example.test' }),
    ).toBe(true);
    expect(await neonAccountExists(db, { neonUserId: 'someone-else', email: who.email })).toBe(
      true,
    );
  });

  it('is false for empty input', async () => {
    expect(await neonAccountExists(db, { neonUserId: ' ', email: ' ' })).toBe(false);
  });
});
