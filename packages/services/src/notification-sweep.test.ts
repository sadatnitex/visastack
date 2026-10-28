import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { decideAcknowledgement } from './acknowledgements';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { addDocumentVersion, registerDocument } from './documents';
import {
  attachPackVersion,
  createMission,
  createTask,
  selectEvidence,
  snapshotMission,
} from './missions';
import {
  computeTaskDeadlineThreshold,
  sweepExpiryReminders,
  sweepTaskDeadlineReminders,
} from './notification-sweep';
import { createOrganization } from './organizations';
import {
  addPackVersion,
  addRequirement,
  approvePackVersion,
  createPack,
  publishPackVersion,
} from './packs';

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  const db = drizzle(client, { schema });
  return db as unknown as Db;
}

async function seedOwner(db: Db, email: string) {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision failed');
  const account = provisioned.value;
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
  if (!isOk(applicant)) throw new Error('applicant failed');
  return { account, applicantId: applicant.value.id };
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe('computeTaskDeadlineThreshold', () => {
  const tz = 'Asia/Dhaka'; // UTC+6, no DST -- deterministic across the year.
  const now = new Date('2026-06-15T12:00:00.000Z'); // 2026-06-15 18:00 in Dhaka.

  it('fires due_7d and due_1d on exactly those calendar days, nothing between', () => {
    expect(computeTaskDeadlineThreshold(new Date(now.getTime() + 7 * DAY_MS), tz, now)).toBe(
      'due_7d',
    );
    expect(computeTaskDeadlineThreshold(new Date(now.getTime() + 1 * DAY_MS), tz, now)).toBe(
      'due_1d',
    );
    expect(computeTaskDeadlineThreshold(new Date(now.getTime() + 3 * DAY_MS), tz, now)).toBeNull();
    expect(computeTaskDeadlineThreshold(new Date(now.getTime() + 30 * DAY_MS), tz, now)).toBeNull();
  });

  it('fires overdue_0 the day the due date arrives, then overdue_1/2/... weekly, capped', () => {
    expect(computeTaskDeadlineThreshold(now, tz, now)).toBe('overdue_0');
    expect(computeTaskDeadlineThreshold(new Date(now.getTime() - 1 * DAY_MS), tz, now)).toBe(
      'overdue_0',
    );
    expect(computeTaskDeadlineThreshold(new Date(now.getTime() - 7 * DAY_MS), tz, now)).toBe(
      'overdue_1',
    );
    expect(computeTaskDeadlineThreshold(new Date(now.getTime() - 14 * DAY_MS), tz, now)).toBe(
      'overdue_2',
    );
    // Far beyond the bound: no more follow-ups, ever.
    expect(
      computeTaskDeadlineThreshold(new Date(now.getTime() - 365 * DAY_MS), tz, now),
    ).toBeNull();
  });

  it('never fires twice for the same calendar day in the subject timezone, even near a UTC day boundary', () => {
    // 2026-06-15 23:30 UTC is still 2026-06-16 05:30 in Dhaka (UTC+6) --
    // both instants below fall on the SAME Dhaka calendar day.
    const lateUtc = new Date('2026-06-15T23:30:00.000Z');
    const earlyNextUtc = new Date('2026-06-15T23:45:00.000Z');
    const due = new Date('2026-06-23T00:00:00.000Z');
    expect(computeTaskDeadlineThreshold(due, tz, lateUtc)).toBe(
      computeTaskDeadlineThreshold(due, tz, earlyNextUtc),
    );
  });
});

describe('sweepTaskDeadlineReminders', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('enqueues a TASK_DEADLINE reminder for a task due in exactly 7 days, using the task own dueTimezone', async () => {
    const { account, applicantId } = await seedOwner(db, 'task-sweep-owner@example.com');
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'M',
    });
    if (!isOk(mission)) throw new Error('mission');
    const now = new Date('2026-06-15T12:00:00.000Z');
    const dueDate = new Date(now.getTime() + 7 * DAY_MS);
    const task = await createTask(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      description: 'Submit form',
      dueDate,
      dueTimezone: 'Asia/Dhaka',
    });
    if (!isOk(task)) throw new Error('task');

    const result = await sweepTaskDeadlineReminders(db, now);
    expect(result.enqueued).toBe(1);

    const rows = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.eventType, 'TASK_DEADLINE'));
    expect(rows).toHaveLength(2); // in-app + email
    expect(rows[0]?.recipientAccountId).toBe(account.id);
    expect(rows.every((r) => r.idempotencyKey.endsWith(':due_7d'))).toBe(true);
    // The due day on the task's own calendar, and never the task's own words.
    const payload = rows[0]?.payload as { summary: string };
    expect(payload.summary).toBe('A task on "M" is due on 22 Jun 2026.');
    expect(payload.summary).not.toContain('Submit form');
  });

  it('says a task due today is due today, not past its date', async () => {
    const { account, applicantId } = await seedOwner(db, 'task-sweep-today@example.com');
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'M',
    });
    if (!isOk(mission)) throw new Error('mission');
    const now = new Date('2026-06-15T03:00:00.000Z');
    const task = await createTask(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      description: 'Submit form',
      dueDate: new Date('2026-06-15T00:00:00.000Z'),
      dueTimezone: 'Asia/Dhaka',
    });
    if (!isOk(task)) throw new Error('task');
    await sweepTaskDeadlineReminders(db, now);
    const [row] = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.eventType, 'TASK_DEADLINE'));
    expect(row?.payload).toMatchObject({
      subject: 'Task due today',
      summary: 'A task on "M" is due today, 15 Jun 2026.',
      timing: 'today',
    });
  });

  it('is idempotent across repeated runs on the same day -- never floods', async () => {
    const { account, applicantId } = await seedOwner(db, 'task-sweep-repeat@example.com');
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'M',
    });
    if (!isOk(mission)) throw new Error('mission');
    const now = new Date('2026-06-15T12:00:00.000Z');
    const task = await createTask(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      description: 'Submit form',
      dueDate: new Date(now.getTime() + DAY_MS),
      dueTimezone: 'Asia/Dhaka',
    });
    if (!isOk(task)) throw new Error('task');

    await sweepTaskDeadlineReminders(db, now);
    await sweepTaskDeadlineReminders(db, new Date(now.getTime() + 3600_000));
    await sweepTaskDeadlineReminders(db, new Date(now.getTime() + 7200_000));

    const rows = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.eventType, 'TASK_DEADLINE'));
    expect(rows).toHaveLength(2);
  });

  it('never reminds about a DONE or CANCELLED task', async () => {
    const { account, applicantId } = await seedOwner(db, 'task-sweep-done@example.com');
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'M',
    });
    if (!isOk(mission)) throw new Error('mission');
    const now = new Date('2026-06-15T12:00:00.000Z');
    const task = await createTask(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      description: 'Submit form',
      dueDate: new Date(now.getTime() + DAY_MS),
      dueTimezone: 'Asia/Dhaka',
    });
    if (!isOk(task)) throw new Error('task');
    await db
      .update(schema.missionTasks)
      .set({ status: 'DONE' })
      .where(eq(schema.missionTasks.id, task.value.id));

    const result = await sweepTaskDeadlineReminders(db, now);
    expect(result.enqueued).toBe(0);
  });

  it('falls back to the applicant own timezone when the task has none set', async () => {
    const { account, applicantId } = await seedOwner(db, 'task-sweep-fallback@example.com');
    await db
      .update(schema.applicants)
      .set({ timezone: 'America/New_York' })
      .where(eq(schema.applicants.id, applicantId));
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'M',
    });
    if (!isOk(mission)) throw new Error('mission');
    const now = new Date('2026-06-15T12:00:00.000Z');
    const task = await createTask(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      description: 'Submit form',
      dueDate: new Date(now.getTime() + DAY_MS),
    });
    if (!isOk(task)) throw new Error('task');

    const result = await sweepTaskDeadlineReminders(db, now);
    expect(result.enqueued).toBe(1);
  });
});

