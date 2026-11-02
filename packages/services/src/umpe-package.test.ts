/**
 * UMPE P4 (R11, R13 to R17, R19, R23, S05): trip package assembly over the existing case.
 *
 * Synthetic data only. Pins:
 * 1. A confirmed handoff is never rewritten: a newer document only becomes a proposal, and the
 *    database refuses any edit of a handoff row.
 * 2. A recommended item that is missing never stops Prepared for Handoff.
 * 3. An unknown condition keeps the case at Needs Attention, with the question it needs.
 * 4. The freshness check flags a withdrawn checklist version.
 * 5. Continuous matching touches only active cases and never a handoff.
 * 6. Exclude is refused for an item that can block; choices pin exact version ids.
 * 7. The intention-first start opens an existing active case instead of a duplicate.
 */
import { randomUUID } from 'node:crypto';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { accountPrincipal, requireAccess } from './access';
import { systemScopeForTest } from './access/system-scope.test-support';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { addDocumentVersion, registerDocument, setDocumentDate } from './documents';
import { attachPackVersion, createMission, transitionMission } from './missions';
import { PACKAGE_CHANGED_EVENT, runNotificationWorker } from './notifications';
import {
  type RequirementInput,
  addPackVersion,
  addRequirement,
  approvePackVersion,
  createPack,
  publishPackVersion,
  withdrawPackVersion,
} from './packs';
import { editFact, registerFieldDefinition } from './profile';
import { derivePackagePhrase, outsideSteps, pickPackageChange } from './umpe-package-phrases';
import {
  confirmPackageHandoff,
  getCasePackage,
  listPackageHandoffs,
  markPackageChangeReviewed,
  recordPackageChoice,
  sweepPackageChanges,
} from './umpe-package-service';
import { openOrStartTripCase } from './umpe-package-start';

const TEST_TIMEOUT_MS = 90_000;

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, { schema }) as unknown as Db;
}

async function seed(db: Db, email = 'p4-owner@example.com') {
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
    displayName: 'Synthetic Traveller',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  return { actor: account.value.id, applicantId: applicant.value.id };
}

async function publishedPack(db: Db, actor: string, rows: readonly RequirementInput[]) {
  const pack = await createPack(db, {
    actorAccountId: actor,
    key: `p4.${Math.random().toString(36).slice(2)}`,
    name: 'P4 Synthetic',
  });
  if (!isOk(pack)) throw new Error('pack');
  const version = await addPackVersion(db, { actorAccountId: actor, packId: pack.value.id });
  if (!isOk(version)) throw new Error('version');
  for (const row of rows) {
    const added = await addRequirement(db, {
      actorAccountId: actor,
      packVersionId: version.value.id,
      ...row,
    });
    if (!isOk(added)) throw new Error(`requirement: ${added.error.message}`);
  }
  const approved = await approvePackVersion(db, {
    actorAccountId: actor,
    packVersionId: version.value.id,
  });
  if (!isOk(approved)) throw new Error(`approve: ${approved.error.message}`);
  const published = await publishPackVersion(db, {
    actorAccountId: actor,
    packVersionId: version.value.id,
  });
  if (!isOk(published)) throw new Error(`publish: ${published.error.message}`);
  return version.value.id;
}

async function caseOn(db: Db, actor: string, applicantId: string, versionId: string) {
  const mission = await createMission(db, {
    actorAccountId: actor,
    applicantId,
    title: 'Synthetic Case',
  });
  if (!isOk(mission)) throw new Error('mission');
  const attached = await attachPackVersion(db, {
    actorAccountId: actor,
    missionId: mission.value.id,
    packVersionId: versionId,
  });
  if (!isOk(attached)) throw new Error('attach');
  return mission.value.id;
}

async function document(
  db: Db,
  actor: string,
  applicantId: string,
  docType: string,
  date: string | null = null,
) {
  const doc = await registerDocument(db, {
    actorAccountId: actor,
    applicantId,
    originalName: `${docType}.pdf`,
    docType,
  });
  if (!isOk(doc)) throw new Error('doc');
  await newVersion(db, actor, doc.value.id);
  if (date) {
    const dated = await setDocumentDate(db, {
      actorAccountId: actor,
      documentId: doc.value.id,
      documentDate: date,
    });
    if (!isOk(dated)) throw new Error('date');
  }
  return doc.value.id;
}

