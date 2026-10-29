import { createHash, randomBytes } from 'node:crypto';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAiConnection,
  exchangeAiAuthorizationCode,
  refreshAiTokens,
  resolveAiAccessToken,
} from './access/ai-connection';
import {
  changeAiConnection,
  getAiConnection,
  turnOffAiConnection,
} from './access/ai-connection-manage';
import { accountPrincipal } from './access/principal';
import { requireAccess } from './access/require-access';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { reconcileRestoredBranch } from './backup-reconciliation';
import { sweepCaseRetentionPurge } from './case-retention';
import { setConsent } from './consent';
import { type Db, first } from './db';
import { executeAccountDeletion, requestAccountDeletion } from './deletion';
import { addDocumentVersion, registerDocument } from './documents';
import { enqueueErasureJob, runErasureWorker } from './erasure';
import { placeLegalHold, releaseLegalHold } from './legal-hold';
import { createMission, transitionMission } from './missions';
import {
  createOrganization,
  reviewOrganization,
  suspendOrganization,
  terminateOrganization,
} from './organizations';
import { grantPlatformRole, revokePlatformRole } from './platform-roles';
import { loadGrantsForPolicy } from './sharing';
import type {
  BlobStore,
  ListObjectsPage,
  PutObjectInput,
  StorageBucket,
  StoredBytes,
} from './storage';

/** Minimal in-memory blob store -- just enough for a real `runErasureWorker` pass to succeed; no failure injection needed here (see erasure.test.ts for that). */
class FakeBlobStore implements BlobStore {
  private readonly objects = new Map<string, StoredBytes>();
  async putObject(input: PutObjectInput): Promise<void> {
    this.objects.set(input.objectKey, { contentType: input.contentType, bytes: input.bytes });
  }
  async getObject(objectKey: string): Promise<StoredBytes | undefined> {
    return this.objects.get(objectKey);
  }
  async deleteObject(_bucket: StorageBucket, objectKey: string): Promise<void> {
    this.objects.delete(objectKey);
  }
  async listObjectKeys(): Promise<ListObjectsPage> {
    return { objectKeys: [...this.objects.keys()], cursor: undefined };
  }
}

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  const db = drizzle(client, { schema });
  return db as unknown as Db;
}

/** Mirrors one row from `oldDb` onto `newDb`, preserving its id exactly -- simulating "this row existed identically on both branches at the restore point." */
async function mirrorRow<T extends Record<string, unknown>>(
  newDb: Db,
  table: Parameters<Db['insert']>[0],
  row: T,
): Promise<void> {
  await newDb.insert(table).values(row);
}

async function seedAccount(db: Db, email: string): Promise<typeof schema.accounts.$inferSelect> {
  const result = await provisionAccount(db, { email });
  if (!isOk(result)) throw new Error('provision failed');
  return result.value;
}

