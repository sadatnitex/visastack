import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { authorize } from '@visastack/policy';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import {
  SUPPORT_GRANT_MAX_DURATION_MINUTES,
  createSupportGrant,
  listActiveSupportGrantsForApplicant,
  listSupportGrantsForApplicant,
  loadSupportGrantsForPolicy,
  revokeSupportGrant,
} from './support-access';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

describe('support-access — scoped, time-limited, reasoned, approved grants (SEC-06)', () => {
  let db: Db;
  let operatorId: string;
  let approverId: string;
  let applicantOwnerId: string;
  let applicantId: string;

  beforeEach(async () => {
    db = await freshDb();
    const operator = await provisionAccount(db, { email: 'support-operator@example.com' });
    if (!isOk(operator)) throw new Error('provision failed');
    operatorId = operator.value.id;

    const approver = await provisionAccount(db, { email: 'security-admin@example.com' });
    if (!isOk(approver)) throw new Error('provision failed');
    approverId = approver.value.id;

    const owner = await provisionAccount(db, { email: 'traveller@example.com' });
    if (!isOk(owner)) throw new Error('provision failed');
    applicantOwnerId = owner.value.id;
    await setConsent(db, {
      actorAccountId: applicantOwnerId,
      accountId: applicantOwnerId,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    const applicant = await createApplicant(db, {
      actorAccountId: applicantOwnerId,
      ownerAccountId: applicantOwnerId,
      displayName: 'Traveller One',
    });
    if (!isOk(applicant)) throw new Error('applicant creation failed');
    applicantId = applicant.value.id;
  });

  it('issues a grant with a real reason, approver, and bounded expiry', async () => {
    const result = await createSupportGrant(db, {
      actorAccountId: operatorId,
      applicantId,
      actions: ['VIEW_METADATA', 'PREVIEW'],
      reason: 'Investigating ticket #4821 — applicant reports missing document',
      approvedByAccountId: approverId,
      durationMinutes: 30,
    });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.reason).toContain('#4821');
    expect(result.value.approvedByAccountId).toBe(approverId);
    expect(result.value.revokedAt).toBeNull();
    const durationMs = result.value.expiryAt.getTime() - result.value.startAt.getTime();
    expect(durationMs).toBe(30 * 60_000);
  });

  it('refuses an empty reason', async () => {
    const result = await createSupportGrant(db, {
      actorAccountId: operatorId,
      applicantId,
      actions: ['VIEW_METADATA'],
      reason: '   ',
      approvedByAccountId: approverId,
      durationMinutes: 10,
    });
    expect(isOk(result)).toBe(false);
  });

  it('refuses a self-approved grant, at the service layer', async () => {
    const result = await createSupportGrant(db, {
      actorAccountId: operatorId,
      applicantId,
      actions: ['VIEW_METADATA'],
      reason: 'self-approval attempt',
      approvedByAccountId: operatorId,
      durationMinutes: 10,
    });
    expect(isOk(result)).toBe(false);
    if (isOk(result)) return;
    expect(result.error.code).toBe('invalid');
  });

  it('the database itself refuses a self-approved grant even if a caller bypassed the service layer', async () => {
    await expect(
      db.insert(schema.supportGrants).values({
        actorAccountId: operatorId,
        applicantId,
        actions: ['VIEW_METADATA'],
        reason: 'bypassing the service layer directly',
        approvedByAccountId: operatorId,
        startAt: new Date(),
        expiryAt: new Date(Date.now() + 10 * 60_000),
      }),
    ).rejects.toThrow();
  });

  it(`refuses a duration over ${SUPPORT_GRANT_MAX_DURATION_MINUTES} minutes`, async () => {
    const result = await createSupportGrant(db, {
      actorAccountId: operatorId,
      applicantId,
      actions: ['VIEW_METADATA'],
      reason: 'trying to exceed the cap',
      approvedByAccountId: approverId,
      durationMinutes: SUPPORT_GRANT_MAX_DURATION_MINUTES + 1,
    });
    expect(isOk(result)).toBe(false);
    if (isOk(result)) return;
    expect(result.error.code).toBe('invalid');
  });

  it('the database itself refuses a duration over the maximum even if a caller bypassed the service layer', async () => {
    await expect(
      db.insert(schema.supportGrants).values({
        actorAccountId: operatorId,
        applicantId,
        actions: ['VIEW_METADATA'],
        reason: 'bypassing the service layer directly',
        approvedByAccountId: approverId,
        startAt: new Date(),
        expiryAt: new Date(Date.now() + (SUPPORT_GRANT_MAX_DURATION_MINUTES + 1) * 60_000),
      }),
    ).rejects.toThrow();
  });

  it('an active support grant lets a support_admin actor pass authorize(), scoped to the granted actions only', async () => {
    const created = await createSupportGrant(db, {
      actorAccountId: operatorId,
      applicantId,
      actions: ['VIEW_METADATA', 'PREVIEW'],
      reason: 'ticket #123',
      approvedByAccountId: approverId,
      durationMinutes: 15,
    });
    expect(isOk(created)).toBe(true);

    const grants = await loadSupportGrantsForPolicy(db, applicantId);
    expect(grants).toHaveLength(1);

    const allowedDecision = authorize({
      actor: { kind: 'support_admin', accountId: operatorId as never },
      action: 'PREVIEW',
      resource: { applicantId: applicantId as never },
      context: { now: new Date(), purpose: 'support_access', stepUpSatisfied: false, grants },
    });
    expect(allowedDecision.allowed).toBe(true);

    // Not granted DOWNLOAD_ORIGINAL — must be denied, not silently widened.
    const deniedDecision = authorize({
      actor: { kind: 'support_admin', accountId: operatorId as never },
      action: 'DOWNLOAD_ORIGINAL',
      resource: { applicantId: applicantId as never },
      context: { now: new Date(), purpose: 'support_access', stepUpSatisfied: true, grants },
    });
    expect(deniedDecision.allowed).toBe(false);
  });

  it('a different operator with no grant of their own is denied, even for the same applicant', async () => {
    await createSupportGrant(db, {
      actorAccountId: operatorId,
      applicantId,
      actions: ['VIEW_METADATA'],
      reason: 'ticket #123',
      approvedByAccountId: approverId,
      durationMinutes: 15,
    });
    const grants = await loadSupportGrantsForPolicy(db, applicantId);

    const otherOperatorDecision = authorize({
      actor: { kind: 'support_admin', accountId: 'someone-else' as never },
      action: 'VIEW_METADATA',
      resource: { applicantId: applicantId as never },
      context: { now: new Date(), purpose: 'support_access', stepUpSatisfied: false, grants },
    });
    expect(otherOperatorDecision.allowed).toBe(false);
  });

  it('an expired support grant denies access even though the row still exists', async () => {
    const created = await createSupportGrant(db, {
      actorAccountId: operatorId,
      applicantId,
      actions: ['VIEW_METADATA'],
      reason: 'ticket #123',
      approvedByAccountId: approverId,
      durationMinutes: 1,
    });
    expect(isOk(created)).toBe(true);
    const grants = await loadSupportGrantsForPolicy(db, applicantId);

    // Evaluate as if two hours have passed — well past the 1-minute grant.
    const future = new Date(Date.now() + 2 * 60 * 60_000);
    const decision = authorize({
      actor: { kind: 'support_admin', accountId: operatorId as never },
      action: 'VIEW_METADATA',
      resource: { applicantId: applicantId as never },
      context: { now: future, purpose: 'support_access', stepUpSatisfied: false, grants },
    });
    expect(decision.allowed).toBe(false);
  });

  it('revoking a grant removes it from the active/policy-loaded set immediately, and is idempotent', async () => {
    const created = await createSupportGrant(db, {
      actorAccountId: operatorId,
      applicantId,
      actions: ['VIEW_METADATA'],
      reason: 'ticket #123',
      approvedByAccountId: approverId,
      durationMinutes: 30,
    });
    expect(isOk(created)).toBe(true);
    if (!isOk(created)) return;

    const revoked = await revokeSupportGrant(db, {
      grantId: created.value.id,
      revokedByAccountId: approverId,
      reason: 'investigation concluded',
    });
    expect(isOk(revoked)).toBe(true);

    const active = await listActiveSupportGrantsForApplicant(db, applicantId);
    expect(active).toHaveLength(0);

    const grants = await loadSupportGrantsForPolicy(db, applicantId);
    expect(grants).toHaveLength(0);

    // Revoking again is a no-op success, not an error.
    const revokedAgain = await revokeSupportGrant(db, {
      grantId: created.value.id,
      revokedByAccountId: approverId,
      reason: 'already revoked',
    });
    expect(isOk(revokedAgain)).toBe(true);
  });

  it('full history remains visible after revocation, for audit review', async () => {
    const created = await createSupportGrant(db, {
      actorAccountId: operatorId,
      applicantId,
      actions: ['VIEW_METADATA'],
      reason: 'ticket #123',
      approvedByAccountId: approverId,
      durationMinutes: 30,
    });
    expect(isOk(created)).toBe(true);
    if (!isOk(created)) return;
    await revokeSupportGrant(db, {
      grantId: created.value.id,
      revokedByAccountId: approverId,
      reason: 'done',
    });

    const history = await listSupportGrantsForApplicant(db, applicantId);
    expect(history).toHaveLength(1);
    expect(history[0]?.revokedAt).not.toBeNull();
    expect(history[0]?.revokedReason).toBe('done');
  });
});
