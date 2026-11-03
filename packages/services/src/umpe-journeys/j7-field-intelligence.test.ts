/**
 * Journey J7 (field intelligence), services layer, on a real migrated in-memory database.
 *
 * Covered: two successive authority submissions on one case, each with its own handoff evidence
 * and its own outcome, stay two attempts (a refusal then an approval is never one success); an
 * attempt with no decision record stays Unknown whatever the case's state says; a person's own
 * word stays Self Reported (there is no government-verified label, and a made-up verified decision
 * is refused); a guest's submission to an agency is counted as an agency submission, never as an
 * authority submission; small cohorts are hidden in the staff report; the report carries counts
 * only and no approval prediction of any kind.
 *
 * Setup note: cases, snapshots, handoffs, submission reports, agencies and guest submissions are
 * inserted as rows, exactly as the existing outcome tests do, so this journey starts at the moment
 * an application was sent. Attempts and their events go through the real services and gate.
 *
 * Not exercisable below the browser (reported, not faked): real sign-in, the outcome and Field
 * Insights screens, staff step-up, and the live deployment.
 *
 * Synthetic people and documents only. The clock is a fixed `TODAY`.
 */
import { createHash, randomUUID } from 'node:crypto';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { accountPrincipal, requireAccess } from '../access';
import { provisionAccount } from '../accounts';
import { createApplicant } from '../applicants';
import { setConsent } from '../consent';
import type { Db } from '../db';
import { addDocumentVersion, registerDocument } from '../documents';
import { seedStaffAccount, staffScopeFor } from '../platform-roles.test-support';
import { type FieldInsightsReport, getFieldInsights } from '../umpe-insights-service';
import {
  listOutcomeAttempts,
  recordAttemptEvent,
  recordOutcomeAttempt,
  trackSubmissionAsAttempt,
} from '../umpe-outcome-service';
import { EVIDENCE_BASES } from '../umpe-outcome-tables';

const TIMEOUT = 120_000;
const TODAY = new Date('2026-11-03T06:00:00Z');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function stage(report: FieldInsightsReport, key: string) {
  const row = report.funnel.find((f) => f.key === key);
  if (!row) throw new Error(`no stage ${key}`);
  return row.cell;
}