describe('sweepExpiryReminders', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  async function registerExpiringDocument(
    db: Db,
    accountId: string,
    applicantId: string,
    expiresAt: Date,
  ) {
    const doc = await registerDocument(db, {
      actorAccountId: accountId,
      applicantId,
      originalName: 'passport.pdf',
      docType: 'passport',
    });
    if (!isOk(doc)) throw new Error('doc');
    await addDocumentVersion(db, {
      actorAccountId: accountId,
      documentId: doc.value.id,
      bucket: 'CLEAN',
      objectKey: 'k',
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });
    await db
      .update(schema.documents)
      .set({ expiresAt })
      .where(eq(schema.documents.id, doc.value.id));
    return doc.value.id;
  }

  it('enqueues a DOCUMENT_EXPIRY reminder once a default threshold is crossed', async () => {
    const { account, applicantId } = await seedOwner(db, 'expiry-sweep-owner@example.com');
    const now = new Date('2026-06-15T12:00:00.000Z');
    await registerExpiringDocument(
      db,
      account.id,
      applicantId,
      new Date(now.getTime() + 30 * DAY_MS),
    );

    const result = await sweepExpiryReminders(db, now);
    expect(result.enqueued).toBe(1);
    const rows = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.eventType, 'DOCUMENT_EXPIRY'));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.idempotencyKey.endsWith(':30'))).toBe(true);
  });

  it('never enqueues for a document with no known expiry -- unknown stays unknown', async () => {
    const { account, applicantId } = await seedOwner(db, 'expiry-sweep-unknown@example.com');
    const doc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId,
      originalName: 'bank.pdf',
      docType: 'bank_statement',
    });
    if (!isOk(doc)) throw new Error('doc');
    await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: doc.value.id,
      bucket: 'CLEAN',
      objectKey: 'k',
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });

    const result = await sweepExpiryReminders(db, new Date());
    expect(result.enqueued).toBe(0);
  });

  it('is idempotent across repeated runs while the same threshold window holds', async () => {
    const { account, applicantId } = await seedOwner(db, 'expiry-sweep-repeat@example.com');
    const now = new Date('2026-06-15T12:00:00.000Z');
    await registerExpiringDocument(
      db,
      account.id,
      applicantId,
      new Date(now.getTime() + 5 * DAY_MS),
    );

    await sweepExpiryReminders(db, now);
    await sweepExpiryReminders(db, new Date(now.getTime() + 3600_000));

    const rows = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.eventType, 'DOCUMENT_EXPIRY'));
    expect(rows).toHaveLength(2);
  });

  it('never enqueues once truly expired -- only the named reminder window, not a post-expiry event', async () => {
    const { account, applicantId } = await seedOwner(db, 'expiry-sweep-expired@example.com');
    const now = new Date('2026-06-15T12:00:00.000Z');
    await registerExpiringDocument(db, account.id, applicantId, new Date(now.getTime() - DAY_MS));

    const result = await sweepExpiryReminders(db, now);
    expect(result.enqueued).toBe(0);
  });

  /** A mission with one DOCUMENT requirement satisfied by, and acknowledged over, a document whose `expiresAt` can be set independently. */
  async function seedAcknowledgedMissionOverDocument(
    db: Db,
    accountId: string,
    applicantId: string,
  ) {
    const pack = await createPack(db, {
      actorAccountId: accountId,
      key: 'expiry-dirty.pack',
      name: 'Expiry Dirty Pack',
    });
    if (!isOk(pack)) throw new Error('pack');
    const version = await addPackVersion(db, { actorAccountId: accountId, packId: pack.value.id });
    if (!isOk(version)) throw new Error('version');
    const requirement = await addRequirement(db, {
      actorAccountId: accountId,
      packVersionId: version.value.id,
      kind: 'DOCUMENT',
      docType: 'passport',
      citation: 'rule 1',
    });
    if (!isOk(requirement)) throw new Error('requirement');
    await approvePackVersion(db, { actorAccountId: accountId, packVersionId: version.value.id });
    await publishPackVersion(db, { actorAccountId: accountId, packVersionId: version.value.id });

    const mission = await createMission(db, { actorAccountId: accountId, applicantId, title: 'M' });
    if (!isOk(mission)) throw new Error('mission');
    await attachPackVersion(db, {
      actorAccountId: accountId,
      missionId: mission.value.id,
      packVersionId: version.value.id,
    });

    const documentId = await registerExpiringDocument(
      db,
      accountId,
      applicantId,
      new Date(Date.now() + 365 * DAY_MS),
    );

    const selected = await selectEvidence(db, {
      actorAccountId: accountId,
      missionId: mission.value.id,
      packRequirementId: requirement.value.id,
      documentId,
    });
    if (!isOk(selected)) throw new Error('select');

    const snap = await snapshotMission(db, {
      actorAccountId: accountId,
      missionId: mission.value.id,
    });
    if (!isOk(snap)) throw new Error('snapshot');

    const ack = await decideAcknowledgement(db, {
      actorAccountId: accountId,
      missionId: mission.value.id,
      snapshotId: snap.value.id,
      expectedSnapshotChecksum: snap.value.checksum,
      decision: 'ACKNOWLEDGED',
      stepUpSatisfied: true,
    });
    if (!isOk(ack)) throw new Error('acknowledge');

    return { missionId: mission.value.id, documentId };
  }

  it("invalidates a mission's live acknowledgement once its selected document genuinely expires (directive Part 7 §5)", async () => {
    const { account, applicantId } = await seedOwner(db, 'expiry-dirty-owner@example.com');
    const { missionId, documentId } = await seedAcknowledgedMissionOverDocument(
      db,
      account.id,
      applicantId,
    );

    const before = await db
      .select()
      .from(schema.acknowledgements)
      .where(eq(schema.acknowledgements.missionId, missionId));
    expect(before[0]?.invalidatedAt).toBeNull();

    // Evidence expires only now, after acknowledgement.
    await db
      .update(schema.documents)
      .set({ expiresAt: new Date(Date.now() - 2 * DAY_MS) })
      .where(eq(schema.documents.id, documentId));

    const result = await sweepExpiryReminders(db, new Date());
    expect(result.missionsDirtied).toBe(1);

    const after = await db
      .select()
      .from(schema.acknowledgements)
      .where(eq(schema.acknowledgements.missionId, missionId));
    expect(after[0]?.invalidatedAt).not.toBeNull();
  });

  it('does not re-dirty a mission on a later run once its acknowledgement is already invalidated -- self-limiting with no new bookkeeping', async () => {
    const { account, applicantId } = await seedOwner(db, 'expiry-dirty-repeat@example.com');
    const { missionId, documentId } = await seedAcknowledgedMissionOverDocument(
      db,
      account.id,
      applicantId,
    );
    await db
      .update(schema.documents)
      .set({ expiresAt: new Date(Date.now() - 2 * DAY_MS) })
      .where(eq(schema.documents.id, documentId));

    const first = await sweepExpiryReminders(db, new Date());
    expect(first.missionsDirtied).toBe(1);

    const second = await sweepExpiryReminders(db, new Date());
    expect(second.missionsDirtied).toBe(0);

    // Still invalidated (not un-done), just not re-counted.
    const rows = await db
      .select()
      .from(schema.acknowledgements)
      .where(eq(schema.acknowledgements.missionId, missionId));
    expect(rows[0]?.invalidatedAt).not.toBeNull();
  });
});

