import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { accountPrincipal, requireAccess } from './access';
import { listAccessEndsForOrg } from './access-ends';
import { verifyStepUp } from './access/step-up-proof';
import { systemScopeForTest } from './access/system-scope.test-support';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { createMission } from './missions';
import { sweepGrantExpiryReminders } from './notification-sweep';
import {
  AGENCY_ACCESS_ENDING_EVENT,
  GRANT_ENDING_EVENT,
  type NotificationPayload,
  cancelQueuedNotificationsForResource,
  runNotificationWorker,
} from './notifications';
import { addMembership, createOrganization, reviewOrganization } from './organizations';
import type { EmailPort, SendEmailInput, SendEmailResult } from './ports';
import {
  GRANT_EXTEND_ENDED,
  GRANT_EXTEND_RESUME_FIRST,
  GRANT_EXTENSION_DAYS,
  acceptGrant,
  createGrant,
  extendGrant,
  extendedGrantEnd,
  pauseGrant,
  revokeGrant,
} from './sharing';
import { issueStepUpAssurance } from './step-up';

const DAY = 24 * 60 * 60 * 1000;

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, { schema }) as unknown as Db;
}

async function makeAccount(db: Db, email: string) {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision');
  const account = provisioned.value;
  for (const type of ['CORE_PROCESSING', 'SHARING'] as const) {
    await setConsent(db, {
      actorAccountId: account.id,
      accountId: account.id,
      type,
      granted: true,
    });
  }
  return account;
}

async function makeTraveller(db: Db, email: string, name = 'Traveller One') {
  const account = await makeAccount(db, email);
  const applicant = await createApplicant(db, {
    actorAccountId: account.id,
    ownerAccountId: account.id,
    displayName: name,
  });
  if (!isOk(applicant)) throw new Error('applicant');
  return { account, applicantId: applicant.value.id };
}

/** An active agency with an owner, an admin and a plain case manager. */
async function makeAgency(db: Db) {
  const owner = await makeAccount(db, 'agency-owner@acme.example.com');
  const org = await createOrganization(db, { actorAccountId: owner.id, name: 'Acme Visas' });
  if (!isOk(org)) throw new Error('org');
  const reviewer = await makeAccount(db, 'reviewer@platform.example.com');
  const reviewed = await reviewOrganization(db, {
    reviewerAccountId: reviewer.id,
    organizationId: org.value.id,
    decision: 'ACTIVE',
    stepUpSatisfied: true,
  });
  if (!isOk(reviewed)) throw new Error('review');
  const admin = await makeAccount(db, 'agency-admin@acme.example.com');
  const manager = await makeAccount(db, 'agency-manager@acme.example.com');
  for (const [member, role] of [
    [admin, 'ADMIN'],
    [manager, 'CASE_MANAGER'],
  ] as const) {
    const added = await addMembership(db, {
      actorAccountId: owner.id,
      organizationId: org.value.id,
      accountId: member.id,
      role,
    });
    if (!isOk(added)) throw new Error('membership');
  }
  return { orgId: org.value.id, owner, admin, manager };
}

/** An accepted grant that ends `days` from the real clock. */
async function activeGrant(
  db: Db,
  input: {
    readonly travellerId: string;
    readonly applicantId: string;
    readonly recipientOrganizationId?: string;
    readonly recipientAccountId?: string;
    readonly acceptingAccountId: string;
    readonly days: number;
  },
) {
  const created = await createGrant(db, {
    actorAccountId: input.travellerId,
    applicantId: input.applicantId,
    ...(input.recipientOrganizationId
      ? { recipientOrganizationId: input.recipientOrganizationId }
      : {}),
    ...(input.recipientAccountId ? { recipientAccountId: input.recipientAccountId } : {}),
    actions: ['PREVIEW'],
    purpose: 'visa_application',
    expiryAt: new Date(Date.now() + input.days * DAY),
  });
  if (!isOk(created)) throw new Error(`grant: ${created.error.message}`);
  const accepted = await acceptGrant(db, {
    actorAccountId: input.acceptingAccountId,
    grantId: created.value.id,
  });
  if (!isOk(accepted)) throw new Error(`accept: ${accepted.error.message}`);
  return accepted.value;
}

async function proofFor(db: Db, accountId: string, applicantId: string) {
  const access = await requireAccess(
    db,
    accountPrincipal(accountId),
    'MANAGE',
    { applicantId },
    { purpose: 'self' },
  );
  return access;
}

async function ownerProof(db: Db, accountId: string, applicantId: string) {
  const access = await proofFor(db, accountId, applicantId);
  if (!access.ok) throw new Error('owner proof');
  return access.value;
}

async function notificationsFor(db: Db, grantId: string) {
  return db.select().from(schema.notifications).where(eq(schema.notifications.resourceId, grantId));
}

const SCOPE = systemScopeForTest('process-notification-sweeps');

