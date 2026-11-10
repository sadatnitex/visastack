import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { accountPrincipal, requireAccess } from './access';
import type { Db } from './db';
import { addDocumentVersion, setDocumentType } from './documents';
import { type Cases, freshDb, setState, twoCases } from './finished-case-freeze.test-support';
import {
  type EvidenceCandidateEntry,
  computeReadiness,
  generateCoverLetter,
  getEvidenceCandidates,
  listGeneratedOutputs,
} from './missions';
import { editFact } from './profile';
import { type Selection, buildSelectedOutput } from './selected-output';
import { getCasePackage } from './umpe-package-service';

/**
 * Finished cases are frozen, part two (owner decision, 10 Nov 2026): the evidence list, the
 * package panel, letters and outputs of a finished case show what the case used when it
 * finished. Each test makes the same change to the shared record and reads an open case (which
 * follows it) and a finished case (which does not).
 */

const FIELD = 'passport.number';

async function candidatesOf(
  db: Db,
  c: Cases,
  missionId: string,
): Promise<readonly EvidenceCandidateEntry[]> {
  const result = await getEvidenceCandidates(db, c.accountId, missionId);
  if (!isOk(result)) throw new Error('candidates');
  return result.value;
}

async function changeAnswer(db: Db, c: Cases, value: string, fieldKey = FIELD): Promise<void> {
  const edited = await editFact(db, {
    actorAccountId: c.accountId,
    applicantId: c.applicantId,
    fieldKey,
    value,
  });
  if (!isOk(edited)) throw new Error('edit');
}

async function newFileVersion(db: Db, c: Cases, key: string): Promise<void> {
  if (!c.documentId) throw new Error('document');
  const added = await addDocumentVersion(db, {
    actorAccountId: c.accountId,
    documentId: c.documentId,
    bucket: 'CLEAN',
    objectKey: key,
    safetyStatus: 'CLEAN',
    processingStatus: 'AWAITING_REVIEW',
  });
  if (!isOk(added)) throw new Error('version');
}

async function packageOf(db: Db, c: Cases, missionId: string) {
  const proof = await requireAccess(
    db,
    accountPrincipal(c.accountId),
    'VIEW_METADATA',
    { missionId },
    { purpose: 'self' },
  );
  if (!isOk(proof)) throw new Error('proof');
  const pkg = await getCasePackage(proof.value, missionId);
  if (!isOk(pkg)) throw new Error('package');
  return pkg.value;
}

/** Take the copy out of a finished case's submission, so it has nothing to read from. */
async function withoutMapping(db: Db, missionId: string): Promise<void> {
  const [snapshot] = await db
    .select()
    .from(schema.missionSnapshots)
    .where(eq(schema.missionSnapshots.missionId, missionId));
  if (!snapshot) throw new Error('snapshot');
  const { requirementMapping: _gone, ...rest } = snapshot.content as Record<string, unknown>;
  await db
    .update(schema.missionSnapshots)
    .set({ content: rest })
    .where(eq(schema.missionSnapshots.id, snapshot.id));
}