describe('OPS-04 (Commercial V1 Part 9): overdue-task analytics', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  const now = new Date('2026-06-15T12:00:00.000Z');

  async function overdueEvents() {
    return (await db.select().from(schema.productEvents)).filter(
      (e) => e.eventType === 'TASK_OVERDUE',
    );
  }

  async function taskDue(dueDate: Date, options: { readonly organizationId?: string } = {}) {
    const { account, applicantId } = await seedOwner(db, 'ops04-sweep@example.com');
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'M',
      ...(options.organizationId ? { ownerOrganizationId: options.organizationId } : {}),
    });
    if (!isOk(mission)) throw new Error('mission');
    const task = await createTask(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      description: 'Submit form',
      dueDate,
      dueTimezone: 'Asia/Dhaka',
    });
    if (!isOk(task)) throw new Error('task');
    return { account, taskId: task.value.id };
  }

  it('records a task going overdue once, however many sweeps revisit it, including the weekly follow-ups', async () => {
    const { account, taskId } = await taskDue(new Date(now.getTime() - DAY_MS));

    await sweepTaskDeadlineReminders(db, now);
    await sweepTaskDeadlineReminders(db, new Date(now.getTime() + 3600_000));
    // A week on, the sweep sends a fresh follow-up reminder (overdue_1) for the
    // same task; the task is still the same overdue task.
    const aWeekOn = new Date(now.getTime() + 6 * DAY_MS);
    await sweepTaskDeadlineReminders(db, aWeekOn);
    const reminders = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.eventType, 'TASK_DEADLINE'));
    expect(reminders.some((r) => r.idempotencyKey.endsWith(':overdue_1'))).toBe(true);

    const events = await overdueEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      accountId: account.id,
      organizationId: null,
      dimension: null,
      metricValue: null,
    });
    expect(events[0]?.dedupeKey).toMatch(/^[0-9a-f]{64}$/);
    expect(events[0]?.dedupeKey).not.toContain(taskId);
  });

  it('carries the organization of an agency case', async () => {
    const { account } = await seedOwner(db, 'ops04-sweep-org@example.com');
    const org = await createOrganization(db, { actorAccountId: account.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    const { taskId } = await taskDue(new Date(now.getTime() - DAY_MS), {
      organizationId: org.value.id,
    });
    expect(taskId).toBeTruthy();

    await sweepTaskDeadlineReminders(db, now);
    expect(await overdueEvents()).toMatchObject([{ organizationId: org.value.id }]);
  });

  it('records nothing for a task that is merely coming due, or one that is already done', async () => {
    const upcoming = await taskDue(new Date(now.getTime() + 7 * DAY_MS));
    expect(upcoming.taskId).toBeTruthy();
    expect((await sweepTaskDeadlineReminders(db, now)).enqueued).toBe(1);
    expect(await overdueEvents()).toEqual([]);

    const done = await taskDue(new Date(now.getTime() - DAY_MS));
    await db
      .update(schema.missionTasks)
      .set({ status: 'DONE' })
      .where(eq(schema.missionTasks.id, done.taskId));
    await sweepTaskDeadlineReminders(db, now);
    expect(await overdueEvents()).toEqual([]);
  });
});