describe('extendedGrantEnd', () => {
  it('adds 30 days to the current end, never passes 90 days from now, never shortens', () => {
    const now = new Date('2026-11-10T09:00:00Z');
    const current = new Date(now.getTime() + 5 * DAY);
    expect(extendedGrantEnd(current, now).getTime()).toBe(current.getTime() + 30 * DAY);
    const late = new Date(now.getTime() + 80 * DAY);
    expect(extendedGrantEnd(late, now).getTime()).toBe(now.getTime() + 90 * DAY);
    const beyond = new Date(now.getTime() + 100 * DAY);
    expect(extendedGrantEnd(beyond, now).getTime()).toBe(beyond.getTime());
  });
});

describe('sharing ends soon: the reminder', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('reminds the traveller once, a week before an ordinary grant ends, and never twice', async () => {
    const { account, applicantId } = await makeTraveller(db, 'solo@example.com');
    const friend = await makeAccount(db, 'friend@example.com');
    const grant = await activeGrant(db, {
      travellerId: account.id,
      applicantId,
      recipientAccountId: friend.id,
      acceptingAccountId: friend.id,
      days: 40,
    });
    const expiry = grant.expiryAt as Date;
    const at = new Date(expiry.getTime() - 7 * DAY + 60 * 60 * 1000);

    const first = await sweepGrantExpiryReminders(db, SCOPE, at);
    expect(first.enqueued).toBe(2);
    const second = await sweepGrantExpiryReminders(db, SCOPE, at);
    expect(second.enqueued).toBe(0);
    // A later run inside the window is the same end date, so still nothing new.
    const later = await sweepGrantExpiryReminders(db, SCOPE, new Date(at.getTime() + 2 * DAY));
    expect(later.enqueued).toBe(0);

    const rows = await notificationsFor(db, grant.id);
    expect(rows.map((row) => `${row.eventType}:${row.channel}`).sort()).toEqual([
      `${GRANT_ENDING_EVENT}:EMAIL`,
      `${GRANT_ENDING_EVENT}:IN_APP`,
    ]);
    expect(rows.every((row) => row.recipientAccountId === account.id)).toBe(true);
    const inApp = rows.find((row) => row.channel === 'IN_APP');
    const inAppPayload = inApp?.payload as NotificationPayload;
    expect(inAppPayload.subject).toBe('Your Sharing Ends Soon');
    expect(inAppPayload.summary).toContain('friend@example.com');
    expect(inAppPayload.summary).toContain('30 more days');
    expect(inAppPayload.deepLinkPath).toBe(
      `/app/applicant/${applicantId}/sharing#extend-grant-${grant.id}`,
    );
  });

  it('is quiet before the window and still catches up on the last day', async () => {
    const { account, applicantId } = await makeTraveller(db, 'window@example.com');
    const friend = await makeAccount(db, 'friend2@example.com');
    const grant = await activeGrant(db, {
      travellerId: account.id,
      applicantId,
      recipientAccountId: friend.id,
      acceptingAccountId: friend.id,
      days: 40,
    });
    const expiry = (grant.expiryAt as Date).getTime();
    const early = await sweepGrantExpiryReminders(db, SCOPE, new Date(expiry - 9 * DAY));
    expect(early.enqueued).toBe(0);
    const earlier = await sweepGrantExpiryReminders(db, SCOPE, new Date(expiry - 8.5 * DAY));
    expect(earlier.enqueued).toBe(0);
    // The daily run was down all week: the last day still gets the one reminder.
    const lastDay = await sweepGrantExpiryReminders(db, SCOPE, new Date(expiry - 1.4 * DAY));
    expect(lastDay.enqueued).toBe(2);
  });

  it("tells an agency's owners and admins too, never a plain member", async () => {
    const { account, applicantId } = await makeTraveller(db, 'client@example.com', 'Client Name');
    const agency = await makeAgency(db);
    const grant = await activeGrant(db, {
      travellerId: account.id,
      applicantId,
      recipientOrganizationId: agency.orgId,
      acceptingAccountId: agency.owner.id,
      days: 30,
    });
    const at = new Date((grant.expiryAt as Date).getTime() - 5 * DAY);
    const result = await sweepGrantExpiryReminders(db, SCOPE, at);
    // Traveller (2) + owner (2) + admin (2). The case manager gets nothing.
    expect(result.enqueued).toBe(6);

    const rows = await notificationsFor(db, grant.id);
    const agencyRows = rows.filter((row) => row.eventType === AGENCY_ACCESS_ENDING_EVENT);
    expect(new Set(agencyRows.map((row) => row.recipientAccountId))).toEqual(
      new Set([agency.owner.id, agency.admin.id]),
    );
    expect(agencyRows.some((row) => row.recipientAccountId === agency.manager.id)).toBe(false);
    expect(agencyRows.every((row) => row.organizationId === agency.orgId)).toBe(true);
    const note = agencyRows.find((row) => row.channel === 'IN_APP')?.payload as NotificationPayload;
    expect(note.subject).toBe('Client Access Ends Soon');
    expect(note.summary).toContain('Client Name');
    expect(note.summary).toContain('The traveller can extend it.');
    // The traveller's own note is separate and offers the extension.
    const own = rows.filter((row) => row.eventType === GRANT_ENDING_EVENT);
    expect(own.every((row) => row.recipientAccountId === account.id)).toBe(true);
  });

  it('sends nothing for a revoked, paused, waiting or ended grant, or one with no end date', async () => {
    const { account, applicantId } = await makeTraveller(db, 'skip@example.com');
    const friend = await makeAccount(db, 'friend3@example.com');
    const base = {
      travellerId: account.id,
      applicantId,
      recipientAccountId: friend.id,
      acceptingAccountId: friend.id,
      days: 40,
    };
    const revoked = await activeGrant(db, base);
    const paused = await activeGrant(db, base);
    const ended = await activeGrant(db, { ...base, days: 12 });
    const legacy = await activeGrant(db, base);
    const waitingCreated = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientAccountId: friend.id,
      actions: ['PREVIEW'],
      purpose: 'visa_application',
      expiryAt: new Date(Date.now() + 40 * DAY),
    });
    if (!isOk(waitingCreated)) throw new Error('waiting');
    expect(isOk(await revokeGrant(db, { actorAccountId: account.id, grantId: revoked.id }))).toBe(
      true,
    );
    expect(isOk(await pauseGrant(db, { actorAccountId: account.id, grantId: paused.id }))).toBe(
      true,
    );
    await db.update(schema.grants).set({ expiryAt: null }).where(eq(schema.grants.id, legacy.id));

    const at = new Date(Date.now() + 40 * DAY - 5 * DAY);
    const result = await sweepGrantExpiryReminders(db, SCOPE, at);
    expect(result.enqueued).toBe(0);
    for (const id of [revoked.id, paused.id, legacy.id, waitingCreated.value.id]) {
      expect(await notificationsFor(db, id)).toHaveLength(0);
    }
    // The ended one: asked after its end date.
    const afterEnd = await sweepGrantExpiryReminders(
      db,
      SCOPE,
      new Date((ended.expiryAt as Date).getTime() + DAY),
    );
    expect(afterEnd.enqueued).toBe(0);
    expect(await notificationsFor(db, ended.id)).toHaveLength(0);
  });

  it('does not remind about a share that was only ever short', async () => {
    const { account, applicantId } = await makeTraveller(db, 'short@example.com');
    const friend = await makeAccount(db, 'friend4@example.com');
    const grant = await activeGrant(db, {
      travellerId: account.id,
      applicantId,
      recipientAccountId: friend.id,
      acceptingAccountId: friend.id,
      days: 5,
    });
    const at = new Date(Date.now() + 1 * DAY);
    const result = await sweepGrantExpiryReminders(db, SCOPE, at);
    expect(result.enqueued).toBe(0);
    expect(await notificationsFor(db, grant.id)).toHaveLength(0);
  });

  it("counts days on the traveller's own calendar", async () => {
    const { account, applicantId } = await makeTraveller(db, 'zone@example.com');
    await db
      .update(schema.applicants)
      .set({ timezone: 'Asia/Dhaka' })
      .where(eq(schema.applicants.id, applicantId));
    const friend = await makeAccount(db, 'friend5@example.com');
    const grant = await activeGrant(db, {
      travellerId: account.id,
      applicantId,
      recipientAccountId: friend.id,
      acceptingAccountId: friend.id,
      days: 30,
    });
    // Ends 20:00 UTC, which is already the next calendar day in Dhaka (UTC+6).
    const end = new Date(Date.UTC(2027, 0, 10, 20, 0, 0));
    await db.update(schema.grants).set({ expiryAt: end }).where(eq(schema.grants.id, grant.id));
    await db
      .update(schema.grants)
      .set({ acceptedAt: new Date(Date.UTC(2026, 11, 1)) })
      .where(eq(schema.grants.id, grant.id));

    // 10:00 UTC on 3 Jan is 16:00 on 3 Jan in Dhaka: the end is on the 11th, 8 days away: too early.
    const tooEarly = await sweepGrantExpiryReminders(db, SCOPE, new Date(Date.UTC(2027, 0, 3, 10)));
    expect(tooEarly.enqueued).toBe(0);
    // 10:00 UTC on 4 Jan is 7 Dhaka days before the 11th: now.
    const inWindow = await sweepGrantExpiryReminders(db, SCOPE, new Date(Date.UTC(2027, 0, 4, 10)));
    expect(inWindow.enqueued).toBe(2);
    const rows = await notificationsFor(db, grant.id);
    expect(rows[0]?.idempotencyKey).toContain('ends_7d:2027-01-11');
  });

  it('ignores a scope that is not the sweeps own', async () => {
    const wrong = systemScopeForTest('process-ai-reading') as unknown as typeof SCOPE;
    const { account, applicantId } = await makeTraveller(db, 'wrong@example.com');
    const friend = await makeAccount(db, 'friend6@example.com');
    const grant = await activeGrant(db, {
      travellerId: account.id,
      applicantId,
      recipientAccountId: friend.id,
      acceptingAccountId: friend.id,
      days: 40,
    });
    const at = new Date((grant.expiryAt as Date).getTime() - 5 * DAY);
    expect((await sweepGrantExpiryReminders(db, wrong, at)).enqueued).toBe(0);
  });
});