async function newVersion(db: Db, actor: string, documentId: string) {
  const version = await addDocumentVersion(db, {
    actorAccountId: actor,
    documentId,
    bucket: 'CLEAN',
    objectKey: `k-${Math.random().toString(36).slice(2)}`,
    safetyStatus: 'CLEAN',
    processingStatus: 'AWAITING_REVIEW',
  });
  if (!isOk(version)) throw new Error('version');
  return version.value.version.id;
}

async function viewProof(db: Db, actor: string, missionId: string) {
  const proof = await requireAccess(
    db,
    accountPrincipal(actor),
    'VIEW_METADATA',
    { missionId },
    { purpose: 'self' },
  );
  if (!isOk(proof)) throw new Error('view proof');
  return proof.value;
}

async function manageProof(db: Db, actor: string, missionId: string) {
  const proof = await requireAccess(
    db,
    accountPrincipal(actor),
    'MANAGE',
    { missionId },
    { purpose: 'self' },
  );
  if (!isOk(proof)) throw new Error('manage proof');
  return proof.value;
}

async function pkg(db: Db, actor: string, missionId: string) {
  const result = await getCasePackage(await viewProof(db, actor, missionId), missionId);
  if (!isOk(result)) throw new Error(`package: ${result.error.message}`);
  return result.value;
}

const PASSPORT: RequirementInput = {
  kind: 'DOCUMENT',
  docType: 'passport',
  citation: 'Synthetic rule 1',
};
const HOTEL_RECOMMENDED: RequirementInput = {
  kind: 'DOCUMENT',
  docType: 'hotel_booking',
  citation: 'Synthetic rule 2',
  necessity: 'RECOMMENDED',
  notes: 'Bring the original booking to the appointment; a translation may be asked for.',
};

describe('UMPE P4 phrases (pure)', () => {
  const base = {
    requiredLeftMissing: false,
    pinnedCopyReplaced: false,
    pinnedCopyUnusable: false,
    packWithdrawn: false,
    packReplaced: false,
    openChange: false,
    handoffCurrent: false,
  } as const;

  it('reads ready only when the existing readiness says so and nothing material is open', () => {
    expect(derivePackagePhrase({ ...base, overallState: 'READY_FOR_APPLICANT_REVIEW' })).toEqual({
      phrase: 'READY_FOR_FINAL_REVIEW',
      reasons: [],
    });
    expect(derivePackagePhrase({ ...base, overallState: 'NEEDS_REVIEW' }).phrase).toBe(
      'NEEDS_ATTENTION',
    );
    expect(derivePackagePhrase({ ...base, overallState: null }).reasons).toEqual(['NO_CHECKLIST']);
    expect(
      derivePackagePhrase({ ...base, overallState: 'READY_FOR_APPLICANT_REVIEW', openChange: true })
        .phrase,
    ).toBe('NEEDS_ATTENTION');
  });

  it('never reads prepared for a withdrawn checklist, even with a matching confirmation', () => {
    expect(
      derivePackagePhrase({
        ...base,
        overallState: 'READY_FOR_APPLICANT_REVIEW',
        handoffCurrent: true,
        packWithdrawn: true,
      }).phrase,
    ).toBe('NEEDS_ATTENTION');
  });

  it('never reads prepared while something needs attention, even with a matching confirmation', () => {
    const aged = derivePackagePhrase({
      ...base,
      overallState: 'NEEDS_ACTION',
      handoffCurrent: true,
      pinnedCopyUnusable: true,
    });
    expect(aged.phrase).toBe('NEEDS_ATTENTION');
    expect(aged.reasons).toEqual(['REQUIRED_GAP', 'PINNED_COPY_UNUSABLE']);
    expect(
      derivePackagePhrase({
        ...base,
        overallState: 'READY_FOR_APPLICANT_REVIEW',
        requiredLeftMissing: true,
      }).reasons,
    ).toEqual(['REQUIRED_GAP']);
    expect(
      derivePackagePhrase({
        ...base,
        overallState: 'READY_FOR_APPLICANT_REVIEW',
        handoffCurrent: true,
      }).phrase,
    ).toBe('PREPARED_FOR_HANDOFF');
  });

  it('lists the standard outside steps and adds the ones a note names', () => {
    expect(outsideSteps([]).map((s) => s.kind)).toEqual([
      'APPLICATION_FORM',
      'APPOINTMENT',
      'ORIGINALS',
      'FEE',
    ]);
    const steps = outsideSteps(['Fingerprints at the visa centre', null]);
    expect(steps.map((s) => s.kind)).toContain('BIOMETRICS');
    expect(steps.find((s) => s.kind === 'APPOINTMENT')?.namedByChecklist).toBe(true);
    expect(steps.find((s) => s.kind === 'FEE')?.namedByChecklist).toBe(false);
  });

  it('picks the most important change and gives the same situation the same signature', () => {
    const signals = [
      { kind: 'NEWER_DOCUMENT', packRequirementId: 'b', subjectId: '2' },
      { kind: 'PACK_WITHDRAWN', packRequirementId: null, subjectId: 'v' },
      { kind: 'NEWER_DOCUMENT', packRequirementId: 'a', subjectId: '1' },
    ] as const;
    const picked = pickPackageChange(signals);
    expect(picked?.kind).toBe('PACK_WITHDRAWN');
    const newer = pickPackageChange(signals.filter((s) => s.kind === 'NEWER_DOCUMENT'));
    const again = pickPackageChange(
      [...signals].reverse().filter((s) => s.kind === 'NEWER_DOCUMENT'),
    );
    expect(newer?.signature).toBe(again?.signature);
    expect(pickPackageChange([])).toBeNull();
  });
});