async function seedApplicant(
  db: Db,
  ownerAccountId: string,
): Promise<typeof schema.applicants.$inferSelect> {
  await setConsent(db, {
    actorAccountId: ownerAccountId,
    accountId: ownerAccountId,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  const result = await createApplicant(db, {
    actorAccountId: ownerAccountId,
    ownerAccountId,
    displayName: 'Traveller',
  });
  if (!isOk(result)) throw new Error('applicant failed');
  const row = first(
    await db.select().from(schema.applicants).where(eq(schema.applicants.id, result.value.id)),
  );
  if (!row) throw new Error('applicant row missing');
  return row;
}

const RESTORE_POINT = new Date('2026-01-01T00:00:00.000Z');
const AFTER = new Date('2026-01-01T01:00:00.000Z');
const BEFORE = new Date('2025-12-31T23:00:00.000Z');

/** Indexes by a runtime variable, never a literal -- satisfies both TS4111 and Biome's useLiteralKeys. */
function setEnv(name: string, value: string): void {
  process.env[name] = value;
}
function unsetEnv(name: string): void {
  delete process.env[name];
}

describe('reconcileRestoredBranch (master directive Part 7 §15: backup resurrection protection)', () => {
  let oldDb: Db;
  let newDb: Db;

  beforeEach(async () => {
    oldDb = await freshDb();
    newDb = await freshDb();
  });

  it('forces a grant revoked after the restore point, and never touches one revoked before it', async () => {
    const owner = await seedAccount(oldDb, 'grant-owner@example.com');
    await mirrorRow(newDb, schema.accounts, owner);
    const applicant = await seedApplicant(oldDb, owner.id);
    await mirrorRow(newDb, schema.applicants, applicant);
    const org = await seedAccount(oldDb, 'grant-org-owner@example.com');
    await mirrorRow(newDb, schema.accounts, org);

    // Grant A: still ACTIVE on both at the restore point, revoked on OLD after it.
    const grantA = { id: crypto.randomUUID() };
    await oldDb.insert(schema.grants).values({
      id: grantA.id,
      applicantId: applicant.id,
      recipientAccountId: org.id,
      recipientOrganizationId: null,
      status: 'ACTIVE',
      actions: ['MANAGE'],
      purpose: 'test',
      createdAt: BEFORE,
      updatedAt: BEFORE,
    });
    const [grantARow] = await oldDb
      .select()
      .from(schema.grants)
      .where(eq(schema.grants.id, grantA.id));
    if (!grantARow) throw new Error('setup');
    await mirrorRow(newDb, schema.grants, grantARow);
    await oldDb
      .update(schema.grants)
      .set({ status: 'REVOKED', updatedAt: AFTER })
      .where(eq(schema.grants.id, grantA.id));
    await oldDb.insert(schema.auditEvents).values({
      occurredAt: AFTER,
      eventType: 'GRANT_REVOKED',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'grant',
      resourceId: grantA.id,
      hash: 'test-hash-a',
    });

    // Grant B: revoked BEFORE the restore point -- the restored branch
    // already reflects this correctly; the event must never be replayed
    // (it is outside the query window, but this also proves a pre-restore
    // event alone would not accidentally match).
    const grantB = { id: crypto.randomUUID() };
    await oldDb.insert(schema.grants).values({
      id: grantB.id,
      applicantId: applicant.id,
      recipientAccountId: org.id,
      recipientOrganizationId: null,
      status: 'REVOKED',
      actions: ['MANAGE'],
      purpose: 'test',
      createdAt: BEFORE,
      updatedAt: BEFORE,
    });
    const [grantBRow] = await oldDb
      .select()
      .from(schema.grants)
      .where(eq(schema.grants.id, grantB.id));
    if (!grantBRow) throw new Error('setup');
    await mirrorRow(newDb, schema.grants, { ...grantBRow, status: 'ACTIVE' as const });

    const report = await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);
    expect(report.counts.grantsRevoked).toBe(1);
    expect(report.errors).toHaveLength(0);

    const [newGrantA] = await newDb
      .select()
      .from(schema.grants)
      .where(eq(schema.grants.id, grantA.id));
    expect(newGrantA?.status).toBe('REVOKED');
    // Grant B was never touched -- its own audit event predates the restore
    // point, so it is correctly outside reconciliation's scope here.
    const [newGrantB] = await newDb
      .select()
      .from(schema.grants)
      .where(eq(schema.grants.id, grantB.id));
    expect(newGrantB?.status).toBe('ACTIVE');
  });

  it('forces a consent revocation, inserting a new append-only record rather than mutating one', async () => {
    const account = await seedAccount(oldDb, 'consent-owner@example.com');
    await mirrorRow(newDb, schema.accounts, account);
    await setConsent(oldDb, {
      actorAccountId: account.id,
      accountId: account.id,
      type: 'AI_EXTRACTION',
      granted: true,
    });
    const grantedRows = await oldDb
      .select()
      .from(schema.consentRecords)
      .where(eq(schema.consentRecords.accountId, account.id));
    for (const row of grantedRows) await mirrorRow(newDb, schema.consentRecords, row);

    await setConsent(oldDb, {
      actorAccountId: account.id,
      accountId: account.id,
      type: 'AI_EXTRACTION',
      granted: false,
    });
    // Backdate the revoke's own audit event to after the restore point.
    await oldDb
      .update(schema.auditEvents)
      .set({ occurredAt: AFTER })
      .where(eq(schema.auditEvents.eventType, 'CONSENT_REVOKED'));

    const report = await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);
    expect(report.counts.consentsRevoked).toBe(1);

    const newRecords = await newDb
      .select()
      .from(schema.consentRecords)
      .where(eq(schema.consentRecords.accountId, account.id));
    expect(newRecords).toHaveLength(2); // the original grant, plus the reconciled revoke
    expect(newRecords.some((r) => r.type === 'AI_EXTRACTION' && r.revokedAt !== null)).toBe(true);
  });

  it('forces a membership deactivation', async () => {
    const owner = await seedAccount(oldDb, 'member-owner@example.com');
    await mirrorRow(newDb, schema.accounts, owner);
    const orgResult = await createOrganization(oldDb, { actorAccountId: owner.id, name: 'Acme' });
    if (!isOk(orgResult)) throw new Error('org failed');
    await mirrorRow(newDb, schema.organizations, orgResult.value);
    const [membershipRow] = await oldDb
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.organizationId, orgResult.value.id));
    if (!membershipRow) throw new Error('membership missing');
    await mirrorRow(newDb, schema.memberships, membershipRow);

    await oldDb
      .update(schema.memberships)
      .set({ active: false, updatedAt: AFTER })
      .where(eq(schema.memberships.id, membershipRow.id));
    await oldDb.insert(schema.auditEvents).values({
      occurredAt: AFTER,
      eventType: 'MEMBERSHIP_DEACTIVATED',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'membership',
      resourceId: membershipRow.id,
      hash: 'test-hash-membership',
    });

    const report = await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);
    expect(report.counts.membershipsDeactivated).toBe(1);
    const [newMembership] = await newDb
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.id, membershipRow.id));
    expect(newMembership?.active).toBe(false);
  });

  it('inserts a legal hold placed after the restore point that the restored branch never had at all', async () => {
    const owner = await seedAccount(oldDb, 'hold-owner@example.com');
    await mirrorRow(newDb, schema.accounts, owner);
    const applicant = await seedApplicant(oldDb, owner.id);
    await mirrorRow(newDb, schema.applicants, applicant);

    const reviewAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    const hold = await placeLegalHold(oldDb, {
      actorAccountId: owner.id,
      applicantId: applicant.id,
      reason: 'pending investigation',
      reviewAt,
      stepUpSatisfied: true,
    });
    if (!isOk(hold)) throw new Error('hold failed');
    await oldDb
      .update(schema.auditEvents)
      .set({ occurredAt: AFTER })
      .where(eq(schema.auditEvents.eventType, 'LEGAL_HOLD_PLACED'));

    const report = await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);
    expect(report.counts.legalHoldsPlaced).toBe(1);
    expect(report.errors).toHaveLength(0);

    const [newHold] = await newDb
      .select()
      .from(schema.legalHolds)
      .where(eq(schema.legalHolds.id, hold.value.id));
    expect(newHold).toBeDefined();
    expect(newHold?.active).toBe(true);
    expect(newHold?.applicantId).toBe(applicant.id);
  });

  it('applies a hold placed then released, in that order -- the restored branch ends up released, not stuck active', async () => {
    const owner = await seedAccount(oldDb, 'hold-order-owner@example.com');
    await mirrorRow(newDb, schema.accounts, owner);
    const applicant = await seedApplicant(oldDb, owner.id);
    await mirrorRow(newDb, schema.applicants, applicant);

    const reviewAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    const hold = await placeLegalHold(oldDb, {
      actorAccountId: owner.id,
      applicantId: applicant.id,
      reason: 'pending investigation',
      reviewAt,
      stepUpSatisfied: true,
    });
    if (!isOk(hold)) throw new Error('hold failed');
    await oldDb
      .update(schema.auditEvents)
      .set({ occurredAt: AFTER })
      .where(eq(schema.auditEvents.eventType, 'LEGAL_HOLD_PLACED'));

    const released = await releaseLegalHold(oldDb, {
      actorAccountId: owner.id,
      holdId: hold.value.id,
      stepUpSatisfied: true,
    });
    if (!isOk(released)) throw new Error('release failed');
    const laterThanPlacement = new Date(AFTER.getTime() + 1000);
    await oldDb
      .update(schema.auditEvents)
      .set({ occurredAt: laterThanPlacement })
      .where(eq(schema.auditEvents.eventType, 'LEGAL_HOLD_RELEASED'));

    const report = await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);
    expect(report.counts.legalHoldsPlaced).toBe(1);
    expect(report.counts.legalHoldsReleased).toBe(1);

    const [newHold] = await newDb
      .select()
      .from(schema.legalHolds)
      .where(eq(schema.legalHolds.id, hold.value.id));
    expect(newHold?.active).toBe(false);
    expect(newHold?.releasedAt).not.toBeNull();
  });

  it('forces a platform role revocation', async () => {
    const admin = await seedAccount(oldDb, 'role-admin@example.com');
    await mirrorRow(newDb, schema.accounts, admin);
    const target = await seedAccount(oldDb, 'role-target@example.com');
    await mirrorRow(newDb, schema.accounts, target);

    // Bootstrap admin to PLATFORM_OWNER first: the very first grant this
    // table ever receives is always forced to PLATFORM_OWNER regardless of
    // the role requested (post-programme-defect-register.md finding #16),
    // so admin must self-grant before it can grant SUPPORT_ADMIN to target.
    const adminAuth = {
      accountId: admin.id,
      email: 'role-admin@example.com',
      bootstrapEmails: ['role-admin@example.com'],
    };
    const bootstrap = await grantPlatformRole(oldDb, {
      actor: adminAuth,
      targetAccountId: admin.id,
      role: 'PLATFORM_OWNER',
      reason: 'bootstrap',
      stepUpSatisfied: true,
    });
    if (!isOk(bootstrap)) throw new Error('bootstrap failed');

    const granted = await grantPlatformRole(oldDb, {
      actor: { ...adminAuth, bootstrapEmails: [] },
      targetAccountId: target.id,
      role: 'SUPPORT_ADMIN',
      reason: 'test grant',
      stepUpSatisfied: true,
    });
    if (!isOk(granted)) throw new Error('grant failed');
    await mirrorRow(newDb, schema.platformRoles, granted.value);

    const revoked = await revokePlatformRole(oldDb, {
      actor: { ...adminAuth, bootstrapEmails: [] },
      grantId: granted.value.id,
      reason: 'test revoke',
      stepUpSatisfied: true,
    });
    if (!isOk(revoked)) throw new Error('revoke failed');
    await oldDb
      .update(schema.auditEvents)
      .set({ occurredAt: AFTER })
      .where(eq(schema.auditEvents.eventType, 'PLATFORM_ROLE_REVOKED'));

    const report = await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);
    expect(report.counts.platformRolesRevoked).toBe(1);
    const [newRole] = await newDb
      .select()
      .from(schema.platformRoles)
      .where(eq(schema.platformRoles.id, granted.value.id));
    expect(newRole?.revokedAt).not.toBeNull();
  });

  it('forces an organization to CLOSED even when suspended and terminated both replay, and never downgrades an already-CLOSED org', async () => {
    const owner = await seedAccount(oldDb, 'org-owner@example.com');
    await mirrorRow(newDb, schema.accounts, owner);
    const reviewer = await seedAccount(oldDb, 'org-reviewer@example.com');
    await mirrorRow(newDb, schema.accounts, reviewer);

    const created = await createOrganization(oldDb, { actorAccountId: owner.id, name: 'Acme' });
    if (!isOk(created)) throw new Error('org failed');
    const reviewed = await reviewOrganization(oldDb, {
      reviewerAccountId: reviewer.id,
      organizationId: created.value.id,
      decision: 'ACTIVE',
      stepUpSatisfied: true,
    });
    if (!isOk(reviewed)) throw new Error('review failed');
    await mirrorRow(newDb, schema.organizations, reviewed.value);

    const suspended = await suspendOrganization(oldDb, {
      reviewerAccountId: reviewer.id,
      organizationId: created.value.id,
      stepUpSatisfied: true,
    });
    if (!isOk(suspended)) throw new Error('suspend failed');
    await oldDb
      .update(schema.auditEvents)
      .set({ occurredAt: AFTER })
      .where(eq(schema.auditEvents.eventType, 'ORGANIZATION_SUSPENDED'));

    const terminated = await terminateOrganization(oldDb, {
      reviewerAccountId: reviewer.id,
      organizationId: created.value.id,
      stepUpSatisfied: true,
    });
    if (!isOk(terminated)) throw new Error('terminate failed');
    const laterThanSuspend = new Date(AFTER.getTime() + 1000);
    await oldDb
      .update(schema.auditEvents)
      .set({ occurredAt: laterThanSuspend })
      .where(eq(schema.auditEvents.eventType, 'ORGANIZATION_TERMINATED'));

    const report = await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);
    expect(report.counts.organizationsForced).toBe(2);

    const [newOrg] = await newDb
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, created.value.id));
    expect(newOrg?.status).toBe('CLOSED');

    // Re-running reconciliation is a genuine no-op once the restored branch
    // already matches: CLOSED is maximally restrictive, so a replayed
    // SUSPENDED event must never downgrade it.
    const secondReport = await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);
    expect(secondReport.counts.organizationsForced).toBe(0);
    const [stillClosed] = await newDb
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, created.value.id));
    expect(stillClosed?.status).toBe('CLOSED');
  });

  it('replays an executed account deletion by calling the real cascade, and a second run is a clean no-op', async () => {
    const owner = await seedAccount(oldDb, 'delete-owner@example.com');
    await mirrorRow(newDb, schema.accounts, owner);
    const applicant = await seedApplicant(oldDb, owner.id);
    await mirrorRow(newDb, schema.applicants, applicant);

    // Requested well before the restore point (realistic: the grace window
    // is measured in days, dwarfing this codebase's <=5 minute RPO), so the
    // PENDING request is already mirrored onto newDb exactly as it is here --
    // only the eventual EXECUTED transition needs reconciling.
    const requested = await requestAccountDeletion(oldDb, {
      actorAccountId: owner.id,
      accountId: owner.id,
      gracePeriodMs: AFTER.getTime() - BEFORE.getTime(),
      now: BEFORE,
    });
    if (!isOk(requested)) throw new Error('deletion request failed');
    const requestRow = first(
      await oldDb
        .select()
        .from(schema.accountDeletionRequests)
        .where(eq(schema.accountDeletionRequests.id, requested.value.id)),
    );
    if (!requestRow) throw new Error('setup');
    await mirrorRow(newDb, schema.accountDeletionRequests, requestRow);

    const executed = await executeAccountDeletion(oldDb, { accountId: owner.id, now: AFTER });
    if (!isOk(executed)) throw new Error('execute failed');
    await oldDb
      .update(schema.auditEvents)
      .set({ occurredAt: AFTER })
      .where(eq(schema.auditEvents.eventType, 'ACCOUNT_DELETION_EXECUTED'));

    const report = await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);
    expect(report.counts.accountsDeleted).toBe(1);
    expect(report.errors).toHaveLength(0);

    const remainingAccount = first(
      await newDb.select().from(schema.accounts).where(eq(schema.accounts.id, owner.id)),
    );
    expect(remainingAccount).toBeUndefined();
    const remainingApplicant = first(
      await newDb.select().from(schema.applicants).where(eq(schema.applicants.id, applicant.id)),
    );
    expect(remainingApplicant).toBeUndefined();

    // The account is already gone -- a second run must find nothing left to
    // delete and report a clean no-op, never an error.
    const secondReport = await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);
    expect(secondReport.counts.accountsDeleted).toBe(0);
    expect(secondReport.errors).toHaveLength(0);
  });

  it('records one reconciliation-attributed audit event per forced change on the restored branch', async () => {
    const owner = await seedAccount(oldDb, 'audit-owner@example.com');
    await mirrorRow(newDb, schema.accounts, owner);
    const org = await seedAccount(oldDb, 'audit-org@example.com');
    await mirrorRow(newDb, schema.accounts, org);
    const applicant = await seedApplicant(oldDb, owner.id);
    await mirrorRow(newDb, schema.applicants, applicant);

    const grantId = crypto.randomUUID();
    await oldDb.insert(schema.grants).values({
      id: grantId,
      applicantId: applicant.id,
      recipientAccountId: org.id,
      recipientOrganizationId: null,
      status: 'ACTIVE',
      actions: ['MANAGE'],
      purpose: 'test',
      createdAt: BEFORE,
      updatedAt: BEFORE,
    });
    const [grantRow] = await oldDb
      .select()
      .from(schema.grants)
      .where(eq(schema.grants.id, grantId));
    if (!grantRow) throw new Error('setup');
    await mirrorRow(newDb, schema.grants, grantRow);
    await oldDb
      .update(schema.grants)
      .set({ status: 'REVOKED', updatedAt: AFTER })
      .where(eq(schema.grants.id, grantId));
    await oldDb.insert(schema.auditEvents).values({
      occurredAt: AFTER,
      eventType: 'GRANT_REVOKED',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'grant',
      resourceId: grantId,
      hash: 'test-hash-audit',
    });

    await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);

    const [reconciliationEvent] = await newDb
      .select()
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.eventType, 'RECONCILIATION_GRANT_REVOKED'),
          eq(schema.auditEvents.resourceId, grantId),
        ),
      );
    expect(reconciliationEvent).toBeDefined();
    expect(reconciliationEvent?.method).toBe('SYSTEM');
    expect(reconciliationEvent?.actorAccountId).toBeNull();
  });

  it('collects a per-event error rather than aborting the whole run', async () => {
    const owner = await seedAccount(oldDb, 'error-owner@example.com');
    await mirrorRow(newDb, schema.accounts, owner);
    const applicant = await seedApplicant(oldDb, owner.id);
    // Deliberately never mirrored onto newDb -- the hold below references an
    // applicant that does not exist there, so inserting it must fail with a
    // foreign key violation, caught and reported rather than thrown.

    const reviewAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    const hold = await placeLegalHold(oldDb, {
      actorAccountId: owner.id,
      applicantId: applicant.id,
      reason: 'pending investigation',
      reviewAt,
      stepUpSatisfied: true,
    });
    if (!isOk(hold)) throw new Error('hold failed');
    await oldDb
      .update(schema.auditEvents)
      .set({ occurredAt: AFTER })
      .where(eq(schema.auditEvents.eventType, 'LEGAL_HOLD_PLACED'));

    // A second, unrelated, genuinely reconcilable event in the same run --
    // its own applicant IS mirrored onto newDb, proving the failure above
    // does not abort reconciliation of everything else.
    const org = await seedAccount(oldDb, 'error-org@example.com');
    await mirrorRow(newDb, schema.accounts, org);
    const secondApplicant = await seedApplicant(oldDb, owner.id);
    await mirrorRow(newDb, schema.applicants, secondApplicant);
    const grantId = crypto.randomUUID();
    await oldDb.insert(schema.grants).values({
      id: grantId,
      applicantId: secondApplicant.id,
      recipientAccountId: org.id,
      recipientOrganizationId: null,
      status: 'ACTIVE',
      actions: ['MANAGE'],
      purpose: 'test',
      createdAt: BEFORE,
      updatedAt: BEFORE,
    });
    const [grantRow] = await oldDb
      .select()
      .from(schema.grants)
      .where(eq(schema.grants.id, grantId));
    if (!grantRow) throw new Error('setup');
    await mirrorRow(newDb, schema.grants, grantRow);
    await oldDb
      .update(schema.grants)
      .set({ status: 'REVOKED', updatedAt: AFTER })
      .where(eq(schema.grants.id, grantId));
    await oldDb.insert(schema.auditEvents).values({
      occurredAt: AFTER,
      eventType: 'GRANT_REVOKED',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'grant',
      resourceId: grantId,
      hash: 'test-hash-error-case',
    });

    const report = await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);
    expect(report.counts.legalHoldsPlaced).toBe(0);
    expect(report.counts.grantsRevoked).toBe(1);
    expect(report.errors.length).toBeGreaterThan(0);
    expect(report.errors[0]?.eventType).toBe('LEGAL_HOLD_PLACED');
  });

  it('replays a mission retention purge by forcing the same redaction and cascade, and a second run is a clean no-op', async () => {
    const owner = await seedAccount(oldDb, 'purge-owner@example.com');
    await mirrorRow(newDb, schema.accounts, owner);
    const applicant = await seedApplicant(oldDb, owner.id);
    await mirrorRow(newDb, schema.applicants, applicant);

    const created = await createMission(oldDb, {
      actorAccountId: owner.id,
      applicantId: applicant.id,
      title: 'Closed case',
    });
    if (!isOk(created)) throw new Error('setup failed');
    const missionId = created.value.id;
    // Mirror the mission onto newDb BEFORE it is closed/purged on oldDb --
    // simulating a restore point that predates the whole retention cycle.
    const missionRow = first(
      await oldDb.select().from(schema.missions).where(eq(schema.missions.id, missionId)),
    );
    if (!missionRow) throw new Error('setup failed');
    await mirrorRow(newDb, schema.missions, missionRow);

    // Workflow content that must be cascaded away on replay.
    await oldDb.insert(schema.missionNotes).values({
      missionId,
      authorAccountId: owner.id,
      body: 'a note',
    });
    const noteRow = first(
      await oldDb
        .select()
        .from(schema.missionNotes)
        .where(eq(schema.missionNotes.missionId, missionId)),
    );
    if (!noteRow) throw new Error('setup failed');
    await mirrorRow(newDb, schema.missionNotes, noteRow);

    // A historical fact that must survive on both branches regardless.
    await oldDb.insert(schema.missionOutcomes).values({
      missionId,
      decision: 'REFUSED',
      decisionDate: new Date(),
      actorAccountId: owner.id,
      authAssuranceContext: {},
    });
    const outcomeRow = first(
      await oldDb
        .select()
        .from(schema.missionOutcomes)
        .where(eq(schema.missionOutcomes.missionId, missionId)),
    );
    if (!outcomeRow) throw new Error('setup failed');
    await mirrorRow(newDb, schema.missionOutcomes, outcomeRow);

    const cancelled = await transitionMission(oldDb, {
      actorAccountId: owner.id,
      missionId,
      to: 'CANCELLED',
    });
    expect(isOk(cancelled)).toBe(true);
    const thirteenMonthsAgo = new Date();
    thirteenMonthsAgo.setUTCMonth(thirteenMonthsAgo.getUTCMonth() - 13);
    await oldDb
      .update(schema.missions)
      .set({ closedAt: thirteenMonthsAgo })
      .where(eq(schema.missions.id, missionId));
    const thirtyOneDaysAgo = new Date();
    thirtyOneDaysAgo.setUTCDate(thirtyOneDaysAgo.getUTCDate() - 31);
    await oldDb
      .update(schema.missions)
      .set({ retentionNoticeSentAt: thirtyOneDaysAgo })
      .where(eq(schema.missions.id, missionId));

    setEnv('CASE_RETENTION_PURGE_ENABLED', 'true');
    try {
      const purgeResult = await sweepCaseRetentionPurge(oldDb);
      expect(purgeResult.purged).toBe(1);
    } finally {
      unsetEnv('CASE_RETENTION_PURGE_ENABLED');
    }
    await oldDb
      .update(schema.auditEvents)
      .set({ occurredAt: AFTER })
      .where(eq(schema.auditEvents.eventType, 'MISSION_RETENTION_PURGED'));

    const report = await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);
    expect(report.counts.missionsPurged).toBe(1);
    expect(report.errors).toHaveLength(0);

    const newMission = first(
      await newDb.select().from(schema.missions).where(eq(schema.missions.id, missionId)),
    );
    expect(newMission?.title).toBe('[case data purged]');
    expect(newMission?.destination).toBeNull();
    expect(newMission?.purgedAt).not.toBeNull();

    const newNotes = await newDb
      .select()
      .from(schema.missionNotes)
      .where(eq(schema.missionNotes.missionId, missionId));
    expect(newNotes).toHaveLength(0);
    const newOutcomes = await newDb
      .select()
      .from(schema.missionOutcomes)
      .where(eq(schema.missionOutcomes.missionId, missionId));
    expect(newOutcomes).toHaveLength(1);

    // Already purged -- a second run must find nothing left to do.
    const secondReport = await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);
    expect(secondReport.counts.missionsPurged).toBe(0);
    expect(secondReport.errors).toHaveLength(0);
  });

  it('is a clean no-op, never an error, when the purged mission never existed on the restored branch at all', async () => {
    const owner = await seedAccount(oldDb, 'purge-missing-owner@example.com');
    await mirrorRow(newDb, schema.accounts, owner);
    const applicant = await seedApplicant(oldDb, owner.id);
    await mirrorRow(newDb, schema.applicants, applicant);
    // Deliberately never mirrored onto newDb -- simulating a mission created
    // and fully purged entirely within the gap after the restore point.

    const created = await createMission(oldDb, {
      actorAccountId: owner.id,
      applicantId: applicant.id,
      title: 'Never-restored case',
    });
    if (!isOk(created)) throw new Error('setup failed');
    const missionId = created.value.id;
    const cancelled = await transitionMission(oldDb, {
      actorAccountId: owner.id,
      missionId,
      to: 'CANCELLED',
    });
    expect(isOk(cancelled)).toBe(true);
    const thirteenMonthsAgo = new Date();
    thirteenMonthsAgo.setUTCMonth(thirteenMonthsAgo.getUTCMonth() - 13);
    await oldDb
      .update(schema.missions)
      .set({ closedAt: thirteenMonthsAgo })
      .where(eq(schema.missions.id, missionId));
    const thirtyOneDaysAgo = new Date();
    thirtyOneDaysAgo.setUTCDate(thirtyOneDaysAgo.getUTCDate() - 31);
    await oldDb
      .update(schema.missions)
      .set({ retentionNoticeSentAt: thirtyOneDaysAgo })
      .where(eq(schema.missions.id, missionId));

    setEnv('CASE_RETENTION_PURGE_ENABLED', 'true');
    try {
      const purgeResult = await sweepCaseRetentionPurge(oldDb);
      // Confirms there really is a MISSION_RETENTION_PURGED event to
      // replay -- without this, the missingPurged assertion below would
      // pass vacuously (nothing to reconcile) rather than proving the
      // "mission missing on the restored branch" no-op path.
      expect(purgeResult.purged).toBe(1);
    } finally {
      unsetEnv('CASE_RETENTION_PURGE_ENABLED');
    }
    await oldDb
      .update(schema.auditEvents)
      .set({ occurredAt: AFTER })
      .where(eq(schema.auditEvents.eventType, 'MISSION_RETENTION_PURGED'));

    const report = await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);
    expect(report.counts.missionsPurged).toBe(0);
    expect(report.errors).toHaveLength(0);
  });

  it('forces the same storage-object delete for an ACCOUNT_DELETION-reason erasure, and a second run is a clean no-op', async () => {
    const storage = new FakeBlobStore();
    const [storageObject] = await oldDb
      .insert(schema.storageObjects)
      .values({
        bucket: 'CLEAN',
        objectKey: 'obj-account-deletion',
        contentHash: 'deadbeef',
        sizeBytes: 3,
      })
      .returning();
    if (!storageObject) throw new Error('setup failed');
    await mirrorRow(newDb, schema.storageObjects, storageObject);
    await storage.putObject({
      bucket: 'CLEAN',
      objectKey: 'obj-account-deletion',
      contentType: 'application/pdf',
      bytes: new Uint8Array([1, 2, 3]),
    });
    await enqueueErasureJob(oldDb, {
      reason: 'ACCOUNT_DELETION',
      bucket: 'CLEAN',
      objectKey: 'obj-account-deletion',
      expectedHash: 'deadbeef',
      storageObjectId: storageObject.id,
    });
    const workerResult = await runErasureWorker(oldDb, storage, { limit: 5 });
    expect(workerResult).toEqual({ processed: 1, blocked: 0, failed: 0 });
    await oldDb
      .update(schema.auditEvents)
      .set({ occurredAt: AFTER })
      .where(eq(schema.auditEvents.eventType, 'ERASURE_VERIFIED'));

    const report = await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);
    expect(report.counts.erasuresVerified).toBe(1);
    expect(report.errors).toHaveLength(0);
    expect(
      await newDb
        .select()
        .from(schema.storageObjects)
        .where(eq(schema.storageObjects.id, storageObject.id)),
    ).toHaveLength(0);

    const secondReport = await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);
    expect(secondReport.counts.erasuresVerified).toBe(0);
    expect(secondReport.errors).toHaveLength(0);
  });

  it('forces the full document+sibling cascade for a fully-verified RETENTION_PURGE erasure, bumping material revision for a mission that still selects it, and a second run is a clean no-op', async () => {
    const storage = new FakeBlobStore();
    const owner = await seedAccount(oldDb, 'retention-purge-owner@example.com');
    await mirrorRow(newDb, schema.accounts, owner);
    const applicant = await seedApplicant(oldDb, owner.id);
    await mirrorRow(newDb, schema.applicants, applicant);

    const registered = await registerDocument(oldDb, {
      actorAccountId: owner.id,
      applicantId: applicant.id,
      originalName: 'bank-statement.pdf',
    });
    if (!isOk(registered)) throw new Error('setup failed');
    const documentId = registered.value.id;
    await addDocumentVersion(oldDb, {
      actorAccountId: owner.id,
      documentId,
      bucket: 'CLEAN',
      objectKey: 'obj-retention-purge',
    });
    await storage.putObject({
      bucket: 'CLEAN',
      objectKey: 'obj-retention-purge',
      contentType: 'application/pdf',
      bytes: new Uint8Array([1]),
    });
    const documentRow = first(
      await oldDb.select().from(schema.documents).where(eq(schema.documents.id, documentId)),
    );
    const versionRow = first(
      await oldDb
        .select()
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.documentId, documentId)),
    );
    const storageObject = first(
      await oldDb
        .select()
        .from(schema.storageObjects)
        .where(eq(schema.storageObjects.objectKey, 'obj-retention-purge')),
    );
    if (!documentRow || !versionRow || !storageObject) throw new Error('setup failed');
    await mirrorRow(newDb, schema.documents, documentRow);
    await mirrorRow(newDb, schema.storageObjects, storageObject);
    await mirrorRow(newDb, schema.documentVersions, versionRow);

    // A mission on the restored branch that currently selects this same
    // document as evidence -- proves `forceErasureVerified` bumps material
    // revision (mirroring `finalizeVerifiedJob`'s own real behavior) before
    // tearing the document down, not just deleting rows blindly.
    // createMission requires CORE_PROCESSING consent on whichever db it
    // runs against -- seedApplicant already set this on oldDb, but this
    // mission is deliberately created directly on newDb, so it needs its
    // own consent record there too.
    await setConsent(newDb, {
      actorAccountId: owner.id,
      accountId: owner.id,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    const mission = await createMission(newDb, {
      actorAccountId: owner.id,
      applicantId: applicant.id,
      title: 'Retention purge case',
    });
    if (!isOk(mission)) throw new Error('setup failed');
    const missionBefore = first(
      await newDb.select().from(schema.missions).where(eq(schema.missions.id, mission.value.id)),
    );
    if (!missionBefore) throw new Error('setup failed');
    const [pack] = await newDb
      .insert(schema.packs)
      .values({ key: 'test.retention-purge', name: 'Test pack' })
      .returning();
    if (!pack) throw new Error('setup failed');
    const [packVersion] = await newDb
      .insert(schema.packVersions)
      .values({ packId: pack.id, version: 1 })
      .returning();
    if (!packVersion) throw new Error('setup failed');
    const [requirement] = await newDb
      .insert(schema.packRequirements)
      .values({
        packVersionId: packVersion.id,
        kind: 'DOCUMENT',
        docType: 'bank_statement',
        citation: 'test citation',
      })
      .returning();
    if (!requirement) throw new Error('setup failed');
    await newDb.insert(schema.selectedEvidence).values({
      missionId: mission.value.id,
      packRequirementId: requirement.id,
      documentId,
    });

    await enqueueErasureJob(oldDb, {
      reason: 'RETENTION_PURGE',
      bucket: 'CLEAN',
      objectKey: 'obj-retention-purge',
      expectedHash: null,
      storageObjectId: storageObject.id,
      documentId,
      applicantId: applicant.id,
    });
    const workerResult = await runErasureWorker(oldDb, storage, { limit: 5 });
    expect(workerResult).toEqual({ processed: 1, blocked: 0, failed: 0 });
    // Confirms the old branch's own erasure genuinely completed the full
    // cascade (single sibling, so this one job's own verification is also
    // the document's last) -- otherwise the no-op assertions below the
    // second run would pass vacuously.
    expect(
      await oldDb.select().from(schema.documents).where(eq(schema.documents.id, documentId)),
    ).toHaveLength(0);
    await oldDb
      .update(schema.auditEvents)
      .set({ occurredAt: AFTER })
      .where(eq(schema.auditEvents.eventType, 'ERASURE_VERIFIED'));

    const report = await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);
    expect(report.counts.erasuresVerified).toBe(1);
    expect(report.errors).toHaveLength(0);
    expect(
      await newDb.select().from(schema.documents).where(eq(schema.documents.id, documentId)),
    ).toHaveLength(0);
    expect(
      await newDb
        .select()
        .from(schema.storageObjects)
        .where(eq(schema.storageObjects.id, storageObject.id)),
    ).toHaveLength(0);
    const missionAfter = first(
      await newDb.select().from(schema.missions).where(eq(schema.missions.id, mission.value.id)),
    );
    expect(missionAfter?.materialRevision).toBeGreaterThan(missionBefore.materialRevision);

    const secondReport = await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);
    expect(secondReport.counts.erasuresVerified).toBe(0);
    expect(secondReport.errors).toHaveLength(0);
  });

  it('leaves a RETENTION_PURGE-reason document and its storage objects untouched when the old branch itself never finished verifying every sibling', async () => {
    const storage = new FakeBlobStore();
    const owner = await seedAccount(oldDb, 'retention-purge-partial@example.com');
    await mirrorRow(newDb, schema.accounts, owner);
    const applicant = await seedApplicant(oldDb, owner.id);
    await mirrorRow(newDb, schema.applicants, applicant);

    const registered = await registerDocument(oldDb, {
      actorAccountId: owner.id,
      applicantId: applicant.id,
      originalName: 'multi-version.pdf',
    });
    if (!isOk(registered)) throw new Error('setup failed');
    const documentId = registered.value.id;
    const objectKeys = ['obj-partial-1', 'obj-partial-2'];
    for (const objectKey of objectKeys) {
      await addDocumentVersion(oldDb, {
        actorAccountId: owner.id,
        documentId,
        bucket: 'CLEAN',
        objectKey,
      });
      await storage.putObject({
        bucket: 'CLEAN',
        objectKey,
        contentType: 'application/pdf',
        bytes: new Uint8Array([1]),
      });
    }
    const documentRow = first(
      await oldDb.select().from(schema.documents).where(eq(schema.documents.id, documentId)),
    );
    if (!documentRow) throw new Error('setup failed');
    await mirrorRow(newDb, schema.documents, documentRow);
    const storageObjectRows = await oldDb
      .select()
      .from(schema.storageObjects)
      .where(inArray(schema.storageObjects.objectKey, objectKeys));
    for (const object of storageObjectRows) await mirrorRow(newDb, schema.storageObjects, object);
    const versionRows = await oldDb
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, documentId));
    for (const version of versionRows) await mirrorRow(newDb, schema.documentVersions, version);
    for (const object of storageObjectRows) {
      await enqueueErasureJob(oldDb, {
        reason: 'RETENTION_PURGE',
        bucket: 'CLEAN',
        objectKey: object.objectKey,
        expectedHash: null,
        storageObjectId: object.id,
        documentId,
        applicantId: applicant.id,
      });
    }

    // Process strictly one of the two sibling jobs -- the document is
    // deliberately still alive on the old branch itself, proving this test
    // exercises the "not yet fully verified" path, not a vacuous no-op.
    await runErasureWorker(oldDb, storage, { limit: 1 });
    expect(
      await oldDb.select().from(schema.documents).where(eq(schema.documents.id, documentId)),
    ).toHaveLength(1);
    await oldDb
      .update(schema.auditEvents)
      .set({ occurredAt: AFTER })
      .where(eq(schema.auditEvents.eventType, 'ERASURE_VERIFIED'));

    const report = await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);
    expect(report.counts.erasuresVerified).toBe(0);
    expect(report.errors).toHaveLength(0);
    expect(
      await newDb.select().from(schema.documents).where(eq(schema.documents.id, documentId)),
    ).toHaveLength(1);
    expect(
      await newDb
        .select()
        .from(schema.storageObjects)
        .where(inArray(schema.storageObjects.objectKey, objectKeys)),
    ).toHaveLength(2);
  });
});