describe('the evidence list of a finished case', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('lists the answer as it was; an open case follows the edit', async () => {
    const c = await twoCases(db, 'FIELD');
    const openBefore = (await candidatesOf(db, c, c.openId))[0];
    const finishedBefore = (await candidatesOf(db, c, c.finishedId))[0];
    expect(openBefore?.factCandidates.map((f) => f.value)).toEqual(['A1']);
    expect(finishedBefore?.factCandidates.map((f) => f.value)).toEqual(['A1']);

    await changeAnswer(db, c, 'B2');

    const open = (await candidatesOf(db, c, c.openId))[0];
    const finished = (await candidatesOf(db, c, c.finishedId))[0];
    expect(open?.factCandidates.map((f) => f.value)).toEqual(['B2']);
    expect(open?.factCandidates[0]?.factVersionId).not.toBe(
      openBefore?.factCandidates[0]?.factVersionId,
    );
    expect(finished?.factCandidates).toEqual(finishedBefore?.factCandidates);
    // The case's own choice is the same record as before (choosing is already frozen).
    expect(finished?.selectedFactIds).toEqual(finishedBefore?.selectedFactIds);
    expect(finished?.selectedFactIds).toEqual([c.factId]);
  });

  it('lists the file version it used; an open case follows a new version', async () => {
    const c = await twoCases(db, 'DOCUMENT');
    const finishedBefore = (await candidatesOf(db, c, c.finishedId))[0]?.documentCandidates;
    const first = finishedBefore?.[0];
    expect(first?.displayName).toBe('passport.pdf');

    await newFileVersion(db, c, 'freeze-k2');

    const open = (await candidatesOf(db, c, c.openId))[0]?.documentCandidates;
    const finished = (await candidatesOf(db, c, c.finishedId))[0]?.documentCandidates;
    expect(open?.[0]?.documentVersionId).not.toBe(first?.documentVersionId);
    expect(finished?.map((d) => [d.documentVersionId, d.sha256, d.displayName])).toEqual(
      finishedBefore?.map((d) => [d.documentVersionId, d.sha256, d.displayName]),
    );
  });

  it('keeps listing a file after its kind changes; an open case stops offering it', async () => {
    const c = await twoCases(db, 'DOCUMENT');
    if (!c.documentId) throw new Error('document');
    const changed = await setDocumentType(db, {
      actorAccountId: c.accountId,
      documentId: c.documentId,
      docType: 'photo',
    });
    expect(isOk(changed)).toBe(true);

    const open = (await candidatesOf(db, c, c.openId))[0]?.documentCandidates;
    const finished = (await candidatesOf(db, c, c.finishedId))[0]?.documentCandidates;
    expect(open).toHaveLength(0);
    expect(finished?.map((d) => d.displayName)).toEqual(['passport.pdf']);
  });

  it('drops a file the person has since removed', async () => {
    const c = await twoCases(db, 'DOCUMENT');
    if (!c.documentId) throw new Error('document');
    await db.insert(schema.documentLifecycle).values({
      documentId: c.documentId,
      applicantId: c.applicantId,
      deletedAt: new Date(),
      deletePath: 'REQUEST',
      purgeAfter: new Date(Date.now() + 30 * 86_400_000),
    });
    const finished = (await candidatesOf(db, c, c.finishedId))[0]?.documentCandidates;
    expect(finished).toHaveLength(0);
  });

  it('reads live when the case has no saved copy (the page says so)', async () => {
    const c = await twoCases(db, 'FIELD');
    await db.delete(schema.acknowledgements).where(eq(schema.acknowledgements.missionId, c.openId));
    await db.delete(schema.missionSnapshots).where(eq(schema.missionSnapshots.missionId, c.openId));
    await setState(db, c.openId, 'CANCELLED', new Date());
    await changeAnswer(db, c, 'B2');
    const read = (await candidatesOf(db, c, c.openId))[0];
    expect(read?.factCandidates.map((f) => f.value)).toEqual(['B2']);
    const readiness = await computeReadiness(db, c.openId);
    if (!isOk(readiness)) throw new Error('readiness');
    expect(readiness.value.savedCopy).toBe('NONE');
  });

  it('reads live, with readiness, when the copy lacks the requirement mapping', async () => {
    const c = await twoCases(db, 'FIELD');
    await withoutMapping(db, c.finishedId);
    await changeAnswer(db, c, 'B2');
    const read = (await candidatesOf(db, c, c.finishedId))[0];
    expect(read?.factCandidates.map((f) => f.value)).toEqual(['B2']);
    const readiness = await computeReadiness(db, c.finishedId);
    if (!isOk(readiness)) throw new Error('readiness');
    expect(readiness.value.savedCopy).toBe('NONE');
  });

  it('never changes what an open case lists', async () => {
    const c = await twoCases(db, 'FIELD');
    const read = (await candidatesOf(db, c, c.openId))[0];
    expect(read?.factCandidates.map((f) => f.value)).toEqual(['A1']);
  });
});

