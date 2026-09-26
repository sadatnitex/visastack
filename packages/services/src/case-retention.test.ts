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
import { sweepCaseRetentionNotices } from './case-retention';
import { setConsent } from './consent';
import type { Db } from './db';
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