describe('Keep Sharing for 30 More Days', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  async function setup(days = 20) {
    const { account, applicantId } = await makeTraveller(db, 'owner@example.com', 'Client Name');
    const agency = await makeAgency(db);
    const grant = await activeGrant(db, {
      travellerId: account.id,
      applicantId,
      recipientOrganizationId: agency.orgId,
      acceptingAccountId: agency.owner.id,
      days,
    });
    return { account, applicantId, agency, grant };
  }

  it('lets the owner add 30 days, and records who, when and from what to what', async () => {
    const { account, applicantId, grant } = await setup(20);
    const before = grant.expiryAt as Date;
    const result = await extendGrant(await ownerProof(db, account.id, applicantId), {
      grantId: grant.id,
      expectedExpiryAt: before,
    });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.extended).toBe(true);
    expect(result.value.grant.expiryAt?.getTime()).toBe(before.getTime() + 30 * DAY);
    expect(GRANT_EXTENSION_DAYS).toBe(30);

    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'GRANT_EXTENDED'));
    expect(events).toHaveLength(1);
    expect(events[0]?.actorAccountId).toBe(account.id);
    expect(events[0]?.grantId).toBe(grant.id);
    expect(events[0]?.metadata).toMatchObject({
      previousExpiryAt: before.toISOString(),
      newExpiryAt: new Date(before.getTime() + 30 * DAY).toISOString(),
      days: 30,
    });
  });

  it('refuses the agency, a team member and a stranger the same way as an unknown grant', async () => {
    const { applicantId, agency, grant } = await setup();
    const stranger = await makeTraveller(db, 'stranger@example.com', 'Other Person');

    // None of them can even obtain the owner-only proof (MANAGE is the owner's alone). The
    // `ownerOnly` check inside extendGrant is a second lock behind that gate, not reachable by a test.
    for (const accountId of [agency.owner.id, agency.admin.id, agency.manager.id]) {
      expect((await proofFor(db, accountId, applicantId)).ok).toBe(false);
    }
    expect((await proofFor(db, stranger.account.id, applicantId)).ok).toBe(false);

    // A stranger's own proof cannot reach someone else's grant, and an unknown id looks identical.
    const strangerProof = await ownerProof(db, stranger.account.id, stranger.applicantId);
    const theirs = await extendGrant(strangerProof, { grantId: grant.id });
    const missing = await extendGrant(strangerProof, {
      grantId: '00000000-0000-4000-8000-000000000000',
    });
    expect(isErr(theirs)).toBe(true);
    expect(isErr(missing)).toBe(true);
    if (isErr(theirs) && isErr(missing)) {
      expect(theirs.error.code).toBe('not_found');
      expect(theirs.error).toEqual(missing.error);
    }
    const unchanged = await db.select().from(schema.grants).where(eq(schema.grants.id, grant.id));
    expect(unchanged[0]?.expiryAt?.getTime()).toBe((grant.expiryAt as Date).getTime());
  });

  it('never goes past 90 days from today and never shortens', async () => {
    const { account, applicantId, grant } = await setup(80);
    const proof = await ownerProof(db, account.id, applicantId);
    const now = new Date();
    const first = await extendGrant(proof, { grantId: grant.id, now });
    if (!isOk(first)) throw new Error('first');
    expect(first.value.extended).toBe(true);
    expect(first.value.grant.expiryAt?.getTime()).toBe(now.getTime() + 90 * DAY);
    expect(first.value.atLimit).toBe(true);

    const second = await extendGrant(proof, { grantId: grant.id, now });
    if (!isOk(second)) throw new Error('second');
    expect(second.value.extended).toBe(false);
    expect(second.value.atLimit).toBe(true);
    expect(second.value.grant.expiryAt?.getTime()).toBe(now.getTime() + 90 * DAY);

    // A date already past the ceiling is left alone, never pulled back.
    const far = new Date(now.getTime() + 100 * DAY);
    await db.update(schema.grants).set({ expiryAt: far }).where(eq(schema.grants.id, grant.id));
    const third = await extendGrant(proof, { grantId: grant.id, now });
    if (!isOk(third)) throw new Error('third');
    expect(third.value.extended).toBe(false);
    expect(third.value.grant.expiryAt?.getTime()).toBe(far.getTime());
  });

  it('extends once when the button is tapped twice, one after the other or together', async () => {
    const { account, applicantId, grant } = await setup(20);
    const proof = await ownerProof(db, account.id, applicantId);
    const seen = grant.expiryAt as Date;
    const one = await extendGrant(proof, { grantId: grant.id, expectedExpiryAt: seen });
    const two = await extendGrant(proof, { grantId: grant.id, expectedExpiryAt: seen });
    if (!isOk(one) || !isOk(two)) throw new Error('taps');
    expect(one.value.extended).toBe(true);
    expect(two.value.extended).toBe(false);
    expect(two.value.grant.expiryAt?.getTime()).toBe(seen.getTime() + 30 * DAY);

    // Together: both read the same date; only one write can match it.
    const {
      account: a2,
      applicantId: ap2,
      grant: g2,
    } = await (async () => {
      const t = await makeTraveller(db, 'twin@example.com');
      const friend = await makeAccount(db, 'twinfriend@example.com');
      const g = await activeGrant(db, {
        travellerId: t.account.id,
        applicantId: t.applicantId,
        recipientAccountId: friend.id,
        acceptingAccountId: friend.id,
        days: 20,
      });
      return { account: t.account, applicantId: t.applicantId, grant: g };
    })();
    const p2 = await ownerProof(db, a2.id, ap2);
    const seen2 = g2.expiryAt as Date;
    const both = await Promise.all([
      extendGrant(p2, { grantId: g2.id, expectedExpiryAt: seen2 }),
      extendGrant(p2, { grantId: g2.id, expectedExpiryAt: seen2 }),
    ]);
    expect(both.every(isOk)).toBe(true);
    const rows = await db.select().from(schema.grants).where(eq(schema.grants.id, g2.id));
    expect(rows[0]?.expiryAt?.getTime()).toBe(seen2.getTime() + 30 * DAY);
    const audits = await db
      .select()
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.eventType, 'GRANT_EXTENDED'),
          eq(schema.auditEvents.grantId, g2.id),
        ),
      );
    expect(audits).toHaveLength(1);
  });

  it('refuses a paused, revoked or ended grant and leaves it exactly as it was', async () => {
    const { account, applicantId, agency } = await setup();
    const proof = await ownerProof(db, account.id, applicantId);
    const mk = (days: number) =>
      activeGrant(db, {
        travellerId: account.id,
        applicantId,
        recipientOrganizationId: agency.orgId,
        acceptingAccountId: agency.owner.id,
        days,
      });
    const paused = await mk(20);
    const revoked = await mk(20);
    const ended = await mk(20);
    await pauseGrant(db, { actorAccountId: account.id, grantId: paused.id });
    await revokeGrant(db, { actorAccountId: account.id, grantId: revoked.id });
    await db
      .update(schema.grants)
      .set({ expiryAt: new Date(Date.now() - DAY) })
      .where(eq(schema.grants.id, ended.id));

    for (const id of [paused.id, revoked.id, ended.id]) {
      const result = await extendGrant(proof, { grantId: id });
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.error.code).toBe('invalid');
    }
    // A paused one is told to resume first, not that it has ended.
    const pausedResult = await extendGrant(proof, { grantId: paused.id });
    if (isErr(pausedResult)) expect(pausedResult.error.message).toBe(GRANT_EXTEND_RESUME_FIRST);
    const endedResult = await extendGrant(proof, { grantId: ended.id });
    if (isErr(endedResult)) expect(endedResult.error.message).toBe(GRANT_EXTEND_ENDED);
    const [p] = await db.select().from(schema.grants).where(eq(schema.grants.id, paused.id));
    expect(p?.status).toBe('PAUSED');
    expect(p?.expiryAt?.getTime()).toBe((paused.expiryAt as Date).getTime());
    const [r] = await db.select().from(schema.grants).where(eq(schema.grants.id, revoked.id));
    expect(r?.status).toBe('REVOKED');
  });

  it('gives a new reminder for the new end date and drops the old queued ones', async () => {
    const { account, applicantId, grant } = await setup(40);
    const proof = await ownerProof(db, account.id, applicantId);
    const end = (grant.expiryAt as Date).getTime();
    const at = new Date(end - 6 * DAY);
    const first = await sweepGrantExpiryReminders(db, SCOPE, at);
    expect(first.enqueued).toBe(6);
    const queued = await notificationsFor(db, grant.id);
    expect(queued.every((row) => row.status === 'QUEUED')).toBe(true);

    // Extend with the clock at the reminder: the new end is 30 days further out.
    const extended = await extendGrant(proof, { grantId: grant.id, now: at });
    if (!isOk(extended)) throw new Error('extend');
    expect(extended.value.extended).toBe(true);
    const cancelled = await notificationsFor(db, grant.id);
    expect(cancelled.every((row) => row.status === 'CANCELLED')).toBe(true);

    // Nothing more until the new end date is a week away, then exactly one more reminder.
    expect((await sweepGrantExpiryReminders(db, SCOPE, at)).enqueued).toBe(0);
    const newEnd = (extended.value.grant.expiryAt as Date).getTime();
    const again = await sweepGrantExpiryReminders(db, SCOPE, new Date(newEnd - 6 * DAY));
    expect(again.enqueued).toBe(6);
    expect(
      new Set((await notificationsFor(db, grant.id)).map((row) => row.idempotencyKey)).size,
    ).toBe(12);
  });

  it('shows the agency the new end date, and nobody else sees one', async () => {
    const { account, applicantId, agency, grant } = await setup(20);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'Spring trip',
    });
    if (!isOk(mission)) throw new Error('mission');
    const before = await listAccessEndsForOrg(db, agency.orgId, [mission.value.id]);
    expect(before.get(mission.value.id)?.getTime()).toBe((grant.expiryAt as Date).getTime());

    const proof = await ownerProof(db, account.id, applicantId);
    const result = await extendGrant(proof, { grantId: grant.id });
    if (!isOk(result)) throw new Error('extend');
    const after = await listAccessEndsForOrg(db, agency.orgId, [mission.value.id]);
    expect(after.get(mission.value.id)?.getTime()).toBe(
      (grant.expiryAt as Date).getTime() + 30 * DAY,
    );
    // Another agency learns nothing about this case, and a case not named is not read.
    const other = await listAccessEndsForOrg(db, '00000000-0000-4000-8000-000000000000', [
      mission.value.id,
    ]);
    expect(other.size).toBe(0);
    expect((await listAccessEndsForOrg(db, agency.orgId, [])).size).toBe(0);
    const unnamed = await listAccessEndsForOrg(db, agency.orgId, [
      '00000000-0000-4000-8000-000000000000',
    ]);
    expect(unnamed.size).toBe(0);
  });
});

