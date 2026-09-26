import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { sweepCaseRetentionNotices, sweepCaseRetentionPurge } from './case-retention';
import { fileComplaint } from './complaints';
import { setConsent } from './consent';
import type { Db } from './db';
import { placeLegalHold } from './legal-hold';
import { createMission, transitionMission } from './missions';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

async function seed(db: Db) {
  const p = await provisionAccount(db, { email: 'owner@example.com' });
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
  return { account, applicantId: applicant.value.id };
}

async function backdateClosedAt(db: Db, missionId: string, when: Date): Promise<void> {
  await db.update(schema.missions).set({ closedAt: when }).where(eq(schema.missions.id, missionId));
}

async function backdateRetentionNotice(db: Db, missionId: string, when: Date): Promise<void> {
  await db
    .update(schema.missions)
    .set({ retentionNoticeSentAt: when })
    .where(eq(schema.missions.id, missionId));
}

const PURGE_ENV_KEYS = ['CASE_RETENTION_PURGE_ENABLED', 'CASE_RETENTION_PURGE_GRACE_DAYS'] as const;
const ORIGINAL_ENV: Record<string, string | undefined> = {};

/** Indexes by a runtime variable, never a literal -- satisfies both TS4111 and Biome's useLiteralKeys. */
function setEnv(name: string, value: string): void {
  process.env[name] = value;
}
function unsetEnv(name: string): void {
  delete process.env[name];
}

describe('sweepCaseRetentionNotices (PRV-02, Part 7 §11: "closed case: initial proposed 12m with 30d notice")', () => {
  let db: Db;
  let ownerId: string;
  let applicantId: string;

  beforeEach(async () => {
    db = await freshDb();
    const seeded = await seed(db);
    ownerId = seeded.account.id;
    applicantId = seeded.applicantId;
  });

  it('sends a notice for a CANCELLED case closed 12+ months ago, and records when', async () => {
    const created = await createMission(db, {
      actorAccountId: ownerId,
      applicantId,
      title: 'Cancelled case',
    });
    if (!isOk(created)) throw new Error('setup failed');
    const cancelled = await transitionMission(db, {
      actorAccountId: ownerId,
      missionId: created.value.id,
      to: 'CANCELLED',
    });
    expect(isOk(cancelled)).toBe(true);

    const thirteenMonthsAgo = new Date();
    thirteenMonthsAgo.setUTCMonth(thirteenMonthsAgo.getUTCMonth() - 13);
    await backdateClosedAt(db, created.value.id, thirteenMonthsAgo);

    const result = await sweepCaseRetentionNotices(db);
    expect(result).toEqual({ checked: 1, notified: 1 });

    const [mission] = await db
      .select()
      .from(schema.missions)
      .where(eq(schema.missions.id, created.value.id));
    expect(mission?.retentionNoticeSentAt).not.toBeNull();

    const notices = await db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.resourceId, created.value.id),
          eq(schema.notifications.eventType, 'CASE_RETENTION_NOTICE'),
        ),
      );
    expect(notices).toHaveLength(2); // IN_APP + EMAIL
    expect(notices.every((n) => n.recipientAccountId === ownerId)).toBe(true);
    expect(notices[0]?.payload).toMatchObject({ deepLinkPath: `/app/mission/${created.value.id}` });
  });

  it('treats CLOSED identically to CANCELLED', async () => {
    const created = await createMission(db, {
      actorAccountId: ownerId,
      applicantId,
      title: 'Fully processed case',
    });
    if (!isOk(created)) throw new Error('setup failed');
    // Legacy chain to CLOSED (no acknowledgement gate on this path, unlike SUBMISSION_READY -> CLOSED).
    for (const to of [
      'IN_PROGRESS',
      'READY_FOR_REVIEW',
      'UNDER_REVIEW',
      'READY_TO_EXPORT',
      'LOCKED',
      'CLOSED',
    ] as const) {
      const step = await transitionMission(db, {
        actorAccountId: ownerId,
        missionId: created.value.id,
        to,
      });
      expect(isOk(step)).toBe(true);
    }

    const thirteenMonthsAgo = new Date();
    thirteenMonthsAgo.setUTCMonth(thirteenMonthsAgo.getUTCMonth() - 13);
    await backdateClosedAt(db, created.value.id, thirteenMonthsAgo);

    const result = await sweepCaseRetentionNotices(db);
    expect(result).toEqual({ checked: 1, notified: 1 });
  });

  it('does not notify a case closed less than the configured threshold ago', async () => {
    const created = await createMission(db, {
      actorAccountId: ownerId,
      applicantId,
      title: 'Recently cancelled case',
    });
    if (!isOk(created)) throw new Error('setup failed');
    const cancelled = await transitionMission(db, {
      actorAccountId: ownerId,
      missionId: created.value.id,
      to: 'CANCELLED',
    });
    expect(isOk(cancelled)).toBe(true);
    // closedAt was just set by transitionMission itself -- far short of 12 months.

    const result = await sweepCaseRetentionNotices(db);
    expect(result).toEqual({ checked: 0, notified: 0 });
  });

  it('never touches a case that is still open, regardless of age', async () => {
    const created = await createMission(db, {
      actorAccountId: ownerId,
      applicantId,
      title: 'Still-open case',
    });
    if (!isOk(created)) throw new Error('setup failed');
    // Open cases never have closedAt set at all -- backdating createdAt/updatedAt
    // alone must never be mistaken for closure.
    const thirteenMonthsAgo = new Date();
    thirteenMonthsAgo.setUTCMonth(thirteenMonthsAgo.getUTCMonth() - 13);
    await db
      .update(schema.missions)
      .set({ createdAt: thirteenMonthsAgo, updatedAt: thirteenMonthsAgo })
      .where(eq(schema.missions.id, created.value.id));

    const result = await sweepCaseRetentionNotices(db);
    expect(result).toEqual({ checked: 0, notified: 0 });
  });

  it('is idempotent: re-running the sweep never sends a second notice for the same case', async () => {
    const created = await createMission(db, {
      actorAccountId: ownerId,
      applicantId,
      title: 'Cancelled case',
    });
    if (!isOk(created)) throw new Error('setup failed');
    const cancelled = await transitionMission(db, {
      actorAccountId: ownerId,
      missionId: created.value.id,
      to: 'CANCELLED',
    });
    expect(isOk(cancelled)).toBe(true);
    const thirteenMonthsAgo = new Date();
    thirteenMonthsAgo.setUTCMonth(thirteenMonthsAgo.getUTCMonth() - 13);
    await backdateClosedAt(db, created.value.id, thirteenMonthsAgo);

    const first = await sweepCaseRetentionNotices(db);
    expect(first).toEqual({ checked: 1, notified: 1 });
    const second = await sweepCaseRetentionNotices(db);
    expect(second).toEqual({ checked: 0, notified: 0 });

    const notices = await db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.resourceId, created.value.id),
          eq(schema.notifications.eventType, 'CASE_RETENTION_NOTICE'),
        ),
      );
    expect(notices).toHaveLength(2); // still just the one IN_APP + one EMAIL, never doubled
  });
});

