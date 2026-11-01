import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { appendAuditEvent } from './audit';
import { listComplaintsForQualityReview } from './complaints';
import { setConsent } from './consent';
import type { Db } from './db';
import { addDocumentVersion, registerDocument } from './documents';
import { listEmailDeliveryProblems } from './email-delivery-admin';
import { listFeedbackForQualityReview } from './feedback';
import { listFailedJobs } from './jobs';
import { createMission } from './missions';
import { encodeSeqCursor, encodeTimeCursor } from './paging';
import { listInvitations } from './pilot-access';
import { listRecentAuditEvents } from './platform-reads';
import { seedStaffAccount, staffScopeFor } from './platform-roles.test-support';

/**
 * WP-SB6: the staff operations reads, one page at a time. Each paged read walks the whole list
 * with its cursor (every row once, in order, nothing skipped), refuses to be steered by a cursor
 * from another list or view, keeps its role check, and the old call shape is unchanged.
 */

const BASE = Date.UTC(2026, 9, 1, 9, 0, 0);
const at = (minutes: number) => new Date(BASE + minutes * 60_000);

async function freshDb(): Promise<Db> {
  return drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
}

async function seedTraveller(db: Db, email: string) {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision');
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
  if (!isOk(applicant)) throw new Error('applicant');
  const mission = await createMission(db, {
    actorAccountId: account.id,
    applicantId: applicant.value.id,
    title: 'UK Visa',
  });
  if (!isOk(mission)) throw new Error('mission');
  return { account, applicantId: applicant.value.id, missionId: mission.value.id };
}