describe('revoking with a reminder already queued', () => {
  it('drops the queued reminders and changes nothing else about revoke', async () => {
    const db = await freshDb();
    const { account, applicantId } = await makeTraveller(db, 'revoker@example.com');
    const agency = await makeAgency(db);
    const grant = await activeGrant(db, {
      travellerId: account.id,
      applicantId,
      recipientOrganizationId: agency.orgId,
      acceptingAccountId: agency.owner.id,
      days: 30,
    });
    await sweepGrantExpiryReminders(
      db,
      SCOPE,
      new Date((grant.expiryAt as Date).getTime() - 5 * DAY),
    );
    expect((await notificationsFor(db, grant.id)).every((r) => r.status === 'QUEUED')).toBe(true);

    const revoked = await revokeGrant(db, { actorAccountId: account.id, grantId: grant.id });
    expect(isOk(revoked)).toBe(true);
    if (isOk(revoked)) expect(revoked.value.status).toBe('REVOKED');
    expect((await notificationsFor(db, grant.id)).every((r) => r.status === 'CANCELLED')).toBe(
      true,
    );
    // Revoke is still terminal and is audited as before.
    const again = await revokeGrant(db, { actorAccountId: account.id, grantId: grant.id });
    expect(isErr(again)).toBe(true);
    const audits = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'GRANT_REVOKED'));
    expect(audits).toHaveLength(1);
    // A stranger still cannot revoke it (the existing refusal is unchanged).
    const stranger = await makeAccount(db, 'nobody@example.com');
    const denied = await revokeGrant(db, { actorAccountId: stranger.id, grantId: grant.id });
    expect(isErr(denied)).toBe(true);
  });

  it('cancelling a grant that has no queued reminders is a quiet no-op', async () => {
    const db = await freshDb();
    const result = await db.transaction((tx) =>
      cancelQueuedNotificationsForResource(
        tx as unknown as Db,
        '00000000-0000-4000-8000-000000000000',
        GRANT_ENDING_EVENT,
      ),
    );
    expect(result.cancelled).toBe(0);
  });
});