describe('reconcileRestoredBranch: per-case sharing exceptions (ADR 0017)', () => {
  let oldDb: Db;
  let newDb: Db;

  beforeEach(async () => {
    oldDb = await freshDb();
    newDb = await freshDb();
  });

  /** An owner, a case and an all-cases grant, identical on both branches at the restore point. */
  async function sharedCase() {
    const owner = await seedAccount(oldDb, 'exception-owner@example.com');
    await mirrorRow(newDb, schema.accounts, owner);
    const recipient = await seedAccount(oldDb, 'exception-recipient@example.com');
    await mirrorRow(newDb, schema.accounts, recipient);
    const applicant = await seedApplicant(oldDb, owner.id);
    await mirrorRow(newDb, schema.applicants, applicant);
    const [mission] = await oldDb
      .insert(schema.missions)
      .values({ applicantId: applicant.id, title: 'Japan trip 2026', createdAt: BEFORE })
      .returning();
    if (!mission) throw new Error('setup');
    await mirrorRow(newDb, schema.missions, mission);
    const [grant] = await oldDb
      .insert(schema.grants)
      .values({
        applicantId: applicant.id,
        recipientAccountId: recipient.id,
        status: 'ACTIVE',
        acceptedAt: BEFORE,
        actions: ['VIEW_METADATA'],
        purpose: 'test',
        createdAt: BEFORE,
        updatedAt: BEFORE,
      })
      .returning();
    if (!grant) throw new Error('setup');
    await mirrorRow(newDb, schema.grants, grant);
    return { owner, applicantId: applicant.id, missionId: mission.id, grantId: grant.id };
  }

  async function recordOnOld(
    eventType: 'GRANT_CASE_EXCLUDED' | 'GRANT_CASE_EXCLUSION_REMOVED',
    c: Awaited<ReturnType<typeof sharedCase>>,
    occurredAt: Date,
    parent: { kind: 'grant' | 'sharing_invitation'; id: string } = { kind: 'grant', id: c.grantId },
  ): Promise<void> {
    await oldDb.insert(schema.auditEvents).values({
      occurredAt,
      eventType,
      actorAccountId: c.owner.id,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: c.applicantId,
      missionId: c.missionId,
      grantId: parent.kind === 'grant' ? parent.id : null,
      resourceType: parent.kind,
      resourceId: parent.id,
      hash: `test-hash-${eventType}-${occurredAt.getTime()}`,
    });
  }

  async function exceptionsOnNew() {
    return newDb.select().from(schema.grantCaseExclusions);
  }

  async function reconciliationEvents(): Promise<number> {
    const rows = await newDb
      .select({ seq: schema.auditEvents.seq })
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.reason, 'backup_resurrection_reconciliation'));
    return rows.length;
  }

  it('an exception written after the restore point survives the restore, and a second run is a clean no-op', async () => {
    const c = await sharedCase();
    await recordOnOld('GRANT_CASE_EXCLUDED', c, AFTER);

    const report = await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);
    expect(report.errors).toEqual([]);
    expect(report.counts.caseExceptionsAdded).toBe(1);
    const rows = await exceptionsOnNew();
    expect(rows.map((r) => [r.grantId, r.missionId, r.applicantId, r.createdByAccountId])).toEqual([
      [c.grantId, c.missionId, c.applicantId, c.owner.id],
    ]);
    // The restored branch's own access check now refuses the case again.
    const policyGrant = (await loadGrantsForPolicy(newDb, c.applicantId))[0];
    expect(policyGrant?.excludedMissionIds).toEqual([c.missionId]);
    const audits = await reconciliationEvents();
    expect(audits).toBe(1);

    const again = await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);
    expect(again.errors).toEqual([]);
    expect(again.counts.caseExceptionsAdded).toBe(0);
    expect(await exceptionsOnNew()).toHaveLength(1);
    expect(await reconciliationEvents()).toBe(audits);
  });

  it('an Allow This Case after the restore point is replayed too, in order, and twice is a no-op', async () => {
    const c = await sharedCase();
    // Excluded before the restore point (both branches have it), allowed after.
    await newDb.insert(schema.grantCaseExclusions).values({
      grantId: c.grantId,
      missionId: c.missionId,
      applicantId: c.applicantId,
    });
    await recordOnOld('GRANT_CASE_EXCLUSION_REMOVED', c, AFTER);
    const report = await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);
    expect(report.errors).toEqual([]);
    expect(report.counts.caseExceptionsRemoved).toBe(1);
    expect(await exceptionsOnNew()).toHaveLength(0);
    const again = await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);
    expect(again.counts.caseExceptionsRemoved).toBe(0);
    expect(again.counts.caseExceptionsAdded).toBe(0);

    // A "no" then "allow" then "no" after the restore point ends excluded; repeats change nothing.
    const later = new Date(AFTER.getTime() + 60_000);
    const latest = new Date(AFTER.getTime() + 120_000);
    await recordOnOld('GRANT_CASE_EXCLUDED', c, later);
    await recordOnOld('GRANT_CASE_EXCLUDED', c, latest);
    const third = await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);
    expect(third.errors).toEqual([]);
    expect(await exceptionsOnNew()).toHaveLength(1);
    const audits = await reconciliationEvents();
    await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);
    expect(await exceptionsOnNew()).toHaveLength(1);
    expect(await reconciliationEvents()).toBe(audits);
  });

  it('a "no" on a pending invitation is replayed against the invitation, ready for its acceptance', async () => {
    const c = await sharedCase();
    const [invitation] = await oldDb
      .insert(schema.sharingInvitations)
      .values({
        applicantId: c.applicantId,
        invitedByAccountId: c.owner.id,
        email: 'invited@example.com',
        tokenHash: 'token-hash-reconcile',
        purpose: 'test',
        actions: ['VIEW_METADATA'],
        grantExpiryAt: new Date(Date.now() + 86_400_000),
        expiresAt: new Date(Date.now() + 86_400_000),
        createdAt: BEFORE,
      })
      .returning();
    if (!invitation) throw new Error('setup');
    await mirrorRow(newDb, schema.sharingInvitations, invitation);
    await recordOnOld('GRANT_CASE_EXCLUDED', c, AFTER, {
      kind: 'sharing_invitation',
      id: invitation.id,
    });
    const report = await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);
    expect(report.errors).toEqual([]);
    expect((await exceptionsOnNew()).map((r) => [r.sharingInvitationId, r.missionId])).toEqual([
      [invitation.id, c.missionId],
    ]);
  });

  it('is a clean no-op when the grant or case was made after the restore point', async () => {
    const c = await sharedCase();
    await recordOnOld('GRANT_CASE_EXCLUDED', c, AFTER, {
      kind: 'grant',
      id: crypto.randomUUID(),
    });
    const report = await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);
    expect(report.errors).toEqual([]);
    expect(report.counts.caseExceptionsAdded).toBe(0);
    expect(await exceptionsOnNew()).toHaveLength(0);
  });

  it('fails closed: when the exception cannot be written, the grant is revoked (never paused) and the error reported', async () => {
    const c = await sharedCase();
    await recordOnOld('GRANT_CASE_EXCLUDED', c, AFTER);
    // A restored branch from before migration 0090 has no table to write it to.
    await newDb.execute(sql`drop table grant_case_exclusions`);
    const report = await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]?.message).toContain('grant closed instead');
    const [grant] = await newDb.select().from(schema.grants).where(eq(schema.grants.id, c.grantId));
    expect(grant?.status).toBe('REVOKED');
    const closed = await newDb
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'RECONCILIATION_CASE_EXCEPTION_FAIL_CLOSED'));
    expect(closed.map((e) => [e.resourceId, e.missionId])).toEqual([[c.grantId, c.missionId]]);
    // Running again keeps it closed and reports again; it never reopens.
    const again = await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);
    expect(again.errors).toHaveLength(1);
    const [still] = await newDb.select().from(schema.grants).where(eq(schema.grants.id, c.grantId));
    expect(still?.status).toBe('REVOKED');
  });
});

