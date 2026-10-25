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
  createMission,
  snapshotMission,
  transitionMission,
  updateMissionCaseDetails,
} from './missions';
import { createOrganization, reviewOrganization } from './organizations';
import { recordOutcome } from './outcomes';
import type { KeyManagementPort } from './ports';
import { editFact, registerFieldDefinition } from './profile';
import { resetProtectedFieldKeyCacheForTests } from './protected-fields';
import { acceptGrant, createGrant } from './sharing';
import { recordSubmission } from './submissions';

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
    expect(renewal.value.comparison.current.explanation).toBe('Renewed at the passport office');
    expect(JSON.stringify(renewal.value)).not.toMatch(/A1234567|B7654321/);

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
});