class RecordingEmail implements EmailPort {
  public readonly sent: SendEmailInput[] = [];
  async send(input: SendEmailInput): Promise<SendEmailResult> {
    this.sent.push(input);
    return { providerMessageId: `m-${this.sent.length}` };
  }
}

/** An accepted grant that really ends in `daysLeft` days and began 10 days ago, so the sweep at the real clock sees it. */
async function endingGrant(db: Db, input: Parameters<typeof activeGrant>[1], daysLeft: number) {
  const grant = await activeGrant(db, { ...input, days: 40 });
  await db
    .update(schema.grants)
    .set({
      acceptedAt: new Date(Date.now() - 10 * DAY),
      startAt: new Date(Date.now() - 10 * DAY),
      expiryAt: new Date(Date.now() + daysLeft * DAY),
    })
    .where(eq(schema.grants.id, grant.id));
  return grant;
}

describe('a note that is no longer true is cancelled, not sent and not failed', () => {
  it('cancels both notes when the grant is paused before they go out', async () => {
    const db = await freshDb();
    const { account, applicantId } = await makeTraveller(db, 'late-pause@example.com');
    const agency = await makeAgency(db);
    const grant = await endingGrant(
      db,
      {
        travellerId: account.id,
        applicantId,
        recipientOrganizationId: agency.orgId,
        acceptingAccountId: agency.owner.id,
        days: 0,
      },
      3,
    );
    expect((await sweepGrantExpiryReminders(db, SCOPE, new Date())).enqueued).toBe(6);
    await pauseGrant(db, { actorAccountId: account.id, grantId: grant.id });

    const email = new RecordingEmail();
    await runNotificationWorker(db, email, 'https://app.example.com');
    expect(email.sent).toHaveLength(0);
    const rows = await notificationsFor(db, grant.id);
    expect(rows.every((row) => row.status === 'CANCELLED')).toBe(true);
  });

  it('sends the traveller their note and the agency its own while the grant is live', async () => {
    const db = await freshDb();
    const { account, applicantId } = await makeTraveller(db, 'live@example.com', 'Client Name');
    const agency = await makeAgency(db);
    const grant = await endingGrant(
      db,
      {
        travellerId: account.id,
        applicantId,
        recipientOrganizationId: agency.orgId,
        acceptingAccountId: agency.owner.id,
        days: 0,
      },
      3,
    );
    await sweepGrantExpiryReminders(db, SCOPE, new Date());
    const email = new RecordingEmail();
    await runNotificationWorker(db, email, 'https://app.example.com');
    const rows = await notificationsFor(db, grant.id);
    expect(rows.every((row) => row.status === 'SENT')).toBe(true);
    const toTraveller = email.sent.find((mail) => mail.to === 'live@example.com');
    expect(toTraveller?.subject).toBe('Your Sharing Ends Soon');
    expect(toTraveller?.body).toContain('Keep Sharing for 30 More Days');
    expect(toTraveller?.body).toContain(
      `https://app.example.com/app/applicant/${applicantId}/sharing#extend-grant-${grant.id}`,
    );
    const toAdmin = email.sent.find((mail) => mail.to === 'agency-admin@acme.example.com');
    expect(toAdmin?.subject).toBe('Client Access Ends Soon');
    // Emails are forwarded and sit in inboxes: no client, agency or recipient name in any of them
    // (subject, text or HTML). The signed-in app notices keep the names.
    expect(email.sent).toHaveLength(3);
    for (const mail of email.sent) {
      for (const text of [mail.subject, mail.body, mail.html ?? '']) {
        expect(text).not.toContain('Client Name');
        expect(text).not.toContain('Acme Visas');
      }
    }
    expect(toTraveller?.body).toContain('Your sharing with an agency or person ends on');
    expect(toAdmin?.body).toContain('Access to one of your clients ends on');
    expect(toAdmin?.body).toContain('Only the traveller can extend it.');
    const inAppRows = (await notificationsFor(db, grant.id)).filter((r) => r.channel === 'IN_APP');
    expect(
      inAppRows.some((r) => (r.payload as NotificationPayload).summary.includes('Client Name')),
    ).toBe(true);
  });

  it('cancels a note whose end date has already passed', async () => {
    const db = await freshDb();
    const { account, applicantId } = await makeTraveller(db, 'passed@example.com');
    const friend = await makeAccount(db, 'passedfriend@example.com');
    const grant = await endingGrant(
      db,
      {
        travellerId: account.id,
        applicantId,
        recipientAccountId: friend.id,
        acceptingAccountId: friend.id,
        days: 0,
      },
      3,
    );
    await sweepGrantExpiryReminders(db, SCOPE, new Date());
    await db
      .update(schema.grants)
      .set({ expiryAt: new Date(Date.now() - DAY) })
      .where(eq(schema.grants.id, grant.id));
    const email = new RecordingEmail();
    await runNotificationWorker(db, email, 'https://app.example.com');
    expect(email.sent).toHaveLength(0);
    expect((await notificationsFor(db, grant.id)).every((row) => row.status === 'CANCELLED')).toBe(
      true,
    );
  });
});

