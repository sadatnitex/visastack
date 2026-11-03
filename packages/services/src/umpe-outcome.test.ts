/**
 * UMPE P12 (O01 to O07): application attempts, authority requests and Field Insights.
 *
 * Synthetic data only. Pins:
 * 1. Two attempts on one case keep their own package record, decisions and evidence.
 * 2. An attempt with no decision record stays Unknown, whatever the case's state says.
 * 3. A guest's submission to an agency is never an authority submission.
 * 4. A recorded decision without a document is never counted as document supported.
 * 5. Small cohorts and one-agency cells are hidden; a lone hidden count is not derivable.
 * 6. Only quality staff read the report, and it carries no ids, names or words.
 * 7. A purged case, a removed person and a removed document leave the report.
 * 8. The database refuses edits and direct deletes of attempt records.
 */
import { createHash, randomUUID } from 'node:crypto';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { accountPrincipal, requireAccess } from './access';
import { staffPrincipal } from './access/principal';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { addDocumentVersion, registerDocument } from './documents';
import { seedStaffAccount, staffScopeFor } from './platform-roles.test-support';
import { type FieldInsightsReport, getFieldInsights } from './umpe-insights-service';
import {
  DEFAULT_INSIGHT_THRESHOLDS,
  protect,
  protectGroup,
  tally,
} from './umpe-insights-suppression';
import {
  listOutcomeAttempts,
  recordAttemptEvent,
  recordOutcomeAttempt,
  trackSubmissionAsAttempt,
} from './umpe-outcome-service';

const TEST_TIMEOUT_MS = 120_000;
const TODAY = new Date('2026-11-03T06:00:00Z');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, { schema }) as unknown as Db;
}

async function person(db: Db, email: string) {
  const account = await provisionAccount(db, { email });
  if (!isOk(account)) throw new Error('provision');
  await setConsent(db, {
    actorAccountId: account.value.id,
    accountId: account.value.id,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  const applicant = await createApplicant(db, {
    actorAccountId: account.value.id,
    ownerAccountId: account.value.id,
    displayName: `Synthetic ${email}`,
  });
  if (!isOk(applicant)) throw new Error('applicant');
  return { actor: account.value.id, applicantId: applicant.value.id };
}

async function organization(db: Db, name: string) {
  const [row] = await db.insert(schema.organizations).values({ name }).returning();
  if (!row) throw new Error('org');
  return row.id;
}

async function pack(db: Db, docTypes: readonly string[] = []) {
  const [p] = await db
    .insert(schema.packs)
    .values({ key: `p12.${randomUUID()}`, name: 'P12 Synthetic', route: 'SYNTH-VISITOR' })
    .returning();
  if (!p) throw new Error('pack');
  const [v] = await db
    .insert(schema.packVersions)
    .values({ packId: p.id, version: 1, status: 'PUBLISHED', checksum: 'c'.repeat(64) })
    .returning();
  if (!v) throw new Error('version');
  for (const docType of docTypes) {
    await db
      .insert(schema.packRequirements)
      .values({ packVersionId: v.id, kind: 'DOCUMENT', docType, citation: 'Synthetic source' });
  }
  return v.id;
}

async function caseFor(
  db: Db,
  applicantId: string,
  org: string | null = null,
  title = 'Synthetic Case',
) {
  const [row] = await db
    .insert(schema.missions)
    .values({
      applicantId,
      title,
      purpose: 'Visit',
      destination: 'Synthland',
      state: 'SUBMITTED',
      ownerOrganizationId: org,
    })
    .returning();
  if (!row) throw new Error('mission');
  return row.id;
}

async function snapshot(
  db: Db,
  missionId: string,
  version: number,
  createdAt: Date,
  docIds: string[] = [],
) {
  const [row] = await db
    .insert(schema.missionSnapshots)
    .values({
      missionId,
      version,
      content: {
        facts: [],
        documents: docIds.map((id) => ({ documentId: id, documentVersionId: id })),
      },
      checksum: sha(`${missionId}${version}`),
      materialRevisionAtCapture: version,
      createdAt,
    })
    .returning();
  if (!row) throw new Error('snapshot');
  return row.id;
}

async function handoff(
  db: Db,
  missionId: string,
  applicantId: string,
  snapshotId: string,
  packVersionId: string,
  confirmedAt: Date,
  documentVersionId: string,
) {
  const [row] = await db
    .insert(schema.umpePackageHandoffs)
    .values({
      missionId,
      applicantId,
      missionSnapshotId: snapshotId,
      packVersionId,
      packChecksum: 'c'.repeat(64),
      manifestFormat: 1,
      materialRevisionAtCapture: 1,
      content: { selections: [{ documentVersionId, factVersionId: null }] },
      contentChecksum: sha(`${snapshotId}${documentVersionId}`),
      confirmedAt,
    })
    .returning();
  if (!row) throw new Error('handoff');
  return row.id;
}

async function report(
  db: Db,
  missionId: string,
  snapshotId: string,
  actor: string,
  submittedAt: Date,
) {
  const [row] = await db
    .insert(schema.missionSubmissions)
    .values({
      missionId,
      snapshotId,
      actorAccountId: actor,
      channel: 'VISA_APPLICATION_CENTER',
      externalReportDescription: 'Synthetic report',
      submittedAt,
      authAssuranceContext: { method: 'test' },
    })
    .returning();
  if (!row) throw new Error('report');
  return row.id;
}

async function evidence(db: Db, actor: string, applicantId: string, name: string) {
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
    objectKey: `k-${randomUUID()}`,
    safetyStatus: 'CLEAN',
    processingStatus: 'AWAITING_REVIEW',
  });
  if (!isOk(version)) throw new Error('version');
  return { documentId: doc.value.id, versionId: version.value.version.id };
}

