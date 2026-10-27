import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { StaffScope } from './access/principal';
import { provisionAccount } from './accounts';
import { getAccountByNeonUserId, provisionNeonAccount } from './accounts-neon';
import type { Db } from './db';
import type { PlatformAuthInput } from './platform-roles';
import { seedStaffAccount, staffScopeFor } from './platform-roles.test-support';
import {
  SIGN_IN_RECOVERY_REFUSED,
  SIGN_IN_RECOVERY_WINDOW_MS,
  connectSignInToAccount,
  listSignInRecoveryRequests,
} from './sign-in-recovery';

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, { schema }) as unknown as Db;
}

async function events(db: Db, eventType: string) {
  return db.select().from(schema.auditEvents).where(eq(schema.auditEvents.eventType, eventType));
}

/** An older account with no sign-in bound, as the move to the current sign-in service left them. */
async function olderAccount(db: Db, email: string): Promise<string> {
  const account = await provisionAccount(db, { email, workosUserId: `user_${email}` });
  if (!isOk(account)) throw new Error('provision failed');
  return account.value.id;
}

/** The holder confirms the address with a new sign-in, which provisioning refuses and records. */
async function trySignIn(db: Db, email: string, neonUserId: string) {
  const result = await provisionNeonAccount(db, { email, neonUserId, emailVerified: true });
  expect(isErr(result)).toBe(true);
}

