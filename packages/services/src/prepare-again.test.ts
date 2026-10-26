import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import { accountPrincipal, requireAccess } from './access';
import { provisionAccount } from './accounts';
import { addNote, assignMember, createTaskForOrg, listMissionsForOrganization } from './agency';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { addDocumentVersion, registerDocument, setDocumentDate } from './documents';
import {
  type DocumentInstance,
  type FactInstance,
  attachPackVersion,
  classifyPrepareAgainRequirement,
  computeReadiness,
  createMission,
  createTask,
  listTasks,
  planPrepareAgain,
  prepareCaseAgain,
  selectEvidence,
  transitionMission,
} from './missions';
import { createOrganization, reviewOrganization } from './organizations';
import {
  addPackVersion,
  addRequirement,
  approvePackVersion,
  createPack,
  listRequirements,
  publishPackVersion,
} from './packs';
import { editFact, registerFieldDefinition } from './profile';
import { acceptGrant, createGrant } from './sharing';

/**
 * Prepare Again (Programme X WP-V4, v1.2 U02; tests X09, T08, T09).
 *
 * One traveller has a finished case on a published checklist with a passport
 * number, a bank statement and travel insurance. Two agencies hold all-cases
 * grants. Preparing the case again must reuse the confirmed records by
 * reference, mark outdated ones for review, list what is missing, copy none
 * of the previous case's work or approvals, and let the traveller decide who
 * sees the new case.
 */

const HEAVY_TIMEOUT_MS = 120_000;

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, { schema }) as unknown as Db;
}

async function consentedAccount(db: Db, email: string) {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision');
  for (const type of ['CORE_PROCESSING', 'SHARING'] as const) {
    await setConsent(db, {
      actorAccountId: provisioned.value.id,
      accountId: provisioned.value.id,
      type,
      granted: true,
    });
  }
  return provisioned.value;
}

async function activeOrganization(db: Db, ownerEmail: string, name: string) {
  const admin = await consentedAccount(db, ownerEmail);
  const org = await createOrganization(db, { actorAccountId: admin.id, name });
  if (!isOk(org)) throw new Error('org');
  const reviewer = await provisionAccount(db, { email: `reviewer-${ownerEmail}` });
  if (!isOk(reviewer)) throw new Error('reviewer');
  const reviewed = await reviewOrganization(db, {
    reviewerAccountId: reviewer.value.id,
    organizationId: org.value.id,
    decision: 'ACTIVE',
    stepUpSatisfied: true,
  });
  if (!isOk(reviewed)) throw new Error('review');
  return { adminId: admin.id, organizationId: org.value.id };
}

async function publishVersion(db: Db, actor: string, packId: string, extra = false) {
  const version = await addPackVersion(db, { actorAccountId: actor, packId });
  if (!isOk(version)) throw new Error('version');
  const add = async (input: Record<string, unknown>) => {
    const added = await addRequirement(db, {
      actorAccountId: actor,
      packVersionId: version.value.id,
      citation: 'rule',
      ...input,
    } as never);
    if (!isOk(added)) throw new Error(`requirement: ${added.error.message}`);
  };
  await add({ kind: 'FIELD', fieldKey: 'passport.number' });
  await add({ kind: 'DOCUMENT', docType: 'bank_statement', maxAgeDays: 90 });
  await add({ kind: 'DOCUMENT', docType: 'travel_insurance' });
  if (extra) await add({ kind: 'FIELD', fieldKey: 'employment.employer_name' });
  const approved = await approvePackVersion(db, {
    actorAccountId: actor,
    packVersionId: version.value.id,
  });
  if (!isOk(approved)) throw new Error('approve');
  const published = await publishPackVersion(db, {
    actorAccountId: actor,
    packVersionId: version.value.id,
  });
  if (!isOk(published)) throw new Error('publish');
  return version.value.id;
}

