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
import { setConsent } from './consent';
import { type Db, first } from './db';
import { registerDocument } from './documents';
import {
  documentBlockedByLegalHold,
  legalHoldReminderIntervalDays,
  listActiveLegalHoldsForAccount,
  missionBlockedByLegalHold,
  placeLegalHold,
  sweepLegalHoldReviewReminders,
} from './legal-hold';
import { createMission } from './missions';
import { createOrganization, reviewOrganization } from './organizations';
import { addPackVersion, addRequirement, createPack } from './packs';
import { grantPlatformRole } from './platform-roles';
import { acceptGrant, createGrant, pauseGrant, revokeGrant } from './sharing';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

async function seedApplicant(db: Db, email: string) {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision failed');
  const account = provisioned.value;
  await setConsent(db, {
    actorAccountId: account.id,
    accountId: account.id,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  await setConsent(db, {
    actorAccountId: account.id,
    accountId: account.id,
    type: 'SHARING',
    granted: true,
  });
  const applicant = await createApplicant(db, {
    actorAccountId: account.id,
    ownerAccountId: account.id,
    displayName: 'Traveller',
  });
  if (!isOk(applicant)) throw new Error('applicant failed');
  return { accountId: account.id, applicantId: applicant.value.id };
}

/** A future date safely past `placeLegalHold`'s own "must be in the future" check. */
function soon(): Date {
  return new Date(Date.now() + 60_000);
}

/** A mission with one document selected as its evidence for a requirement -- the minimal real `selectedEvidence` link `missionsSelectingDocument` (and so `documentBlockedByLegalHold`'s mission-reach) actually reads. Inserted directly rather than through `selectEvidence` itself: this only needs the FK targets to exist for real, not the full attach/approve/publish ceremony that service function's own authorization checks require. */
async function seedMissionWithDocument(
  db: Db,
  accountId: string,
  applicantId: string,
  title: string,
): Promise<{ missionId: string; documentId: string }> {
  const pack = await createPack(db, {
    actorAccountId: accountId,
    key: `pack-${title.toLowerCase().replace(/\s+/g, '-')}`,
    name: 'Test Pack',
  });
  if (!isOk(pack)) throw new Error('pack');
  const version = await addPackVersion(db, { actorAccountId: accountId, packId: pack.value.id });
  if (!isOk(version)) throw new Error('version');
  const requirement = await addRequirement(db, {
    actorAccountId: accountId,
    packVersionId: version.value.id,
    kind: 'DOCUMENT',
    docType: 'bank_statement',
    citation: 'rule 1',
  });
  if (!isOk(requirement)) throw new Error('requirement');

  const mission = await createMission(db, { actorAccountId: accountId, applicantId, title });
  if (!isOk(mission)) throw new Error('mission');

  const doc = await registerDocument(db, {
    actorAccountId: accountId,
    applicantId,
    originalName: 'evidence.pdf',
    docType: 'bank_statement',
  });
  if (!isOk(doc)) throw new Error('doc');

  await db.insert(schema.selectedEvidence).values({
    missionId: mission.value.id,
    packRequirementId: requirement.value.id,
    documentId: doc.value.id,
    selectedByAccountId: accountId,
  });

  return { missionId: mission.value.id, documentId: doc.value.id };
}

/** Independently verify a PENDING_VERIFICATION org (createGrant requires an ACTIVE recipient organization) - mirrors sharing.test.ts's own identical helper. */
async function activateOrg(db: Db, organizationId: string): Promise<void> {
  const reviewer = await provisionAccount(db, {
    email: `reviewer-${organizationId}@platform.example.com`,
  });
  if (!isOk(reviewer)) throw new Error('reviewer');
  const reviewed = await reviewOrganization(db, {
    reviewerAccountId: reviewer.value.id,
    organizationId,
    decision: 'ACTIVE',
    stepUpSatisfied: true,
  });
  if (!isOk(reviewed)) throw new Error('review');
}

describe('legal holds - who can access (Part 7 §13)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('accessibleTo lists only a genuinely current (ACTIVE, unexpired) grant recipient, never a paused or revoked one', async () => {
    const { accountId, applicantId } = await seedApplicant(db, 'holder@example.com');
    await placeLegalHold(db, {
      actorAccountId: accountId,
      applicantId,
      reason: 'investigation',
      reviewAt: soon(),
      stepUpSatisfied: true,
    });

    const activeOrg = await createOrganization(db, {
      actorAccountId: accountId,
      name: 'Active Org',
    });
    const pausedOrg = await createOrganization(db, {
      actorAccountId: accountId,
      name: 'Paused Org',
    });
    const revokedOrg = await createOrganization(db, {
      actorAccountId: accountId,
      name: 'Revoked Org',
    });
    if (!isOk(activeOrg) || !isOk(pausedOrg) || !isOk(revokedOrg)) throw new Error('org');
    await activateOrg(db, activeOrg.value.id);
    await activateOrg(db, pausedOrg.value.id);
    await activateOrg(db, revokedOrg.value.id);

    const activeGrant = await createGrant(db, {
      actorAccountId: accountId,
      applicantId,
      recipientOrganizationId: activeOrg.value.id,
      actions: ['PREVIEW'],
      purpose: 'visa_application',
    });
    const pausedGrant = await createGrant(db, {
      actorAccountId: accountId,
      applicantId,
      recipientOrganizationId: pausedOrg.value.id,
      actions: ['PREVIEW'],
      purpose: 'visa_application',
    });
    const revokedGrant = await createGrant(db, {
      actorAccountId: accountId,
      applicantId,
      recipientOrganizationId: revokedOrg.value.id,
      actions: ['PREVIEW'],
      purpose: 'visa_application',
    });
    if (!isOk(activeGrant) || !isOk(pausedGrant) || !isOk(revokedGrant)) throw new Error('grant');

    await acceptGrant(db, { actorAccountId: accountId, grantId: activeGrant.value.id });
    await acceptGrant(db, { actorAccountId: accountId, grantId: pausedGrant.value.id });
    await acceptGrant(db, { actorAccountId: accountId, grantId: revokedGrant.value.id });
    await pauseGrant(db, { actorAccountId: accountId, grantId: pausedGrant.value.id });
    await revokeGrant(db, { actorAccountId: accountId, grantId: revokedGrant.value.id });

    const holds = await listActiveLegalHoldsForAccount(db, accountId);
    expect(holds).toHaveLength(1);
    expect(holds[0]?.accessibleTo).toEqual(['Active Org']);
  });

  it('accessibleTo is empty when nobody currently has access', async () => {
    const { accountId, applicantId } = await seedApplicant(db, 'nobody@example.com');
    await placeLegalHold(db, {
      actorAccountId: accountId,
      applicantId,
      reason: 'investigation',
      reviewAt: soon(),
      stepUpSatisfied: true,
    });
    const holds = await listActiveLegalHoldsForAccount(db, accountId);
    expect(holds).toHaveLength(1);
    expect(holds[0]?.accessibleTo).toEqual([]);
  });
});