describe('reminders that would be wrong or wasteful are not made', () => {
  it('skips a grant that another live grant to the same agency outlasts', async () => {
    const db = await freshDb();
    const { account, applicantId } = await makeTraveller(db, 'renewed@example.com');
    const agency = await makeAgency(db);
    const shared = {
      travellerId: account.id,
      applicantId,
      recipientOrganizationId: agency.orgId,
      acceptingAccountId: agency.owner.id,
      days: 0,
    };
    const old = await endingGrant(db, shared, 3);
    const renewal = await endingGrant(db, shared, 60);
    const result = await sweepGrantExpiryReminders(db, SCOPE, new Date());
    expect(result.enqueued).toBe(0);
    expect(await notificationsFor(db, old.id)).toHaveLength(0);
    expect(await notificationsFor(db, renewal.id)).toHaveLength(0);
  });

  it('does not skip when the later grant is for one case and this one is for all', async () => {
    const db = await freshDb();
    const { account, applicantId } = await makeTraveller(db, 'narrower@example.com');
    const agency = await makeAgency(db);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'One trip',
    });
    if (!isOk(mission)) throw new Error('mission');
    const shared = {
      travellerId: account.id,
      applicantId,
      recipientOrganizationId: agency.orgId,
      acceptingAccountId: agency.owner.id,
      days: 0,
    };
    const allCases = await endingGrant(db, shared, 3);
    const oneCase = await endingGrant(db, shared, 60);
    await db
      .update(schema.grants)
      .set({ missionId: mission.value.id })
      .where(eq(schema.grants.id, oneCase.id));
    const result = await sweepGrantExpiryReminders(db, SCOPE, new Date());
    expect(result.enqueued).toBe(6);
    expect(await notificationsFor(db, allCases.id)).toHaveLength(6);
  });

  it('does not look again at a grant already reminded for this end date', async () => {
    const db = await freshDb();
    const { account, applicantId } = await makeTraveller(db, 'again@example.com');
    const friend = await makeAccount(db, 'againfriend@example.com');
    const grant = await endingGrant(
      db,
      {
        travellerId: account.id,
        applicantId,
        recipientAccountId: friend.id,
        acceptingAccountId: friend.id,
        days: 0,
      },
      3,
    );
    const first = await sweepGrantExpiryReminders(db, SCOPE, new Date());
    expect(first).toEqual({ checked: 1, enqueued: 2 });
    const second = await sweepGrantExpiryReminders(db, SCOPE, new Date());
    expect(second).toEqual({ checked: 0, enqueued: 0 });
    expect(await notificationsFor(db, grant.id)).toHaveLength(2);
  });
});