async function scenario() {
  const db = await freshDb();
  const owner = await consentedAccount(db, 'owner@example.test');
  const applicant = await createApplicant(db, {
    actorAccountId: owner.id,
    ownerAccountId: owner.id,
    displayName: 'Rahim Uddin',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  const applicantId = applicant.value.id;

  const pack = await createPack(db, { actorAccountId: owner.id, key: 'jp.tourist', name: 'Japan' });
  if (!isOk(pack)) throw new Error('pack');
  const v1 = await publishVersion(db, owner.id, pack.value.id);

  await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
  await registerFieldDefinition(db, { key: 'employment.employer_name', dataType: 'string' });
  const passport = await editFact(db, {
    actorAccountId: owner.id,
    applicantId,
    fieldKey: 'passport.number',
    value: 'A1234567',
  });
  if (!isOk(passport)) throw new Error('fact');
  const factId = passport.value.fact.id;

  const bank = await registerDocument(db, {
    actorAccountId: owner.id,
    applicantId,
    originalName: 'bank.pdf',
    docType: 'bank_statement',
  });
  if (!isOk(bank)) throw new Error('doc');
  await addDocumentVersion(db, {
    actorAccountId: owner.id,
    documentId: bank.value.id,
    bucket: 'CLEAN',
    objectKey: 'k-bank',
    safetyStatus: 'CLEAN',
    processingStatus: 'AWAITING_REVIEW',
  });

  const previous = await createMission(db, {
    actorAccountId: owner.id,
    applicantId,
    title: 'Japan trip 2025',
    destination: 'Japan',
    purpose: 'Tourism',
    travelStartDate: new Date('2025-04-01'),
  });
  if (!isOk(previous)) throw new Error('mission');
  const previousId = previous.value.id;
  await attachPackVersion(db, {
    actorAccountId: owner.id,
    missionId: previousId,
    packVersionId: v1,
  });
  const reqs = await listRequirements(db, v1);
  const reqFor = (key: string) => {
    const found = reqs.find((r) => r.fieldKey === key || r.docType === key);
    if (!found) throw new Error(key);
    return found.id;
  };
  for (const selection of [
    { packRequirementId: reqFor('passport.number'), factId },
    { packRequirementId: reqFor('bank_statement'), documentId: bank.value.id },
  ]) {
    const selected = await selectEvidence(db, {
      actorAccountId: owner.id,
      missionId: previousId,
      ...selection,
    });
    if (!isOk(selected)) throw new Error(`select: ${selected.error.message}`);
  }

  const a = await activeOrganization(db, 'a-admin@agency-a.test', 'Agency A');
  const b = await activeOrganization(db, 'b-admin@agency-b.test', 'Agency B');
  const grantTo = async (organizationId: string, missionId?: string) => {
    const created = await createGrant(db, {
      actorAccountId: owner.id,
      applicantId,
      recipientOrganizationId: organizationId,
      ...(missionId ? { missionId } : {}),
      actions: ['VIEW_METADATA', 'COMMENT', 'MANAGE'],
      purpose: 'collaboration',
    });
    if (!isOk(created)) throw new Error(`grant: ${created.error.message}`);
    return created.value.id;
  };
  const grantA = await grantTo(a.organizationId);
  const grantB = await grantTo(b.organizationId);
  for (const [actor, grantId] of [
    [a.adminId, grantA],
    [b.adminId, grantB],
  ] as const) {
    const accepted = await acceptGrant(db, { actorAccountId: actor, grantId });
    if (!isOk(accepted)) throw new Error('accept');
  }

  // Work on the previous case that must never travel to the new one.
  const assigned = await assignMember(db, {
    actorAccountId: a.adminId,
    organizationId: a.organizationId,
    memberAccountId: a.adminId,
    missionId: previousId,
  });
  if (!isOk(assigned)) throw new Error(`assign: ${assigned.error.message}`);
  const note = await addNote(db, {
    actorAccountId: a.adminId,
    missionId: previousId,
    body: 'Agency A private working note',
    visibility: 'AGENCY_INTERNAL',
  });
  if (!isOk(note)) throw new Error(`note: ${note.error.message}`);
  const orgTask = await createTaskForOrg(db, {
    actorAccountId: a.adminId,
    organizationId: a.organizationId,
    missionId: previousId,
    description: 'Check bank statement',
  });
  if (!isOk(orgTask)) throw new Error(`task: ${orgTask.error.message}`);
  const ownTask = await createTask(db, {
    actorAccountId: owner.id,
    missionId: previousId,
    description: 'Book biometrics',
  });
  if (!isOk(ownTask)) throw new Error('own task');
  const moved = await transitionMission(db, {
    actorAccountId: owner.id,
    missionId: previousId,
    to: 'INTAKE',
  });
  if (!isOk(moved)) throw new Error(`transition: ${moved.error.message}`);

  return {
    db,
    owner,
    applicantId,
    packId: pack.value.id,
    v1,
    factId,
    bankId: bank.value.id,
    previousId,
    a,
    b,
    grantA,
    grantB,
  };
}

type Scenario = Awaited<ReturnType<typeof scenario>>;

async function ownerProof<A extends 'VIEW_METADATA' | 'MANAGE'>(s: Scenario, action: A) {
  const proof = await requireAccess(
    s.db,
    accountPrincipal(s.owner.id),
    action,
    { missionId: s.previousId },
    { purpose: 'owner_prepare_again' },
  );
  if (!isOk(proof)) throw new Error('owner proof');
  return proof.value;
}

async function plan(s: Scenario) {
  const planned = await planPrepareAgain(await ownerProof(s, 'VIEW_METADATA'));
  if (!isOk(planned)) throw new Error(`plan: ${planned.error.message}`);
  return planned.value;
}

/** Every ticked-by-default record, as the screen would submit it. */
function preselected(p: Awaited<ReturnType<typeof plan>>) {
  return p.items.flatMap((item) =>
    item.records
      .filter((r) => r.preselected)
      .map((r) =>
        r.kind === 'fact'
          ? { packRequirementId: item.packRequirementId, factId: r.factId }
          : { packRequirementId: item.packRequirementId, documentId: r.documentId },
      ),
  );
}

async function missionCount(s: Scenario): Promise<number> {
  return (await s.db.select({ id: schema.missions.id }).from(schema.missions)).length;
}

describe('Prepare Again: sorting one requirement (pure rules)', () => {
  const req = {
    id: 'r1',
    kind: 'FIELD' as const,
    fieldKey: 'passport.number',
    docType: null,
    citation: 'rule',
    optional: false,
    maxAgeDays: null,
  };
  const fact = (id: string, status: FactInstance['status']): FactInstance => ({
    factId: id,
    factVersionId: `${id}-v`,
    repeatingRecordKey: null,
    value: 'A1',
    status,
    evidenceLinkIds: [],
  });
  const doc = (id: string, eligible: boolean, documentDate: string | null): DocumentInstance => ({
    documentId: id,
    documentVersionId: `${id}-v`,
    docType: 'bank_statement',
    displayName: `${id}.pdf`,
    sha256: null,
    safetyStatus: eligible ? 'CLEAN' : 'PENDING',
    processingStatus: 'AWAITING_REVIEW',
    eligible,
    documentDate,
  });
  const now = new Date('2026-10-26T00:00:00Z');
  const none = { factIds: new Set<string>(), documentIds: new Set<string>() };

  it('reuses a record the previous case chose, ticked', () => {
    const item = classifyPrepareAgainRequirement(
      req,
      [fact('f1', 'APPLICANT_CONFIRMED'), fact('f2', 'APPLICANT_CONFIRMED')],
      [],
      { factIds: new Set(['f2']), documentIds: new Set() },
      now,
    );
    expect(item).toMatchObject({ group: 'REUSABLE', reason: 'used_before' });
    // Every current record is listed so the person can switch; only the earlier choice is ticked.
    expect(item.records).toEqual([
      expect.objectContaining({ factId: 'f1', carriable: true, preselected: false }),
      expect.objectContaining({ factId: 'f2', carriable: true, preselected: true }),
    ]);
  });

  it('sends a chosen record that is now in conflict to review and never carries it', () => {
    const item = classifyPrepareAgainRequirement(
      req,
      [fact('f1', 'CONFLICTED')],
      [],
      { factIds: new Set(['f1']), documentIds: new Set() },
      now,
    );
    expect(item).toMatchObject({ group: 'NEEDS_REVIEW', reason: 'conflict' });
    expect(item.records.every((r) => !r.carriable && !r.preselected)).toBe(true);
  });

  it('counts the only current match without ticking it, and never picks among several', () => {
    const one = classifyPrepareAgainRequirement(req, [fact('f1', 'DECLARED')], [], none, now);
    expect(one).toMatchObject({ group: 'REUSABLE', reason: 'only_match' });
    expect(one.records[0]).toMatchObject({ carriable: true, preselected: false });

    const two = classifyPrepareAgainRequirement(
      req,
      [fact('f1', 'DECLARED'), fact('f2', 'DOCUMENT_SUPPORTED')],
      [],
      none,
      now,
    );
    expect(two).toMatchObject({ group: 'NEEDS_REVIEW', reason: 'choose_one' });
    expect(two.records.every((r) => r.carriable && !r.preselected)).toBe(true);
  });

  it('names the most serious problem, whatever order the records come in', () => {
    const item = classifyPrepareAgainRequirement(
      req,
      [fact('f1', 'EXTRACTED_PENDING'), fact('f2', 'CONFLICTED')],
      [],
      none,
      now,
    );
    expect(item).toMatchObject({ group: 'NEEDS_REVIEW', reason: 'conflict' });
  });

  it('marks unconfirmed records for review and an empty requirement as missing', () => {
    const pending = classifyPrepareAgainRequirement(
      req,
      [fact('f1', 'EXTRACTED_PENDING')],
      [],
      none,
      now,
    );
    expect(pending).toMatchObject({ group: 'NEEDS_REVIEW', reason: 'needs_confirmation' });
    const missing = classifyPrepareAgainRequirement(req, [], [], none, now);
    expect(missing).toMatchObject({ group: 'MISSING', reason: 'not_provided', records: [] });
  });

  it('sends a document older than the route allows, or not usable, to review', () => {
    const docReq = {
      ...req,
      kind: 'DOCUMENT' as const,
      fieldKey: null,
      docType: 'bank_statement',
      maxAgeDays: 90,
    };
    const old = classifyPrepareAgainRequirement(
      docReq,
      [],
      [doc('d1', true, '2026-01-01')],
      { factIds: new Set(), documentIds: new Set(['d1']) },
      now,
    );
    expect(old).toMatchObject({ group: 'NEEDS_REVIEW', reason: 'too_old' });
    expect(old.records[0]?.carriable).toBe(false);
    // The old statement went out of date, a fresh one was added: the fresh one
    // can be ticked, but nothing in Needs Review is ticked for the person.
    const refreshed = classifyPrepareAgainRequirement(
      docReq,
      [],
      [doc('d1', true, '2026-01-01'), doc('d3', true, '2026-10-01')],
      { factIds: new Set(), documentIds: new Set(['d1']) },
      now,
    );
    expect(refreshed).toMatchObject({ group: 'NEEDS_REVIEW', reason: 'too_old' });
    expect(refreshed.records).toEqual([
      expect.objectContaining({ documentId: 'd1', carriable: false, preselected: false }),
      expect.objectContaining({ documentId: 'd3', carriable: true, preselected: false }),
    ]);
    const unsafe = classifyPrepareAgainRequirement(docReq, [], [doc('d2', false, null)], none, now);
    expect(unsafe).toMatchObject({ group: 'NEEDS_REVIEW', reason: 'not_usable' });
  });
});

describe('Prepare Again: plan and create (X09, T08, T09)', () => {
  it(
    'shows Reusable, Needs Review and Missing, then starts a fresh case reusing references only',
    async () => {
      const s = await scenario();
      const p = await plan(s);
      expect(p.packVersion).toMatchObject({ id: s.v1, changedSincePrevious: false });
      expect(p.source).toMatchObject({ title: 'Japan trip 2025', destination: 'Japan' });
      const byKey = (key: string) => p.items.find((i) => i.key === key);
      expect(byKey('passport.number')).toMatchObject({ group: 'REUSABLE', reason: 'used_before' });
      expect(byKey('passport.number')?.records[0]).toMatchObject({
        kind: 'fact',
        value: 'A1234567',
      });
      expect(byKey('bank_statement')).toMatchObject({ group: 'REUSABLE', reason: 'used_before' });
      expect(byKey('travel_insurance')).toMatchObject({ group: 'MISSING' });
      expect(p.sharingQuestions.map((q) => q.id).sort()).toEqual([s.grantA, s.grantB].sort());

      const created = await prepareCaseAgain(await ownerProof(s, 'MANAGE'), {
        title: 'Japan trip 2027',
        travelStartDate: new Date('2027-04-01'),
        expectedPackVersionId: p.packVersion?.id ?? null,
        carry: preselected(p),
        sharing: { allowedGrantIds: [s.grantB], allowedInvitationIds: [] },
      });
      if (!isOk(created)) throw new Error(`create: ${created.error.message}`);
      const fresh = created.value;

      // X09: confirmed facts are reused without retyping; readiness counts them.
      expect(fresh).toMatchObject({
        title: 'Japan trip 2027',
        destination: 'Japan',
        purpose: 'Tourism',
        packVersionId: s.v1,
        ownerOrganizationId: null,
        itineraryRef: null,
      });
      expect(fresh.travelStartDate?.toISOString()).toBe('2027-04-01T00:00:00.000Z');
      const selections = await s.db
        .select()
        .from(schema.selectedEvidence)
        .where(eq(schema.selectedEvidence.missionId, fresh.id));
      expect(selections.map((r) => r.factId ?? r.documentId).sort()).toEqual(
        [s.factId, s.bankId].sort(),
      );
      const readiness = await computeReadiness(s.db, fresh.id);
      if (!isOk(readiness)) throw new Error('readiness');
      expect(readiness.value.satisfiedRequired).toBe(2);
      expect(readiness.value.missing.map((m) => m.key)).toEqual(['travel_insurance']);

      // T09: a fresh state, no tasks, notes, snapshots or outputs carried over.
      expect(fresh.state).toBe('DRAFT');
      const tasks = await listTasks(s.db, s.owner.id, fresh.id);
      expect(isOk(tasks) && tasks.value).toEqual([]);
      const notes = await s.db
        .select({ id: schema.missionNotes.id })
        .from(schema.missionNotes)
        .where(eq(schema.missionNotes.missionId, fresh.id));
      expect(notes).toEqual([]);
      for (const table of [schema.missionSnapshots, schema.generatedOutputs]) {
        const rows = await s.db.select().from(table).where(eq(table.missionId, fresh.id));
        expect(rows).toEqual([]);
      }

      // T08: A was not ticked, so it cannot see the new case; B can. A keeps the old one.
      const seenBy = async (organizationId: string) =>
        (await listMissionsForOrganization(s.db, organizationId)).map((m) => m.missionId);
      expect(await seenBy(s.a.organizationId)).toContain(s.previousId);
      expect(await seenBy(s.a.organizationId)).not.toContain(fresh.id);
      expect(await seenBy(s.b.organizationId)).toContain(fresh.id);
      const deniedA = await requireAccess(
        s.db,
        accountPrincipal(s.a.adminId),
        'VIEW_METADATA',
        { missionId: fresh.id },
        { purpose: 'collaboration' },
      );
      expect(isErr(deniedA) && deniedA.error.code).toBe('not_found');

      // The new case records where it came from, and the product event fired once.
      const created_audit = await s.db
        .select({ metadata: schema.auditEvents.metadata })
        .from(schema.auditEvents)
        .where(
          and(
            eq(schema.auditEvents.eventType, 'MISSION_CREATED'),
            eq(schema.auditEvents.missionId, fresh.id),
          ),
        );
      expect(JSON.stringify(created_audit[0]?.metadata)).toContain(s.previousId);
      const events = await s.db
        .select({ metricValue: schema.productEvents.metricValue })
        .from(schema.productEvents)
        .where(eq(schema.productEvents.eventType, 'CASE_PREPARED_AGAIN'));
      expect(events.map((e) => Number(e.metricValue))).toEqual([2]);
    },
    HEAVY_TIMEOUT_MS,
  );

  it(
    'a case-scoped grant on the previous case never reaches the new one',
    async () => {
      const s = await scenario();
      const c = await activeOrganization(s.db, 'c-admin@agency-c.test', 'Agency C');
      const grantC = await createGrant(s.db, {
        actorAccountId: s.owner.id,
        applicantId: s.applicantId,
        recipientOrganizationId: c.organizationId,
        missionId: s.previousId,
        actions: ['VIEW_METADATA'],
        purpose: 'collaboration',
      });
      if (!isOk(grantC)) throw new Error('grant c');
      await acceptGrant(s.db, { actorAccountId: c.adminId, grantId: grantC.value.id });
      const p = await plan(s);
      expect(p.sharingQuestions.map((q) => q.id)).not.toContain(grantC.value.id);
      const created = await prepareCaseAgain(await ownerProof(s, 'MANAGE'), {
        title: 'Again',
        expectedPackVersionId: p.packVersion?.id ?? null,
        carry: [],
        sharing: { allowedGrantIds: [s.grantA, s.grantB], allowedInvitationIds: [] },
      });
      if (!isOk(created)) throw new Error('create');
      const seen = (await listMissionsForOrganization(s.db, c.organizationId)).map(
        (m) => m.missionId,
      );
      expect(seen).toEqual([s.previousId]);
    },
    HEAVY_TIMEOUT_MS,
  );

  it(
    'uses the newest published checklist and carries choices across versions by requirement',
    async () => {
      const s = await scenario();
      const v2 = await publishVersion(s.db, s.owner.id, s.packId, true);
      const p = await plan(s);
      expect(p.packVersion).toMatchObject({ id: v2, version: 2, changedSincePrevious: true });
      const v2Requirements = new Set((await listRequirements(s.db, v2)).map((r) => r.id));
      expect(p.items.every((i) => v2Requirements.has(i.packRequirementId))).toBe(true);
      expect(p.items.find((i) => i.key === 'passport.number')).toMatchObject({
        group: 'REUSABLE',
        reason: 'used_before',
      });
      expect(p.items.find((i) => i.key === 'employment.employer_name')).toMatchObject({
        group: 'MISSING',
      });

      // The person saw v1, then v2 was published: refused, nothing written.
      const before = await missionCount(s);
      const stale = await prepareCaseAgain(await ownerProof(s, 'MANAGE'), {
        title: 'Again',
        expectedPackVersionId: s.v1,
        carry: [],
        sharing: { allowedGrantIds: [s.grantA, s.grantB], allowedInvitationIds: [] },
      });
      expect(isErr(stale) && stale.error.code).toBe('invalid');
      expect(await missionCount(s)).toBe(before);

      const created = await prepareCaseAgain(await ownerProof(s, 'MANAGE'), {
        title: 'Again',
        expectedPackVersionId: v2,
        carry: preselected(p),
        sharing: { allowedGrantIds: [s.grantA, s.grantB], allowedInvitationIds: [] },
      });
      if (!isOk(created)) throw new Error(`create: ${created.error.message}`);
      expect(created.value.packVersionId).toBe(v2);
    },
    HEAVY_TIMEOUT_MS,
  );

  it(
    'marks an outdated bank statement for review and lets the person leave a suggestion out',
    async () => {
      const s = await scenario();
      const dated = await setDocumentDate(s.db, {
        actorAccountId: s.owner.id,
        documentId: s.bankId,
        documentDate: '2020-01-01',
      });
      if (!isOk(dated)) throw new Error(`date: ${dated.error.message}`);
      const p = await plan(s);
      const bank = p.items.find((i) => i.key === 'bank_statement');
      expect(bank).toMatchObject({ group: 'NEEDS_REVIEW', reason: 'too_old' });
      expect(bank?.records.every((r) => !r.carriable)).toBe(true);

      // Carrying it anyway is refused; the whole request writes nothing.
      const before = await missionCount(s);
      const forced = await prepareCaseAgain(await ownerProof(s, 'MANAGE'), {
        title: 'Again',
        expectedPackVersionId: s.v1,
        carry: [{ packRequirementId: bank?.packRequirementId ?? '', documentId: s.bankId }],
        sharing: { allowedGrantIds: [s.grantA, s.grantB], allowedInvitationIds: [] },
      });
      expect(isErr(forced) && forced.error.code).toBe('invalid');
      expect(await missionCount(s)).toBe(before);

      // Leaving the passport suggestion out: the new case has no choice for it.
      const created = await prepareCaseAgain(await ownerProof(s, 'MANAGE'), {
        title: 'Again',
        expectedPackVersionId: s.v1,
        carry: [],
        sharing: { allowedGrantIds: [s.grantA, s.grantB], allowedInvitationIds: [] },
      });
      if (!isOk(created)) throw new Error('create');
      const selections = await s.db
        .select()
        .from(schema.selectedEvidence)
        .where(eq(schema.selectedEvidence.missionId, created.value.id));
      expect(selections).toEqual([]);
    },
    HEAVY_TIMEOUT_MS,
  );

  it(
    "refuses another person's record, a duplicate, an unknown recipient and a non-owner, writing nothing",
    async () => {
      const s = await scenario();
      const p = await plan(s);
      const passportReq = p.items.find((i) => i.key === 'passport.number')?.packRequirementId ?? '';
      const other = await createApplicant(s.db, {
        actorAccountId: s.owner.id,
        ownerAccountId: s.owner.id,
        displayName: 'Someone else',
      });
      if (!isOk(other)) throw new Error('other');
      const foreign = await editFact(s.db, {
        actorAccountId: s.owner.id,
        applicantId: other.value.id,
        fieldKey: 'passport.number',
        value: 'Z9',
      });
      if (!isOk(foreign)) throw new Error('foreign fact');
      const before = await missionCount(s);
      const attempts = [
        { carry: [{ packRequirementId: passportReq, factId: foreign.value.fact.id }] },
        {
          carry: [
            { packRequirementId: passportReq, factId: s.factId },
            { packRequirementId: passportReq, factId: s.factId },
          ],
        },
        { carry: [{ packRequirementId: passportReq, factId: s.factId, documentId: s.bankId }] },
        { carry: [], allowedGrantIds: ['00000000-0000-4000-8000-000000000000'] },
      ];
      for (const attempt of attempts) {
        const result = await prepareCaseAgain(await ownerProof(s, 'MANAGE'), {
          title: 'Again',
          expectedPackVersionId: s.v1,
          carry: attempt.carry,
          sharing: {
            allowedGrantIds: attempt.allowedGrantIds ?? [s.grantA, s.grantB],
            allowedInvitationIds: [],
          },
        });
        expect(isErr(result) && result.error.code).toBe('invalid');
      }
      expect(await missionCount(s)).toBe(before);

      // Agency A may manage the previous case, but only the owner prepares again.
      for (const action of ['VIEW_METADATA', 'MANAGE'] as const) {
        const agencyProof = await requireAccess(
          s.db,
          accountPrincipal(s.a.adminId),
          action,
          { missionId: s.previousId },
          { purpose: 'collaboration' },
        );
        if (!isOk(agencyProof)) throw new Error(`agency proof: ${agencyProof.error.message}`);
        const refused =
          action === 'VIEW_METADATA'
            ? await planPrepareAgain(agencyProof.value as never)
            : await prepareCaseAgain(agencyProof.value as never, {
                title: 'Again',
                expectedPackVersionId: s.v1,
                carry: [],
                sharing: { allowedGrantIds: [s.grantA, s.grantB], allowedInvitationIds: [] },
              });
        expect(refused.ok ? 'allowed' : refused.error.code).toBe('forbidden');
      }
      expect(await missionCount(s)).toBe(before);
    },
    HEAVY_TIMEOUT_MS,
  );

  it(
    'ignores choices made under a checklist the previous case no longer uses',
    async () => {
      const s = await scenario();
      const other = await createPack(s.db, {
        actorAccountId: s.owner.id,
        key: 'other.route',
        name: 'Other',
      });
      if (!isOk(other)) throw new Error('other pack');
      const otherVersion = await publishVersion(s.db, s.owner.id, other.value.id);
      const oldStatement = await registerDocument(s.db, {
        actorAccountId: s.owner.id,
        applicantId: s.applicantId,
        originalName: 'old-bank.pdf',
        docType: 'bank_statement',
      });
      if (!isOk(oldStatement)) throw new Error('doc');
      await addDocumentVersion(s.db, {
        actorAccountId: s.owner.id,
        documentId: oldStatement.value.id,
        bucket: 'CLEAN',
        objectKey: 'k-old',
        safetyStatus: 'CLEAN',
        processingStatus: 'AWAITING_REVIEW',
      });
      // Briefly on the other checklist with the old statement chosen, then back.
      await attachPackVersion(s.db, {
        actorAccountId: s.owner.id,
        missionId: s.previousId,
        packVersionId: otherVersion,
      });
      const otherBank = (await listRequirements(s.db, otherVersion)).find(
        (r) => r.docType === 'bank_statement',
      );
      const chosen = await selectEvidence(s.db, {
        actorAccountId: s.owner.id,
        missionId: s.previousId,
        packRequirementId: otherBank?.id ?? '',
        documentId: oldStatement.value.id,
      });
      if (!isOk(chosen)) throw new Error('select');
      await attachPackVersion(s.db, {
        actorAccountId: s.owner.id,
        missionId: s.previousId,
        packVersionId: s.v1,
      });

      const bank = (await plan(s)).items.find((i) => i.key === 'bank_statement');
      expect(bank).toMatchObject({ group: 'REUSABLE', reason: 'used_before' });
      const ticked = bank?.records.filter((r) => r.preselected) ?? [];
      expect(ticked.map((r) => (r.kind === 'document' ? r.documentId : ''))).toEqual([s.bankId]);
    },
    HEAVY_TIMEOUT_MS,
  );

  it(
    'a case without a checklist is prepared again with its details and sharing answers only',
    async () => {
      const s = await scenario();
      const bare = await createMission(s.db, {
        actorAccountId: s.owner.id,
        applicantId: s.applicantId,
        title: 'Manual case',
        manualMode: true,
      });
      if (!isOk(bare)) throw new Error('bare');
      const proof = await requireAccess(
        s.db,
        accountPrincipal(s.owner.id),
        'VIEW_METADATA',
        { missionId: bare.value.id },
        { purpose: 'owner_prepare_again' },
      );
      if (!isOk(proof)) throw new Error('proof');
      const p = await planPrepareAgain(proof.value);
      if (!isOk(p)) throw new Error('plan');
      expect(p.value).toMatchObject({ packVersion: null, checklistUnavailable: false, items: [] });
      const manage = await requireAccess(
        s.db,
        accountPrincipal(s.owner.id),
        'MANAGE',
        { missionId: bare.value.id },
        { purpose: 'owner_prepare_again' },
      );
      if (!isOk(manage)) throw new Error('manage');
      const created = await prepareCaseAgain(manage.value, {
        title: 'Manual case again',
        expectedPackVersionId: null,
        carry: [],
        sharing: { allowedGrantIds: [], allowedInvitationIds: [] },
      });
      if (!isOk(created)) throw new Error(`create: ${created.error.message}`);
      expect(created.value).toMatchObject({ manualMode: true, packVersionId: null });
      const seenByB = (await listMissionsForOrganization(s.db, s.b.organizationId)).map(
        (m) => m.missionId,
      );
      expect(seenByB).not.toContain(created.value.id);
    },
    HEAVY_TIMEOUT_MS,
  );
});