describe('sign-in recovery for older accounts', () => {
  let db: Db;
  let securityAuth: PlatformAuthInput;
  let security: StaffScope<'ACCOUNT_SIGN_IN_RECOVERY'>;
  let ownerAuth: PlatformAuthInput;
  let owner: StaffScope<'ACCOUNT_SIGN_IN_RECOVERY'>;

  beforeEach(async () => {
    db = await freshDb();
    securityAuth = await seedStaffAccount(db, 'SECURITY_ADMIN', 'security@example.com');
    security = await staffScopeFor(db, securityAuth, 'ACCOUNT_SIGN_IN_RECOVERY');
    ownerAuth = await seedStaffAccount(db, 'PLATFORM_OWNER', 'owner@example.com');
    owner = await staffScopeFor(db, ownerAuth, 'ACCOUNT_SIGN_IN_RECOVERY');
  });

  it('records the refused identity only for an older account that has no sign-in', async () => {
    const id = await olderAccount(db, 'old@example.com');
    await trySignIn(db, 'old@example.com', 'neon-old');
    const bound = await provisionNeonAccount(db, {
      email: 'bound@example.com',
      neonUserId: 'neon-a',
      emailVerified: true,
    });
    expect(isOk(bound)).toBe(true);
    await trySignIn(db, 'bound@example.com', 'neon-b');

    const conflicts = await events(db, 'ACCOUNT_IDENTITY_CONFLICT');
    expect(conflicts.map((e) => e.metadata)).toEqual([
      { kind: 'unbound_account', identity: 'neon-old' },
      { kind: 'bound_elsewhere' },
    ]);
    const listed = await listSignInRecoveryRequests(db, security);
    if (!isOk(listed)) throw new Error('expected ok');
    expect(listed.value.map((r) => [r.accountId, r.email, r.ambiguous])).toEqual([
      [id, 'old@example.com', false],
    ]);
  });

  it('connects the confirmed sign-in, audits it, and the person then reaches the older account', async () => {
    const id = await olderAccount(db, 'old@example.com');
    await trySignIn(db, 'old@example.com', 'neon-old');

    const result = await connectSignInToAccount(db, security, {
      accountId: id,
      reason: 'Checked by phone with the account holder',
      stepUpSatisfied: true,
      owner: securityAuth,
    });
    expect(isOk(result)).toBe(true);
    expect((await getAccountByNeonUserId(db, 'neon-old'))?.id).toBe(id);
    const signedIn = await provisionNeonAccount(db, {
      email: 'old@example.com',
      neonUserId: 'neon-old',
      emailVerified: true,
    });
    expect(isOk(signedIn) && signedIn.value.id).toBe(id);

    const [audit] = await events(db, 'ACCOUNT_SIGN_IN_CONNECTED');
    expect(audit).toMatchObject({
      actorAccountId: securityAuth.accountId,
      resourceId: id,
      result: 'ALLOWED',
      reason: 'Checked by phone with the account holder',
    });
    expect(Object.keys(audit?.metadata ?? {}).sort()).toEqual([
      'attemptedAt',
      'staffAccount',
      'stepUp',
    ]);
    // The identity itself is never repeated in the connection record, nor the address.
    expect(JSON.stringify(audit)).not.toContain('neon-old');
    expect(JSON.stringify(audit)).not.toContain('old@example.com');
    const listed = await listSignInRecoveryRequests(db, security);
    expect(isOk(listed) && listed.value).toEqual([]);
  });

  it('refuses without a fresh sign-in check or a reason, and changes nothing', async () => {
    const id = await olderAccount(db, 'old@example.com');
    await trySignIn(db, 'old@example.com', 'neon-old');
    const noStepUp = await connectSignInToAccount(db, security, {
      accountId: id,
      reason: 'checked',
      stepUpSatisfied: false,
      owner: securityAuth,
    });
    expect(isErr(noStepUp) && noStepUp.error.code).toBe('step_up_required');
    const noReason = await connectSignInToAccount(db, security, {
      accountId: id,
      reason: '  ',
      stepUpSatisfied: true,
      owner: securityAuth,
    });
    expect(isErr(noReason) && noReason.error.code).toBe('invalid');
    expect(await getAccountByNeonUserId(db, 'neon-old')).toBeUndefined();
    expect(await events(db, 'ACCOUNT_SIGN_IN_CONNECTED')).toEqual([]);
  });

  it('refuses an attempt older than the window', async () => {
    const id = await olderAccount(db, 'old@example.com');
    await trySignIn(db, 'old@example.com', 'neon-old');
    const later = new Date(Date.now() + SIGN_IN_RECOVERY_WINDOW_MS + 60_000);
    const result = await connectSignInToAccount(db, security, {
      accountId: id,
      reason: 'checked',
      stepUpSatisfied: true,
      owner: securityAuth,
      now: later,
    });
    expect(isErr(result) && result.error.message).toBe(SIGN_IN_RECOVERY_REFUSED.noAttempt);
    const listed = await listSignInRecoveryRequests(db, security, later);
    expect(isOk(listed) && listed.value).toEqual([]);
  });

  it('refuses when two different sign-ins tried to reach the same account', async () => {
    const id = await olderAccount(db, 'old@example.com');
    await trySignIn(db, 'old@example.com', 'neon-one');
    await trySignIn(db, 'old@example.com', 'neon-two');
    const listed = await listSignInRecoveryRequests(db, security);
    expect(isOk(listed) && listed.value[0]?.ambiguous).toBe(true);
    const result = await connectSignInToAccount(db, security, {
      accountId: id,
      reason: 'checked',
      stepUpSatisfied: true,
      owner: securityAuth,
    });
    expect(isErr(result) && result.error.message).toBe(SIGN_IN_RECOVERY_REFUSED.ambiguous);
  });

  it('lets only a platform owner connect an account that holds a platform role', async () => {
    const id = await olderAccount(db, 'old-staff@example.com');
    await db
      .insert(schema.platformRoles)
      .values({ accountId: id, role: 'PLATFORM_OWNER', reason: 'test setup' });
    await trySignIn(db, 'old-staff@example.com', 'neon-staff');

    const bySecurity = await connectSignInToAccount(db, security, {
      accountId: id,
      reason: 'checked',
      stepUpSatisfied: true,
      owner: securityAuth,
    });
    expect(isErr(bySecurity) && bySecurity.error.message).toBe(SIGN_IN_RECOVERY_REFUSED.ownerOnly);
    expect(await getAccountByNeonUserId(db, 'neon-staff')).toBeUndefined();

    // Another person's owner check cannot be borrowed.
    const borrowed = await connectSignInToAccount(db, security, {
      accountId: id,
      reason: 'checked',
      stepUpSatisfied: true,
      owner: ownerAuth,
    });
    expect(isErr(borrowed) && borrowed.error.code).toBe('forbidden');

    const byOwner = await connectSignInToAccount(db, owner, {
      accountId: id,
      reason: 'checked',
      stepUpSatisfied: true,
      owner: ownerAuth,
    });
    expect(isOk(byOwner)).toBe(true);
    const [audit] = await events(db, 'ACCOUNT_SIGN_IN_CONNECTED');
    expect(audit?.metadata).toMatchObject({ staffAccount: true });
  });

  it('refuses an account that already has a sign-in, and a forged or other-action scope', async () => {
    const bound = await provisionNeonAccount(db, {
      email: 'bound@example.com',
      neonUserId: 'neon-a',
      emailVerified: true,
    });
    if (!isOk(bound)) throw new Error('expected ok');
    await trySignIn(db, 'bound@example.com', 'neon-b');
    const result = await connectSignInToAccount(db, security, {
      accountId: bound.value.id,
      reason: 'checked',
      stepUpSatisfied: true,
      owner: securityAuth,
    });
    expect(isErr(result) && result.error.message).toBe(SIGN_IN_RECOVERY_REFUSED.alreadyConnected);

    const forged = {
      kind: 'staff',
      accountId: securityAuth.accountId,
      platformAction: 'ACCOUNT_SIGN_IN_RECOVERY',
      verifiedAt: new Date(),
    } as unknown as StaffScope<'ACCOUNT_SIGN_IN_RECOVERY'>;
    expect(isErr(await listSignInRecoveryRequests(db, forged))).toBe(true);
    const other = (await staffScopeFor(
      db,
      securityAuth,
      'AUDIT_TRAIL_VIEW',
    )) as unknown as StaffScope<'ACCOUNT_SIGN_IN_RECOVERY'>;
    expect(isErr(await listSignInRecoveryRequests(db, other))).toBe(true);
  });

  it('a support admin cannot open sign-in recovery at all', async () => {
    const { staffPrincipal } = await import('./access/principal');
    const support = await seedStaffAccount(db, 'SUPPORT_ADMIN', 'support@example.com');
    const minted = await staffPrincipal(db, support, 'ACCOUNT_SIGN_IN_RECOVERY');
    expect(minted.ok).toBe(false);
  });
});
