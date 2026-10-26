import { randomBytes } from 'node:crypto';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import type { Db } from './db';
import { grantPlatformRole } from './platform-roles';
import { seedStaffAccount } from './platform-roles.test-support';
import type { KeyManagementPort } from './ports';
import {
  confirmStaffFactorEnrolment,
  getStaffFactorStatus,
  isStaffFactorFresh,
  regenerateStaffRecoveryCodes,
  resetStaffSecondFactor,
  revealPendingStaffEnrolment,
  staffFactorCoverage,
  startStaffFactorEnrolment,
  verifyStaffFactor,
} from './staff-second-factor';
import { base32Decode, totp } from './totp';

async function freshDb(): Promise<Db> {
  return drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
}

function fakeKeyPort(): KeyManagementPort {
  const masterKey = Buffer.alloc(32, 9);
  return {
    currentKeyVersion: () => 'test-v1',
    async generateDataKey() {
      return {
        keyVersion: 'test-v1',
        plaintextDataKey: randomBytes(32),
        wrappedDataKey: masterKey,
      };
    },
    async unwrapDataKey() {
      return masterKey;
    },
  };
}

/** The secret an authenticator app would hold, read back from the setup details. */
function secretOf(manualKey: string): Uint8Array {
  return base32Decode(manualKey);
}

const MIN = 60_000;
const T0 = new Date('2026-10-26T12:00:00Z');

