import { randomBytes } from 'node:crypto';
import { isErr, isOk } from '@visastack/core';
import { TAX_BASIS } from '@visastack/core/catalogue';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { accountPrincipal, requireAccess } from './access';
import { provisionAccount } from './accounts';
import { decideAcknowledgement } from './acknowledgements';
import { createApplicant } from './applicants';
import {
  compareSnapshotDetail,
  getApplicationMemory,
  listChangesSinceConfirmed,
  listChangesSinceSnapshot,
} from './application-memory';
import { setConsent } from './consent';
import { compareAuthorizedFactVersions } from './consistency';
import type { Db } from './db';
import { addDocumentVersion, registerDocument } from './documents';
import {
  attachPackVersion,
  createMission,
  listCaseEvidenceIds,
  selectEvidence,
  snapshotMission,
  transitionMission,
  updateMissionCaseDetails,
} from './missions';
import { createOrganization, reviewOrganization } from './organizations';
import { recordOutcome } from './outcomes';
import {
  addPackVersion,
  addRequirement,
  approvePackVersion,
  createPack,
  publishPackVersion,
} from './packs';
import type { KeyManagementPort } from './ports';
import { editFact, registerFieldDefinition } from './profile';
import { resetProtectedFieldKeyCacheForTests } from './protected-fields';
import { acceptGrant, createGrant } from './sharing';
import { recordSubmission } from './submissions';
import { supersedeDocument } from './wallet';

/**
 * WP-V3 part 3: Application Memory (v1.2 B08 / U06) and the prior-versus-
 * current view (E03). Tests T10-T12, R05, R06 at service level.
 */

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, { schema }) as unknown as Db;
}

function fakeKeyManagementPort(keyVersion = 'test-v1'): KeyManagementPort {
  const masterKey = Buffer.alloc(32, 7);
  return {
    currentKeyVersion: () => keyVersion,
    async generateDataKey() {
      return { keyVersion, plaintextDataKey: randomBytes(32), wrappedDataKey: masterKey };
    },
    async unwrapDataKey(version) {
      if (version !== keyVersion) throw new Error(`unknown key version ${version}`);
      return masterKey;
    },
  };
}

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const encryption = fakeKeyManagementPort();