describe('extending asks for what creating the sharing asked for', () => {
  it('refuses when sharing consent has been withdrawn', async () => {
    const db = await freshDb();
    const { account, applicantId } = await makeTraveller(db, 'noconsent@example.com');
    const friend = await makeAccount(db, 'noconsentfriend@example.com');
    const grant = await activeGrant(db, {
      travellerId: account.id,
      applicantId,
      recipientAccountId: friend.id,
      acceptingAccountId: friend.id,
      days: 20,
    });
    const proof = await ownerProof(db, account.id, applicantId);
    await setConsent(db, {
      actorAccountId: account.id,
      accountId: account.id,
      type: 'SHARING',
      granted: false,
    });
    const result = await extendGrant(proof, { grantId: grant.id });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('consent_required');
  });

  it('refuses a grant to an agency that is no longer active', async () => {
    const db = await freshDb();
    const { account, applicantId } = await makeTraveller(db, 'suspended@example.com');
    const agency = await makeAgency(db);
    const grant = await activeGrant(db, {
      travellerId: account.id,
      applicantId,
      recipientOrganizationId: agency.orgId,
      acceptingAccountId: agency.owner.id,
      days: 20,
    });
    await db
      .update(schema.organizations)
      .set({ status: 'SUSPENDED' })
      .where(eq(schema.organizations.id, agency.orgId));
    const result = await extendGrant(await ownerProof(db, account.id, applicantId), {
      grantId: grant.id,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.message).toBe(GRANT_EXTEND_ENDED);
  });

  it('asks for a fresh sign-in only when the grant hands out a step-up action', async () => {
    const db = await freshDb();
    const { account, applicantId } = await makeTraveller(db, 'stepup@example.com');
    const friend = await makeAccount(db, 'stepupfriend@example.com');
    const created = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientAccountId: friend.id,
      actions: ['DOWNLOAD_ORIGINAL'],
      purpose: 'visa_application',
      expiryAt: new Date(Date.now() + 20 * DAY),
      stepUpSatisfied: true,
    });
    if (!isOk(created)) throw new Error(`grant: ${created.error.message}`);
    await acceptGrant(db, { actorAccountId: friend.id, grantId: created.value.id });
    const proof = await ownerProof(db, account.id, applicantId);

    const without = await extendGrant(proof, { grantId: created.value.id });
    expect(isErr(without)).toBe(true);
    if (isErr(without)) expect(without.error.code).toBe('step_up_required');

    const request = { accountId: account.id, action: 'SHARE', resourceId: applicantId } as const;
    const stepUp = verifyStepUp(
      'step-up-secret',
      issueStepUpAssurance('step-up-secret', request),
      request,
    );
    expect(stepUp).toBeDefined();
    const withIt = await extendGrant(proof, {
      grantId: created.value.id,
      ...(stepUp ? { stepUp } : {}),
    });
    expect(isOk(withIt)).toBe(true);
  });

  it('reports a pause that lands between the read and the write as paused, not ended', async () => {
    const db = await freshDb();
    const { account, applicantId } = await makeTraveller(db, 'race@example.com');
    const friend = await makeAccount(db, 'racefriend@example.com');
    const grant = await activeGrant(db, {
      travellerId: account.id,
      applicantId,
      recipientAccountId: friend.id,
      acceptingAccountId: friend.id,
      days: 20,
    });
    const proof = await ownerProof(db, account.id, applicantId);
    const [result] = await Promise.all([
      extendGrant(proof, { grantId: grant.id }),
      pauseGrant(db, { actorAccountId: account.id, grantId: grant.id }),
    ]);
    // Either order is possible; what must hold is that nothing reads "ended" for a paused grant.
    if (isErr(result)) expect(result.error.message).toBe(GRANT_EXTEND_RESUME_FIRST);
    const [row] = await db.select().from(schema.grants).where(eq(schema.grants.id, grant.id));
    expect(row?.status).toBe('PAUSED');
  });
});