describe('legal holds - scheduled review reminder (Part 7 §13)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  async function seedComplianceAdmins(db: Db, count: number): Promise<string[]> {
    const owner = await provisionAccount(db, { email: 'owner@example.com' });
    if (!isOk(owner)) throw new Error('provision');
    const ownerAuth = {
      accountId: owner.value.id,
      email: 'owner@example.com',
      bootstrapEmails: ['owner@example.com'],
    };
    await grantPlatformRole(db, {
      actor: ownerAuth,
      targetAccountId: owner.value.id,
      role: 'PLATFORM_OWNER',
      reason: 'bootstrap',
      stepUpSatisfied: true,
    });
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const admin = await provisionAccount(db, { email: `compliance-${i}@example.com` });
      if (!isOk(admin)) throw new Error('provision');
      await grantPlatformRole(db, {
        actor: ownerAuth,
        targetAccountId: admin.value.id,
        role: 'COMPLIANCE_ADMIN',
        reason: 'seed',
        stepUpSatisfied: true,
      });
      ids.push(admin.value.id);
    }
    return ids;
  }

  async function makeOverdue(db: Db, holdId: string): Promise<void> {
    await db
      .update(schema.legalHolds)
      .set({ reviewAt: new Date(Date.now() - 1000) })
      .where(eq(schema.legalHolds.id, holdId));
  }

  it('notifies every current COMPLIANCE_ADMIN once a hold becomes overdue, and records when', async () => {
    const admins = await seedComplianceAdmins(db, 2);
    const { accountId, applicantId } = await seedApplicant(db, 'overdue@example.com');
    const hold = await placeLegalHold(db, {
      actorAccountId: accountId,
      applicantId,
      reason: 'fraud review',
      reviewAt: soon(),
      stepUpSatisfied: true,
    });
    if (!isOk(hold)) throw new Error('hold');
    await makeOverdue(db, hold.value.id);

    const result = await sweepLegalHoldReviewReminders(db);
    expect(result).toEqual({ checked: 1, notified: 1 });

    const row = first(
      await db.select().from(schema.legalHolds).where(eq(schema.legalHolds.id, hold.value.id)),
    );
    expect(row?.lastReviewReminderAt).not.toBeNull();

    for (const adminId of admins) {
      const notice = first(
        await db
          .select()
          .from(schema.notifications)
          .where(
            and(
              eq(schema.notifications.eventType, 'LEGAL_HOLD_REVIEW_REMINDER'),
              eq(schema.notifications.recipientAccountId, adminId),
            ),
          ),
      );
      expect(notice).toBeDefined();
    }
  });

  it('does not re-notify again before the reminder interval has passed', async () => {
    await seedComplianceAdmins(db, 1);
    const { accountId, applicantId } = await seedApplicant(db, 'too-soon@example.com');
    const hold = await placeLegalHold(db, {
      actorAccountId: accountId,
      applicantId,
      reason: 'fraud review',
      reviewAt: soon(),
      stepUpSatisfied: true,
    });
    if (!isOk(hold)) throw new Error('hold');
    await makeOverdue(db, hold.value.id);

    await sweepLegalHoldReviewReminders(db);
    const second = await sweepLegalHoldReviewReminders(db);
    expect(second).toEqual({ checked: 1, notified: 0 });
  });

  it('re-notifies once the reminder interval has elapsed', async () => {
    await seedComplianceAdmins(db, 1);
    const { accountId, applicantId } = await seedApplicant(db, 'interval-elapsed@example.com');
    const hold = await placeLegalHold(db, {
      actorAccountId: accountId,
      applicantId,
      reason: 'fraud review',
      reviewAt: soon(),
      stepUpSatisfied: true,
    });
    if (!isOk(hold)) throw new Error('hold');
    await makeOverdue(db, hold.value.id);
    await sweepLegalHoldReviewReminders(db);

    // Simulate the interval having fully elapsed since the last reminder.
    const intervalMs = legalHoldReminderIntervalDays() * 24 * 60 * 60 * 1000;
    await db
      .update(schema.legalHolds)
      .set({ lastReviewReminderAt: new Date(Date.now() - intervalMs - 1000) })
      .where(eq(schema.legalHolds.id, hold.value.id));

    const result = await sweepLegalHoldReviewReminders(db);
    expect(result).toEqual({ checked: 1, notified: 1 });
  });
});