describe('Application Memory and prior versus current (WP-V3 part 3)', () => {
  let db: Db;

  beforeEach(async () => {
    db = await freshDb();
    resetProtectedFieldKeyCacheForTests();
    await registerFieldDefinition(db, {
      key: 'passport_number',
      dataType: 'string',
      sensitivity: 'SENSITIVE',
    });
    await registerFieldDefinition(db, { key: 'employer_name', dataType: 'string' });
    await registerFieldDefinition(db, { key: 'monthly_salary', dataType: 'string' });
    await registerFieldDefinition(db, { key: 'monthly_salary_currency', dataType: 'string' });
    await registerFieldDefinition(db, { key: 'monthly_salary_tax_basis', dataType: 'string' });
  });

  async function person(email: string) {
    const provisioned = await provisionAccount(db, { email });
    if (!isOk(provisioned)) throw new Error('provision failed');
    const accountId = provisioned.value.id;
    for (const type of ['CORE_PROCESSING', 'SHARING'] as const) {
      await setConsent(db, { actorAccountId: accountId, accountId, type, granted: true });
    }
    const applicant = await createApplicant(db, {
      actorAccountId: accountId,
      ownerAccountId: accountId,
      displayName: 'Self',
    });
    if (!isOk(applicant)) throw new Error('applicant failed');
    return { accountId, applicantId: applicant.value.id };
  }

  type Person = Awaited<ReturnType<typeof person>>;

  async function save(
    who: Person,
    fieldKey: string,
    value: string,
    extra: { effectiveFrom?: Date; reason?: string } = {},
  ) {
    const saved = await editFact(db, {
      actorAccountId: who.accountId,
      applicantId: who.applicantId,
      fieldKey,
      value,
      encryption,
      ...extra,
    });
    if (!isOk(saved)) throw new Error(`save failed: ${JSON.stringify(saved.error)}`);
    return saved.value.version;
  }

  /** A case with no requirement pack: its snapshot holds the whole record. */
  async function caseFor(who: Person, title = 'Japan visitor visa') {
    const mission = await createMission(db, {
      actorAccountId: who.accountId,
      applicantId: who.applicantId,
      title,
      destination: 'Japan',
      purpose: 'Tourism',
    });
    if (!isOk(mission)) throw new Error('mission failed');
    return mission.value.id;
  }

  async function snapshot(who: Person, missionId: string) {
    const snap = await snapshotMission(db, { actorAccountId: who.accountId, missionId });
    if (!isOk(snap)) throw new Error('snapshot failed');
    return snap.value;
  }

  async function confirm(who: Person, missionId: string, snap: { id: string; checksum: string }) {
    const decided = await decideAcknowledgement(db, {
      actorAccountId: who.accountId,
      missionId,
      snapshotId: snap.id,
      expectedSnapshotChecksum: snap.checksum,
      decision: 'ACKNOWLEDGED',
      stepUpSatisfied: true,
    });
    if (!isOk(decided)) throw new Error(`acknowledge failed: ${JSON.stringify(decided.error)}`);
    return decided.value;
  }

  async function view(who: Person, ref: { applicantId: string } | { missionId: string }) {
    const proof = await requireAccess(db, accountPrincipal(who.accountId), 'VIEW_METADATA', ref, {
      purpose: 'application_memory',
    });
    if (!isOk(proof)) throw new Error(`gate refused: ${JSON.stringify(proof.error)}`);
    return proof.value;
  }

  async function manage(who: Person) {
    const proof = await requireAccess(
      db,
      accountPrincipal(who.accountId),
      'MANAGE',
      { applicantId: who.applicantId },
      { purpose: 'application_memory' },
    );
    if (!isOk(proof)) throw new Error(`gate refused: ${JSON.stringify(proof.error)}`);
    return proof.value;
  }

  it('lists prepared, confirmed, shared, reported-submitted and decided records as distinct events (B08, T12)', async () => {
    const me = await person('memory@example.com');
    await save(me, 'employer_name', 'Acme Ltd');
    const missionId = await caseFor(me);
    const first = await snapshot(me, missionId);
    await confirm(me, missionId, first);

    const agent = await provisionAccount(db, { email: 'memory-agent@example.com' });
    if (!isOk(agent)) throw new Error('provision');
    const org = await createOrganization(db, {
      actorAccountId: agent.value.id,
      name: 'Harbor Visas',
    });
    if (!isOk(org)) throw new Error('org');
    const admin = await provisionAccount(db, { email: 'memory-admin@example.com' });
    if (!isOk(admin)) throw new Error('provision');
    await reviewOrganization(db, {
      reviewerAccountId: admin.value.id,
      organizationId: org.value.id,
      decision: 'ACTIVE',
      stepUpSatisfied: true,
    });
    const grant = await createGrant(db, {
      actorAccountId: me.accountId,
      applicantId: me.applicantId,
      recipientOrganizationId: org.value.id,
      missionId,
      actions: ['VIEW_METADATA'],
      purpose: 'case_management',
    });
    if (!isOk(grant)) throw new Error('grant');
    // A share of the whole record, not tied to the case.
    const wholeRecord = await createGrant(db, {
      actorAccountId: me.accountId,
      applicantId: me.applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['VIEW_METADATA'],
      purpose: 'record_review',
    });
    if (!isOk(wholeRecord)) throw new Error('record grant');

    for (const to of ['INTAKE', 'IN_REVIEW', 'AWAITING_APPLICANT', 'SUBMISSION_READY'] as const) {
      const moved = await transitionMission(db, { actorAccountId: me.accountId, missionId, to });
      if (!isOk(moved)) throw new Error(`transition ${to}: ${JSON.stringify(moved.error)}`);
    }
    const submitted = await recordSubmission(db, {
      actorAccountId: me.accountId,
      missionId,
      channel: 'EMAIL',
      externalReportDescription: 'Sent from my own email',
      submittedAt: day('2026-10-01'),
      stepUpSatisfied: true,
    });
    if (!isOk(submitted)) throw new Error(`submission: ${JSON.stringify(submitted.error)}`);
    const decided = await recordOutcome(db, {
      actorAccountId: me.accountId,
      missionId,
      decision: 'APPROVED',
      decisionDate: day('2026-10-20'),
      stepUpSatisfied: true,
    });
    if (!isOk(decided)) throw new Error(`outcome: ${JSON.stringify(decided.error)}`);

    const memory = await getApplicationMemory(await view(me, { applicantId: me.applicantId }));
    expect(isOk(memory)).toBe(true);
    if (!isOk(memory)) return;
    expect(memory.value.cases).toHaveLength(1);
    const [only] = memory.value.cases;
    expect(only).toMatchObject({
      missionId,
      title: 'Japan visitor visa',
      destination: 'Japan',
      purpose: 'Tourism',
      removed: false,
    });
    const kinds = only?.events.map((e) => e.kind) ?? [];
    expect(new Set(kinds)).toEqual(
      new Set(['prepared', 'confirmed', 'shared', 'reported_submitted', 'outcome']),
    );
    const reported = only?.events.find((e) => e.kind === 'reported_submitted');
    expect(reported).toMatchObject({
      at: '2026-10-01T00:00:00.000Z',
      snapshotId: first.id,
      snapshotVersion: 1,
      channel: 'EMAIL',
    });
    // The whole-record share is listed once, on its own, never inside a case.
    expect(memory.value.recordShares).toEqual([
      expect.objectContaining({ id: wholeRecord.value.id, recipientName: 'Harbor Visas' }),
    ]);
    expect(only?.events.filter((e) => e.kind === 'shared')).toHaveLength(1);
    const ids = only?.events.map((e) => `${e.kind}:${e.id}`) ?? [];
    expect(new Set(ids).size).toBe(ids.length);
    expect(only?.events.find((e) => e.kind === 'shared')).toMatchObject({
      recipientName: 'Harbor Visas',
      recipientKind: 'organization',
      status: 'PENDING_ACCEPTANCE',
    });
    // Oldest first, by the date each record carries.
    const times = only?.events.map((e) => Date.parse(e.at)) ?? [];
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    // No free text reaches the timeline.
    expect(JSON.stringify(memory.value)).not.toContain('Sent from my own email');
  }, 60_000);

  it('names what changed since the last confirmation, never the values, and keeps the snapshot exact (U04, T12)', async () => {
    const me = await person('changes@example.com');
    const employer = await save(me, 'employer_name', 'Acme Ltd');
    const passport = await save(me, 'passport_number', 'A1234567', {
      effectiveFrom: day('2018-03-01'),
    });
    const doc = await registerDocument(db, {
      actorAccountId: me.accountId,
      applicantId: me.applicantId,
      originalName: 'bank.pdf',
      docType: 'bank_statement',
    });
    if (!isOk(doc)) throw new Error('doc');
    await addDocumentVersion(db, {
      actorAccountId: me.accountId,
      documentId: doc.value.id,
      bucket: 'CLEAN',
      objectKey: 'k1',
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });
    const missionId = await caseFor(me);
    const snap = await snapshot(me, missionId);
    await confirm(me, missionId, snap);
    const [before] = await db
      .select()
      .from(schema.missionSnapshots)
      .where(eq(schema.missionSnapshots.id, snap.id));

    // Nothing changed yet.
    const quiet = await listChangesSinceConfirmed(await view(me, { missionId }));
    expect(isOk(quiet) && quiet.value?.changes).toEqual([]);
    expect(isOk(quiet) && quiet.value?.unchangedDetailCount).toBe(2);

    const renewed = await save(me, 'passport_number', 'B7654321', {
      effectiveFrom: day('2024-02-10'),
      reason: 'Renewed',
    });
    await save(me, 'monthly_salary', '90000');
    await addDocumentVersion(db, {
      actorAccountId: me.accountId,
      documentId: doc.value.id,
      bucket: 'CLEAN',
      objectKey: 'k2',
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });
    const details = await updateMissionCaseDetails(db, {
      actorAccountId: me.accountId,
      missionId,
      travelStartDate: day('2026-12-01'),
    });
    if (!isOk(details)) throw new Error(`details: ${JSON.stringify(details.error)}`);

    const listed = await listChangesSinceConfirmed(await view(me, { missionId }));
    expect(isOk(listed)).toBe(true);
    if (!isOk(listed) || !listed.value) return;
    expect(listed.value.snapshot).toMatchObject({ id: snap.id, version: 1, exact: true });
    expect(listed.value.review.setAsideAt).not.toBeNull();
    expect(listed.value.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'detail',
          change: 'changed',
          fieldKey: 'passport_number',
          priorFactVersionId: passport.id,
          currentFactVersionId: renewed.id,
        }),
        expect.objectContaining({ kind: 'detail', change: 'added', fieldKey: 'monthly_salary' }),
        expect.objectContaining({
          kind: 'document',
          change: 'new_version',
          documentId: doc.value.id,
          docType: 'bank_statement',
        }),
        expect.objectContaining({ kind: 'case', caseField: 'travelStartDate' }),
      ]),
    );
    expect(listed.value.changes).not.toContainEqual(
      expect.objectContaining({ fieldKey: 'employer_name' }),
    );
    expect(listed.value.unchangedDetailCount).toBe(1);
    expect(employer.id).toBeTruthy();
    expect(JSON.stringify(listed.value)).not.toMatch(/A1234567|B7654321|90000/);

    // The snapshot row is byte-for-byte what it was.
    const [after] = await db
      .select()
      .from(schema.missionSnapshots)
      .where(eq(schema.missionSnapshots.id, snap.id));
    expect(after).toEqual(before);
  }, 60_000);

  it('a case never confirmed has no list; an older snapshot without exact versions says so (R05)', async () => {
    const me = await person('legacy@example.com');
    await save(me, 'employer_name', 'Acme Ltd');
    const missionId = await caseFor(me);
    const none = await listChangesSinceConfirmed(await view(me, { missionId }));
    expect(isOk(none) && none.value).toBeNull();

    const snap = await snapshot(me, missionId);
    // The pre-PR-10 shape: a field-to-value map with no version ids.
    await db
      .update(schema.missionSnapshots)
      .set({ content: { facts: { employer_name: 'Acme Ltd' }, documents: [] } })
      .where(eq(schema.missionSnapshots.id, snap.id));
    const legacy = await listChangesSinceSnapshot(
      await view(me, { applicantId: me.applicantId }),
      snap.id,
    );
    expect(isOk(legacy) && legacy.value.snapshot.exact).toBe(false);
    expect(isOk(legacy) && legacy.value.changes).toEqual([]);
  }, 60_000);

  it('compares a detail exactly as the snapshot recorded it with now, in the fixed vocabulary (E03, T10, R05)', async () => {
    const me = await person('compare@example.com');
    await save(me, 'monthly_salary_currency', 'BDT');
    await save(me, 'monthly_salary_tax_basis', TAX_BASIS.before);
    const salary = await save(me, 'monthly_salary', '80000', { effectiveFrom: day('2023-01-01') });
    const passport = await save(me, 'passport_number', 'A1234567', {
      effectiveFrom: day('2018-03-01'),
    });
    const employer = await save(me, 'employer_name', 'Acme Ltd');
    const missionId = await caseFor(me);
    const snap = await snapshot(me, missionId);
    await confirm(me, missionId, snap);

    await save(me, 'monthly_salary', '95000', { effectiveFrom: day('2025-01-01') });
    await save(me, 'passport_number', 'B7654321', {
      effectiveFrom: day('2024-02-10'),
      reason: 'Renewed at the passport office',
    });
    await save(me, 'employer_name', 'Beta Ltd', { reason: 'Changed jobs' });

    const proof = await manage(me);
    const raise = await compareSnapshotDetail(proof, {
      snapshotId: snap.id,
      factVersionId: salary.id,
      encryption,
    });
    expect(isOk(raise)).toBe(true);
    if (!isOk(raise)) return;
    expect(raise.value.valuesHidden).toBe(false);
    expect(raise.value.snapshot).toMatchObject({ id: snap.id, missionId, version: 1 });
    expect(raise.value.comparison).toMatchObject({
      result: 'LEGITIMATE_CHANGE',
      label: 'Legitimate change',
      prior: {
        factVersionId: salary.id,
        value: '80000',
        effectiveFrom: '2023-01-01T00:00:00.000Z',
      },
      current: { value: '95000', effectiveFrom: '2025-01-01T00:00:00.000Z' },
    });

    // A protected detail: the kind of difference, never the values.
    const renewal = await compareSnapshotDetail(proof, {
      snapshotId: snap.id,
      factVersionId: passport.id,
      encryption,
    });
    expect(isOk(renewal)).toBe(true);
    if (!isOk(renewal)) return;
    expect(renewal.value.valuesHidden).toBe(true);
    expect(renewal.value.comparison.result).toBe('LEGITIMATE_CHANGE');
    expect(renewal.value.comparison.prior.value).toBeNull();
    expect(renewal.value.comparison.current.value).toBeNull();
    // The note can repeat the value, so it is hidden with it; only that a note exists is said.
    expect(renewal.value.comparison.current.explanation).toBeNull();
    expect(renewal.value.notesSaved).toEqual({ prior: false, current: true });
    expect(JSON.stringify(renewal.value)).not.toMatch(
      /A1234567|B7654321|Renewed at the passport office/,
    );

    // A protected value with no key service: refused, never compared as blank.
    const noKeys = await compareSnapshotDetail(proof, {
      snapshotId: snap.id,
      factVersionId: passport.id,
    });
    expect(isErr(noKeys) && noKeys.error.code).toBe('encryption_unavailable');

    // No dates: insufficient information, and the note does not change that.
    const job = await compareSnapshotDetail(proof, {
      snapshotId: snap.id,
      factVersionId: employer.id,
      encryption,
    });
    expect(isOk(job) && job.value.comparison.result).toBe('INSUFFICIENT_INFORMATION');
    expect(isOk(job) && job.value.comparison.current.explanation).toBe('Changed jobs');
    expect(isOk(job) && job.value.review.confirmedAt).not.toBeNull();
  }, 60_000);

  it('a same-date conflict stays Needs clarification after a note, and a later confirmation is shown, not used to clear it (T11)', async () => {
    const me = await person('conflict@example.com');
    const first = await save(me, 'employer_name', 'Acme Ltd', { effectiveFrom: day('2024-01-01') });
    const missionId = await caseFor(me);
    const snap = await snapshot(me, missionId);
    await confirm(me, missionId, snap);
    await save(me, 'employer_name', 'Acme Limited Group', {
      effectiveFrom: day('2024-01-01'),
      reason: 'The first name was wrong',
    });
    const second = await snapshot(me, missionId);
    await confirm(me, missionId, second);

    const compared = await compareSnapshotDetail(await manage(me), {
      snapshotId: snap.id,
      factVersionId: first.id,
    });
    expect(isOk(compared)).toBe(true);
    if (!isOk(compared)) return;
    expect(compared.value.comparison.result).toBe('NEEDS_CLARIFICATION');
    expect(compared.value.comparison.current.explanation).toBe('The first name was wrong');
    expect(compared.value.review.laterConfirmation).toMatchObject({ snapshotVersion: 2 });
  }, 60_000);

  it('refuses a version the snapshot did not record, and another person’s snapshot, with one answer (R06)', async () => {
    const me = await person('owner@example.com');
    const other = await person('other@example.com');
    const recorded = await save(me, 'employer_name', 'Acme Ltd');
    const missionId = await caseFor(me);
    const snap = await snapshot(me, missionId);
    const later = await save(me, 'employer_name', 'Beta Ltd');
    const theirs = await save(other, 'employer_name', 'Gamma Ltd');
    const theirMission = await caseFor(other);
    const theirSnap = await snapshot(other, theirMission);

    const proof = await manage(me);
    for (const input of [
      { snapshotId: snap.id, factVersionId: later.id },
      { snapshotId: snap.id, factVersionId: theirs.id },
      { snapshotId: theirSnap.id, factVersionId: theirs.id },
      { snapshotId: 'not-a-uuid', factVersionId: recorded.id },
    ]) {
      const refused = await compareSnapshotDetail(proof, input);
      expect(isErr(refused) && refused.error.code).toBe('not_found');
    }
    const foreign = await listChangesSinceSnapshot(
      await view(me, { applicantId: me.applicantId }),
      theirSnap.id,
    );
    expect(isErr(foreign) && foreign.error.code).toBe('not_found');
    // A snapshot of another of my cases is refused through a proof for this case.
    const secondCase = await caseFor(me, 'Second case');
    const secondSnap = await snapshot(me, secondCase);
    const wrongCase = await listChangesSinceSnapshot(await view(me, { missionId }), secondSnap.id);
    expect(isErr(wrongCase) && wrongCase.error.code).toBe('not_found');
  }, 60_000);

  it('stays owner only: a recipient the gate lets in still cannot read the history or compare (R06)', async () => {
    const me = await person('shared-owner@example.com');
    const recorded = await save(me, 'employer_name', 'Acme Ltd');
    const missionId = await caseFor(me);
    const snap = await snapshot(me, missionId);

    const agent = await provisionAccount(db, { email: 'shared-agent@example.com' });
    if (!isOk(agent)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agent.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    const admin = await provisionAccount(db, { email: 'shared-admin@example.com' });
    if (!isOk(admin)) throw new Error('provision');
    await reviewOrganization(db, {
      reviewerAccountId: admin.value.id,
      organizationId: org.value.id,
      decision: 'ACTIVE',
      stepUpSatisfied: true,
    });
    const grant = await createGrant(db, {
      actorAccountId: me.accountId,
      applicantId: me.applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['VIEW_METADATA', 'MANAGE'],
      purpose: 'case_management',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agent.value.id, grantId: grant.value.id });

    const principal = accountPrincipal(agent.value.id);
    const viewProof = await requireAccess(
      db,
      principal,
      'VIEW_METADATA',
      { applicantId: me.applicantId },
      { purpose: 'case_management' },
    );
    const manageProof = await requireAccess(
      db,
      principal,
      'MANAGE',
      { applicantId: me.applicantId },
      { purpose: 'case_management' },
    );
    // The gate itself allows the grant; the history stays the owner's.
    expect(isOk(viewProof) && isOk(manageProof)).toBe(true);
    if (!isOk(viewProof) || !isOk(manageProof)) return;
    const memory = await getApplicationMemory(viewProof.value);
    expect(isErr(memory) && memory.error.code).toBe('forbidden');
    const changes = await listChangesSinceSnapshot(viewProof.value, snap.id);
    expect(isErr(changes) && changes.error.code).toBe('forbidden');
    const compared = await compareSnapshotDetail(manageProof.value, {
      snapshotId: snap.id,
      factVersionId: recorded.id,
    });
    expect(isErr(compared) && compared.error.code).toBe('forbidden');
    // What the case uses is owner only too, and a case proof reaches that case alone.
    const evidence = await listCaseEvidenceIds(viewProof.value, missionId);
    expect(isErr(evidence) && evidence.error.code).toBe('forbidden');
    const otherCase = await caseFor(me, 'Other case');
    const scoped = await listCaseEvidenceIds(await view(me, { missionId }), otherCase);
    expect(isErr(scoped) && scoped.error.code).toBe('not_found');
    const own = await listCaseEvidenceIds(
      await view(me, { applicantId: me.applicantId }),
      otherCase,
    );
    expect(isOk(own)).toBe(true);
    // The gated comparison itself refuses a non-owner proof and records the refusal.
    const direct = await compareAuthorizedFactVersions(manageProof.value, {
      priorFactVersionId: recorded.id,
    });
    expect(isErr(direct) && direct.error.code).toBe('forbidden');
    const denied = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'DECLARATION_COMPARISON_DENIED'));
    expect(denied).toHaveLength(1);
    expect(denied[0]?.actorAccountId).toBe(agent.value.id);

    // A spread copy of a genuine owner proof is not a proof.
    const ownerProof = await view(me, { applicantId: me.applicantId });
    const copy = { ...ownerProof } as typeof ownerProof;
    const forged = await getApplicationMemory(copy);
    expect(isErr(forged) && forged.error.code).toBe('forbidden');
  }, 60_000);

  async function addDocument(who: Person, name: string, docType = 'bank_statement') {
    const doc = await registerDocument(db, {
      actorAccountId: who.accountId,
      applicantId: who.applicantId,
      originalName: name,
      docType,
    });
    if (!isOk(doc)) throw new Error('doc');
    await addDocumentVersion(db, {
      actorAccountId: who.accountId,
      documentId: doc.value.id,
      bucket: 'CLEAN',
      objectKey: `${name}-1`,
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });
    return doc.value.id;
  }

  /** A case on a published pack asking for passport.number and a bank statement. */
  async function packCase(who: Person) {
    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    const pack = await createPack(db, {
      actorAccountId: who.accountId,
      key: 'memory.pack',
      name: 'Memory Pack',
    });
    if (!isOk(pack)) throw new Error('pack');
    const version = await addPackVersion(db, {
      actorAccountId: who.accountId,
      packId: pack.value.id,
    });
    if (!isOk(version)) throw new Error('version');
    await addRequirement(db, {
      actorAccountId: who.accountId,
      packVersionId: version.value.id,
      kind: 'FIELD',
      fieldKey: 'passport.number',
      citation: 'rule 1',
    });
    await addRequirement(db, {
      actorAccountId: who.accountId,
      packVersionId: version.value.id,
      kind: 'DOCUMENT',
      docType: 'bank_statement',
      citation: 'rule 2',
    });
    await approvePackVersion(db, {
      actorAccountId: who.accountId,
      packVersionId: version.value.id,
    });
    await publishPackVersion(db, {
      actorAccountId: who.accountId,
      packVersionId: version.value.id,
    });
    const missionId = await caseFor(who);
    await attachPackVersion(db, {
      actorAccountId: who.accountId,
      missionId,
      packVersionId: version.value.id,
    });
    const requirements = await db
      .select()
      .from(schema.packRequirements)
      .where(eq(schema.packRequirements.packVersionId, version.value.id));
    const documentRequirement = requirements.find((r) => r.kind === 'DOCUMENT');
    if (!documentRequirement) throw new Error('requirement');
    return { missionId, documentRequirementId: documentRequirement.id };
  }

  it('a new candidate with no explicit choice counts as added, by the same rule the snapshot uses (U04)', async () => {
    const me = await person('candidate@example.com');
    const { missionId } = await packCase(me);
    const firstStatement = await addDocument(me, 'bank-1.pdf');
    await addDocument(me, 'payslip.pdf', 'payslip');
    const snap = await snapshot(me, missionId);
    const quiet = await listChangesSinceSnapshot(await view(me, { missionId }), snap.id);
    expect(isOk(quiet) && quiet.value.changes).toEqual([]);

    // Neither is chosen explicitly: both become candidates for the case's requirements.
    await save(me, 'passport.number', 'A1');
    const secondStatement = await addDocument(me, 'bank-2.pdf');
    const listed = await listChangesSinceSnapshot(await view(me, { missionId }), snap.id);
    expect(isOk(listed)).toBe(true);
    if (!isOk(listed)) return;
    expect(listed.value.changes).toEqual([
      expect.objectContaining({ kind: 'detail', change: 'added', fieldKey: 'passport.number' }),
      expect.objectContaining({ kind: 'document', change: 'added', documentId: secondStatement }),
    ]);
    // A document the requirements do not ask for was never in the case.
    expect(JSON.stringify(listed.value.changes)).not.toContain('payslip');
    expect(firstStatement).toBeTruthy();
  }, 60_000);

  it('narrowing the choice to one document reports the other as no longer used (U04)', async () => {
    const me = await person('narrowed@example.com');
    const { missionId, documentRequirementId } = await packCase(me);
    const kept = await addDocument(me, 'bank-1.pdf');
    const dropped = await addDocument(me, 'bank-2.pdf');
    const snap = await snapshot(me, missionId);
    const chosen = await selectEvidence(db, {
      actorAccountId: me.accountId,
      missionId,
      packRequirementId: documentRequirementId,
      documentId: kept,
    });
    if (!isOk(chosen)) throw new Error(`select: ${JSON.stringify(chosen.error)}`);
    const listed = await listChangesSinceSnapshot(await view(me, { missionId }), snap.id);
    expect(isOk(listed) && listed.value.changes).toEqual([
      { kind: 'document', change: 'not_used', documentId: dropped, docType: 'bank_statement' },
    ]);
  }, 60_000);

  it('names a replaced, deleted or refused document, a removed detail and a changed case setting (U04)', async () => {
    const me = await person('removals@example.com');
    const gone = await save(me, 'employer_name', 'Acme Ltd');
    const replaced = await addDocument(me, 'old-statement.pdf');
    const deleted = await addDocument(me, 'deleted.pdf', 'payslip');
    const refused = await addDocument(me, 'refused.pdf', 'tax_return');
    const missionId = await caseFor(me);
    const snap = await snapshot(me, missionId);

    const replacement = await addDocument(me, 'new-statement.pdf');
    const superseded = await supersedeDocument(db, {
      actorAccountId: me.accountId,
      oldDocumentId: replaced,
      newDocumentId: replacement,
    });
    if (!isOk(superseded)) throw new Error(`supersede: ${JSON.stringify(superseded.error)}`);
    await db.delete(schema.documents).where(eq(schema.documents.id, deleted));
    await db
      .update(schema.documentVersions)
      .set({ processingStatus: 'REJECTED' })
      .where(eq(schema.documentVersions.documentId, refused));
    await db.delete(schema.facts).where(eq(schema.facts.id, gone.factId));
    const details = await updateMissionCaseDetails(db, {
      actorAccountId: me.accountId,
      missionId,
      jurisdiction: 'Embassy of Japan, Dhaka',
      manualMode: true,
    });
    if (!isOk(details)) throw new Error(`details: ${JSON.stringify(details.error)}`);

    const listed = await listChangesSinceSnapshot(await view(me, { missionId }), snap.id);
    expect(isOk(listed)).toBe(true);
    if (!isOk(listed)) return;
    const changes = listed.value.changes;
    expect(changes).toContainEqual(
      expect.objectContaining({ kind: 'detail', change: 'removed', fieldKey: 'employer_name' }),
    );
    expect(changes).toContainEqual(
      expect.objectContaining({ kind: 'document', change: 'replaced', documentId: replaced }),
    );
    // Gone for good reads as deleted once the lifecycle tables exist (LC-Z); before, as removed.
    expect(changes).toContainEqual(
      expect.objectContaining({ kind: 'document', change: 'deleted', documentId: deleted }),
    );
    expect(changes).toContainEqual(
      expect.objectContaining({ kind: 'document', change: 'removed', documentId: refused }),
    );
    // The replacement is named once, through the document it replaced.
    expect(changes).not.toContainEqual(expect.objectContaining({ documentId: replacement }));
    expect(changes).toContainEqual({ kind: 'case', change: 'changed', caseField: 'jurisdiction' });
    expect(changes).toContainEqual({ kind: 'case', change: 'changed', caseField: 'manualMode' });
    expect(changes).not.toContainEqual(expect.objectContaining({ caseField: 'travelStartDate' }));
  }, 60_000);

  it('says a document in Recently Deleted, being removed or gone for good was deleted, and never says so of an archived one (LC-Z)', async () => {
    const me = await person('deleted-history@example.com');
    const binned = await addDocument(me, 'binned.pdf', 'payslip');
    const going = await addDocument(me, 'going.pdf', 'tax_return');
    const gone = await addDocument(me, 'gone.pdf', 'bank_statement');
    const shelved = await addDocument(me, 'shelved.pdf', 'utility_bill');
    const missionId = await caseFor(me);
    const snap = await snapshot(me, missionId);
    const quiet = await listChangesSinceSnapshot(await view(me, { missionId }), snap.id);
    expect(isOk(quiet) && quiet.value.changes).toEqual([]);

    const now = new Date();
    await db.insert(schema.documentLifecycle).values([
      {
        documentId: binned,
        applicantId: me.applicantId,
        deletedAt: now,
        deletePath: 'DUPLICATE',
        purgeAfter: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      },
      {
        documentId: going,
        applicantId: me.applicantId,
        deletedAt: now,
        deletePath: 'REQUEST',
        purgeAfter: now,
      },
      { documentId: shelved, applicantId: me.applicantId, archivedAt: now },
    ]);
    await db.delete(schema.documents).where(eq(schema.documents.id, gone));

    const listed = await listChangesSinceSnapshot(await view(me, { missionId }), snap.id);
    expect(isOk(listed)).toBe(true);
    if (!isOk(listed)) return;
    const documentChanges = listed.value.changes.filter((c) => c.kind === 'document');
    expect(documentChanges).toEqual(
      expect.arrayContaining([
        { kind: 'document', change: 'deleted', documentId: binned, docType: 'payslip' },
        { kind: 'document', change: 'deleted', documentId: going, docType: 'tax_return' },
        { kind: 'document', change: 'deleted', documentId: gone, docType: 'bank_statement' },
      ]),
    );
    // An archived document is never called deleted: it simply stops being matched automatically
    // (it was not chosen by hand), so it reads as no longer used, as before.
    expect(documentChanges).toContainEqual({
      kind: 'document',
      change: 'not_used',
      documentId: shelved,
      docType: 'utility_bill',
    });
    expect(documentChanges).toHaveLength(4);
  }, 60_000);

  it('lists the replacement as added when the replaced document was then deleted (LC-Z review)', async () => {
    const me = await person('replaced-then-deleted@example.com');
    const old = await addDocument(me, 'old.pdf', 'payslip');
    const missionId = await caseFor(me);
    const snap = await snapshot(me, missionId);
    const newer = await addDocument(me, 'newer.pdf', 'payslip');
    await db
      .update(schema.documents)
      .set({ supersededByDocumentId: newer })
      .where(eq(schema.documents.id, old));
    const now = new Date();
    await db.insert(schema.documentLifecycle).values({
      documentId: old,
      applicantId: me.applicantId,
      deletedAt: now,
      deletePath: 'DUPLICATE',
      purgeAfter: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    });
    const listed = await listChangesSinceSnapshot(await view(me, { missionId }), snap.id);
    if (!isOk(listed)) throw new Error('listed');
    const documentChanges = listed.value.changes.filter((c) => c.kind === 'document');
    expect(documentChanges).toContainEqual({
      kind: 'document',
      change: 'deleted',
      documentId: old,
      docType: 'payslip',
    });
    expect(documentChanges).toContainEqual({
      kind: 'document',
      change: 'added',
      documentId: newer,
      docType: 'payslip',
    });
  }, 60_000);

  it('works exactly as before with the lifecycle tables missing: a gone document is no longer available (LC-Z)', async () => {
    const client = await createMigratedPglite();
    await client.exec(
      'drop table document_removal_requests, document_lifecycle, applicant_lifecycle, deletion_receipts cascade',
    );
    db = drizzle(client, { schema }) as unknown as Db;
    const me = await person('deleted-history-before@example.com');
    const gone = await addDocument(me, 'gone.pdf', 'payslip');
    const kept = await addDocument(me, 'kept.pdf');
    const missionId = await caseFor(me);
    const snap = await snapshot(me, missionId);
    await db.delete(schema.documents).where(eq(schema.documents.id, gone));
    const listed = await listChangesSinceSnapshot(await view(me, { missionId }), snap.id);
    expect(isOk(listed) && listed.value.changes).toEqual([
      { kind: 'document', change: 'removed', documentId: gone, docType: 'payslip' },
    ]);
    expect(kept).toBeTruthy();
  }, 60_000);
});

