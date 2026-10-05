import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import {
  assignComplaintOwner,
  fileComplaint,
  listComplaintEvents,
  listComplaintsForMission,
  listComplaintsForQualityReview,
  updateComplaintStatus,
  withdrawOwnComplaint,
} from './complaints';
import { setConsent } from './consent';
import type { Db } from './db';
import { createMission } from './missions';
import { createOrganization, reviewOrganization } from './organizations';
import { grantPlatformRole } from './platform-roles';
import { acceptGrant, createGrant } from './sharing';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

async function seed(db: Db) {
  const p = await provisionAccount(db, { email: 'complaint@example.com' });
  if (!isOk(p)) throw new Error('provision');
  const account = p.value;
  await setConsent(db, {
    actorAccountId: account.id,
    accountId: account.id,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  const applicant = await createApplicant(db, {
    actorAccountId: account.id,
    ownerAccountId: account.id,
    displayName: 'Owner',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  const mission = await createMission(db, {
    actorAccountId: account.id,
    applicantId: applicant.value.id,
    title: 'UK Visa',
  });
  if (!isOk(mission)) throw new Error('mission');
  return { account, applicantId: applicant.value.id, missionId: mission.value.id };
}

/** Bootstraps a PLATFORM_OWNER, then has it grant a fresh account QUALITY_ADMIN. */
async function seedQualityAdmin(db: Db) {
  const owner = await provisionAccount(db, { email: 'quality-bootstrap@example.com' });
  if (!isOk(owner)) throw new Error('provision');
  const ownerAuth = {
    accountId: owner.value.id,
    email: 'quality-bootstrap@example.com',
    bootstrapEmails: ['quality-bootstrap@example.com'],
  };
  // The very first grant always becomes PLATFORM_OWNER regardless of the
  // requested role (finding #16) -- so bootstrap the owner first, then have
  // it grant QUALITY_ADMIN to a second, non-bootstrap account.
  await grantPlatformRole(db, {
    actor: ownerAuth,
    targetAccountId: owner.value.id,
    role: 'PLATFORM_OWNER',
    reason: 'bootstrap',
    stepUpSatisfied: true,
  });
  const admin = await provisionAccount(db, { email: 'quality-admin@example.com' });
  if (!isOk(admin)) throw new Error('provision');
  const granted = await grantPlatformRole(db, {
    actor: ownerAuth,
    targetAccountId: admin.value.id,
    role: 'QUALITY_ADMIN',
    reason: 'quality team member',
    stepUpSatisfied: true,
  });
  if (!isOk(granted)) throw new Error('grant');
  return { accountId: admin.value.id, email: 'quality-admin@example.com', bootstrapEmails: [] };
}

describe('TRU-04 (Commercial V1 Part 7 §9): case complaint workflow', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('files a complaint (owner-only) and records the opening history event', async () => {
    const { account, missionId } = await seed(db);
    const result = await fileComplaint(db, {
      actorAccountId: account.id,
      missionId,
      description: 'My agency has not responded in three weeks.',
    });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.missionId).toBe(missionId);
    expect(result.value.filedByAccountId).toBe(account.id);
    expect(result.value.status).toBe('OPEN');
    expect(result.value.ownerAccountId).toBeNull();
    expect(result.value.resolution).toBeNull();

    const events = await listComplaintEvents(db, account.id, result.value.id);
    expect(isOk(events)).toBe(true);
    if (!isOk(events)) return;
    expect(events.value).toHaveLength(1);
    expect(events.value[0]?.fromStatus).toBeNull();
    expect(events.value[0]?.toStatus).toBe('OPEN');
  });

  it('refuses an empty description', async () => {
    const { account, missionId } = await seed(db);
    const result = await fileComplaint(db, {
      actorAccountId: account.id,
      missionId,
      description: '   ',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('invalid');
  });

  it('refuses an org member filing a complaint merely because they manage the case, even with a MANAGE grant', async () => {
    const { account, applicantId, missionId } = await seed(db);
    await setConsent(db, {
      actorAccountId: account.id,
      accountId: account.id,
      type: 'SHARING',
      granted: true,
    });
    const agent = await provisionAccount(db, { email: 'complaint-agent@example.com' });
    if (!isOk(agent)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agent.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    const admin = await provisionAccount(db, { email: 'complaint-org-admin@example.com' });
    if (!isOk(admin)) throw new Error('provision');
    await reviewOrganization(db, {
      reviewerAccountId: admin.value.id,
      organizationId: org.value.id,
      decision: 'ACTIVE',
      stepUpSatisfied: true,
    });
    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['MANAGE'],
      purpose: 'case_management',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agent.value.id, grantId: grant.value.id });

    const result = await fileComplaint(db, {
      actorAccountId: agent.value.id,
      missionId,
      description: 'Filed by the agency, not the applicant.',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('forbidden');
  });

  it('listComplaintsForMission is owner-scoped, newest first, and refuses a stranger', async () => {
    const { account, missionId } = await seed(db);
    await fileComplaint(db, {
      actorAccountId: account.id,
      missionId,
      description: 'First complaint.',
    });
    await fileComplaint(db, {
      actorAccountId: account.id,
      missionId,
      description: 'Second complaint.',
    });

    const list = await listComplaintsForMission(db, account.id, missionId);
    expect(isOk(list)).toBe(true);
    if (!isOk(list)) return;
    expect(list.value).toHaveLength(2);
    expect(list.value[0]?.description).toBe('Second complaint.');

    const stranger = await provisionAccount(db, { email: 'complaint-stranger@example.com' });
    if (!isOk(stranger)) throw new Error('provision');
    const denied = await listComplaintsForMission(db, stranger.value.id, missionId);
    expect(isErr(denied)).toBe(true);
    if (isErr(denied)) expect(denied.error.code).toBe('forbidden');
  });

  it('the filer can withdraw their own open complaint, moving it to CLOSED with a history event', async () => {
    const { account, missionId } = await seed(db);
    const filed = await fileComplaint(db, {
      actorAccountId: account.id,
      missionId,
      description: 'x',
    });
    if (!isOk(filed)) throw new Error('file');

    const withdrawn = await withdrawOwnComplaint(db, {
      actorAccountId: account.id,
      complaintId: filed.value.id,
    });
    expect(isOk(withdrawn)).toBe(true);
    if (isOk(withdrawn)) expect(withdrawn.value.status).toBe('CLOSED');

    const events = await listComplaintEvents(db, account.id, filed.value.id);
    expect(isOk(events)).toBe(true);
    if (isOk(events)) {
      expect(events.value).toHaveLength(2);
      expect(events.value[1]?.toStatus).toBe('CLOSED');
      expect(events.value[1]?.note).toContain('Withdrawn');
    }
  });

  it("refuses a non-filer withdrawing someone else's complaint", async () => {
    const { account, missionId } = await seed(db);
    const filed = await fileComplaint(db, {
      actorAccountId: account.id,
      missionId,
      description: 'x',
    });
    if (!isOk(filed)) throw new Error('file');
    const stranger = await provisionAccount(db, { email: 'complaint-stranger2@example.com' });
    if (!isOk(stranger)) throw new Error('provision');

    const result = await withdrawOwnComplaint(db, {
      actorAccountId: stranger.value.id,
      complaintId: filed.value.id,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('forbidden');
  });

  it('refuses withdrawing an already RESOLVED or CLOSED complaint', async () => {
    const { account, missionId } = await seed(db);
    const filed = await fileComplaint(db, {
      actorAccountId: account.id,
      missionId,
      description: 'x',
    });
    if (!isOk(filed)) throw new Error('file');
    const admin = await seedQualityAdmin(db);
    const resolved = await updateComplaintStatus(db, {
      actor: admin,
      complaintId: filed.value.id,
      status: 'RESOLVED',
      resolution: 'Refunded and apologized.',
    });
    expect(isOk(resolved)).toBe(true);

    const result = await withdrawOwnComplaint(db, {
      actorAccountId: account.id,
      complaintId: filed.value.id,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('invalid');
  });

  it('QUALITY_ADMIN moves a complaint through legal transitions, requiring a resolution to RESOLVE it', async () => {
    const { account, missionId } = await seed(db);
    const filed = await fileComplaint(db, {
      actorAccountId: account.id,
      missionId,
      description: 'x',
    });
    if (!isOk(filed)) throw new Error('file');
    const admin = await seedQualityAdmin(db);

    const noResolution = await updateComplaintStatus(db, {
      actor: admin,
      complaintId: filed.value.id,
      status: 'RESOLVED',
    });
    expect(isErr(noResolution)).toBe(true);
    if (isErr(noResolution)) expect(noResolution.error.code).toBe('invalid');

    const inProgress = await updateComplaintStatus(db, {
      actor: admin,
      complaintId: filed.value.id,
      status: 'IN_PROGRESS',
      note: 'Investigating.',
    });
    expect(isOk(inProgress)).toBe(true);
    if (isOk(inProgress)) expect(inProgress.value.status).toBe('IN_PROGRESS');

    const resolved = await updateComplaintStatus(db, {
      actor: admin,
      complaintId: filed.value.id,
      status: 'RESOLVED',
      resolution: 'Refunded and apologized.',
    });
    expect(isOk(resolved)).toBe(true);
    if (isOk(resolved)) {
      expect(resolved.value.status).toBe('RESOLVED');
      expect(resolved.value.resolution).toBe('Refunded and apologized.');
    }

    const illegal = await updateComplaintStatus(db, {
      actor: admin,
      complaintId: filed.value.id,
      status: 'IN_PROGRESS',
    });
    expect(isErr(illegal)).toBe(true);
    if (isErr(illegal)) expect(illegal.error.code).toBe('invalid');
  });

  it('refuses updateComplaintStatus, assignComplaintOwner, and listComplaintsForQualityReview without QUALITY_ADMIN permission', async () => {
    const { account, missionId } = await seed(db);
    const filed = await fileComplaint(db, {
      actorAccountId: account.id,
      missionId,
      description: 'x',
    });
    if (!isOk(filed)) throw new Error('file');
    const plain = await provisionAccount(db, { email: 'not-quality@example.com' });
    if (!isOk(plain)) throw new Error('provision');
    const plainAuth = {
      accountId: plain.value.id,
      email: 'not-quality@example.com',
      bootstrapEmails: [],
    };

    const status = await updateComplaintStatus(db, {
      actor: plainAuth,
      complaintId: filed.value.id,
      status: 'IN_PROGRESS',
    });
    expect(isErr(status)).toBe(true);
    if (isErr(status)) expect(status.error.code).toBe('forbidden');

    const assign = await assignComplaintOwner(db, {
      actor: plainAuth,
      complaintId: filed.value.id,
      ownerAccountId: plain.value.id,
    });
    expect(isErr(assign)).toBe(true);
    if (isErr(assign)) expect(assign.error.code).toBe('forbidden');

    const list = await listComplaintsForQualityReview(db, plainAuth);
    expect(isErr(list)).toBe(true);
    if (isErr(list)) expect(list.error.code).toBe('forbidden');
  });

  it('assignComplaintOwner sets the owner and records a history event; listComplaintsForQualityReview sees complaints platform-wide', async () => {
    const { account, missionId } = await seed(db);
    const filed = await fileComplaint(db, {
      actorAccountId: account.id,
      missionId,
      description: 'x',
    });
    if (!isOk(filed)) throw new Error('file');
    const admin = await seedQualityAdmin(db);

    const assigned = await assignComplaintOwner(db, {
      actor: admin,
      complaintId: filed.value.id,
      ownerAccountId: admin.accountId,
    });
    expect(isOk(assigned)).toBe(true);
    if (isOk(assigned)) expect(assigned.value.ownerAccountId).toBe(admin.accountId);

    const list = await listComplaintsForQualityReview(db, admin);
    expect(isOk(list)).toBe(true);
    if (isOk(list)) {
      expect(list.value.some((c) => c.id === filed.value.id)).toBe(true);
    }
  });
});

describe('OPS-04 (Commercial V1 Part 9): complaint-resolution analytics', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  const THREE_DAYS = 3 * 24 * 60 * 60;

  async function endings() {
    return (await db.select().from(schema.productEvents)).filter(
      (e) => e.eventType === 'COMPLAINT_RESOLVED',
    );
  }

  /** A complaint that has been open three days. */
  async function openComplaint() {
    const { account, missionId } = await seed(db);
    const filed = await fileComplaint(db, {
      actorAccountId: account.id,
      missionId,
      description: 'Mr Karim was charged 40,000 BDT twice by the agency',
    });
    if (!isOk(filed)) throw new Error('file');
    await db
      .update(schema.caseComplaints)
      .set({ createdAt: new Date(Date.now() - THREE_DAYS * 1000) })
      .where(eq(schema.caseComplaints.id, filed.value.id));
    return { account, missionId, complaintId: filed.value.id };
  }

  it('records how a complaint was resolved and how long it was open, and nothing of what it said', async () => {
    const { complaintId } = await openComplaint();
    const admin = await seedQualityAdmin(db);
    const resolved = await updateComplaintStatus(db, {
      actor: admin,
      complaintId,
      status: 'RESOLVED',
      resolution: 'Refunded Mr Karim the duplicate 40,000 BDT and apologised',
    });
    expect(isOk(resolved)).toBe(true);

    const events = await endings();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      accountId: admin.accountId,
      organizationId: null,
      dimension: 'RESOLVED',
    });
    expect(events[0]?.metricValue).toBeGreaterThanOrEqual(THREE_DAYS);
    expect(events[0]?.metricValue).toBeLessThan(THREE_DAYS + 300);
    const stored = JSON.stringify(events);
    for (const leaked of ['Karim', '40,000', 'agency', 'Refunded', 'apologised']) {
      expect(stored, leaked).not.toContain(leaked);
    }
  });

  it('labels a complaint closed by the quality reviewer, and one withdrawn by the person who filed it', async () => {
    const closed = await openComplaint();
    const admin = await seedQualityAdmin(db);
    expect(
      isOk(
        await updateComplaintStatus(db, {
          actor: admin,
          complaintId: closed.complaintId,
          status: 'CLOSED',
        }),
      ),
    ).toBe(true);

    const withdrawn = await fileComplaint(db, {
      actorAccountId: closed.account.id,
      missionId: closed.missionId,
      description: 'another',
    });
    if (!isOk(withdrawn)) throw new Error('file');
    expect(
      isOk(
        await withdrawOwnComplaint(db, {
          actorAccountId: closed.account.id,
          complaintId: withdrawn.value.id,
        }),
      ),
    ).toBe(true);

    const events = await endings();
    expect(events.map((e) => e.dimension).sort()).toEqual(['CLOSED', 'WITHDRAWN']);
    expect(events.find((e) => e.dimension === 'WITHDRAWN')?.accountId).toBe(closed.account.id);
    expect(events.find((e) => e.dimension === 'CLOSED')?.accountId).toBe(admin.accountId);
  });

  it('carries the organization of an agency case', async () => {
    const { account, applicantId } = await seed(db);
    const org = await createOrganization(db, { actorAccountId: account.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'Agency case',
      ownerOrganizationId: org.value.id,
    });
    if (!isOk(mission)) throw new Error('mission');
    const filed = await fileComplaint(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      description: 'x',
    });
    if (!isOk(filed)) throw new Error('file');
    await withdrawOwnComplaint(db, { actorAccountId: account.id, complaintId: filed.value.id });
    expect(await endings()).toMatchObject([
      { organizationId: org.value.id, dimension: 'WITHDRAWN' },
    ]);
  });

  it('records nothing for a step that does not end the complaint, or for one that is refused', async () => {
    const { account, complaintId } = await openComplaint();
    const admin = await seedQualityAdmin(db);
    const steps = [
      await updateComplaintStatus(db, { actor: admin, complaintId, status: 'IN_PROGRESS' }),
      // Resolving needs a resolution.
      await updateComplaintStatus(db, { actor: admin, complaintId, status: 'RESOLVED' }),
      // Not a quality admin.
      await updateComplaintStatus(db, {
        actor: { accountId: account.id, email: 'complaint@example.com', bootstrapEmails: [] },
        complaintId,
        status: 'CLOSED',
      }),
    ];
    expect(steps.map((r) => isOk(r))).toEqual([true, false, false]);
    expect(await endings()).toEqual([]);
  });
});