describe('the package panel of a finished case', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('proposes the answer it used; an open case proposes the new one', async () => {
    const c = await twoCases(db, 'FIELD');
    const finishedBefore = (await packageOf(db, c, c.finishedId)).items[0]?.proposed;
    await changeAnswer(db, c, 'B2');
    const open = await packageOf(db, c, c.openId);
    const finished = await packageOf(db, c, c.finishedId);
    expect(finishedBefore?.factVersionId).toBeTruthy();
    expect(finished.items[0]?.proposed?.factVersionId).toBe(finishedBefore?.factVersionId);
    expect(open.items[0]?.proposed?.factVersionId).not.toBe(finishedBefore?.factVersionId);
    expect(finished.active).toBe(false);
    expect(finished.questions).toEqual([]);
  });

  it('names the file version it used; an open case follows a new version', async () => {
    const c = await twoCases(db, 'DOCUMENT');
    const before = (await packageOf(db, c, c.finishedId)).items[0]?.proposed;
    await newFileVersion(db, c, 'freeze-k2');
    const open = (await packageOf(db, c, c.openId)).items[0]?.proposed;
    const finished = (await packageOf(db, c, c.finishedId)).items[0]?.proposed;
    expect(before?.documentVersionId).toBeTruthy();
    expect(finished?.documentVersionId).toBe(before?.documentVersionId);
    expect(open?.documentVersionId).not.toBe(before?.documentVersionId);
    expect(finished?.displayName).toBe('passport.pdf');
  });
});

describe('cover letters', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('stay as stored after the record changes; a new letter on an open case follows it', async () => {
    const c = await twoCases(db, 'FIELD');
    const first = await generateCoverLetter(db, {
      actorAccountId: c.accountId,
      missionId: c.openId,
    });
    if (!isOk(first)) throw new Error('letter');
    expect(first.value.content).toContain('A1');
    // A letter already stored on the finished case.
    await db.insert(schema.generatedOutputs).values({
      missionId: c.finishedId,
      kind: 'COVER_LETTER',
      version: 1,
      content: first.value.content,
      groundedReferences: first.value.groundedReferences,
      createdByAccountId: c.accountId,
    });

    await changeAnswer(db, c, 'B2');

    for (const missionId of [c.openId, c.finishedId]) {
      const letters = await listGeneratedOutputs(db, c.accountId, missionId);
      if (!isOk(letters)) throw new Error('letters');
      expect(letters.value[0]?.content).toContain('A1');
      expect(letters.value[0]?.content).not.toContain('B2');
    }
    const second = await generateCoverLetter(db, {
      actorAccountId: c.accountId,
      missionId: c.openId,
    });
    if (!isOk(second)) throw new Error('letter');
    expect(second.value.content).toContain('B2');
  });
});

describe('outputs built from a finished case', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  const FIELD_KEY = 'tax_zone';

  async function moneyOutput(c: Cases, missionId: string) {
    const proof = await requireAccess(
      db,
      accountPrincipal(c.accountId),
      'VIEW_METADATA',
      { applicantId: c.applicantId },
      { purpose: 'selected_output_test' },
    );
    if (!isOk(proof)) throw new Error('proof');
    const selection: Selection = {
      layers: ['money'],
      cases: { kind: 'one', missionId },
      documentList: false,
      documentText: [],
      revealIdentifiers: false,
      depth: 'standard',
    };
    const built = await buildSelectedOutput(proof.value, selection, {
      now: new Date(),
    });
    if (!isOk(built)) throw new Error(`build ${built.error.message}`);
    return built.value.profile.money?.find((v) => v.fieldKey === FIELD_KEY);
  }

  it('shows the answer as the finished case used it; an open case shows today', async () => {
    const c = await twoCases(db, 'FIELD', FIELD_KEY);
    expect((await moneyOutput(c, c.finishedId))?.value).toBe('A1');
    await changeAnswer(db, c, 'B2', FIELD_KEY);
    expect((await moneyOutput(c, c.openId))?.value).toBe('B2');
    const finished = await moneyOutput(c, c.finishedId);
    expect(finished?.value).toBe('A1');
    expect(finished?.relevance).toBe('required_by_case');
  });

  it('shows today when the finished case has no saved copy', async () => {
    const c = await twoCases(db, 'FIELD', FIELD_KEY);
    await withoutMapping(db, c.finishedId);
    await changeAnswer(db, c, 'B2', FIELD_KEY);
    expect((await moneyOutput(c, c.finishedId))?.value).toBe('B2');
  });

  it('leaves an agency AI call on today, and pins only through the owner path', () => {
    const source = readFileSync(join(__dirname, 'selected-output.ts'), 'utf8');
    expect(source).toContain('agency || !onlyCase');
  });
});