describe('staff second factor (S3)', () => {
  let db: Db;
  let port: KeyManagementPort;
  beforeEach(async () => {
    db = await freshDb();
    port = fakeKeyPort();
  });

  async function enrolled(email: string, now = T0) {
    const actor = await seedStaffAccount(db, 'SECURITY_ADMIN', email);
    const started = await startStaffFactorEnrolment(db, port, { actor, stepUpSatisfied: true });
    if (!isOk(started)) throw new Error('start failed');
    const secret = secretOf(started.value.manualKey);
    const confirmed = await confirmStaffFactorEnrolment(db, port, {
      actor,
      code: totp(secret, now.getTime()),
      sessionRef: 'session-a',
      now,
    });
    if (!isOk(confirmed)) throw new Error(`confirm failed: ${confirmed.error.message}`);
    return { actor, secret, codes: confirmed.value.recoveryCodes };
  }

  it('stores no readable secret, and shows ten recovery codes once', async () => {
    const { actor, codes } = await enrolled('enrol@example.com');
    expect(codes).toHaveLength(10);
    const rows = await db.select().from(schema.staffSecondFactors);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    const dump = JSON.stringify(row);
    for (const code of codes) expect(dump).not.toContain(code.replace(/-/g, ''));
    expect(row?.recoveryCodeHashes).toHaveLength(10);
    expect(row?.recoveryCodeHashes.every((hash) => /^[0-9a-f]{64}$/.test(hash))).toBe(true);
    expect(row?.status).toBe('ACTIVE');
    const status = await getStaffFactorStatus(db, actor.accountId);
    expect(status).toMatchObject({ state: 'active', recoveryCodesLeft: 10 });
  });

  it('keeps the secret unreadable in the row and unusable if copied to another account', async () => {
    const a = await enrolled('copy-a@example.com');
    const b = await seedStaffAccount(db, 'SECURITY_ADMIN', 'copy-b@example.com');
    const started = await startStaffFactorEnrolment(db, port, { actor: b, stepUpSatisfied: true });
    expect(isOk(started)).toBe(true);
    const [rowA] = await db
      .select()
      .from(schema.staffSecondFactors)
      .where(eq(schema.staffSecondFactors.accountId, a.actor.accountId));
    // Copy A's encrypted secret onto B's pending row: B can no longer reveal it.
    await db
      .update(schema.staffSecondFactors)
      .set({
        secretCiphertext: rowA?.secretCiphertext ?? Buffer.alloc(0),
        secretNonce: rowA?.secretNonce ?? Buffer.alloc(0),
      })
      .where(eq(schema.staffSecondFactors.accountId, b.accountId));
    await expect(revealPendingStaffEnrolment(db, port, b)).rejects.toThrow();
    const plain = Buffer.from(a.secret).toString('base64');
    expect(JSON.stringify(rowA)).not.toContain(plain);
  });

  it('refuses setup without a recent sign-in, for non-staff, and over an active factor', async () => {
    const actor = await seedStaffAccount(db, 'SECURITY_ADMIN', 'refuse@example.com');
    const stale = await startStaffFactorEnrolment(db, port, { actor, stepUpSatisfied: false });
    expect(isErr(stale) && stale.error.code).toBe('step_up_required');

    const plain = await provisionAccount(db, { email: 'plain@example.com' });
    if (!isOk(plain)) throw new Error('provision');
    const notStaff = await startStaffFactorEnrolment(db, port, {
      actor: { accountId: plain.value.id, email: 'plain@example.com', bootstrapEmails: [] },
      stepUpSatisfied: true,
    });
    expect(isErr(notStaff) && notStaff.error.code).toBe('forbidden');

    const done = await enrolled('active@example.com');
    const again = await startStaffFactorEnrolment(db, port, {
      actor: done.actor,
      stepUpSatisfied: true,
    });
    expect(isErr(again) && again.error.code).toBe('invalid');
    // The working authenticator is untouched.
    expect((await getStaffFactorStatus(db, done.actor.accountId)).state).toBe('active');
  });

  it('lets the bootstrap address enrol while the roles table is empty', async () => {
    const boot = await provisionAccount(db, { email: 'boot@example.com' });
    if (!isOk(boot)) throw new Error('provision');
    const actor = {
      accountId: boot.value.id,
      email: 'boot@example.com',
      bootstrapEmails: ['boot@example.com'],
    };
    expect(isOk(await startStaffFactorEnrolment(db, port, { actor, stepUpSatisfied: true }))).toBe(
      true,
    );
  });

  it('refuses a wrong first code and leaves the setup pending', async () => {
    const actor = await seedStaffAccount(db, 'SECURITY_ADMIN', 'wrong@example.com');
    await startStaffFactorEnrolment(db, port, { actor, stepUpSatisfied: true });
    const result = await confirmStaffFactorEnrolment(db, port, {
      actor,
      code: '000000',
      sessionRef: 's',
      now: T0,
    });
    expect(isErr(result) && result.error.code).toBe('invalid');
    expect((await getStaffFactorStatus(db, actor.accountId)).state).toBe('pending');
  });

  it('accepts a correct code once and refuses the same code, or an older one, again', async () => {
    const { actor, secret } = await enrolled('replay@example.com');
    const later = new Date(T0.getTime() + 2 * MIN);
    const code = totp(secret, later.getTime());
    const first = await verifyStaffFactor(db, port, {
      accountId: actor.accountId,
      code,
      sessionRef: 'session-b',
      now: later,
    });
    expect(isOk(first)).toBe(true);
    const replay = await verifyStaffFactor(db, port, {
      accountId: actor.accountId,
      code,
      sessionRef: 'session-c',
      now: later,
    });
    expect(isErr(replay) && replay.error.code).toBe('invalid');
    // An older step inside the window is also refused.
    const older = await verifyStaffFactor(db, port, {
      accountId: actor.accountId,
      code: totp(secret, later.getTime() - 30_000),
      sessionRef: 'session-c',
      now: later,
    });
    expect(isErr(older)).toBe(true);
    // The replay did not move the proof to the attacker's session.
    expect(
      await isStaffFactorFresh(db, {
        accountId: actor.accountId,
        sessionRef: 'session-c',
        maxAgeMs: null,
        now: later,
      }),
    ).toBe(false);
  });

  it('lets only one of two parallel uses of the same code win', async () => {
    const { actor, secret } = await enrolled('parallel@example.com');
    const later = new Date(T0.getTime() + 3 * MIN);
    const code = totp(secret, later.getTime());
    const results = await Promise.all(
      ['s1', 's2'].map((sessionRef) =>
        verifyStaffFactor(db, port, { accountId: actor.accountId, code, sessionRef, now: later }),
      ),
    );
    expect(results.filter((r) => isOk(r))).toHaveLength(1);
  });

  it('proves freshness only for the same sign-in and only for five minutes', async () => {
    const { actor } = await enrolled('fresh@example.com');
    const check = (sessionRef: string, ms: number, maxAgeMs: number | null) =>
      isStaffFactorFresh(db, {
        accountId: actor.accountId,
        sessionRef,
        maxAgeMs,
        now: new Date(T0.getTime() + ms),
      });
    expect(await check('session-a', 0, 5 * MIN)).toBe(true);
    expect(await check('session-a', 5 * MIN, 5 * MIN)).toBe(true);
    expect(await check('session-a', 5 * MIN + 1000, 5 * MIN)).toBe(false);
    expect(await check('session-a', 60 * MIN, null)).toBe(true);
    expect(await check('another-session', 0, 5 * MIN)).toBe(false);
    expect(await check('another-session', 0, null)).toBe(false);
  });

  it('counts guesses before checking: the sixth try fails even with the right code', async () => {
    const { actor, secret } = await enrolled('lock@example.com');
    const later = new Date(T0.getTime() + 10 * MIN);
    for (let i = 0; i < 5; i += 1) {
      const wrong = await verifyStaffFactor(db, port, {
        accountId: actor.accountId,
        code: '000000',
        sessionRef: 'x',
        now: later,
      });
      expect(isErr(wrong) && wrong.error.code).toBe('invalid');
    }
    const locked = await verifyStaffFactor(db, port, {
      accountId: actor.accountId,
      code: totp(secret, later.getTime()),
      sessionRef: 'x',
      now: later,
    });
    expect(isErr(locked) && locked.error.code).toBe('rate_limited');
    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'STAFF_SECOND_FACTOR_LOCKED'));
    expect(events.length).toBeGreaterThan(0);
  });

  it('bounds parallel guesses and gives a success its count back', async () => {
    const { actor, secret } = await enrolled('burst@example.com');
    const later = new Date(T0.getTime() + 20 * MIN);
    const burst = await Promise.all(
      Array.from({ length: 12 }, () =>
        verifyStaffFactor(db, port, {
          accountId: actor.accountId,
          code: '111111',
          sessionRef: 'x',
          now: later,
        }),
      ),
    );
    expect(burst.filter((r) => isErr(r) && r.error.code === 'invalid').length).toBeLessThanOrEqual(
      5,
    );

    // A different account that succeeds repeatedly never builds up a count.
    const good = await enrolled('refund@example.com');
    let at = T0.getTime();
    for (let i = 0; i < 8; i += 1) {
      at += 31_000; // a new 30 second step each time, all inside one five minute window
      const result = await verifyStaffFactor(db, port, {
        accountId: good.actor.accountId,
        code: totp(good.secret, at),
        sessionRef: 'ok',
        now: new Date(at),
      });
      expect(isOk(result)).toBe(true);
    }
  });

  it('uses a recovery code once, and shows how many are left', async () => {
    const { actor, codes } = await enrolled('recover@example.com');
    const later = new Date(T0.getTime() + 30 * MIN);
    const code = (codes[0] ?? '').toLowerCase().replace(/-/g, ' ');
    const used = await verifyStaffFactor(db, port, {
      accountId: actor.accountId,
      code,
      sessionRef: 'r1',
      now: later,
    });
    expect(isOk(used) && used.value).toEqual({ method: 'recovery', recoveryCodesLeft: 9 });
    const again = await verifyStaffFactor(db, port, {
      accountId: actor.accountId,
      code,
      sessionRef: 'r2',
      now: later,
    });
    expect(isErr(again)).toBe(true);
    expect(
      await isStaffFactorFresh(db, {
        accountId: actor.accountId,
        sessionRef: 'r1',
        maxAgeMs: 5 * MIN,
        now: later,
      }),
    ).toBe(true);
  });

  it('lets only one of two parallel uses of the same recovery code win', async () => {
    const { actor, codes } = await enrolled('rparallel@example.com');
    const later = new Date(T0.getTime() + 40 * MIN);
    const results = await Promise.all(
      ['a', 'b'].map((sessionRef) =>
        verifyStaffFactor(db, port, {
          accountId: actor.accountId,
          code: codes[1] ?? '',
          sessionRef,
          now: later,
        }),
      ),
    );
    expect(results.filter((r) => isOk(r))).toHaveLength(1);
  });

  it('replaces the recovery codes only after a fresh proof', async () => {
    const { actor, codes } = await enrolled('regen@example.com');
    const stale = await regenerateStaffRecoveryCodes(db, {
      accountId: actor.accountId,
      sessionRef: 'session-a',
      now: new Date(T0.getTime() + 30 * MIN),
    });
    expect(isErr(stale) && stale.error.code).toBe('step_up_required');
    const fresh = await regenerateStaffRecoveryCodes(db, {
      accountId: actor.accountId,
      sessionRef: 'session-a',
      now: new Date(T0.getTime() + MIN),
    });
    expect(isOk(fresh)).toBe(true);
    const old = await verifyStaffFactor(db, port, {
      accountId: actor.accountId,
      code: codes[0] ?? '',
      sessionRef: 'n',
      now: new Date(T0.getTime() + 2 * MIN),
    });
    expect(isErr(old)).toBe(true);
  });

  describe('reset by a platform owner', () => {
    async function owner() {
      const email = 'owner@example.com';
      const account = await provisionAccount(db, { email });
      if (!isOk(account)) throw new Error('provision');
      const auth = { accountId: account.value.id, email, bootstrapEmails: [email] };
      await grantPlatformRole(db, {
        actor: auth,
        targetAccountId: account.value.id,
        role: 'PLATFORM_OWNER',
        reason: 'bootstrap',
        stepUpSatisfied: true,
      });
      return { ...auth, bootstrapEmails: [] };
    }

    it('clears another person, with a reason, and records it', async () => {
      const boss = await owner();
      const { actor } = await enrolled('target@example.com');
      const done = await resetStaffSecondFactor(db, {
        actor: boss,
        targetAccountId: actor.accountId,
        reason: 'Lost phone, no backup codes',
        stepUpSatisfied: true,
      });
      expect(isOk(done)).toBe(true);
      expect((await getStaffFactorStatus(db, actor.accountId)).state).toBe('none');
      const [event] = await db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.eventType, 'STAFF_SECOND_FACTOR_RESET'));
      expect(event?.actorAccountId).toBe(boss.accountId);
      expect(event?.resourceId).toBe(actor.accountId);
      expect(event?.reason).toBe('Lost phone, no backup codes');
    });

    it('refuses a non-owner, your own account, a missing reason and a stale sign-in', async () => {
      const boss = await owner();
      const target = await enrolled('target2@example.com');
      const base = {
        targetAccountId: target.actor.accountId,
        reason: 'why',
        stepUpSatisfied: true,
      };
      expect(isErr(await resetStaffSecondFactor(db, { ...base, actor: target.actor }))).toBe(true);
      const own = await resetStaffSecondFactor(db, {
        ...base,
        actor: boss,
        targetAccountId: boss.accountId,
      });
      expect(isErr(own) && own.error.code).toBe('forbidden');
      const noReason = await resetStaffSecondFactor(db, { ...base, actor: boss, reason: '  ' });
      expect(isErr(noReason) && noReason.error.code).toBe('invalid');
      const stale = await resetStaffSecondFactor(db, {
        ...base,
        actor: boss,
        stepUpSatisfied: false,
      });
      expect(isErr(stale) && stale.error.code).toBe('step_up_required');
      expect((await getStaffFactorStatus(db, target.actor.accountId)).state).toBe('active');
    });
  });

  it('writes audit rows with kinds and counts only', async () => {
    const { actor, secret, codes } = await enrolled('audit@example.com');
    await verifyStaffFactor(db, port, {
      accountId: actor.accountId,
      code: '123456',
      sessionRef: 'ref-secret-value',
      now: new Date(T0.getTime() + 50 * MIN),
    });
    const events = await db.select().from(schema.auditEvents);
    const mine = events.filter((event) => event.resourceType === 'staff_second_factor');
    expect(mine.length).toBeGreaterThanOrEqual(2);
    const dump = JSON.stringify(mine);
    expect(dump).not.toContain('ref-secret-value');
    expect(dump).not.toContain('123456');
    expect(dump).not.toContain(Buffer.from(secret).toString('base64'));
    for (const code of codes) expect(dump).not.toContain(code.replace(/-/g, ''));
  });

  it('reports the table as unavailable, and refuses everything, while it is missing', async () => {
    const actor = await seedStaffAccount(db, 'SECURITY_ADMIN', 'missing@example.com');
    await db.execute('drop table staff_second_factors' as never);
    expect(await getStaffFactorStatus(db, actor.accountId)).toEqual({ state: 'unavailable' });
    expect(
      await isStaffFactorFresh(db, { accountId: actor.accountId, sessionRef: 's', maxAgeMs: null }),
    ).toBe(false);
    const started = await startStaffFactorEnrolment(db, port, { actor, stepUpSatisfied: true });
    expect(isErr(started)).toBe(true);
    const verified = await verifyStaffFactor(db, port, {
      accountId: actor.accountId,
      code: '123456',
      sessionRef: 's',
    });
    expect(isErr(verified)).toBe(true);
    expect(await staffFactorCoverage(db)).toBeNull();
  });

  it('counts how many staff have set up an authenticator', async () => {
    await enrolled('cover-a@example.com');
    await seedStaffAccount(db, 'SUPPORT_ADMIN', 'cover-b@example.com');
    expect(await staffFactorCoverage(db)).toEqual({ staff: 2, enrolled: 1 });
  });
});