describe('J7 field intelligence', () => {
  let db: Db;
  let actor: string;
  let applicantId: string;
  let missionId: string;
  let firstAttempt: string;
  let secondAttempt: string;
  let firstDocVersion: string;
  let secondDocVersion: string;
  let refusalLetterVersion: string;

  async function proof<A extends 'MANAGE' | 'VIEW_METADATA'>(action: A) {
    const granted = await requireAccess(
      db,
      accountPrincipal(actor),
      action,
      { missionId },
      { purpose: 'self' },
    );
    if (!granted.ok) throw new Error('access');
    return granted.value;
  }
  async function evidence(name: string) {
    const doc = await registerDocument(db, {
      actorAccountId: actor,
      applicantId,
      originalName: `${name}.pdf`,
      docType: 'OTHER',
    });
    if (!isOk(doc)) throw new Error('doc');
    const version = await addDocumentVersion(db, {
      actorAccountId: actor,
      documentId: doc.value.id,
      bucket: 'CLEAN',
      objectKey: `j7-${randomUUID()}`,
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });
    if (!isOk(version)) throw new Error('version');
    return version.value.version.id;
  }
  async function snapshotAndHandoff(version: number, at: Date, documentVersionId: string) {
    const [snap] = await db
      .insert(schema.missionSnapshots)
      .values({
        missionId,
        version,
        content: { facts: [], documents: [{ documentVersionId }] },
        checksum: sha(`${missionId}${version}`),
        materialRevisionAtCapture: version,
        createdAt: at,
      })
      .returning();
    if (!snap) throw new Error('snapshot');
    await db.insert(schema.umpePackageHandoffs).values({
      missionId,
      applicantId,
      missionSnapshotId: snap.id,
      packVersionId,
      packChecksum: 'c'.repeat(64),
      manifestFormat: 1,
      materialRevisionAtCapture: version,
      content: { selections: [{ documentVersionId, factVersionId: null }] },
      contentChecksum: sha(`${snap.id}${documentVersionId}`),
      confirmedAt: new Date(at.getTime() + 3_600_000),
    });
    return snap.id;
  }
  let packVersionId: string;

  beforeAll(async () => {
    db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
    const account = await provisionAccount(db, { email: 'j7-traveller@example.invalid' });
    if (!isOk(account)) throw new Error('provision');
    actor = account.value.id;
    await setConsent(db, {
      actorAccountId: actor,
      accountId: actor,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    const applicant = await createApplicant(db, {
      actorAccountId: actor,
      ownerAccountId: actor,
      displayName: 'Synthetic Traveller',
    });
    if (!isOk(applicant)) throw new Error('applicant');
    applicantId = applicant.value.id;
    const [pack] = await db
      .insert(schema.packs)
      .values({ key: `j7.${randomUUID()}`, name: 'J7 Synthetic', route: 'SYNTH-VISITOR' })
      .returning();
    if (!pack) throw new Error('pack');
    const [version] = await db
      .insert(schema.packVersions)
      .values({ packId: pack.id, version: 1, status: 'PUBLISHED', checksum: 'c'.repeat(64) })
      .returning();
    if (!version) throw new Error('pack version');
    packVersionId = version.id;
    const [mission] = await db
      .insert(schema.missions)
      .values({
        applicantId,
        title: 'Synthetic Case',
        purpose: 'Visit',
        destination: 'Synthland',
        state: 'SUBMITTED',
      })
      .returning();
    if (!mission) throw new Error('mission');
    missionId = mission.id;
    firstDocVersion = await evidence('first-bank-statement');
    secondDocVersion = await evidence('second-bank-statement');
    refusalLetterVersion = await evidence('refusal-letter');
  }, TIMEOUT);

  it(
    'step 1: two successive authority submissions with different evidence are two attempts',
    async () => {
      const snap1 = await snapshotAndHandoff(1, new Date('2026-09-01T00:00:00Z'), firstDocVersion);
      const [report] = await db
        .insert(schema.missionSubmissions)
        .values({
          missionId,
          snapshotId: snap1,
          actorAccountId: actor,
          channel: 'VISA_APPLICATION_CENTER',
          externalReportDescription: 'Synthetic report',
          submittedAt: new Date('2026-09-02T08:00:00Z'),
          authAssuranceContext: { method: 'test' },
        })
        .returning();
      if (!report) throw new Error('report');
      const first = await trackSubmissionAsAttempt(await proof('MANAGE'), {
        missionId,
        missionSubmissionId: report.id,
      });
      if (!first.ok) throw new Error(first.error.message);
      firstAttempt = first.value.attemptId;
      expect(first.value.attemptNo).toBe(1);

      await snapshotAndHandoff(2, new Date('2026-10-10T00:00:00Z'), secondDocVersion);
      const second = await recordOutcomeAttempt(
        await proof('MANAGE'),
        { missionId, channel: 'EMBASSY_PORTAL', submittedOn: '2026-10-12' },
        TODAY,
      );
      if (!second.ok) throw new Error(second.error.message);
      secondAttempt = second.value.attemptId;
      expect(second.value.attemptNo).toBe(2);

      const rows = await db
        .select()
        .from(schema.umpeOutcomeAttempts)
        .where(eq(schema.umpeOutcomeAttempts.missionId, missionId));
      const byNo = new Map(rows.map((r) => [r.attemptNo, r]));
      expect(rows).toHaveLength(2);
      expect(byNo.get(1)?.selectedVersions).toEqual({
        documentVersionIds: [firstDocVersion],
        factVersionIds: [],
      });
      expect(byNo.get(2)?.selectedVersions).toEqual({
        documentVersionIds: [secondDocVersion],
        factVersionIds: [],
      });
    },
    TIMEOUT,
  );

  it(
    'step 2: a missing outcome stays Unknown, whatever the case state says',
    async () => {
      // The case reads as submitted and could be closed; neither is an outcome.
      await db
        .update(schema.missions)
        .set({ state: 'CLOSED' })
        .where(eq(schema.missions.id, missionId));
      const view = await listOutcomeAttempts(await proof('VIEW_METADATA'), missionId);
      if (!view.ok) throw new Error('view');
      expect(view.value.attempts.map((a) => a.standing)).toEqual([
        { kind: 'UNKNOWN' },
        { kind: 'UNKNOWN' },
      ]);
    },
    TIMEOUT,
  );

  it(
    'step 3: a refusal then an approval remain two attempts with their own outcome, not one success',
    async () => {
      const refused = await recordAttemptEvent(
        await proof('MANAGE'),
        {
          missionId,
          attemptId: firstAttempt,
          kind: 'DECISION',
          decision: 'REFUSED',
          occurredOn: '2026-09-20',
          evidenceDocumentVersionId: refusalLetterVersion,
        },
        TODAY,
      );
      expect(refused.ok).toBe(true);
      const approved = await recordAttemptEvent(
        await proof('MANAGE'),
        {
          missionId,
          attemptId: secondAttempt,
          kind: 'DECISION',
          decision: 'APPROVED',
          occurredOn: '2026-10-30',
        },
        TODAY,
      );
      expect(approved.ok).toBe(true);
      const view = await listOutcomeAttempts(await proof('VIEW_METADATA'), missionId);
      if (!view.ok) throw new Error('view');
      expect(view.value.attempts.map((a) => [a.attemptNo, a.standing])).toEqual([
        [
          1,
          {
            kind: 'DECIDED',
            decision: 'REFUSED',
            occurredOn: '2026-09-20',
            documentSupplied: true,
          },
        ],
        [
          2,
          {
            kind: 'DECIDED',
            decision: 'APPROVED',
            occurredOn: '2026-10-30',
            documentSupplied: false,
          },
        ],
      ]);
      // The approval of the second attempt never rewrote the first one's refusal.
      const events = await db
        .select()
        .from(schema.umpeOutcomeEvents)
        .where(eq(schema.umpeOutcomeEvents.attemptId, firstAttempt));
      expect(events.map((e) => e.decision)).toEqual(['REFUSED']);
    },
    TIMEOUT,
  );

  it(
    'negative: a self report is never labelled government verified',
    async () => {
      expect([...EVIDENCE_BASES]).toEqual(['SELF_REPORTED', 'DOCUMENT_SUPPLIED']);
      const [approval] = await db
        .select()
        .from(schema.umpeOutcomeEvents)
        .where(eq(schema.umpeOutcomeEvents.attemptId, secondAttempt));
      expect(approval?.evidenceBasis).toBe('SELF_REPORTED');
      const [attempt] = await db
        .select()
        .from(schema.umpeOutcomeAttempts)
        .where(eq(schema.umpeOutcomeAttempts.id, secondAttempt));
      expect(attempt?.evidenceBasis).toBe('SELF_REPORTED');
      const invented = await recordAttemptEvent(
        await proof('MANAGE'),
        {
          missionId,
          attemptId: secondAttempt,
          kind: 'DECISION',
          decision: 'VERIFIED_APPROVAL',
          occurredOn: '2026-10-31',
        },
        TODAY,
      );
      expect(invented.ok).toBe(false);
      const view = await listOutcomeAttempts(await proof('VIEW_METADATA'), missionId);
      expect(JSON.stringify(view)).not.toMatch(/verified|government/i);
    },
    TIMEOUT,
  );

  it(
    'negative: guest receipts are agency submissions, never authority submissions; small cohorts hidden',
    async () => {
      const attemptsBefore = await db.select().from(schema.umpeOutcomeAttempts);
      for (let i = 0; i < 5; i++) {
        const [org] = await db
          .insert(schema.organizations)
          .values({ name: `Synthetic Agency ${i}` })
          .returning();
        if (!org) throw new Error('org');
        const [request] = await db
          .insert(schema.agencyCollectionRequests)
          .values({ organizationId: org.id, destination: 'SY' })
          .returning();
        if (!request) throw new Error('request');
        const [revision] = await db
          .insert(schema.agencyCollectionRequestRevisions)
          .values({
            requestId: request.id,
            revisionNo: 1,
            items: [],
            contentSha256: sha(`r${i}`),
            issuedByAccountId: randomUUID(),
          })
          .returning();
        if (!revision) throw new Error('revision');
        const [link] = await db
          .insert(schema.agencyCollectionLinks)
          .values({
            requestId: request.id,
            revisionId: revision.id,
            tokenHash: sha(`l${i}`),
            expiresAt: new Date('2027-01-01T00:00:00Z'),
          })
          .returning();
        if (!link) throw new Error('link');
        for (const n of [1, 2]) {
          await db.insert(schema.agencyCollectionGuestSubmissions).values({
            organizationId: org.id,
            requestId: request.id,
            revisionId: revision.id,
            linkId: link.id,
            recipientKey: sha(`guest-${i}-${n}`),
            revisionNo: 1,
            submissionNo: 1,
            retentionDays: 30,
            consentVersion: 'v1',
            contentSha256: sha(`s${i}${n}`),
          });
        }
      }
      const staffActor = await seedStaffAccount(db, 'QUALITY_ADMIN', 'j7-quality@example.invalid');
      const read = await getFieldInsights(
        db,
        await staffScopeFor(db, staffActor, 'FEEDBACK_VIEW'),
        { periodMonths: 12 },
        TODAY,
      );
      if (!read.ok) throw new Error('insights');
      // Reading the report turned no guest receipt into an attempt.
      expect(await db.select().from(schema.umpeOutcomeAttempts)).toEqual(attemptsBefore);
      expect(stage(read.value, 'SUBMITTED_TO_AGENCY')).toEqual({ shown: true, value: 10 });
      // The two real attempts (one person) form a small cohort: hidden, and never 12.
      expect(stage(read.value, 'REPORTED_TO_AUTHORITY')).toEqual({ shown: false, reason: 'SMALL' });
      expect(stage(read.value, 'APPROVAL_RECORDED')).toEqual({ shown: false, reason: 'SMALL' });
    },
    TIMEOUT,
  );

  it(
    'negative: the staff report carries counts only and no approval prediction',
    async () => {
      const staffActor = await seedStaffAccount(
        db,
        'QUALITY_ADMIN',
        'j7-quality-2@example.invalid',
      );
      const read = await getFieldInsights(
        db,
        await staffScopeFor(db, staffActor, 'FEEDBACK_VIEW'),
        {},
        TODAY,
      );
      if (!read.ok) throw new Error('insights');
      const keys: string[] = [];
      const walk = (value: unknown) => {
        if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === 'object') {
          for (const [k, v] of Object.entries(value)) {
            keys.push(k);
            walk(v);
          }
        }
      };
      walk(read.value);
      const text = JSON.stringify(read.value);
      expect(keys.join(' ')).not.toMatch(/predict|probab|likel|chance|odds|score|forecast/i);
      expect(text).not.toMatch(/predict|probab|likel|chance|odds|forecast/i);
      // Nothing personal either.
      expect(text).not.toContain(applicantId);
      expect(text).not.toContain(actor);
      expect(text).not.toMatch(/Synthetic|example\.invalid|Synthland/);
    },
    TIMEOUT,
  );
});