describe('legal holds - exact scope (Part 7 §13)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('rejects a hold scoped to both a mission and a document', async () => {
    const { accountId, applicantId } = await seedApplicant(db, 'both-scopes@example.com');
    const { missionId, documentId } = await seedMissionWithDocument(
      db,
      accountId,
      applicantId,
      'Both scopes case',
    );
    const result = await placeLegalHold(db, {
      actorAccountId: accountId,
      applicantId,
      reason: 'test',
      reviewAt: soon(),
      stepUpSatisfied: true,
      missionId,
      documentId,
    });
    expect(isOk(result)).toBe(false);
  });

  it('rejects a mission that does not belong to the given applicant', async () => {
    const owner = await seedApplicant(db, 'scope-owner@example.com');
    const stranger = await seedApplicant(db, 'scope-stranger@example.com');
    const { missionId } = await seedMissionWithDocument(
      db,
      stranger.accountId,
      stranger.applicantId,
      'Stranger case',
    );
    const result = await placeLegalHold(db, {
      actorAccountId: owner.accountId,
      applicantId: owner.applicantId,
      reason: 'test',
      reviewAt: soon(),
      stepUpSatisfied: true,
      missionId,
    });
    expect(isOk(result)).toBe(false);
  });

  it('rejects a document that does not belong to the given applicant', async () => {
    const owner = await seedApplicant(db, 'doc-scope-owner@example.com');
    const stranger = await seedApplicant(db, 'doc-scope-stranger@example.com');
    const { documentId } = await seedMissionWithDocument(
      db,
      stranger.accountId,
      stranger.applicantId,
      'Stranger doc case',
    );
    const result = await placeLegalHold(db, {
      actorAccountId: owner.accountId,
      applicantId: owner.applicantId,
      reason: 'test',
      reviewAt: soon(),
      stepUpSatisfied: true,
      documentId,
    });
    expect(isOk(result)).toBe(false);
  });

  describe('missionBlockedByLegalHold', () => {
    it('an applicant-wide hold blocks every mission under that applicant', async () => {
      const { accountId, applicantId } = await seedApplicant(
        db,
        'applicant-wide-mission@example.com',
      );
      const { missionId } = await seedMissionWithDocument(db, accountId, applicantId, 'Case A');
      const placed = await placeLegalHold(db, {
        actorAccountId: accountId,
        applicantId,
        reason: 'investigation',
        reviewAt: soon(),
        stepUpSatisfied: true,
      });
      expect(isOk(placed)).toBe(true);
      expect(await missionBlockedByLegalHold(db, { applicantId, missionId })).toBe(true);
    });

    it('a mission-scoped hold blocks only that mission, not a sibling mission', async () => {
      const { accountId, applicantId } = await seedApplicant(db, 'mission-scoped@example.com');
      const held = await seedMissionWithDocument(db, accountId, applicantId, 'Held case');
      const sibling = await seedMissionWithDocument(db, accountId, applicantId, 'Sibling case');
      const placed = await placeLegalHold(db, {
        actorAccountId: accountId,
        applicantId,
        reason: 'investigation',
        reviewAt: soon(),
        stepUpSatisfied: true,
        missionId: held.missionId,
      });
      expect(isOk(placed)).toBe(true);
      expect(await missionBlockedByLegalHold(db, { applicantId, missionId: held.missionId })).toBe(
        true,
      );
      expect(
        await missionBlockedByLegalHold(db, { applicantId, missionId: sibling.missionId }),
      ).toBe(false);
    });

    it('a document-scoped hold never blocks any mission', async () => {
      const { accountId, applicantId } = await seedApplicant(
        db,
        'doc-never-blocks-mission@example.com',
      );
      const { missionId, documentId } = await seedMissionWithDocument(
        db,
        accountId,
        applicantId,
        'Case with held document',
      );
      const placed = await placeLegalHold(db, {
        actorAccountId: accountId,
        applicantId,
        reason: 'investigation',
        reviewAt: soon(),
        stepUpSatisfied: true,
        documentId,
      });
      expect(isOk(placed)).toBe(true);
      expect(await missionBlockedByLegalHold(db, { applicantId, missionId })).toBe(false);
    });
  });

  describe('documentBlockedByLegalHold', () => {
    it('an applicant-wide hold blocks every document under that applicant', async () => {
      const { accountId, applicantId } = await seedApplicant(db, 'applicant-wide-doc@example.com');
      const { documentId } = await seedMissionWithDocument(db, accountId, applicantId, 'Case B');
      const placed = await placeLegalHold(db, {
        actorAccountId: accountId,
        applicantId,
        reason: 'investigation',
        reviewAt: soon(),
        stepUpSatisfied: true,
      });
      expect(isOk(placed)).toBe(true);
      expect(await documentBlockedByLegalHold(db, { applicantId, documentId })).toBe(true);
    });

    it('a document-scoped hold blocks only that document, not a sibling document', async () => {
      const { accountId, applicantId } = await seedApplicant(db, 'document-scoped@example.com');
      const held = await seedMissionWithDocument(db, accountId, applicantId, 'Held doc case');
      const sibling = await seedMissionWithDocument(db, accountId, applicantId, 'Sibling doc case');
      const placed = await placeLegalHold(db, {
        actorAccountId: accountId,
        applicantId,
        reason: 'investigation',
        reviewAt: soon(),
        stepUpSatisfied: true,
        documentId: held.documentId,
      });
      expect(isOk(placed)).toBe(true);
      expect(
        await documentBlockedByLegalHold(db, { applicantId, documentId: held.documentId }),
      ).toBe(true);
      expect(
        await documentBlockedByLegalHold(db, { applicantId, documentId: sibling.documentId }),
      ).toBe(false);
    });

    it('a mission-scoped hold blocks a document currently selected as evidence by that mission', async () => {
      const { accountId, applicantId } = await seedApplicant(db, 'mission-reaches-doc@example.com');
      const { missionId, documentId } = await seedMissionWithDocument(
        db,
        accountId,
        applicantId,
        'Case reaching its evidence',
      );
      const placed = await placeLegalHold(db, {
        actorAccountId: accountId,
        applicantId,
        reason: 'investigation',
        reviewAt: soon(),
        stepUpSatisfied: true,
        missionId,
      });
      expect(isOk(placed)).toBe(true);
      expect(await documentBlockedByLegalHold(db, { applicantId, documentId })).toBe(true);
    });

    it('a mission-scoped hold does not block a document that mission never selected', async () => {
      const { accountId, applicantId } = await seedApplicant(
        db,
        'mission-unrelated-doc@example.com',
      );
      const held = await seedMissionWithDocument(db, accountId, applicantId, 'Held case unrelated');
      const unrelated = await seedMissionWithDocument(db, accountId, applicantId, 'Unrelated case');
      const placed = await placeLegalHold(db, {
        actorAccountId: accountId,
        applicantId,
        reason: 'investigation',
        reviewAt: soon(),
        stepUpSatisfied: true,
        missionId: held.missionId,
      });
      expect(isOk(placed)).toBe(true);
      expect(
        await documentBlockedByLegalHold(db, { applicantId, documentId: unrelated.documentId }),
      ).toBe(false);
    });
  });
});