describe('reconcileRestoredBranch: AI connections (S15)', () => {
  const RESOURCE = 'https://vs.example.test/mcp';
  const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
  const CLIENT = {
    clientId: 'https://claude.ai/oauth/claude-code-client-metadata',
    clientName: 'Claude',
    clientHost: 'claude.ai',
  };
  let oldDb: Db;
  let newDb: Db;

  beforeEach(async () => {
    oldDb = await freshDb();
    newDb = await freshDb();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function ownerProof(db: Db, accountId: string, applicantId: string) {
    const proof = await requireAccess(
      db,
      accountPrincipal(accountId),
      'VIEW_METADATA',
      { applicantId },
      { purpose: 'ai_connection' },
    );
    if (!isOk(proof)) throw new Error('proof');
    return proof.value;
  }

  /**
   * A live connection (record, case, connection and its tokens) that existed identically on both
   * branches at the restore point. Connected "until turned off", so only what reconciliation does
   * decides whether it still works.
   */
  async function sharedConnection(email: string) {
    const owner = await seedAccount(oldDb, email);
    await mirrorRow(newDb, schema.accounts, owner);
    const applicant = await seedApplicant(oldDb, owner.id);
    await mirrorRow(newDb, schema.applicants, applicant);
    const mission = await createMission(oldDb, {
      actorAccountId: owner.id,
      applicantId: applicant.id,
      title: 'UK Visit',
    });
    if (!isOk(mission)) throw new Error('mission');
    const [missionRow] = await oldDb
      .select()
      .from(schema.missions)
      .where(eq(schema.missions.id, mission.value.id));
    if (!missionRow) throw new Error('setup');
    await mirrorRow(newDb, schema.missions, missionRow);
    const verifier = randomBytes(32).toString('base64url');
    const created = await createAiConnection(await ownerProof(oldDb, owner.id, applicant.id), {
      client: CLIENT,
      choices: {
        layers: ['identity', 'travel_documents', 'money'],
        caseMode: 'ALL_CURRENT',
        documentList: true,
        documentText: false,
        revealIdentifiers: false,
        duration: 'until_off',
      },
      codeChallenge: createHash('sha256').update(verifier, 'ascii').digest('base64url'),
      redirectUri: REDIRECT,
      resource: RESOURCE,
    });
    if (!isOk(created)) throw new Error(created.error.description);
    const tokens = await exchangeAiAuthorizationCode(oldDb, {
      code: created.value.code,
      codeVerifier: verifier,
      clientId: CLIENT.clientId,
      redirectUri: REDIRECT,
      resource: RESOURCE,
    });
    if (!isOk(tokens)) throw new Error(tokens.error.description);
    const connectionId = created.value.connectionId;
    for (const row of await oldDb
      .select()
      .from(schema.aiConnections)
      .where(eq(schema.aiConnections.id, connectionId))) {
      await mirrorRow(newDb, schema.aiConnections, row);
    }
    for (const row of await oldDb
      .select()
      .from(schema.aiConnectionTokens)
      .where(eq(schema.aiConnectionTokens.connectionId, connectionId))) {
      await mirrorRow(newDb, schema.aiConnectionTokens, row);
    }
    return {
      ownerId: owner.id,
      applicantId: applicant.id,
      missionId: mission.value.id,
      connectionId,
      access: tokens.value.access_token,
      refresh: tokens.value.refresh_token,
    };
  }

  async function restoredRow(connectionId: string) {
    const [row] = await newDb
      .select()
      .from(schema.aiConnections)
      .where(eq(schema.aiConnections.id, connectionId));
    return row;
  }

  async function liveTokensOnNew(connectionId: string) {
    const rows = await newDb
      .select()
      .from(schema.aiConnectionTokens)
      .where(eq(schema.aiConnectionTokens.connectionId, connectionId));
    return rows.filter((row) => row.revokedAt === null).length;
  }

  it('turns a connection turned off after the restore point off again, tokens and all, and a second run is a no-op', async () => {
    const c = await sharedConnection('ai-off@example.com');
    // Before reconciling, the restored branch still lets the app in.
    expect(
      await resolveAiAccessToken(newDb, { token: c.access, resource: RESOURCE }),
    ).not.toBeNull();
    await turnOffAiConnection(await ownerProof(oldDb, c.ownerId, c.applicantId), {
      connectionId: c.connectionId,
    });

    const report = await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);
    expect(report.errors).toEqual([]);
    expect(report.counts.aiConnectionsRevoked).toBe(1);
    const row = await restoredRow(c.connectionId);
    // The owner's own turn-off, as it happened: its time and its reason.
    const [source] = await oldDb
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'AI_CONNECTION_REVOKED'));
    expect(row?.revokedAt?.getTime()).toBe(source?.occurredAt.getTime());
    expect(row?.revokedReason).toBe('turned off by owner');
    expect(await liveTokensOnNew(c.connectionId)).toBe(0);
    expect(await resolveAiAccessToken(newDb, { token: c.access, resource: RESOURCE })).toBeNull();
    const refreshed = await refreshAiTokens(newDb, {
      refreshToken: c.refresh,
      clientId: CLIENT.clientId,
    });
    expect(refreshed.ok).toBe(false);
    const audited = await newDb
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'RECONCILIATION_AI_CONNECTION_REVOKED'));
    expect(audited.map((event) => [event.resourceType, event.resourceId, event.method])).toEqual([
      ['ai_connection', c.connectionId, 'SYSTEM'],
    ]);

    const again = await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);
    expect(again.counts.aiConnectionsRevoked).toBe(0);
    expect(again.errors).toEqual([]);
  });

  it('never touches a connection whose turn-off predates the restore point', async () => {
    const c = await sharedConnection('ai-before@example.com');
    await turnOffAiConnection(await ownerProof(oldDb, c.ownerId, c.applicantId), {
      connectionId: c.connectionId,
    });
    // The backup was taken after this turn-off (the audit chain cannot be backdated).
    const report = await reconcileRestoredBranch(oldDb, newDb, new Date(Date.now() + 1000));
    expect(report.counts.aiConnectionsRevoked).toBe(0);
    expect((await restoredRow(c.connectionId))?.revokedAt).toBeNull();
  });

  it('re-applies narrowed access and an earlier end that has passed: off, with its tokens dead', async () => {
    const c = await sharedConnection('ai-narrowed@example.com');
    // After the restore point the owner kept only Personal Details, one case, and an end of
    // one hour from then, which has long passed.
    const changedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const proof = await ownerProof(oldDb, c.ownerId, c.applicantId);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(changedAt);
    const changed = await changeAiConnection(proof, {
      connectionId: c.connectionId,
      choices: {
        layers: ['identity'],
        caseMode: 'ONE',
        missionId: c.missionId,
        documentList: false,
        documentText: false,
        revealIdentifiers: false,
        duration: '1h',
      },
    });
    vi.useRealTimers();
    expect(changed.ok).toBe(true);

    const report = await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);
    expect(report.errors).toEqual([]);
    expect(report.counts.aiConnectionsNarrowed).toBe(1);
    const row = await restoredRow(c.connectionId);
    expect(row).toMatchObject({
      scopes: ['identity'],
      caseMode: 'ONE',
      missionId: c.missionId,
      revealIdentifiers: false,
    });
    expect(row?.expiresAt?.getTime()).toBe(changedAt.getTime() + 60 * 60 * 1000);
    expect(await liveTokensOnNew(c.connectionId)).toBe(0);
    expect(await resolveAiAccessToken(newDb, { token: c.access, resource: RESOURCE })).toBeNull();
    const again = await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);
    expect(again.counts.aiConnectionsNarrowed).toBe(0);
  });

  it('never widens: access the owner added after the restore point is not given back', async () => {
    const c = await sharedConnection('ai-widened@example.com');
    // Narrowed on the restored branch's own state at the restore point: one case, no Money.
    await newDb
      .update(schema.aiConnections)
      .set({ scopes: ['identity'], caseMode: 'ONE', missionId: c.missionId })
      .where(eq(schema.aiConnections.id, c.connectionId));
    await oldDb
      .update(schema.aiConnections)
      .set({ scopes: ['identity'], caseMode: 'ONE', missionId: c.missionId })
      .where(eq(schema.aiConnections.id, c.connectionId));
    // After the restore point the owner widened it on the old branch.
    await changeAiConnection(await ownerProof(oldDb, c.ownerId, c.applicantId), {
      connectionId: c.connectionId,
      choices: {
        layers: ['identity', 'money', 'health'],
        caseMode: 'ALL_CURRENT',
        documentList: true,
        documentText: true,
        revealIdentifiers: false,
        duration: 'until_off',
      },
    });
    const report = await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);
    expect(report.counts.aiConnectionsNarrowed).toBe(0);
    expect(await restoredRow(c.connectionId)).toMatchObject({
      scopes: ['identity'],
      caseMode: 'ONE',
      missionId: c.missionId,
    });
    expect(await liveTokensOnNew(c.connectionId)).toBeGreaterThan(0);
  });

  it('a connection whose own end has passed stays off on the restored branch without any replay', async () => {
    const c = await sharedConnection('ai-ended@example.com');
    const ended = new Date(Date.now() - 60 * 1000);
    for (const db of [oldDb, newDb]) {
      await db
        .update(schema.aiConnections)
        .set({ expiresAt: ended })
        .where(eq(schema.aiConnections.id, c.connectionId));
    }
    const report = await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);
    expect(report.errors).toEqual([]);
    expect(await resolveAiAccessToken(newDb, { token: c.access, resource: RESOURCE })).toBeNull();
    const refreshed = await refreshAiTokens(newDb, {
      refreshToken: c.refresh,
      clientId: CLIENT.clientId,
    });
    expect(refreshed.ok).toBe(false);
    // Nor can the restored branch be talked into reviving it.
    const proof = await ownerProof(newDb, c.ownerId, c.applicantId);
    const read = await getAiConnection(proof, c.connectionId);
    expect(read.ok === false && read.error.code).toBe('ended');
  });

  it('is a clean no-op when the restored branch predates the AI connection tables', async () => {
    const c = await sharedConnection('ai-no-table@example.com');
    await turnOffAiConnection(await ownerProof(oldDb, c.ownerId, c.applicantId), {
      connectionId: c.connectionId,
    });
    await newDb.execute(sql`drop table ai_connection_tokens`);
    await newDb.execute(sql`drop table ai_connections`);
    const report = await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);
    expect(report.errors).toEqual([]);
    expect(report.counts.aiConnectionsRevoked).toBe(0);
  });

  /** One side keeps one case, the other all current cases; `closed` closes that case on the restored branch. */
  async function mixedCases(restoredHasOne: boolean, closed: boolean) {
    const c = await sharedConnection(`ai-mixed-${restoredHasOne}-${closed}@example.com`);
    const one = { scopes: ['identity'], caseMode: 'ONE' as const, missionId: c.missionId };
    const all = { scopes: ['identity'], caseMode: 'ALL_CURRENT' as const, missionId: null };
    await newDb
      .update(schema.aiConnections)
      .set(restoredHasOne ? one : all)
      .where(eq(schema.aiConnections.id, c.connectionId));
    await oldDb
      .update(schema.aiConnections)
      .set(restoredHasOne ? all : one)
      .where(eq(schema.aiConnections.id, c.connectionId));
    if (closed) {
      await newDb
        .update(schema.missions)
        .set({ state: 'CLOSED' })
        .where(eq(schema.missions.id, c.missionId));
    }
    await oldDb.insert(schema.auditEvents).values({
      occurredAt: AFTER,
      eventType: 'AI_CONNECTION_CHANGED',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'ai_connection',
      resourceId: c.connectionId,
      hash: `test-hash-${c.connectionId}`,
    });
    const report = await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);
    expect(report.errors).toEqual([]);
    return { c, row: await restoredRow(c.connectionId) };
  }

  it('one case against all current cases keeps the case only while it is current, in both directions', async () => {
    // Pre-incident branch narrowed all current cases to one open case: that one case.
    const toOne = await mixedCases(false, false);
    expect(toOne.row).toMatchObject({ caseMode: 'ONE', missionId: toOne.c.missionId });
    // The same, but that case is closed on the restored branch: all current cases never
    // covered it, so nothing is left.
    const toClosed = await mixedCases(false, true);
    expect(toClosed.row).toMatchObject({ caseMode: 'NONE', missionId: null });
    // The restored branch has one open case, the pre-incident branch all current cases: kept.
    const keepOne = await mixedCases(true, false);
    expect(keepOne.row).toMatchObject({ caseMode: 'ONE', missionId: keepOne.c.missionId });
    // The restored branch has one closed case: not among all current cases, so none.
    const closedOne = await mixedCases(true, true);
    expect(closedOne.row).toMatchObject({ caseMode: 'NONE', missionId: null });
  });
});