describe('sweepCaseRetentionPurge (PRV-02, Part 7 §11: "closed case... 30d notice")', () => {
  let db: Db;
  let ownerId: string;
  let applicantId: string;

  beforeEach(async () => {
    db = await freshDb();
    const seeded = await seed(db);
    ownerId = seeded.account.id;
    applicantId = seeded.applicantId;
    for (const key of PURGE_ENV_KEYS) ORIGINAL_ENV[key] = process.env[key];
  });

  afterEach(() => {
    for (const key of PURGE_ENV_KEYS) {
      if (ORIGINAL_ENV[key] === undefined) delete process.env[key];
      else process.env[key] = ORIGINAL_ENV[key];
    }
  });

  async function seedClosedCaseDueForPurge(): Promise<string> {
    const created = await createMission(db, {
      actorAccountId: ownerId,
      applicantId,
      title: 'Closed case',
    });
    if (!isOk(created)) throw new Error('setup failed');
    const cancelled = await transitionMission(db, {
      actorAccountId: ownerId,
      missionId: created.value.id,
      to: 'CANCELLED',
    });
    if (!isOk(cancelled)) throw new Error('setup failed');
    const thirteenMonthsAgo = new Date();
    thirteenMonthsAgo.setUTCMonth(thirteenMonthsAgo.getUTCMonth() - 13);
    await backdateClosedAt(db, created.value.id, thirteenMonthsAgo);
    const thirtyOneDaysAgo = new Date();
    thirtyOneDaysAgo.setUTCDate(thirtyOneDaysAgo.getUTCDate() - 31);
    await backdateRetentionNotice(db, created.value.id, thirtyOneDaysAgo);
    return created.value.id;
  }

  it('is a no-op by default -- CASE_RETENTION_PURGE_ENABLED unset never touches anything', async () => {
    const missionId = await seedClosedCaseDueForPurge();
    unsetEnv('CASE_RETENTION_PURGE_ENABLED');

    const result = await sweepCaseRetentionPurge(db);
    expect(result).toEqual({
      enabled: false,
      checked: 0,
      purged: 0,
      skippedForHold: 0,
      skippedForComplaint: 0,
    });

    const [mission] = await db
      .select()
      .from(schema.missions)
      .where(eq(schema.missions.id, missionId));
    expect(mission?.title).toBe('Closed case');
    expect(mission?.purgedAt).toBeNull();
  });

  it('deletes workflow content via cascade, but redacts (never deletes) the mission row, and preserves outcome/submission/complaint/feedback as historical facts', async () => {
    setEnv('CASE_RETENTION_PURGE_ENABLED', 'true');
    const missionId = await seedClosedCaseDueForPurge();

    // Workflow clutter -- must be gone after purge.
    await db.insert(schema.missionNotes).values({
      missionId,
      authorAccountId: ownerId,
      body: 'a note',
    });
    await db.insert(schema.missionTasks).values({ missionId, description: 'a task' });
    await db.insert(schema.missionSnapshots).values({
      missionId,
      version: 1,
      content: {},
      checksum: 'abc',
    });

    // Historical facts -- must survive, by design, per this sweep's own doc
    // comment: independent accountability/oversight value.
    await db.insert(schema.missionOutcomes).values({
      missionId,
      decision: 'REFUSED',
      decisionDate: new Date(),
      actorAccountId: ownerId,
      authAssuranceContext: {},
    });
    const [referencedSnapshot] = await db
      .insert(schema.missionSnapshots)
      .values({ missionId, version: 2, content: {}, checksum: 'def' })
      .returning({ id: schema.missionSnapshots.id });
    if (!referencedSnapshot) throw new Error('setup failed');
    await db.insert(schema.missionSubmissions).values({
      missionId,
      snapshotId: referencedSnapshot.id,
      actorAccountId: ownerId,
      channel: 'EMAIL',
      externalReportDescription: 'confirmation email received',
      submittedAt: new Date(),
      authAssuranceContext: {},
    });
    await db.insert(schema.caseFeedback).values({
      missionId,
      submittedByAccountId: ownerId,
      comments: 'service was slow',
    });

    const result = await sweepCaseRetentionPurge(db);
    expect(result).toEqual({
      enabled: true,
      checked: 1,
      purged: 1,
      skippedForHold: 0,
      skippedForComplaint: 0,
    });

    const [mission] = await db
      .select()
      .from(schema.missions)
      .where(eq(schema.missions.id, missionId));
    expect(mission).toBeDefined();
    expect(mission?.title).toBe('[case data purged]');
    expect(mission?.destination).toBeNull();
    expect(mission?.purgedAt).not.toBeNull();
    expect(mission?.state).toBe('CANCELLED'); // lifecycle state itself is not "content"

    const notes = await db
      .select()
      .from(schema.missionNotes)
      .where(eq(schema.missionNotes.missionId, missionId));
    expect(notes).toHaveLength(0);
    const tasks = await db
      .select()
      .from(schema.missionTasks)
      .where(eq(schema.missionTasks.missionId, missionId));
    expect(tasks).toHaveLength(0);
    // The unreferenced (version 1) snapshot is gone, but the one the
    // surviving submission's own snapshotId still points to (version 2)
    // must survive -- that FK is NOT NULL + onDelete:'restrict', precisely
    // so "the exact thing that was actually submitted" can never quietly
    // disappear out from under a preserved historical record.
    const snapshots = await db
      .select()
      .from(schema.missionSnapshots)
      .where(eq(schema.missionSnapshots.missionId, missionId));
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.version).toBe(2);

    // The four historical-fact tables survive untouched.
    const outcomes = await db
      .select()
      .from(schema.missionOutcomes)
      .where(eq(schema.missionOutcomes.missionId, missionId));
    expect(outcomes).toHaveLength(1);
    const submissions = await db
      .select()
      .from(schema.missionSubmissions)
      .where(eq(schema.missionSubmissions.missionId, missionId));
    expect(submissions).toHaveLength(1);
    const feedback = await db
      .select()
      .from(schema.caseFeedback)
      .where(eq(schema.caseFeedback.missionId, missionId));
    expect(feedback).toHaveLength(1);

    // A permanent audit record survives regardless -- audit_events.mission_id
    // is a plain uuid, never an FK.
    const [auditRow] = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'MISSION_RETENTION_PURGED'));
    expect(auditRow?.missionId).toBe(missionId);
    expect(auditRow?.applicantId).toBe(applicantId);
    expect(auditRow?.metadata).toMatchObject({ title: 'Closed case', state: 'CANCELLED' });
  });

  it('is idempotent: a second run never reprocesses an already-purged mission', async () => {
    setEnv('CASE_RETENTION_PURGE_ENABLED', 'true');
    const missionId = await seedClosedCaseDueForPurge();

    const firstRun = await sweepCaseRetentionPurge(db);
    expect(firstRun.purged).toBe(1);
    const secondRun = await sweepCaseRetentionPurge(db);
    expect(secondRun).toEqual({
      enabled: true,
      checked: 0,
      purged: 0,
      skippedForHold: 0,
      skippedForComplaint: 0,
    });

    const [mission] = await db
      .select()
      .from(schema.missions)
      .where(eq(schema.missions.id, missionId));
    expect(mission?.title).toBe('[case data purged]');
  });

  it('never purges a case closed but not yet past the notice grace period', async () => {
    setEnv('CASE_RETENTION_PURGE_ENABLED', 'true');
    const created = await createMission(db, {
      actorAccountId: ownerId,
      applicantId,
      title: 'Recently noticed case',
    });
    if (!isOk(created)) throw new Error('setup failed');
    const cancelled = await transitionMission(db, {
      actorAccountId: ownerId,
      missionId: created.value.id,
      to: 'CANCELLED',
    });
    expect(isOk(cancelled)).toBe(true);
    // Notice sent only yesterday -- 29 days short of the default 30-day grace period.
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    await backdateRetentionNotice(db, created.value.id, yesterday);

    const result = await sweepCaseRetentionPurge(db);
    expect(result).toEqual({
      enabled: true,
      checked: 0,
      purged: 0,
      skippedForHold: 0,
      skippedForComplaint: 0,
    });
  });

  it('skips (never purges) a case whose applicant has an active legal hold', async () => {
    setEnv('CASE_RETENTION_PURGE_ENABLED', 'true');
    const missionId = await seedClosedCaseDueForPurge();
    const reviewAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    const hold = await placeLegalHold(db, {
      actorAccountId: ownerId,
      applicantId,
      reason: 'pending investigation',
      reviewAt,
      stepUpSatisfied: true,
    });
    expect(isOk(hold)).toBe(true);

    const result = await sweepCaseRetentionPurge(db);
    expect(result).toEqual({
      enabled: true,
      checked: 1,
      purged: 0,
      skippedForHold: 1,
      skippedForComplaint: 0,
    });
    const [mission] = await db
      .select()
      .from(schema.missions)
      .where(eq(schema.missions.id, missionId));
    expect(mission).toBeDefined();
  });

  it('skips (never purges) a case with an unresolved (OPEN or IN_PROGRESS) complaint', async () => {
    setEnv('CASE_RETENTION_PURGE_ENABLED', 'true');
    const missionId = await seedClosedCaseDueForPurge();
    const complaint = await fileComplaint(db, {
      actorAccountId: ownerId,
      missionId,
      description: 'the agency never responded',
    });
    expect(isOk(complaint)).toBe(true);

    const result = await sweepCaseRetentionPurge(db);
    expect(result).toEqual({
      enabled: true,
      checked: 1,
      purged: 0,
      skippedForHold: 0,
      skippedForComplaint: 1,
    });
    const [mission] = await db
      .select()
      .from(schema.missions)
      .where(eq(schema.missions.id, missionId));
    expect(mission).toBeDefined();
  });

  it('purges a case whose complaint has since been resolved', async () => {
    setEnv('CASE_RETENTION_PURGE_ENABLED', 'true');
    const missionId = await seedClosedCaseDueForPurge();
    const complaint = await fileComplaint(db, {
      actorAccountId: ownerId,
      missionId,
      description: 'the agency never responded',
    });
    if (!isOk(complaint)) throw new Error('setup failed');
    await db
      .update(schema.caseComplaints)
      .set({ status: 'RESOLVED', resolution: 'refunded' })
      .where(eq(schema.caseComplaints.id, complaint.value.id));

    const result = await sweepCaseRetentionPurge(db);
    expect(result).toEqual({
      enabled: true,
      checked: 1,
      purged: 1,
      skippedForHold: 0,
      skippedForComplaint: 0,
    });
  });

  it('honors a CASE_RETENTION_PURGE_GRACE_DAYS override', async () => {
    setEnv('CASE_RETENTION_PURGE_ENABLED', 'true');
    setEnv('CASE_RETENTION_PURGE_GRACE_DAYS', '5');
    const created = await createMission(db, {
      actorAccountId: ownerId,
      applicantId,
      title: 'Short-grace case',
    });
    if (!isOk(created)) throw new Error('setup failed');
    const cancelled = await transitionMission(db, {
      actorAccountId: ownerId,
      missionId: created.value.id,
      to: 'CANCELLED',
    });
    expect(isOk(cancelled)).toBe(true);
    const sixDaysAgo = new Date();
    sixDaysAgo.setUTCDate(sixDaysAgo.getUTCDate() - 6);
    await backdateRetentionNotice(db, created.value.id, sixDaysAgo);

    const result = await sweepCaseRetentionPurge(db);
    expect(result).toEqual({
      enabled: true,
      checked: 1,
      purged: 1,
      skippedForHold: 0,
      skippedForComplaint: 0,
    });
  });
});
