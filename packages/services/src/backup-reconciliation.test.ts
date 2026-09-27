import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { reconcileRestoredBranch } from './backup-reconciliation';
import { sweepCaseRetentionPurge } from './case-retention';
import { setConsent } from './consent';
import { type Db, first } from './db';
import { executeAccountDeletion, requestAccountDeletion } from './deletion';
import { placeLegalHold, releaseLegalHold } from './legal-hold';
import { createMission, transitionMission } from './missions';
import {
  createOrganization,
  reviewOrganization,
  suspendOrganization,
  terminateOrganization,
} from './organizations';
import { grantPlatformRole, revokePlatformRole } from './platform-roles';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
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
});
