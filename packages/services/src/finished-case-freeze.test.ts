import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { type MissionState, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { decideAcknowledgement } from './acknowledgements';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { addDocumentVersion, registerDocument, setDocumentType } from './documents';
import {
  incrementMaterialRevision,
  isFinishedCaseState,
  missionsSelectingDocument,
} from './material-revision';
import {
  CASE_FINISHED_NO_CHANGE,
  attachPackVersion,
  computeReadiness,
  createMission,
  generateCoverLetter,
  selectEvidence,
  snapshotMission,
  transitionMission,
  unselectEvidence,
  updateMissionCaseDetails,
} from './missions';
import { sweepExpiryReminders } from './notification-sweep';
import {
  addPackVersion,
  addRequirement,
  approvePackVersion,
  createPack,
  publishPackVersion,
} from './packs';
import { editFact, registerFieldDefinition } from './profile';
import { recordSubmission } from './submissions';

/**
 * Finished cases are frozen (owner decision, 10 Nov 2026): once a case is submitted, closed or
 * cancelled, nothing the traveller later changes in their record bumps its revision, voids its
 * confirmation or changes what it shows. Open cases behave exactly as before.
 */

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, { schema }) as unknown as Db;
}

type Kind = 'FIELD' | 'DOCUMENT';

interface Cases {
  readonly accountId: string;
  readonly applicantId: string;
  readonly packVersionId: string;
  /** Selects the shared record and is acknowledged; never finished. */
  readonly openId: string;
  /** The same selection, acknowledged and then submitted. */
  readonly finishedId: string;
  readonly factId?: string;
  readonly documentId?: string;
}

async function publishedPack(db: Db, actor: string, kind: Kind): Promise<string> {
  const pack = await createPack(db, { actorAccountId: actor, key: `freeze.${kind}`, name: 'Pack' });
  if (!isOk(pack)) throw new Error('pack');
  const version = await addPackVersion(db, { actorAccountId: actor, packId: pack.value.id });
  if (!isOk(version)) throw new Error('version');
  await addRequirement(db, {
    actorAccountId: actor,
    packVersionId: version.value.id,
    ...(kind === 'FIELD'
      ? { kind: 'FIELD' as const, fieldKey: 'passport.number' }
      : { kind: 'DOCUMENT' as const, docType: 'passport' }),
    citation: 'rule 1',
  });
  await approvePackVersion(db, { actorAccountId: actor, packVersionId: version.value.id });
  await publishPackVersion(db, { actorAccountId: actor, packVersionId: version.value.id });
  return version.value.id;
}