describe('UMPE P4 trip package', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  }, TEST_TIMEOUT_MS);

  it(
    'pins exact versions, never rewrites a handoff after a newer upload, and refuses edits of it',
    async () => {
      const { actor, applicantId } = await seed(db);
      const versionId = await publishedPack(db, actor, [PASSPORT]);
      const missionId = await caseOn(db, actor, applicantId, versionId);
      const passportId = await document(db, actor, applicantId, 'passport');

      const before = await pkg(db, actor, missionId);
      expect(before.phrase).toBe('READY_FOR_FINAL_REVIEW');
      const item = before.items[0];
      const firstVersion = item?.proposed?.documentVersionId;
      expect(firstVersion).toBeTruthy();

      const chose = await recordPackageChoice(await manageProof(db, actor, missionId), {
        missionId,
        packRequirementId: item?.packRequirementId ?? '',
        choice: 'USE_COPY',
        documentVersionId: firstVersion ?? '',
      });
      expect(isOk(chose)).toBe(true);

      const confirmed = await confirmPackageHandoff(await manageProof(db, actor, missionId), {
        missionId,
        outsideStepsSeen: true,
      });
      if (!isOk(confirmed)) throw new Error(confirmed.error.message);
      expect(confirmed.value.content.selections[0]?.documentVersionId).toBe(firstVersion);
      expect((await pkg(db, actor, missionId)).phrase).toBe('PREPARED_FOR_HANDOFF');

      // A newer copy of the same passport arrives after the handoff.
      const secondVersion = await newVersion(db, actor, passportId);
      const after = await pkg(db, actor, missionId);
      const stored = await db
        .select()
        .from(schema.umpePackageHandoffs)
        .where(eq(schema.umpePackageHandoffs.id, confirmed.value.handoffId));
      const content = stored[0]?.content as { selections: { documentVersionId: string }[] };
      expect(content.selections[0]?.documentVersionId).toBe(firstVersion);
      expect(after.items[0]?.chosen?.copy?.documentVersionId).toBe(firstVersion);
      expect(after.items[0]?.newerCopy?.documentVersionId).toBe(secondVersion);
      expect(after.change?.kind).toBe('NEWER_DOCUMENT');
      expect(after.phrase).toBe('NEEDS_ATTENTION');
      // The case decides again before another handoff, so the frozen copy and the snapshot agree.
      expect(after.reasons).toContain('PINNED_COPY_REPLACED');
      expect(after.latestHandoff?.current).toBe(false);

      // The database itself refuses to change a handoff.
      await expect(
        db.execute(
          sql`update umpe_package_handoffs set material_revision_at_capture = 999 where id = ${confirmed.value.handoffId}`,
        ),
      ).rejects.toThrow();

      // Reviewing the change keeps the same situation quiet.
      const reviewed = await markPackageChangeReviewed(
        await manageProof(db, actor, missionId),
        missionId,
      );
      expect(isOk(reviewed) && reviewed.value.reviewed).toBe(true);
      expect((await pkg(db, actor, missionId)).change).toBeNull();
      const history = await listPackageHandoffs(await viewProof(db, actor, missionId), missionId);
      expect(isOk(history) && history.value.length).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'lets a missing recommended item through to Prepared for Handoff, as a caveat',
    async () => {
      const { actor, applicantId } = await seed(db);
      const versionId = await publishedPack(db, actor, [PASSPORT, HOTEL_RECOMMENDED]);
      const missionId = await caseOn(db, actor, applicantId, versionId);
      await document(db, actor, applicantId, 'passport');

      const ready = await pkg(db, actor, missionId);
      expect(ready.phrase).toBe('READY_FOR_FINAL_REVIEW');
      expect(ready.outsideSteps.map((s) => s.kind)).toEqual(
        expect.arrayContaining(['ORIGINALS', 'APPOINTMENT', 'TRANSLATION']),
      );
      const confirmed = await confirmPackageHandoff(await manageProof(db, actor, missionId), {
        missionId,
        outsideStepsSeen: true,
      });
      if (!isOk(confirmed)) throw new Error(confirmed.error.message);
      expect(confirmed.value.content.caveats).toContain('OPTIONAL_MISSING');
      expect((await pkg(db, actor, missionId)).phrase).toBe('PREPARED_FOR_HANDOFF');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'refuses to exclude an item that can block, and refuses a handoff while it is missing',
    async () => {
      const { actor, applicantId } = await seed(db);
      const versionId = await publishedPack(db, actor, [PASSPORT, HOTEL_RECOMMENDED]);
      const missionId = await caseOn(db, actor, applicantId, versionId);
      const before = await pkg(db, actor, missionId);
      const passport = before.items.find((i) => i.key === 'passport');
      const hotel = before.items.find((i) => i.key === 'hotel_booking');
      expect(passport?.canExclude).toBe(false);
      expect(hotel?.canExclude).toBe(true);

      const refused = await recordPackageChoice(await manageProof(db, actor, missionId), {
        missionId,
        packRequirementId: passport?.packRequirementId ?? '',
        choice: 'EXCLUDE',
        reason: 'Synthetic reason',
      });
      expect(isErr(refused) && refused.error.code).toBe('invalid');

      const left = await recordPackageChoice(await manageProof(db, actor, missionId), {
        missionId,
        packRequirementId: passport?.packRequirementId ?? '',
        choice: 'LEAVE_MISSING',
      });
      expect(isOk(left)).toBe(true);
      const excluded = await recordPackageChoice(await manageProof(db, actor, missionId), {
        missionId,
        packRequirementId: hotel?.packRequirementId ?? '',
        choice: 'EXCLUDE',
        reason: 'Staying with family',
      });
      expect(isOk(excluded)).toBe(true);

      const after = await pkg(db, actor, missionId);
      expect(after.phrase).toBe('NEEDS_ATTENTION');
      expect(after.reasons).toContain('REQUIRED_GAP');
      const handoff = await confirmPackageHandoff(await manageProof(db, actor, missionId), {
        missionId,
        outsideStepsSeen: true,
      });
      expect(isErr(handoff)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'treats Leave Missing on a required item as a gap, and saving the same choice twice as nothing',
    async () => {
      const { actor, applicantId } = await seed(db);
      const versionId = await publishedPack(db, actor, [PASSPORT]);
      const missionId = await caseOn(db, actor, applicantId, versionId);
      await document(db, actor, applicantId, 'passport');
      const item = (await pkg(db, actor, missionId)).items[0];
      const revision = async () =>
        (await db.select().from(schema.missions).where(eq(schema.missions.id, missionId)))[0]
          ?.materialRevision;

      const choose = async () =>
        recordPackageChoice(await manageProof(db, actor, missionId), {
          missionId,
          packRequirementId: item?.packRequirementId ?? '',
          choice: 'USE_COPY',
          documentVersionId: item?.proposed?.documentVersionId ?? '',
        });
      expect(isOk(await choose())).toBe(true);
      const afterFirst = await revision();
      expect(isOk(await choose())).toBe(true);
      expect(await revision()).toBe(afterFirst);

      const left = await recordPackageChoice(await manageProof(db, actor, missionId), {
        missionId,
        packRequirementId: item?.packRequirementId ?? '',
        choice: 'LEAVE_MISSING',
      });
      expect(isOk(left)).toBe(true);
      const after = await pkg(db, actor, missionId);
      expect(after.phrase).toBe('NEEDS_ATTENTION');
      expect(after.reasons).toEqual(['REQUIRED_GAP']);
      const handoff = await confirmPackageHandoff(await manageProof(db, actor, missionId), {
        missionId,
        outsideStepsSeen: true,
      });
      expect(isErr(handoff)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'keeps an unknown condition at Needs Attention and asks only what the checklist needs',
    async () => {
      const { actor, applicantId } = await seed(db);
      await registerFieldDefinition(db, { key: 'employment.status', dataType: 'string' });
      const versionId = await publishedPack(db, actor, [
        PASSPORT,
        {
          kind: 'DOCUMENT',
          docType: 'employer_letter',
          citation: 'Synthetic rule 3',
          necessity: 'CONDITIONAL',
          condition: { op: 'equals', field: 'employment.status', value: 'employed' },
        },
      ]);
      const missionId = await caseOn(db, actor, applicantId, versionId);
      await document(db, actor, applicantId, 'passport');

      const unknown = await pkg(db, actor, missionId);
      expect(unknown.phrase).toBe('NEEDS_ATTENTION');
      expect(unknown.reasons).toContain('NEEDS_ANSWER');
      expect(unknown.questions).toEqual([{ kind: 'FACT', fieldKey: 'employment.status' }]);

      await editFact(db, {
        actorAccountId: actor,
        applicantId,
        fieldKey: 'employment.status',
        value: 'retired',
      });
      const known = await pkg(db, actor, missionId);
      expect(known.questions).toEqual([]);
      expect(known.phrase).toBe('READY_FOR_FINAL_REVIEW');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'flags a withdrawn checklist version at final review and records one change',
    async () => {
      const { actor, applicantId } = await seed(db);
      const versionId = await publishedPack(db, actor, [PASSPORT]);
      const missionId = await caseOn(db, actor, applicantId, versionId);
      await document(db, actor, applicantId, 'passport');
      expect((await pkg(db, actor, missionId)).freshness?.packWithdrawn).toBe(false);

      const withdrawn = await withdrawPackVersion(db, {
        actorAccountId: actor,
        packVersionId: versionId,
        reason: 'Synthetic source turned out wrong',
      });
      expect(isOk(withdrawn)).toBe(true);
      const after = await pkg(db, actor, missionId);
      expect(after.freshness?.packWithdrawn).toBe(true);
      expect(after.freshness?.caveats).toContain('CHECKLIST_WITHDRAWN');
      expect(after.phrase).toBe('NEEDS_ATTENTION');
      expect(after.reasons).toContain('CHECKLIST_WITHDRAWN');
      expect(after.change?.kind).toBe('PACK_WITHDRAWN');
      // Opening the case again records nothing new.
      expect((await pkg(db, actor, missionId)).change?.changeCount).toBe(1);
      // The person is looking at the case: no note is queued for what they already see.
      expect(
        await db
          .select()
          .from(schema.notifications)
          .where(eq(schema.notifications.eventType, PACKAGE_CHANGED_EVENT)),
      ).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'continuous matching re-evaluates only active cases and never touches a handoff',
    async () => {
      const { actor, applicantId } = await seed(db);
      const versionId = await publishedPack(db, actor, [PASSPORT]);
      const active = await caseOn(db, actor, applicantId, versionId);
      const closed = await caseOn(db, actor, applicantId, versionId);
      const passportId = await document(db, actor, applicantId, 'passport');
      for (const missionId of [active, closed]) {
        const item = (await pkg(db, actor, missionId)).items[0];
        const chose = await recordPackageChoice(await manageProof(db, actor, missionId), {
          missionId,
          packRequirementId: item?.packRequirementId ?? '',
          choice: 'USE_COPY',
          documentVersionId: item?.proposed?.documentVersionId ?? '',
        });
        expect(isOk(chose)).toBe(true);
      }
      const confirmed = await confirmPackageHandoff(await manageProof(db, actor, active), {
        missionId: active,
        outsideStepsSeen: true,
      });
      if (!isOk(confirmed)) throw new Error(confirmed.error.message);
      const cancelled = await transitionMission(db, {
        actorAccountId: actor,
        missionId: closed,
        to: 'CANCELLED',
      });
      expect(isOk(cancelled)).toBe(true);
      const handoffBefore = await db.select().from(schema.umpePackageHandoffs);

      await newVersion(db, actor, passportId);
      const swept = await sweepPackageChanges(
        systemScopeForTest('process-notification-sweeps'),
        db,
      );
      expect(swept.checked).toBe(1);
      expect(swept.recorded).toBe(1);
      const changes = await db.select().from(schema.umpePackageChanges);
      expect(changes.map((c) => c.missionId)).toEqual([active]);
      expect(changes[0]?.source).toBe('SWEEP');
      expect(await db.select().from(schema.umpePackageHandoffs)).toEqual(handoffBefore);
      // A second run over the same situation records nothing more.
      const again = await sweepPackageChanges(
        systemScopeForTest('process-notification-sweeps'),
        db,
      );
      expect(again.recorded).toBe(0);

      // The sweep tells the owner once, on both channels, and never about the cancelled case.
      const notes = await db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.eventType, PACKAGE_CHANGED_EVENT));
      expect(notes.map((n) => n.channel).sort()).toEqual(['EMAIL', 'IN_APP']);
      expect(notes.every((n) => n.missionId === active && n.recipientAccountId === actor)).toBe(
        true,
      );

      const sent: string[] = [];
      const emailPort = {
        send: async (m: { to: string }) => {
          sent.push(m.to);
          return { providerMessageId: randomUUID() };
        },
      } as never;
      const statuses = async () =>
        (
          await db
            .select()
            .from(schema.notifications)
            .where(eq(schema.notifications.eventType, PACKAGE_CHANGED_EVENT))
        )
          .map((n) => `${n.resourceId === notes[0]?.resourceId ? 'first' : 'second'}:${n.status}`)
          .sort();

      // A note about a change that is still open is delivered.
      await runNotificationWorker(db, emailPort, 'https://app.example.test');
      expect(sent).toEqual(['p4-owner@example.com']);
      expect(await statuses()).toEqual(['first:SENT', 'first:SENT']);

      // A different change replaces the open item: one new pair of notes is queued for it.
      await newVersion(db, actor, passportId);
      const replaced = await sweepPackageChanges(
        systemScopeForTest('process-notification-sweeps'),
        db,
      );
      expect(replaced.recorded).toBe(1);
      const queued = (
        await db
          .select()
          .from(schema.notifications)
          .where(eq(schema.notifications.eventType, PACKAGE_CHANGED_EVENT))
      ).filter((n) => n.status === 'QUEUED');
      expect(queued).toHaveLength(2);

      // If the item closes by any other route, the worker's own check still stops the notes.
      await db
        .update(schema.umpePackageChanges)
        .set({ resolvedAt: new Date(), resolution: 'NO_LONGER_APPLIES' })
        .where(eq(schema.umpePackageChanges.missionId, active));
      await runNotificationWorker(db, emailPort, 'https://app.example.test');
      expect(sent).toEqual(['p4-owner@example.com']);
      expect(
        (
          await db
            .select()
            .from(schema.notifications)
            .where(eq(schema.notifications.eventType, PACKAGE_CHANGED_EVENT))
        )
          .filter((n) => queued.some((q) => q.id === n.id))
          .map((n) => n.status),
      ).toEqual(['CANCELLED', 'CANCELLED']);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'refuses another person and a proof for another case, the same way as a missing case',
    async () => {
      const owner = await seed(db);
      const other = await seed(db, 'p4-other@example.com');
      const versionId = await publishedPack(db, owner.actor, [PASSPORT]);
      const missionId = await caseOn(db, owner.actor, owner.applicantId, versionId);
      const otherMission = await caseOn(db, other.actor, other.applicantId, versionId);

      const denied = await requireAccess(
        db,
        accountPrincipal(other.actor),
        'VIEW_METADATA',
        { missionId },
        { purpose: 'self' },
      );
      expect(isErr(denied)).toBe(true);
      const wrongCase = await getCasePackage(
        await viewProof(db, other.actor, otherMission),
        missionId,
      );
      expect(isErr(wrongCase) && wrongCase.error.code).toBe('not_found');
      const forged = await getCasePackage({ tx: db } as never, missionId);
      expect(isErr(forged) && forged.error.code).toBe('forbidden');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'opens the active case for the same trip instead of starting a duplicate',
    async () => {
      const { actor, applicantId } = await seed(db);
      const proof = await requireAccess(
        db,
        accountPrincipal(actor),
        'MANAGE',
        { applicantId },
        { purpose: 'owner_trip_start' },
      );
      if (!isOk(proof)) throw new Error('proof');
      const first = await openOrStartTripCase(proof.value, {
        destination: 'Japan',
        purpose: 'Tourism',
      });
      const second = await openOrStartTripCase(proof.value, {
        destination: 'Japan',
        purpose: 'Tourism',
      });
      const other = await openOrStartTripCase(proof.value, {
        destination: 'Japan',
        purpose: 'Business',
      });
      if (!isOk(first) || !isOk(second) || !isOk(other)) throw new Error('start');
      expect(first.value.existing).toBe(false);
      expect(second.value).toEqual({ missionId: first.value.missionId, existing: true });
      expect(other.value.missionId).not.toBe(first.value.missionId);
    },
    TEST_TIMEOUT_MS,
  );
});