/** Reads every page of a list through its cursor and returns the rows in order. */
async function walk<T>(
  read: (before: string | undefined) => Promise<{ items: readonly T[]; nextCursor: string | null }>,
): Promise<T[]> {
  const all: T[] = [];
  let before: string | undefined;
  for (let guard = 0; guard < 50; guard += 1) {
    const page = await read(before);
    all.push(...page.items);
    if (!page.nextCursor) return all;
    before = page.nextCursor;
  }
  throw new Error('the cursor never ended');
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T {
  if (!result.ok) throw new Error('expected ok');
  return result.value;
}

describe('WP-SB6 staff operations paging', () => {
  let db: Db;
  let traveller: Awaited<ReturnType<typeof seedTraveller>>;

  beforeAll(async () => {
    db = await freshDb();
    traveller = await seedTraveller(db, 'traveller@example.com');
  });

  describe('audit trail by sequence number', () => {
    it('walks every entry once, highest sequence first, and keeps the old shape', async () => {
      const admin = await seedStaffAccount(db, 'SECURITY_ADMIN', 'security@example.com');
      const scope = await staffScopeFor(db, admin, 'AUDIT_TRAIL_VIEW');
      for (let n = 0; n < 23; n += 1) {
        await appendAuditEvent(db, {
          eventType: 'SB6_TEST',
          actorAccountId: n % 2 === 0 ? traveller.account.id : null,
          method: 'MANUAL',
          result: 'ALLOWED',
        });
      }
      const all = unwrap(await listRecentAuditEvents(db, scope, 500));
      const walked = await walk(async (before) =>
        unwrap(await listRecentAuditEvents(db, scope, { limit: 7, ...(before ? { before } : {}) })),
      );
      expect(walked.map((e) => e.seq)).toEqual(all.map((e) => e.seq));
      const seqs = walked.map((e) => e.seq);
      expect([...seqs].sort((a, b) => b - a)).toEqual(seqs);
      expect(new Set(seqs).size).toBe(seqs.length);
      // The actor's email travels with each entry, so the page can say who.
      const byTraveller = walked.filter((e) => e.actorAccountId === traveller.account.id);
      expect(byTraveller.length).toBeGreaterThan(0);
      expect(byTraveller.every((e) => e.actorEmail === 'traveller@example.com')).toBe(true);
      // Old callers still get plain rows.
      const old = unwrap(await listRecentAuditEvents(db, scope, 3));
      expect(old).toHaveLength(3);
      expect('actorEmail' in (old[0] ?? {})).toBe(false);
    });

    it('filters by who, case-insensitively, and binds the cursor to that filter', async () => {
      const admin = await seedStaffAccount(db, 'SECURITY_ADMIN', 'security-2@example.com');
      const scope = await staffScopeFor(db, admin, 'AUDIT_TRAIL_VIEW');
      const mine = await walk(async (before) =>
        unwrap(
          await listRecentAuditEvents(db, scope, {
            limit: 4,
            who: '  Traveller@Example.COM ',
            ...(before ? { before } : {}),
          }),
        ),
      );
      expect(mine.length).toBeGreaterThan(4);
      expect(mine.every((e) => e.actorAccountId === traveller.account.id)).toBe(true);
      // A cursor from the filtered view does not move the unfiltered one, and the reverse.
      const filteredFirst = unwrap(
        await listRecentAuditEvents(db, scope, { limit: 2, who: 'traveller@example.com' }),
      );
      const unfilteredFirst = unwrap(await listRecentAuditEvents(db, scope, { limit: 2 }));
      expect(filteredFirst.nextCursor).not.toBeNull();
      const crossed = unwrap(
        await listRecentAuditEvents(db, scope, {
          limit: 2,
          before: filteredFirst.nextCursor ?? '',
        }),
      );
      expect(crossed.items.map((e) => e.seq)).toEqual(unfilteredFirst.items.map((e) => e.seq));
      // Someone with no account shows nothing; something that is not an email shows everything.
      expect(
        unwrap(await listRecentAuditEvents(db, scope, { who: 'nobody@example.com' })).items,
      ).toEqual([]);
      expect(
        unwrap(await listRecentAuditEvents(db, scope, { limit: 2, who: "x' or 1=1 --" })).items.map(
          (e) => e.seq,
        ),
      ).toEqual(unfilteredFirst.items.map((e) => e.seq));
    });

    it('gives the first page for a malformed or foreign cursor and never changes a row', async () => {
      const admin = await seedStaffAccount(db, 'SECURITY_ADMIN', 'security-3@example.com');
      const scope = await staffScopeFor(db, admin, 'AUDIT_TRAIL_VIEW');
      const first = unwrap(await listRecentAuditEvents(db, scope, { limit: 3 }));
      const before = await db.select().from(schema.auditEvents);
      for (const cursor of [
        'not-a-cursor',
        encodeSeqCursor(5, 'applicant:x:access-log'),
        encodeSeqCursor(5, 'platform:audit:who:other@example.com'),
      ]) {
        const page = unwrap(await listRecentAuditEvents(db, scope, { limit: 3, before: cursor }));
        expect(page.items.map((e) => e.seq)).toEqual(first.items.map((e) => e.seq));
      }
      const after = await db.select().from(schema.auditEvents);
      // Reading appends nothing and edits nothing.
      expect(after.map((e) => [e.seq, e.hash])).toEqual(before.map((e) => [e.seq, e.hash]));
    });

    it('keeps the role check for the paged read', async () => {
      const support = await seedStaffAccount(db, 'SUPPORT_ADMIN', 'support-audit@example.com');
      const wrong = await staffScopeFor(db, support, 'PROCESSING_JOB_RETRY');
      const refused = await listRecentAuditEvents(
        db,
        wrong as unknown as Parameters<typeof listRecentAuditEvents>[1],
        { limit: 5 },
      );
      expect(isErr(refused)).toBe(true);
    });
  });

  describe('complaints by status tab', () => {
    it('reads one tab at a time, open first, with every status counted', async () => {
      const quality = await seedStaffAccount(db, 'QUALITY_ADMIN', 'quality@example.com');
      const statuses = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
      const rows = Array.from({ length: 30 }, (_, n) => ({
        missionId: traveller.missionId,
        filedByAccountId: traveller.account.id,
        description: `Complaint ${n}`,
        status: n < 18 ? ('OPEN' as const) : (statuses[n % 4] ?? 'OPEN'),
        // Two complaints share each minute, so the id breaks the tie.
        createdAt: at(Math.floor(n / 2)),
      }));
      await db.insert(schema.caseComplaints).values(rows);
      const first = unwrap(await listComplaintsForQualityReview(db, quality, { limit: 5 }));
      expect(first.status).toBe('OPEN');
      const expected = {
        OPEN: rows.filter((r) => r.status === 'OPEN').length,
        IN_PROGRESS: rows.filter((r) => r.status === 'IN_PROGRESS').length,
        RESOLVED: rows.filter((r) => r.status === 'RESOLVED').length,
        CLOSED: rows.filter((r) => r.status === 'CLOSED').length,
      };
      expect(first.counts).toEqual(expected);
      const open = await walk(async (before) =>
        unwrap(
          await listComplaintsForQualityReview(db, quality, {
            limit: 5,
            ...(before ? { before } : {}),
          }),
        ),
      );
      expect(open).toHaveLength(expected.OPEN);
      expect(new Set(open.map((c) => c.id)).size).toBe(expected.OPEN);
      expect(open.every((c) => c.status === 'OPEN')).toBe(true);
      const times = open.map((c) => c.createdAt.getTime());
      expect([...times].sort((a, b) => b - a)).toEqual(times);
      // A cursor from the Open tab gives the Resolved tab its first page.
      const resolvedFirst = unwrap(
        await listComplaintsForQualityReview(db, quality, { status: 'RESOLVED', limit: 50 }),
      );
      const crossed = unwrap(
        await listComplaintsForQualityReview(db, quality, {
          status: 'RESOLVED',
          limit: 50,
          before: first.nextCursor ?? '',
        }),
      );
      expect(crossed.items.map((c) => c.id)).toEqual(resolvedFirst.items.map((c) => c.id));
      // An unknown tab reads as Open; the old shape still lists every complaint.
      expect(
        unwrap(await listComplaintsForQualityReview(db, quality, { status: 'DROP TABLE' })).status,
      ).toBe('OPEN');
      expect(unwrap(await listComplaintsForQualityReview(db, quality))).toHaveLength(30);
    });

    it('refuses the paged read without the quality role', async () => {
      const support = await seedStaffAccount(db, 'SUPPORT_ADMIN', 'support-complaints@example.com');
      expect(isErr(await listComplaintsForQualityReview(db, support, { limit: 5 }))).toBe(true);
      expect(isErr(await listFeedbackForQualityReview(db, support, { limit: 5 }))).toBe(true);
    });
  });

  describe('private feedback', () => {
    it('walks every record once, newest first, with the total', async () => {
      const quality = await seedStaffAccount(db, 'QUALITY_ADMIN', 'quality-feedback@example.com');
      await db.insert(schema.caseFeedback).values(
        Array.from({ length: 13 }, (_, n) => ({
          missionId: traveller.missionId,
          submittedByAccountId: traveller.account.id,
          comments: `Feedback ${n}`,
          createdAt: at(Math.floor(n / 3)),
        })),
      );
      const first = unwrap(await listFeedbackForQualityReview(db, quality, { limit: 4 }));
      expect(first.total).toBe(13);
      const walked = await walk(async (before) =>
        unwrap(
          await listFeedbackForQualityReview(db, quality, {
            limit: 4,
            ...(before ? { before } : {}),
          }),
        ),
      );
      expect(walked).toHaveLength(13);
      expect(new Set(walked.map((f) => f.id)).size).toBe(13);
      expect(unwrap(await listFeedbackForQualityReview(db, quality))).toHaveLength(13);
    });
  });

  describe('pilot invitations', () => {
    it('lists pending invitations by default and the history apart, both paged', async () => {
      await db.insert(schema.pilotInvitations).values(
        Array.from({ length: 40 }, (_, n) => ({
          email: `invitee-${n}@example.com`,
          invitedAt: at(Math.floor(n / 2)),
          ...(n % 4 === 1 ? { acceptedAt: at(100) } : {}),
          ...(n % 4 === 2 ? { revokedAt: at(100), revokedReason: 'test' } : {}),
        })),
      );
      const pendingFirst = await listInvitations(db, { limit: 6 });
      expect(pendingFirst.view).toBe('pending');
      expect(pendingFirst.counts).toEqual({ pending: 20, history: 20 });
      const pending = await walk((before) =>
        listInvitations(db, { limit: 6, ...(before ? { before } : {}) }),
      );
      expect(pending).toHaveLength(20);
      expect(pending.every((i) => !i.acceptedAt && !i.revokedAt)).toBe(true);
      const history = await walk((before) =>
        listInvitations(db, { view: 'history', limit: 6, ...(before ? { before } : {}) }),
      );
      expect(history).toHaveLength(20);
      expect(history.every((i) => i.acceptedAt || i.revokedAt)).toBe(true);
      expect(new Set([...pending, ...history].map((i) => i.id)).size).toBe(40);
      // A pending cursor gives the history its first page.
      const historyFirst = await listInvitations(db, { view: 'history', limit: 6 });
      const crossed = await listInvitations(db, {
        view: 'history',
        limit: 6,
        before: pendingFirst.nextCursor ?? '',
      });
      expect(crossed.items.map((i) => i.id)).toEqual(historyFirst.items.map((i) => i.id));
      expect(await listInvitations(db)).toHaveLength(40);
    });
  });

  describe('email delivery lists', () => {
    it('pages failed emails backwards and waiting emails forwards, each with its own cursor', async () => {
      const support = await seedStaffAccount(db, 'SUPPORT_ADMIN', 'support-email@example.com');
      const scope = await staffScopeFor(db, support, 'PROCESSING_JOB_RETRY');
      const now = at(24 * 60);
      await db.insert(schema.notifications).values([
        ...Array.from({ length: 11 }, (_, n) => ({
          eventType: 'CLIENT_INVITATION_CREATED',
          channel: 'EMAIL' as const,
          idempotencyKey: `failed-${n}`,
          recipientEmail: `p${n}@example.org`,
          payload: {},
          status: (n % 3 === 0 ? 'BOUNCED' : 'FAILED') as 'BOUNCED' | 'FAILED',
          createdAt: at(Math.floor(n / 2)),
        })),
        ...Array.from({ length: 9 }, (_, n) => ({
          eventType: 'CLIENT_INVITATION_CREATED',
          channel: 'EMAIL' as const,
          idempotencyKey: `waiting-${n}`,
          recipientEmail: `w${n}@example.org`,
          payload: {},
          createdAt: at(60 + Math.floor(n / 2)),
        })),
      ]);
      const first = unwrap(await listEmailDeliveryProblems(db, scope, now, { limit: 4 }));
      expect(first.failedTotal).toBe(11);
      expect(first.waitingTotal).toBe(9);
      const failed = await walk(async (before) => {
        const value = unwrap(
          await listEmailDeliveryProblems(db, scope, now, {
            limit: 4,
            ...(before ? { failedBefore: before } : {}),
          }),
        );
        return { items: value.failed, nextCursor: value.failedNext };
      });
      expect(failed).toHaveLength(11);
      expect(new Set(failed.map((r) => r.id)).size).toBe(11);
      const failedTimes = failed.map((r) => r.createdAt.getTime());
      expect([...failedTimes].sort((a, b) => b - a)).toEqual(failedTimes);
      const waiting = await walk(async (after) => {
        const value = unwrap(
          await listEmailDeliveryProblems(db, scope, now, {
            limit: 4,
            ...(after ? { waitingAfter: after } : {}),
          }),
        );
        return { items: value.waiting, nextCursor: value.waitingNext };
      });
      expect(waiting).toHaveLength(9);
      const waitingTimes = waiting.map((r) => r.createdAt.getTime());
      expect([...waitingTimes].sort((a, b) => a - b)).toEqual(waitingTimes);
      // The failed cursor cannot move the waiting list.
      const crossed = unwrap(
        await listEmailDeliveryProblems(db, scope, now, {
          limit: 4,
          waitingAfter: first.failedNext ?? '',
        }),
      );
      expect(crossed.waiting.map((r) => r.id)).toEqual(first.waiting.map((r) => r.id));
      // Without options it reads the first 50 of each, as before.
      const plain = unwrap(await listEmailDeliveryProblems(db, scope, now));
      expect(plain.failed).toHaveLength(11);
      expect(plain.failedNext).toBeNull();
    });
  });

  describe('failed intake jobs', () => {
    it('walks every failed job once, newest first, with the total', async () => {
      const ids: string[] = [];
      for (let n = 0; n < 9; n += 1) {
        const doc = await registerDocument(db, {
          actorAccountId: traveller.account.id,
          applicantId: traveller.applicantId,
          originalName: `doc-${n}.pdf`,
        });
        if (!isOk(doc)) throw new Error('doc');
        const version = await addDocumentVersion(db, {
          actorAccountId: traveller.account.id,
          documentId: doc.value.id,
          bucket: 'QUARANTINE',
          objectKey: `obj-${n}`,
        });
        if (!isOk(version)) throw new Error('version');
        const [job] = await db
          .insert(schema.processingJobs)
          .values({
            documentVersionId: version.value.version.id,
            idempotencyKey: `sb6-${n}`,
            status: n === 8 ? 'PENDING' : 'FAILED',
            attempts: 5,
            updatedAt: at(Math.floor(n / 3)),
          })
          .returning({ id: schema.processingJobs.id });
        if (job) ids.push(job.id);
      }
      const first = await listFailedJobs(db, { limit: 3 });
      expect(first.total).toBe(8);
      const walked = await walk((before) =>
        listFailedJobs(db, { limit: 3, ...(before ? { before } : {}) }),
      );
      expect(walked).toHaveLength(8);
      expect(new Set(walked.map((j) => j.id)).size).toBe(8);
      const times = walked.map((j) => Date.parse(j.updatedAt));
      expect([...times].sort((a, b) => b - a)).toEqual(times);
      expect('cursorAt' in (walked[0] ?? {})).toBe(false);
      // A cursor from another list gives the first page; the old shape is unchanged.
      const foreign = encodeTimeCursor(
        { at: '2026-10-01T09:00:00.000000Z', id: ids[0] ?? '' },
        'platform:feedback',
      );
      const crossed = await listFailedJobs(db, { limit: 3, before: foreign });
      expect(crossed.items.map((j) => j.id)).toEqual(first.items.map((j) => j.id));
      const old = await listFailedJobs(db);
      expect(old).toHaveLength(8);
      expect('cursorAt' in (old[0] ?? {})).toBe(false);
    });
  });
});