/** One open case and one submitted case over the same record, each with a live confirmation. */
async function twoCases(db: Db, kind: Kind): Promise<Cases> {
  const provisioned = await provisionAccount(db, { email: `freeze-${kind}@example.com` });
  if (!isOk(provisioned)) throw new Error('provision');
  const accountId = provisioned.value.id;
  await setConsent(db, {
    actorAccountId: accountId,
    accountId,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  const applicant = await createApplicant(db, {
    actorAccountId: accountId,
    ownerAccountId: accountId,
    displayName: 'Owner',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  const applicantId = applicant.value.id;
  const packVersionId = await publishedPack(db, accountId, kind);

  let factId: string | undefined;
  let documentId: string | undefined;
  if (kind === 'FIELD') {
    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    const fact = await editFact(db, {
      actorAccountId: accountId,
      applicantId,
      fieldKey: 'passport.number',
      value: 'A1',
    });
    if (!isOk(fact)) throw new Error('fact');
    factId = fact.value.fact.id;
  } else {
    const doc = await registerDocument(db, {
      actorAccountId: accountId,
      applicantId,
      originalName: 'passport.pdf',
      docType: 'passport',
    });
    if (!isOk(doc)) throw new Error('doc');
    documentId = doc.value.id;
    await addDocumentVersion(db, {
      actorAccountId: accountId,
      documentId,
      bucket: 'CLEAN',
      objectKey: 'freeze-k1',
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });
  }
  const [requirement] = await db
    .select()
    .from(schema.packRequirements)
    .where(eq(schema.packRequirements.packVersionId, packVersionId));
  if (!requirement) throw new Error('requirement');

  const ids: string[] = [];
  for (const title of ['Open case', 'Finished case']) {
    const mission = await createMission(db, { actorAccountId: accountId, applicantId, title });
    if (!isOk(mission)) throw new Error('mission');
    const missionId = mission.value.id;
    await attachPackVersion(db, { actorAccountId: accountId, missionId, packVersionId });
    const selected = await selectEvidence(db, {
      actorAccountId: accountId,
      missionId,
      packRequirementId: requirement.id,
      ...(factId ? { factId } : {}),
      ...(documentId ? { documentId } : {}),
    });
    if (!isOk(selected)) throw new Error('select');
    const snapshot = await snapshotMission(db, { actorAccountId: accountId, missionId });
    if (!isOk(snapshot)) throw new Error('snapshot');
    const ack = await decideAcknowledgement(db, {
      actorAccountId: accountId,
      missionId,
      snapshotId: snapshot.value.id,
      expectedSnapshotChecksum: snapshot.value.checksum,
      decision: 'ACKNOWLEDGED',
      stepUpSatisfied: true,
    });
    if (!isOk(ack)) throw new Error('acknowledge');
    ids.push(missionId);
  }
  const [openId, finishedId] = ids;
  if (!openId || !finishedId) throw new Error('cases');

  for (const to of ['INTAKE', 'IN_REVIEW', 'AWAITING_APPLICANT', 'SUBMISSION_READY'] as const) {
    const moved = await transitionMission(db, {
      actorAccountId: accountId,
      missionId: finishedId,
      to,
    });
    if (!isOk(moved)) throw new Error(`transition to ${to}`);
  }
  const submitted = await recordSubmission(db, {
    actorAccountId: accountId,
    missionId: finishedId,
    channel: 'EMAIL',
    externalReportDescription: 'Sent by email',
    stepUpSatisfied: true,
  });
  if (!isOk(submitted)) throw new Error('submit');

  return {
    accountId,
    applicantId,
    packVersionId,
    openId,
    finishedId,
    ...(factId ? { factId } : {}),
    ...(documentId ? { documentId } : {}),
  };
}

async function caseRow(db: Db, missionId: string) {
  const [row] = await db.select().from(schema.missions).where(eq(schema.missions.id, missionId));
  if (!row) throw new Error('case missing');
  return row;
}

async function liveConfirmations(db: Db, missionId: string): Promise<number> {
  const rows = await db
    .select({ invalidatedAt: schema.acknowledgements.invalidatedAt })
    .from(schema.acknowledgements)
    .where(
      and(
        eq(schema.acknowledgements.missionId, missionId),
        eq(schema.acknowledgements.decision, 'ACKNOWLEDGED'),
      ),
    );
  return rows.filter((row) => row.invalidatedAt === null).length;
}

async function setState(db: Db, missionId: string, state: MissionState, closedAt?: Date) {
  await db
    .update(schema.missions)
    .set({ state, ...(closedAt ? { closedAt } : {}) })
    .where(eq(schema.missions.id, missionId));
}

describe('edits to the traveller record and a finished case', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('a profile edit changes an open case as before and leaves a finished case alone', async () => {
    const c = await twoCases(db, 'FIELD');
    const openBefore = await caseRow(db, c.openId);
    const finishedBefore = await caseRow(db, c.finishedId);
    expect(await liveConfirmations(db, c.openId)).toBe(1);
    expect(await liveConfirmations(db, c.finishedId)).toBe(1);

    const edited = await editFact(db, {
      actorAccountId: c.accountId,
      applicantId: c.applicantId,
      fieldKey: 'passport.number',
      value: 'B2',
    });
    expect(isOk(edited)).toBe(true);

    expect((await caseRow(db, c.openId)).materialRevision).toBe(openBefore.materialRevision + 1);
    expect(await liveConfirmations(db, c.openId)).toBe(0);
    expect((await caseRow(db, c.finishedId)).materialRevision).toBe(
      finishedBefore.materialRevision,
    );
    expect(await liveConfirmations(db, c.finishedId)).toBe(1);
  });

  it('a new document version changes an open case as before and leaves a finished case alone', async () => {
    const c = await twoCases(db, 'DOCUMENT');
    if (!c.documentId) throw new Error('document');
    const finishedBefore = await caseRow(db, c.finishedId);
    const openBefore = await caseRow(db, c.openId);

    const added = await addDocumentVersion(db, {
      actorAccountId: c.accountId,
      documentId: c.documentId,
      bucket: 'CLEAN',
      objectKey: 'freeze-k2',
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });
    expect(isOk(added)).toBe(true);

    expect((await caseRow(db, c.openId)).materialRevision).toBe(openBefore.materialRevision + 1);
    expect(await liveConfirmations(db, c.openId)).toBe(0);
    expect((await caseRow(db, c.finishedId)).materialRevision).toBe(
      finishedBefore.materialRevision,
    );
    expect(await liveConfirmations(db, c.finishedId)).toBe(1);
  });

  it('changing what kind of document a file is leaves a finished case alone', async () => {
    const c = await twoCases(db, 'DOCUMENT');
    if (!c.documentId) throw new Error('document');
    const finishedBefore = await caseRow(db, c.finishedId);
    const changed = await setDocumentType(db, {
      actorAccountId: c.accountId,
      documentId: c.documentId,
      docType: 'visa',
    });
    expect(isOk(changed)).toBe(true);
    expect((await caseRow(db, c.finishedId)).materialRevision).toBe(
      finishedBefore.materialRevision,
    );
    expect(await liveConfirmations(db, c.finishedId)).toBe(1);
    expect(await liveConfirmations(db, c.openId)).toBe(0);
  });

  it('a document that expires voids the open case confirmation and not the finished one', async () => {
    const c = await twoCases(db, 'DOCUMENT');
    if (!c.documentId) throw new Error('document');
    await db
      .update(schema.documents)
      .set({ expiresAt: new Date(Date.now() - 2 * 86_400_000) })
      .where(eq(schema.documents.id, c.documentId));
    const finishedBefore = await caseRow(db, c.finishedId);

    const swept = await sweepExpiryReminders(db, new Date());

    expect(swept.missionsDirtied).toBe(1);
    expect(await liveConfirmations(db, c.openId)).toBe(0);
    expect(await liveConfirmations(db, c.finishedId)).toBe(1);
    expect((await caseRow(db, c.finishedId)).materialRevision).toBe(
      finishedBefore.materialRevision,
    );
  });

  it('the fan-out still lists finished cases, so a legal hold keeps seeing them', async () => {
    const c = await twoCases(db, 'DOCUMENT');
    if (!c.documentId) throw new Error('document');
    const ids = await missionsSelectingDocument(db, c.documentId);
    expect([...ids].sort()).toEqual([c.openId, c.finishedId].sort());
  });
});

describe('the revision bump on a finished case', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  const finished: MissionState[] = ['SUBMITTED', 'CLOSED', 'CANCELLED'];

  it.each(finished)('changes nothing on a %s case and says so', async (state) => {
    const c = await twoCases(db, 'FIELD');
    await setState(db, c.openId, state);
    const before = await caseRow(db, c.openId);
    const events = await db.select().from(schema.productEvents);

    const changed = await db.transaction((tx) => incrementMaterialRevision(tx, c.openId));

    expect(changed).toBe(false);
    expect((await caseRow(db, c.openId)).materialRevision).toBe(before.materialRevision);
    expect(await liveConfirmations(db, c.openId)).toBe(1);
    expect(await db.select().from(schema.productEvents)).toHaveLength(events.length);
  });

  it('bumps an open case once and says so', async () => {
    const c = await twoCases(db, 'FIELD');
    const before = await caseRow(db, c.openId);
    const changed = await db.transaction((tx) => incrementMaterialRevision(tx, c.openId));
    expect(changed).toBe(true);
    expect((await caseRow(db, c.openId)).materialRevision).toBe(before.materialRevision + 1);
    expect(await liveConfirmations(db, c.openId)).toBe(0);
  });

  it('follows the record again once a case is open again (the rule a reopen must keep)', async () => {
    const c = await twoCases(db, 'FIELD');
    const before = await caseRow(db, c.finishedId);
    expect(await db.transaction((tx) => incrementMaterialRevision(tx, c.finishedId))).toBe(false);
    await setState(db, c.finishedId, 'IN_PROGRESS');
    expect(await db.transaction((tx) => incrementMaterialRevision(tx, c.finishedId))).toBe(true);
    expect((await caseRow(db, c.finishedId)).materialRevision).toBe(before.materialRevision + 1);
    expect(await liveConfirmations(db, c.finishedId)).toBe(0);
  });

  it('answers false for a case that does not exist', async () => {
    expect(
      await db.transaction((tx) =>
        incrementMaterialRevision(tx, '00000000-0000-4000-8000-000000000000'),
      ),
    ).toBe(false);
  });

  it('keeps one list of finished states', () => {
    for (const state of finished) expect(isFinishedCaseState(state)).toBe(true);
    for (const state of ['DRAFT', 'IN_PROGRESS', 'LOCKED', 'SUBMISSION_READY', 'IN_REVIEW']) {
      expect(isFinishedCaseState(state)).toBe(false);
    }
  });

  it('is the only place that writes the revision', () => {
    const dir = new URL('.', import.meta.url).pathname;
    const files = readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .filter((name) => name.endsWith('.ts') && !name.includes('.test.'))
      .map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }));
    const writers = files.filter((f) => /materialRevision\s*:\s*sql`/.test(f.text));
    expect(writers.map((f) => f.name)).toEqual(['material-revision.ts']);
    // The state test is part of that one write, so a submit racing an edit cannot be undone.
    const text = files.find((f) => f.name === 'material-revision.ts')?.text ?? '';
    expect(text).toMatch(/notInArray\(schema\.missions\.state, \[\.\.\.INACTIVE_CASE_STATES\]\)/);
  });
});

describe('a finished case refuses changes to itself', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('refuses details, checklist, cover letter and snapshot with the plain line', async () => {
    const c = await twoCases(db, 'FIELD');
    const before = await caseRow(db, c.finishedId);
    const snapshotsBefore = await db.select().from(schema.missionSnapshots);

    const messages = await Promise.all([
      updateMissionCaseDetails(db, {
        actorAccountId: c.accountId,
        missionId: c.finishedId,
        jurisdiction: 'Elsewhere',
      }),
      attachPackVersion(db, {
        actorAccountId: c.accountId,
        missionId: c.finishedId,
        packVersionId: c.packVersionId,
      }),
      generateCoverLetter(db, { actorAccountId: c.accountId, missionId: c.finishedId }),
      snapshotMission(db, { actorAccountId: c.accountId, missionId: c.finishedId }),
    ]);
    for (const result of messages) {
      if (result.ok) throw new Error('expected a refusal');
      expect(result.error.message).toBe(CASE_FINISHED_NO_CHANGE);
    }
    const after = await caseRow(db, c.finishedId);
    expect(after.materialRevision).toBe(before.materialRevision);
    expect(after.jurisdiction).toBe(before.jurisdiction);
    expect(await db.select().from(schema.missionSnapshots)).toHaveLength(snapshotsBefore.length);
    expect(await liveConfirmations(db, c.finishedId)).toBe(1);
  });

  it('refuses to choose or remove evidence and leaves the choice and the revision alone', async () => {
    const c = await twoCases(db, 'FIELD');
    const [selection] = await db
      .select()
      .from(schema.selectedEvidence)
      .where(eq(schema.selectedEvidence.missionId, c.finishedId));
    if (!selection?.factId) throw new Error('selection');
    const before = await caseRow(db, c.finishedId);

    const removed = await unselectEvidence(db, {
      actorAccountId: c.accountId,
      missionId: c.finishedId,
      selectionId: selection.id,
    });
    const chosen = await selectEvidence(db, {
      actorAccountId: c.accountId,
      missionId: c.finishedId,
      packRequirementId: selection.packRequirementId,
      factId: selection.factId,
    });
    for (const result of [removed, chosen]) {
      if (result.ok) throw new Error('expected a refusal');
      expect(result.error.message).toBe(CASE_FINISHED_NO_CHANGE);
    }
    expect(
      await db
        .select()
        .from(schema.selectedEvidence)
        .where(eq(schema.selectedEvidence.missionId, c.finishedId)),
    ).toHaveLength(1);
    expect((await caseRow(db, c.finishedId)).materialRevision).toBe(before.materialRevision);
    expect(await liveConfirmations(db, c.finishedId)).toBe(1);
  });

  it('still lets an open case change those', async () => {
    const c = await twoCases(db, 'FIELD');
    const details = await updateMissionCaseDetails(db, {
      actorAccountId: c.accountId,
      missionId: c.openId,
      jurisdiction: 'Elsewhere',
    });
    expect(isOk(details)).toBe(true);
    const snapshot = await snapshotMission(db, {
      actorAccountId: c.accountId,
      missionId: c.openId,
    });
    expect(isOk(snapshot)).toBe(true);
  });
});

describe('what a finished case shows', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('shows the saved copy after the record has moved on', async () => {
    const c = await twoCases(db, 'DOCUMENT');
    if (!c.documentId) throw new Error('document');
    const now = new Date();
    const finishedAtSubmit = await computeReadiness(db, c.finishedId, now);
    if (!isOk(finishedAtSubmit)) throw new Error('readiness');
    expect(finishedAtSubmit.value.savedCopy).toBe('AS_FINISHED');
    const openAtSubmit = await computeReadiness(db, c.openId, now);
    if (!isOk(openAtSubmit)) throw new Error('readiness');
    expect(openAtSubmit.value.satisfiedRequired).toBe(1);

    // The file runs out after the case was sent. An open case now reads it as expired.
    await db
      .update(schema.documents)
      .set({ expiresAt: new Date(Date.now() - 86_400_000) })
      .where(eq(schema.documents.id, c.documentId));

    const openLater = await computeReadiness(db, c.openId, now);
    if (!isOk(openLater)) throw new Error('readiness');
    expect(openLater.value.satisfiedRequired).toBe(0);

    const finishedLater = await computeReadiness(db, c.finishedId, now);
    if (!isOk(finishedLater)) throw new Error('readiness');
    expect(finishedLater.value).toEqual(finishedAtSubmit.value);
    expect(finishedLater.value.satisfiedRequired).toBe(1);
  });

  it('keeps showing the saved copy for a case closed after it was sent', async () => {
    const c = await twoCases(db, 'FIELD');
    const sent = await computeReadiness(db, c.finishedId);
    await transitionMission(db, {
      actorAccountId: c.accountId,
      missionId: c.finishedId,
      to: 'CLOSED',
    });
    const closed = await computeReadiness(db, c.finishedId);
    if (!isOk(sent) || !isOk(closed)) throw new Error('readiness');
    expect(closed.value.savedCopy).toBe('AS_FINISHED');
    expect(closed.value).toEqual(sent.value);
  });

  it('uses the last copy of a case closed without being sent, while it still matches', async () => {
    const c = await twoCases(db, 'FIELD');
    // The open case has a copy taken at its current revision; close it now.
    await setState(db, c.openId, 'CLOSED', new Date(Date.now() + 1000));
    const read = await computeReadiness(db, c.openId);
    if (!isOk(read)) throw new Error('readiness');
    expect(read.value.savedCopy).toBe('AS_FINISHED');
  });

  it('reads live and says so when the last copy is behind the case', async () => {
    const c = await twoCases(db, 'FIELD');
    // Something changed after the copy was taken (revision moved on), then the case was closed.
    expect(await db.transaction((tx) => incrementMaterialRevision(tx, c.openId))).toBe(true);
    await setState(db, c.openId, 'CLOSED', new Date(Date.now() + 1000));
    const read = await computeReadiness(db, c.openId);
    if (!isOk(read)) throw new Error('readiness');
    expect(read.value.savedCopy).toBe('NONE');
  });

  it('reads live and says so when the case has no copy at all', async () => {
    const c = await twoCases(db, 'FIELD');
    await db.delete(schema.acknowledgements).where(eq(schema.acknowledgements.missionId, c.openId));
    await db.delete(schema.missionSnapshots).where(eq(schema.missionSnapshots.missionId, c.openId));
    await setState(db, c.openId, 'CANCELLED', new Date());
    const read = await computeReadiness(db, c.openId);
    if (!isOk(read)) throw new Error('readiness');
    expect(read.value.savedCopy).toBe('NONE');
  });

  it('never marks an open case', async () => {
    const c = await twoCases(db, 'FIELD');
    const read = await computeReadiness(db, c.openId);
    if (!isOk(read)) throw new Error('readiness');
    expect(read.value.savedCopy).toBeUndefined();
  });

  it('reads live when the saved copy lacks a part the screens need', async () => {
    const c = await twoCases(db, 'FIELD');
    const [submission] = await db
      .select()
      .from(schema.missionSubmissions)
      .where(eq(schema.missionSubmissions.missionId, c.finishedId));
    if (!submission) throw new Error('submission');
    // An older copy that lacks a part the screens read (here the overall state): the pinned
    // reader must not hand a half-filled value to a screen, so it reads live and says so.
    const [snapshot] = await db
      .select()
      .from(schema.missionSnapshots)
      .where(eq(schema.missionSnapshots.id, submission.snapshotId));
    const content = snapshot?.content as { readiness: Record<string, unknown> };
    const { overallState: _removed, ...rest } = content.readiness;
    await db
      .update(schema.missionSnapshots)
      .set({ content: { ...content, readiness: rest } })
      .where(eq(schema.missionSnapshots.id, submission.snapshotId));
    const read = await computeReadiness(db, c.finishedId);
    if (!isOk(read)) throw new Error('readiness');
    expect(read.value.savedCopy).toBe('NONE');
  });
});