describe('Case History limited read (WP-SB1)', () => {
  let db: Db;

  beforeEach(async () => {
    db = await freshDb();
  });

  async function person(email: string) {
    const provisioned = await provisionAccount(db, { email });
    if (!isOk(provisioned)) throw new Error('provision failed');
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
      displayName: 'Self',
    });
    if (!isOk(applicant)) throw new Error('applicant failed');
    return { accountId, applicantId: applicant.value.id };
  }

  async function cases(who: { accountId: string; applicantId: string }, howMany: number) {
    const ids: string[] = [];
    for (let i = 0; i < howMany; i += 1) {
      const mission = await createMission(db, {
        actorAccountId: who.accountId,
        applicantId: who.applicantId,
        title: `Case ${i + 1}`,
        destination: 'Japan',
        purpose: 'Tourism',
      });
      if (!isOk(mission)) throw new Error('mission failed');
      ids.push(mission.value.id);
    }
    return ids;
  }

  async function proofFor(who: { accountId: string; applicantId: string }) {
    const proof = await requireAccess(
      db,
      accountPrincipal(who.accountId),
      'VIEW_METADATA',
      { applicantId: who.applicantId },
      { purpose: 'application_memory' },
    );
    if (!isOk(proof)) throw new Error('gate refused');
    return proof.value;
  }

  it('reads only the most recently active cases, in the order the full read gives them', async () => {
    const ana = await person('ana-sb1@example.test');
    const ids = await cases(ana, 12);
    // The oldest case gets the latest record, so it becomes the most recently active.
    const snap = await snapshotMission(db, {
      actorAccountId: ana.accountId,
      missionId: ids[0] ?? '',
    });
    if (!isOk(snap)) throw new Error('snapshot failed');

    const full = await getApplicationMemory(await proofFor(ana));
    const limited = await getApplicationMemory(await proofFor(ana), { limit: 10 });
    if (!isOk(full) || !isOk(limited)) throw new Error('read failed');

    expect(full.value.cases).toHaveLength(12);
    expect(full.value.totalCases).toBeUndefined();
    expect(limited.value.cases).toHaveLength(10);
    expect(limited.value.totalCases).toBe(12);
    expect(limited.value.cases[0]?.missionId).toBe(ids[0]);
    expect(limited.value.cases[0]?.events.map((e) => e.kind)).toEqual(['prepared']);
    expect(limited.value.cases.map((c) => c.missionId)).toEqual(
      full.value.cases.slice(0, 10).map((c) => c.missionId),
    );
  });

  it("never counts or returns another person's cases, and clamps the limit", async () => {
    const ana = await person('ana-sb1b@example.test');
    const ben = await person('ben-sb1b@example.test');
    await cases(ana, 2);
    const bens = await cases(ben, 3);

    const limited = await getApplicationMemory(await proofFor(ana), { limit: 0 });
    if (!isOk(limited)) throw new Error('read failed');
    expect(limited.value.totalCases).toBe(2);
    expect(limited.value.cases).toHaveLength(1);
    expect(limited.value.cases.some((c) => bens.includes(c.missionId))).toBe(false);

    const none = await person('cy-sb1b@example.test');
    const empty = await getApplicationMemory(await proofFor(none), { limit: 10 });
    if (!isOk(empty)) throw new Error('read failed');
    expect(empty.value).toEqual({ recordShares: [], cases: [], totalCases: 0 });
  });
});