describe('reconcileRestoredBranch: safe copy boxes (S23)', () => {
  let oldDb: Db;
  let newDb: Db;

  beforeEach(async () => {
    oldDb = await freshDb();
    newDb = await freshDb();
  });

  const BOXES = [{ x: 0.1, y: 0.2, w: 0.3, h: 0.05 }];

  /** One document version that existed identically on both branches at the restore point. */
  async function sharedVersion(email: string) {
    const owner = await seedAccount(oldDb, email);
    await mirrorRow(newDb, schema.accounts, owner);
    const applicant = await seedApplicant(oldDb, owner.id);
    await mirrorRow(newDb, schema.applicants, applicant);
    const document = await registerDocument(oldDb, {
      actorAccountId: owner.id,
      applicantId: applicant.id,
      originalName: 'synthetic.pdf',
      docType: 'PASSPORT',
    });
    if (!isOk(document)) throw new Error('document');
    const version = await addDocumentVersion(oldDb, {
      actorAccountId: owner.id,
      documentId: document.value.id,
      bucket: 'CLEAN',
      objectKey: `recon-${randomBytes(4).toString('hex')}`,
      safetyStatus: 'CLEAN',
      processingStatus: 'APPROVED',
    });
    if (!isOk(version)) throw new Error('version');
    for (const [table, id] of [
      [schema.documents, document.value.id],
      [schema.storageObjects, version.value.storageObject.id],
      [schema.documentVersions, version.value.version.id],
    ] as const) {
      const rows = await oldDb.select().from(table).where(eq(table.id, id));
      for (const row of rows) await mirrorRow(newDb, table, row);
    }
    return { owner, documentId: document.value.id, versionId: version.value.version.id };
  }

  async function masks(db: Db, versionId: string) {
    return db
      .select({ page: schema.redactionMasks.page, boxes: schema.redactionMasks.boxes })
      .from(schema.redactionMasks)
      .where(eq(schema.redactionMasks.documentVersionId, versionId))
      .orderBy(schema.redactionMasks.page);
  }

  async function writeMasks(db: Db, versionId: string, ownerId: string, pages: unknown[][]) {
    await db
      .delete(schema.redactionMasks)
      .where(eq(schema.redactionMasks.documentVersionId, versionId));
    for (const [index, boxes] of pages.entries()) {
      await db.insert(schema.redactionMasks).values({
        documentVersionId: versionId,
        page: index + 1,
        boxes: boxes as never,
        source: 'OWNER',
        createdByAccountId: ownerId,
      });
    }
  }

  async function event(
    eventType: 'DOCUMENT_REDACTION_SAVED' | 'DOCUMENT_REDACTION_CLEARED',
    documentId: string,
    versionId: string,
  ) {
    await oldDb.insert(schema.auditEvents).values({
      occurredAt: AFTER,
      eventType,
      method: 'API',
      result: 'ALLOWED',
      resourceType: 'document',
      resourceId: documentId,
      metadata: { documentVersionId: versionId, pageCount: 2, boxCount: 1 },
      hash: `test-hash-${randomBytes(4).toString('hex')}`,
    });
  }

  it('sets the boxes to what the owner saved after the restore point, and a second run is a no-op', async () => {
    const { owner, documentId, versionId } = await sharedVersion('recon-masks@example.com');
    // At the restore point the version had no boxes; afterwards the owner prepared two pages.
    await writeMasks(oldDb, versionId, owner.id, [BOXES, []]);
    await event('DOCUMENT_REDACTION_SAVED', documentId, versionId);

    const report = await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);
    expect(report.errors).toEqual([]);
    expect(report.counts.redactionMasksReconciled).toBe(1);
    expect(await masks(newDb, versionId)).toEqual([
      { page: 1, boxes: BOXES },
      { page: 2, boxes: [] },
    ]);
    const again = await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);
    expect(again.counts.redactionMasksReconciled).toBe(0);
  });

  it('removes boxes the owner cleared after the restore point, so nothing older is served', async () => {
    const { owner, documentId, versionId } = await sharedVersion('recon-clear@example.com');
    await writeMasks(newDb, versionId, owner.id, [[], []]);
    await event('DOCUMENT_REDACTION_CLEARED', documentId, versionId);
    const report = await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);
    expect(report.counts.redactionMasksReconciled).toBe(1);
    expect(await masks(newDb, versionId)).toEqual([]);
  });

  it('fails closed: when the newer boxes cannot be copied, the version is left not prepared', async () => {
    const { owner, documentId, versionId } = await sharedVersion('recon-fail@example.com');
    // The restored branch holds an older "nothing to hide"; the newer boxes were saved by an
    // account the restored branch does not have, so copying them fails.
    await writeMasks(newDb, versionId, owner.id, [[], []]);
    const later = await seedAccount(oldDb, 'recon-later@example.com');
    await writeMasks(oldDb, versionId, later.id, [BOXES, []]);
    await event('DOCUMENT_REDACTION_SAVED', documentId, versionId);
    const report = await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]?.eventType).toBe('DOCUMENT_REDACTION_SAVED');
    expect(await masks(newDb, versionId)).toEqual([]);
  });

  it('is a clean no-op when the restored branch predates the safe copy table', async () => {
    const { owner, documentId, versionId } = await sharedVersion('recon-old@example.com');
    await writeMasks(oldDb, versionId, owner.id, [BOXES]);
    await event('DOCUMENT_REDACTION_SAVED', documentId, versionId);
    await newDb.execute(sql`drop table redaction_masks`);
    const report = await reconcileRestoredBranch(oldDb, newDb, RESTORE_POINT);
    expect(report.errors).toEqual([]);
    expect(report.counts.redactionMasksReconciled).toBe(0);
  });
});