async function proof<A extends 'MANAGE' | 'VIEW_METADATA'>(
  db: Db,
  actor: string,
  missionId: string,
  action: A,
) {
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

async function staff(db: Db) {
  const actor = await seedStaffAccount(db, 'QUALITY_ADMIN', `quality-${randomUUID()}@example.com`);
  return staffScopeFor(db, actor, 'FEEDBACK_VIEW');
}

/** A case with one tracked attempt sent today, and optionally a decision. */
async function attemptCase(
  db: Db,
  who: { actor: string; applicantId: string },
  org: string | null,
  decision: string | null,
  withDocument = false,
) {
  const missionId = await caseFor(db, who.applicantId, org);
  const snap = await snapshot(db, missionId, 1, new Date('2026-11-01T00:00:00Z'));
  const reportId = await report(db, missionId, snap, who.actor, new Date('2026-11-02T08:00:00Z'));
  const tracked = await trackSubmissionAsAttempt(await proof(db, who.actor, missionId, 'MANAGE'), {
    missionId,
    missionSubmissionId: reportId,
  });
  if (!tracked.ok) throw new Error(tracked.error.message);
  let documentId: string | null = null;
  if (decision) {
    const doc = withDocument ? await evidence(db, who.actor, who.applicantId, 'decision') : null;
    documentId = doc?.documentId ?? null;
    const recorded = await recordAttemptEvent(
      await proof(db, who.actor, missionId, 'MANAGE'),
      {
        missionId,
        attemptId: tracked.value.attemptId,
        kind: 'DECISION',
        decision,
        occurredOn: '2026-11-03',
        ...(doc ? { evidenceDocumentVersionId: doc.versionId } : {}),
      },
      TODAY,
    );
    if (!recorded.ok) throw new Error(recorded.error.message);
  }
  return { missionId, attemptId: tracked.value.attemptId, documentId };
}

function stage(report: FieldInsightsReport, key: string) {
  const row = report.funnel.find((f) => f.key === key);
  if (!row) throw new Error(`no stage ${key}`);
  return row.cell;
}

describe('UMPE P12 application attempts', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it(
    'keeps two attempts on one case apart: own package record, decisions and evidence',
    async () => {
      const who = await person(db, 'p12-two@example.com');
      const versionId = await pack(db);
      const missionId = await caseFor(db, who.applicantId);
      const firstDoc = await evidence(db, who.actor, who.applicantId, 'first');
      const secondDoc = await evidence(db, who.actor, who.applicantId, 'second');
      const snap1 = await snapshot(db, missionId, 1, new Date('2026-09-01T00:00:00Z'));
      await handoff(
        db,
        missionId,
        who.applicantId,
        snap1,
        versionId,
        new Date('2026-09-01T01:00:00Z'),
        firstDoc.versionId,
      );
      const reportId = await report(
        db,
        missionId,
        snap1,
        who.actor,
        new Date('2026-09-02T08:00:00Z'),
      );
      const snap2 = await snapshot(db, missionId, 2, new Date('2026-10-10T00:00:00Z'));
      await handoff(
        db,
        missionId,
        who.applicantId,
        snap2,
        versionId,
        new Date('2026-10-10T01:00:00Z'),
        secondDoc.versionId,
      );

      const first = await trackSubmissionAsAttempt(
        await proof(db, who.actor, missionId, 'MANAGE'),
        {
          missionId,
          missionSubmissionId: reportId,
        },
      );
      expect(first.ok && first.value.attemptNo).toBe(1);
      // Tracking the same report again changes nothing.
      const again = await trackSubmissionAsAttempt(
        await proof(db, who.actor, missionId, 'MANAGE'),
        {
          missionId,
          missionSubmissionId: reportId,
        },
      );
      expect(again.ok && again.value.attemptNo).toBe(1);
      const second = await recordOutcomeAttempt(
        await proof(db, who.actor, missionId, 'MANAGE'),
        { missionId, channel: 'EMBASSY_PORTAL', submittedOn: '2026-10-12' },
        TODAY,
      );
      expect(second.ok && second.value.attemptNo).toBe(2);
      if (!first.ok || !second.ok) return;

      const refuse = await recordAttemptEvent(
        await proof(db, who.actor, missionId, 'MANAGE'),
        {
          missionId,
          attemptId: first.value.attemptId,
          kind: 'DECISION',
          decision: 'REFUSED',
          occurredOn: '2026-09-20',
          evidenceDocumentVersionId: firstDoc.versionId,
        },
        TODAY,
      );
      expect(refuse.ok).toBe(true);
      const approve = await recordAttemptEvent(
        await proof(db, who.actor, missionId, 'MANAGE'),
        {
          missionId,
          attemptId: second.value.attemptId,
          kind: 'DECISION',
          decision: 'APPROVED',
          occurredOn: '2026-10-30',
        },
        TODAY,
      );
      expect(approve.ok).toBe(true);
      const asked = await recordAttemptEvent(
        await proof(db, who.actor, missionId, 'MANAGE'),
        {
          missionId,
          attemptId: second.value.attemptId,
          kind: 'AUTHORITY_REQUEST',
          requestSource: 'EMBASSY_OR_CONSULATE',
          requestedDocTypes: ['bank statement', 'BANK_STATEMENT'],
          occurredOn: '2026-10-20',
        },
        TODAY,
      );
      expect(asked.ok).toBe(true);

      const view = await listOutcomeAttempts(
        await proof(db, who.actor, missionId, 'VIEW_METADATA'),
        missionId,
      );
      expect(view.ok).toBe(true);
      if (!view.ok) return;
      const [a1, a2] = view.value.attempts;
      expect(a1?.binding).toBe('PACKAGE_HANDOFF');
      expect(a1?.fromSubmissionReport).toBe(true);
      expect(a1?.standing).toEqual({
        kind: 'DECIDED',
        decision: 'REFUSED',
        occurredOn: '2026-09-20',
        documentSupplied: true,
      });
      expect(a1?.events.some((e) => e.kind === 'AUTHORITY_REQUEST')).toBe(false);
      expect(a2?.binding).toBe('PACKAGE_HANDOFF');
      expect(a2?.standing).toEqual({
        kind: 'DECIDED',
        decision: 'APPROVED',
        occurredOn: '2026-10-30',
        documentSupplied: false,
      });
      expect(a2?.events.find((e) => e.kind === 'AUTHORITY_REQUEST')?.requestedDocTypes).toEqual([
        'BANK_STATEMENT',
      ]);
      expect(view.value.untrackedReports).toEqual([]);
      expect(view.value.evidenceChoices.map((c) => c.versionId).sort()).toEqual(
        [firstDoc.versionId, secondDoc.versionId].sort(),
      );

      // Each attempt kept the exact handoff known when it was sent.
      const rows = await db
        .select()
        .from(schema.umpeOutcomeAttempts)
        .where(eq(schema.umpeOutcomeAttempts.missionId, missionId));
      const byNo = new Map(rows.map((r) => [r.attemptNo, r]));
      expect(byNo.get(1)?.missionSnapshotId).toBe(snap1);
      expect(byNo.get(1)?.selectedVersions).toEqual({
        documentVersionIds: [firstDoc.versionId],
        factVersionIds: [],
      });
      expect(byNo.get(2)?.missionSnapshotId).toBe(snap2);
      expect(byNo.get(2)?.selectedVersions).toEqual({
        documentVersionIds: [secondDoc.versionId],
        factVersionIds: [],
      });
      expect(byNo.get(2)?.routeKey).toBe('SYNTH-VISITOR');
      expect(byNo.get(1)?.evidenceBasis).toBe('SELF_REPORTED');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'leaves an attempt without a decision record Unknown, and refuses what it cannot stand behind',
    async () => {
      const who = await person(db, 'p12-unknown@example.com');
      const other = await person(db, 'p12-other@example.com');
      const missionId = await caseFor(db, who.applicantId);
      const manage = () => proof(db, who.actor, missionId, 'MANAGE');

      // No report yet: a direct attempt is refused (the first report moves the case).
      const early = await recordOutcomeAttempt(
        await manage(),
        { missionId, channel: 'EMAIL', submittedOn: '2026-11-01' },
        TODAY,
      );
      expect(early.ok).toBe(false);

      const snap = await snapshot(db, missionId, 1, new Date('2026-10-01T00:00:00Z'));
      const reportId = await report(
        db,
        missionId,
        snap,
        who.actor,
        new Date('2026-10-02T00:00:00Z'),
      );
      const before = await listOutcomeAttempts(
        await proof(db, who.actor, missionId, 'VIEW_METADATA'),
        missionId,
      );
      expect(before.ok && before.value.untrackedReports.map((r) => r.id)).toEqual([reportId]);
      // An untracked earlier report comes first, so attempts keep the order they happened in.
      const outOfOrder = await recordOutcomeAttempt(
        await manage(),
        { missionId, channel: 'EMAIL', submittedOn: '2026-11-01' },
        TODAY,
      );
      expect(outOfOrder.ok).toBe(false);
      const tracked = await trackSubmissionAsAttempt(await manage(), {
        missionId,
        missionSubmissionId: reportId,
      });
      expect(tracked.ok).toBe(true);
      if (!tracked.ok) return;

      const view = await listOutcomeAttempts(
        await proof(db, who.actor, missionId, 'VIEW_METADATA'),
        missionId,
      );
      expect(view.ok && view.value.attempts[0]?.standing).toEqual({ kind: 'UNKNOWN' });
      expect(view.ok && view.value.attempts[0]?.binding).toBe('SNAPSHOT_ONLY');
      expect(view.ok && view.value.attempts[0]?.receipt).toBe('NONE');

      // A future day, an unknown kind, a document of another person and a made-up decision are refused.
      const future = await recordOutcomeAttempt(
        await manage(),
        { missionId, channel: 'EMAIL', submittedOn: '2026-11-05' },
        TODAY,
      );
      expect(future.ok).toBe(false);
      const foreign = await evidence(db, other.actor, other.applicantId, 'foreign');
      const stolen = await recordAttemptEvent(
        await manage(),
        {
          missionId,
          attemptId: tracked.value.attemptId,
          kind: 'AUTHORITY_RECEIPT',
          occurredOn: '2026-10-03',
          evidenceDocumentVersionId: foreign.versionId,
        },
        TODAY,
      );
      expect(stolen.ok).toBe(false);
      const invented = await recordAttemptEvent(
        await manage(),
        {
          missionId,
          attemptId: tracked.value.attemptId,
          kind: 'DECISION',
          decision: 'VERIFIED_APPROVAL',
          occurredOn: '2026-10-03',
        },
        TODAY,
      );
      expect(invented.ok).toBe(false);
      const unknownDoc = await recordAttemptEvent(
        await manage(),
        {
          missionId,
          attemptId: tracked.value.attemptId,
          kind: 'AUTHORITY_REQUEST',
          requestSource: 'EMBASSY_OR_CONSULATE',
          requestedDocTypes: ['a made up paper'],
          occurredOn: '2026-10-03',
        },
        TODAY,
      );
      expect(unknownDoc.ok).toBe(false);
      const beforeSent = await recordAttemptEvent(
        await manage(),
        {
          missionId,
          attemptId: tracked.value.attemptId,
          kind: 'DECISION',
          decision: 'APPROVED',
          occurredOn: '2026-09-01',
        },
        TODAY,
      );
      expect(beforeSent.ok).toBe(false);

      // Someone else cannot record on this case at all.
      const strangerProof = await requireAccess(
        db,
        accountPrincipal(other.actor),
        'MANAGE',
        { missionId },
        { purpose: 'self' },
      );
      expect(strangerProof.ok).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'refuses direct edits and deletes, and removes attempts when the case is purged',
    async () => {
      const who = await person(db, 'p12-guard@example.com');
      const made = await attemptCase(db, who, null, 'PENDING');
      await expect(
        db
          .update(schema.umpeOutcomeAttempts)
          .set({ channel: 'EMAIL' })
          .where(eq(schema.umpeOutcomeAttempts.id, made.attemptId)),
      ).rejects.toThrow();
      await expect(
        db
          .delete(schema.umpeOutcomeEvents)
          .where(eq(schema.umpeOutcomeEvents.attemptId, made.attemptId)),
      ).rejects.toThrow();
      await expect(
        db
          .delete(schema.umpeOutcomeAttempts)
          .where(eq(schema.umpeOutcomeAttempts.id, made.attemptId)),
      ).rejects.toThrow();
      await db
        .update(schema.missions)
        .set({ purgedAt: new Date() })
        .where(eq(schema.missions.id, made.missionId));
      const left = await db
        .select()
        .from(schema.umpeOutcomeAttempts)
        .where(eq(schema.umpeOutcomeAttempts.missionId, made.missionId));
      expect(left).toEqual([]);
      const events = await db
        .select()
        .from(schema.umpeOutcomeEvents)
        .where(eq(schema.umpeOutcomeEvents.missionId, made.missionId));
      expect(events).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );
});

describe('UMPE P12 suppression rules', () => {
  const t = DEFAULT_INSIGHT_THRESHOLDS;
  const records = (n: number, contributors: number, people = n) =>
    Array.from({ length: n }, (_, i) => ({
      cell: 'x',
      contributor: `c${i % contributors}`,
      person: `p${i % people}`,
    }));

  it('hides small cells, few people and one dominant contributor; shows zero', () => {
    expect(protect(tally(records(9, 5)).get('x') ?? { count: 0, people: 0, top: 0 }, t)).toEqual({
      shown: false,
      reason: 'SMALL',
    });
    expect(
      protect(tally(records(12, 6, 4)).get('x') ?? { count: 0, people: 0, top: 0 }, t),
    ).toEqual({ shown: false, reason: 'SMALL' });
    expect(protect(tally(records(12, 1)).get('x') ?? { count: 0, people: 0, top: 0 }, t)).toEqual({
      shown: false,
      reason: 'DOMINANT',
    });
    expect(protect(tally(records(12, 4)).get('x') ?? { count: 0, people: 0, top: 0 }, t)).toEqual({
      shown: true,
      value: 12,
    });
    expect(protect({ count: 0, people: 0, top: 0 }, t)).toEqual({ shown: true, value: 0 });
  });

  it('hides a second count when one hidden count would otherwise be derivable', () => {
    const cells = protectGroup(
      [
        { count: 40, people: 40, top: 5 },
        { count: 12, people: 12, top: 3 },
        { count: 3, people: 3, top: 1 },
        { count: 0, people: 0, top: 0 },
      ],
      t,
    );
    expect(cells).toEqual([
      { shown: true, value: 40 },
      { shown: false, reason: 'COMPLEMENTARY' },
      { shown: false, reason: 'SMALL' },
      { shown: true, value: 0 },
    ]);
  });
});

describe('UMPE P12 Field Insights', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it(
    'counts each stage on its own, hides small cohorts and never turns a guest receipt into an authority submission',
    async () => {
      const orgs = await Promise.all(
        [1, 2, 3, 4, 5].map((i) => organization(db, `Synthetic Agency ${i}`)),
      );
      const people = await Promise.all(
        Array.from({ length: 22 }, (_, i) => person(db, `p12-cohort-${i}@example.com`)),
      );
      const made = [];
      for (const [i, who] of people.entries()) {
        // 12 recorded approvals (11 with a decision letter), 10 attempts with no decision record.
        made.push(
          await attemptCase(db, who, orgs[i % 5] ?? null, i < 12 ? 'APPROVED' : null, i < 11),
        );
      }
      const scope = await staff(db);
      const read = await getFieldInsights(db, scope, { periodMonths: 12 }, TODAY);
      expect(read.ok).toBe(true);
      if (!read.ok) return;
      expect(stage(read.value, 'REPORTED_TO_AUTHORITY')).toEqual({ shown: true, value: 22 });
      expect(stage(read.value, 'APPROVAL_RECORDED')).toEqual({ shown: true, value: 12 });
      expect(stage(read.value, 'UNKNOWN')).toEqual({ shown: true, value: 10 });
      // The approval recorded without a letter is never counted as document supported.
      expect(stage(read.value, 'APPROVAL_DOCUMENT_SUPPLIED')).toEqual({ shown: true, value: 11 });
      expect(stage(read.value, 'SUBMITTED_TO_AGENCY')).toEqual({ shown: true, value: 0 });
      expect(read.value.missingOutcome.unknown).toEqual({ shown: true, value: 10 });

      // Ten guest submissions to five agencies: Submitted to Agency only.
      for (const [i, org] of orgs.entries()) {
        const [request] = await db
          .insert(schema.agencyCollectionRequests)
          .values({ organizationId: org, destination: 'SY' })
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
            organizationId: org,
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
      const after = await getFieldInsights(db, await staff(db), { periodMonths: 12 }, TODAY);
      expect(after.ok).toBe(true);
      if (!after.ok) return;
      expect(stage(after.value, 'SUBMITTED_TO_AGENCY')).toEqual({ shown: true, value: 10 });
      expect(stage(after.value, 'REPORTED_TO_AUTHORITY')).toEqual({ shown: true, value: 22 });

      // Nothing personal in the report: no ids, names, emails or titles.
      const text = JSON.stringify(after.value);
      for (const who of people) {
        expect(text).not.toContain(who.applicantId);
        expect(text).not.toContain(who.actor);
      }
      for (const org of orgs) expect(text).not.toContain(org);
      expect(text).not.toMatch(/Synthetic|example\.com|Synthland/);

      // Deleting data takes it out: a purged case, a removed person, a removed decision letter.
      const purged = made[12];
      if (!purged) throw new Error('setup');
      await db
        .update(schema.missions)
        .set({ purgedAt: new Date() })
        .where(eq(schema.missions.id, purged.missionId));
      const removedPerson = people[13];
      if (!removedPerson) throw new Error('setup');
      await db.delete(schema.applicants).where(eq(schema.applicants.id, removedPerson.applicantId));
      const letter = made[0]?.documentId;
      if (!letter) throw new Error('setup');
      await db.delete(schema.documents).where(eq(schema.documents.id, letter));
      const later = await getFieldInsights(db, await staff(db), { periodMonths: 12 }, TODAY);
      expect(later.ok).toBe(true);
      if (!later.ok) return;
      expect(stage(later.value, 'REPORTED_TO_AUTHORITY')).toEqual({ shown: true, value: 20 });
      expect(stage(later.value, 'UNKNOWN')).toEqual({ shown: false, reason: 'SMALL' });
      // 20 = 12 + 8 would reveal the hidden 8, so the approvals are hidden too.
      expect(stage(later.value, 'APPROVAL_RECORDED')).toEqual({
        shown: false,
        reason: 'COMPLEMENTARY',
      });
      // The approval stays recorded; only its letter is gone.
      expect(stage(later.value, 'APPROVAL_DOCUMENT_SUPPLIED')).toEqual({ shown: true, value: 10 });
    },
    TEST_TIMEOUT_MS * 2,
  );

  it(
    'hides a cohort that one agency dominates, and lets nobody else read the report',
    async () => {
      const big = await organization(db, 'Dominant Agency');
      const small = await organization(db, 'Small Agency');
      for (let i = 0; i < 11; i++) {
        await attemptCase(
          db,
          await person(db, `p12-dom-${i}@example.com`),
          i < 10 ? big : small,
          null,
        );
      }
      const read = await getFieldInsights(db, await staff(db), {}, TODAY);
      expect(read.ok && stage(read.value, 'REPORTED_TO_AUTHORITY')).toEqual({
        shown: false,
        reason: 'DOMINANT',
      });

      // A member of an agency (no platform role) cannot get a scope; a forged object is refused.
      const member = await person(db, 'p12-member@example.com');
      const denied = await staffPrincipal(
        db,
        { accountId: member.actor, email: 'p12-member@example.com', bootstrapEmails: [] },
        'FEEDBACK_VIEW',
      );
      expect(denied.ok).toBe(false);
      const forged = {
        kind: 'staff',
        accountId: member.actor,
        platformAction: 'FEEDBACK_VIEW',
        verifiedAt: new Date(),
      };
      const refused = await getFieldInsights(db, forged as never, {}, TODAY);
      expect(refused.ok).toBe(false);
      // Another platform role cannot read it either.
      const security = await seedStaffAccount(db, 'SECURITY_ADMIN', 'p12-security@example.com');
      expect((await staffPrincipal(db, security, 'FEEDBACK_VIEW')).ok).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'lists document kinds an authority asked for that the checklist used did not list',
    async () => {
      const versionId = await pack(db, ['PASSPORT']);
      const orgs = await Promise.all([1, 2, 3, 4].map((i) => organization(db, `Gap Agency ${i}`)));
      for (let i = 0; i < 12; i++) {
        const who = await person(db, `p12-gap-${i}@example.com`);
        const missionId = await caseFor(db, who.applicantId, orgs[i % 4] ?? null);
        const snap = await snapshot(db, missionId, 1, new Date('2026-10-01T00:00:00Z'));
        const doc = await evidence(db, who.actor, who.applicantId, 'passport');
        await handoff(
          db,
          missionId,
          who.applicantId,
          snap,
          versionId,
          new Date('2026-10-01T01:00:00Z'),
          doc.versionId,
        );
        const reportId = await report(
          db,
          missionId,
          snap,
          who.actor,
          new Date('2026-10-02T00:00:00Z'),
        );
        const tracked = await trackSubmissionAsAttempt(
          await proof(db, who.actor, missionId, 'MANAGE'),
          { missionId, missionSubmissionId: reportId },
        );
        if (!tracked.ok) throw new Error('track');
        const asked = await recordAttemptEvent(
          await proof(db, who.actor, missionId, 'MANAGE'),
          {
            missionId,
            attemptId: tracked.value.attemptId,
            kind: 'AUTHORITY_REQUEST',
            requestSource: 'EMBASSY_OR_CONSULATE',
            requestedDocTypes: ['PASSPORT', 'BANK_STATEMENT'],
            occurredOn: '2026-10-15',
          },
          TODAY,
        );
        if (!asked.ok) throw new Error(asked.error.message);
      }
      const read = await getFieldInsights(db, await staff(db), {}, TODAY);
      expect(read.ok).toBe(true);
      if (!read.ok) return;
      expect(read.value.authorityRequests.total).toEqual({ shown: true, value: 12 });
      expect(read.value.coverageGaps.requestsCompared).toEqual({ shown: true, value: 12 });
      expect(read.value.coverageGaps.byDocType).toEqual([
        { docType: 'BANK_STATEMENT', cell: { shown: true, value: 12 } },
      ]);
      expect(read.value.byRouteAndPeriod).toEqual([
        { route: 'SYNTH-VISITOR', period: '2026-Q4', attempts: { shown: true, value: 12 } },
      ]);
    },
    TEST_TIMEOUT_MS,
  );
});
