import { type MissionState, isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { decideAcknowledgement } from './acknowledgements';
import { addFamilyMember, createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { addDocumentVersion, registerDocument, setDocumentDate } from './documents';
import { enqueueErasureJob } from './erasure';
import {
  attachPackVersion,
  computeReadiness,
  createAppointment,
  createMission,
  createTask,
  decideAppointment,
  decideTask,
  generateCoverLetter,
  getAppointment,
  getEvidenceCandidates,
  getMissionForOwner,
  getMissionSnapshot,
  legalTransitions,
  listAppointments,
  listGeneratedOutputs,
  listMissionSnapshots,
  listMissions,
  listMissionsByItineraryRef,
  listMissionsByPackVersion,
  listMissionsUsingField,
  listSelectedEvidence,
  listSelectedEvidenceForOrg,
  listTasks,
  selectEvidence,
  setMissionItineraryRef,
  snapshotMission,
  transitionMission,
  unselectEvidence,
  updateAppointment,
  updateMissionCaseDetails,
  updateTask,
} from './missions';
import { enqueueNotificationBothChannels } from './notifications';
import { createOrganization, reviewOrganization } from './organizations';
import {
  addPackVersion,
  addRequirement,
  approvePackVersion,
  createPack,
  listPublishedPackVersions,
  listRequirements,
  publishPackVersion,
} from './packs';
import { recordProductEvent } from './product-events';
import { editFact, registerFieldDefinition } from './profile';
import { CASE_TRAVEL_END_KEY, CASE_TRAVEL_START_KEY } from './rule-conditions';
import { acceptGrant, createGrant } from './sharing';

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  const db = drizzle(client, { schema });
  return db as unknown as Db;
}

async function seed(db: Db) {
  const p = await provisionAccount(db, { email: 'm@example.com' });
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

/** A published pack requiring passport.number (FIELD) + bank_statement (DOCUMENT). */
async function publishedPack(db: Db, actor: string): Promise<string> {
  const pack = await createPack(db, {
    actorAccountId: actor,
    key: 'uk.tourist',
    name: 'UK Tourist',
  });
  if (!isOk(pack)) throw new Error('pack');
  const version = await addPackVersion(db, { actorAccountId: actor, packId: pack.value.id });
  if (!isOk(version)) throw new Error('version');
  await addRequirement(db, {
    actorAccountId: actor,
    packVersionId: version.value.id,
    kind: 'FIELD',
    fieldKey: 'passport.number',
    citation: 'rule 1',
  });
  await addRequirement(db, {
    actorAccountId: actor,
    packVersionId: version.value.id,
    kind: 'DOCUMENT',
    docType: 'bank_statement',
    citation: 'rule 2',
  });
  await approvePackVersion(db, { actorAccountId: actor, packVersionId: version.value.id });
  await publishPackVersion(db, { actorAccountId: actor, packVersionId: version.value.id });
  return version.value.id;
}

describe('missions — workspace, readiness, workflow, snapshot', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('only attaches a PUBLISHED pack version', async () => {
    const { account, applicantId } = await seed(db);
    const pack = await createPack(db, { actorAccountId: account.id, key: 'p', name: 'P' });
    if (!isOk(pack)) throw new Error('pack');
    const draft = await addPackVersion(db, { actorAccountId: account.id, packId: pack.value.id });
    if (!isOk(draft)) throw new Error('draft');
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'UK Visa',
    });
    if (!isOk(mission)) throw new Error('mission');
    const attach = await attachPackVersion(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packVersionId: draft.value.id,
    });
    expect(isErr(attach)).toBe(true);
    if (isErr(attach)) expect(attach.error.code).toBe('invalid');
  });

  it('reports readiness as completeness (missing → satisfied), not probability', async () => {
    const { account, applicantId } = await seed(db);
    const packVersionId = await publishedPack(db, account.id);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'UK Visa',
    });
    if (!isOk(mission)) throw new Error('mission');
    await attachPackVersion(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packVersionId,
    });

    const before = await computeReadiness(db, mission.value.id);
    expect(isOk(before)).toBe(true);
    if (!isOk(before)) return;
    expect(before.value.ready).toBe(false);
    expect(before.value.requiredCount).toBe(2);
    expect(before.value.satisfiedRequired).toBe(0);
    expect(before.value.missing).toHaveLength(2);

    // Satisfy both requirements.
    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'passport.number',
      value: 'A1',
    });
    const doc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId,
      originalName: 'bank.pdf',
      docType: 'bank_statement',
    });
    if (!isOk(doc)) throw new Error('doc');
    await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: doc.value.id,
      bucket: 'CLEAN',
      objectKey: 'k',
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });

    const after = await computeReadiness(db, mission.value.id);
    expect(isOk(after)).toBe(true);
    if (!isOk(after)) return;
    expect(after.value.ready).toBe(true);
    expect(after.value.satisfiedRequired).toBe(2);
    expect(after.value.missing).toHaveLength(0);
  });

  it('enforces legal state transitions only', async () => {
    const { account, applicantId } = await seed(db);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'M',
    });
    if (!isOk(mission)) throw new Error('mission');

    // DRAFT → UNDER_REVIEW is illegal.
    const illegal = await transitionMission(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      to: 'UNDER_REVIEW',
    });
    expect(isErr(illegal)).toBe(true);
    if (isErr(illegal)) expect(illegal.error.code).toBe('invalid');

    // DRAFT → IN_PROGRESS → READY_FOR_REVIEW is legal.
    const t1 = await transitionMission(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      to: 'IN_PROGRESS',
    });
    const t2 = await transitionMission(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      to: 'READY_FOR_REVIEW',
    });
    expect(isOk(t1) && isOk(t2)).toBe(true);
    if (isOk(t2)) expect(t2.value.state).toBe('READY_FOR_REVIEW');
  });

  it('captures immutable, checksummed, incrementing snapshots', async () => {
    const { account, applicantId } = await seed(db);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'M',
    });
    if (!isOk(mission)) throw new Error('mission');

    const s1 = await snapshotMission(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
    });
    const s2 = await snapshotMission(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
    });
    expect(isOk(s1) && isOk(s2)).toBe(true);
    if (!isOk(s1) || !isOk(s2)) return;
    expect(s1.value.version).toBe(1);
    expect(s2.value.version).toBe(2);
    expect(s1.value.checksum).toMatch(/^[0-9a-f]{64}$/);

    // The append-only audit rule protects the row; snapshots are never rewritten.
    const rows = await db.select().from(schema.missionSnapshots);
    expect(rows).toHaveLength(2);
  });

  it('lists published packs, owner missions, and snapshots via the read helpers', async () => {
    const { account, applicantId } = await seed(db);
    const packVersionId = await publishedPack(db, account.id);

    // Only PUBLISHED versions are catalogued, with their requirement count.
    const catalog = await listPublishedPackVersions(db);
    expect(catalog).toHaveLength(1);
    expect(catalog[0]?.packVersionId).toBe(packVersionId);
    expect(catalog[0]?.requirementCount).toBe(2);

    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'UK Visa',
    });
    if (!isOk(mission)) throw new Error('mission');

    const missions = await listMissions(db, account.id, applicantId);
    expect(isOk(missions)).toBe(true);
    if (isOk(missions)) expect(missions.value).toHaveLength(1);

    const owned = await getMissionForOwner(db, account.id, mission.value.id);
    expect(isOk(owned)).toBe(true);

    await snapshotMission(db, { actorAccountId: account.id, missionId: mission.value.id });
    await snapshotMission(db, { actorAccountId: account.id, missionId: mission.value.id });
    const snaps = await listMissionSnapshots(db, account.id, mission.value.id);
    expect(isOk(snaps)).toBe(true);
    // Newest version first.
    if (isOk(snaps)) expect(snaps.value.map((s) => s.version)).toEqual([2, 1]);
  });

  it('does not count an unresolved-conflict fact as satisfying a requirement (Release H)', async () => {
    const { account, applicantId } = await seed(db);
    const packVersionId = await publishedPack(db, account.id);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'UK Visa',
    });
    if (!isOk(mission)) throw new Error('mission');
    await attachPackVersion(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packVersionId,
    });

    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    // A current fact version exists, but its status is CONFLICTED — present,
    // but not currently trustworthy (Build Spec §4.5/§9). Satisfying the
    // document requirement too, so only the field requirement is at issue.
    await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'passport.number',
      value: 'A1',
      status: 'CONFLICTED',
    });
    const doc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId,
      originalName: 'bank.pdf',
      docType: 'bank_statement',
    });
    if (!isOk(doc)) throw new Error('doc');
    await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: doc.value.id,
      bucket: 'CLEAN',
      objectKey: 'k',
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });

    const readiness = await computeReadiness(db, mission.value.id);
    expect(isOk(readiness)).toBe(true);
    if (!isOk(readiness)) return;
    expect(readiness.value.ready).toBe(false);
    expect(readiness.value.satisfiedRequired).toBe(1);
    expect(readiness.value.missing).toHaveLength(1);
    expect(readiness.value.missing[0]).toMatchObject({
      kind: 'FIELD',
      key: 'passport.number',
      reason: 'unresolved_conflict',
    });
  });

  it('maps each pack requirement to the specific value/documents that satisfy it, in a snapshot (Release H)', async () => {
    const { account, applicantId } = await seed(db);
    const packVersionId = await publishedPack(db, account.id);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'UK Visa',
    });
    if (!isOk(mission)) throw new Error('mission');
    await attachPackVersion(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packVersionId,
    });

    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'passport.number',
      value: 'A1',
    });
    const doc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId,
      originalName: 'bank.pdf',
      docType: 'bank_statement',
    });
    if (!isOk(doc)) throw new Error('doc');
    await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: doc.value.id,
      bucket: 'CLEAN',
      objectKey: 'k',
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });

    const snap = await snapshotMission(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
    });
    expect(isOk(snap)).toBe(true);
    if (!isOk(snap)) return;
    const content = snap.value.content as {
      requirementMapping: ReadonlyArray<{
        kind: string;
        key: string;
        satisfied: boolean;
        facts?: ReadonlyArray<{ value: string | null; factVersionId: string | null }>;
        documents?: ReadonlyArray<{
          documentId: string;
          documentVersionId: string;
          displayName: string;
        }>;
      }>;
    };
    expect(content.requirementMapping).toHaveLength(2);
    const field = content.requirementMapping.find((m) => m.kind === 'FIELD');
    expect(field?.satisfied).toBe(true);
    expect(field?.facts).toHaveLength(1);
    expect(field?.facts?.[0]?.value).toBe('A1');
    expect(field?.facts?.[0]?.factVersionId).toBeTruthy();
    const document = content.requirementMapping.find((m) => m.kind === 'DOCUMENT');
    expect(document?.satisfied).toBe(true);
    expect(document?.documents).toHaveLength(1);
    expect(document?.documents?.[0]?.displayName).toBe('bank.pdf');
    expect(document?.documents?.[0]?.documentVersionId).toBeTruthy();

    // The stored snapshot is retrievable in full — not just its checksum.
    const fetched = await getMissionSnapshot(db, account.id, mission.value.id, snap.value.id);
    expect(isOk(fetched)).toBe(true);
    if (isOk(fetched)) expect(fetched.value.checksum).toBe(snap.value.checksum);
  });

  it("A14 (master directive Part 7 §1): a snapshot discloses only this case's own evidence, excluding unrelated wallet facts/documents even when they are seeded and loaded", async () => {
    const { account, applicantId } = await seed(db);
    const packVersionId = await publishedPack(db, account.id);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'UK Visa',
    });
    if (!isOk(mission)) throw new Error('mission');
    await attachPackVersion(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packVersionId,
    });

    // Relevant to this case's pack (passport.number FIELD, bank_statement DOCUMENT).
    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'passport.number',
      value: 'A1',
    });
    const relevantDoc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId,
      originalName: 'bank.pdf',
      docType: 'bank_statement',
    });
    if (!isOk(relevantDoc)) throw new Error('relevant doc');
    await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: relevantDoc.value.id,
      bucket: 'CLEAN',
      objectKey: 'k1',
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });

    // Seeded on the SAME applicant wallet but referenced by no requirement on
    // this pack at all - the exact "unrelated wallet facts/documents" the
    // directive's exclusion list names. Pre-fix, `snapshotMission` embedded
    // every fact/document the applicant has, regardless of relevance.
    await registerFieldDefinition(db, { key: 'unrelated.hobby', dataType: 'string' });
    await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'unrelated.hobby',
      value: 'chess',
    });
    const unrelatedDoc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId,
      originalName: 'unrelated-refusal-letter.pdf',
      docType: 'refusal_letter',
    });
    if (!isOk(unrelatedDoc)) throw new Error('unrelated doc');
    await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: unrelatedDoc.value.id,
      bucket: 'CLEAN',
      objectKey: 'k2',
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });

    const snap = await snapshotMission(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
    });
    expect(isOk(snap)).toBe(true);
    if (!isOk(snap)) return;
    const content = snap.value.content as {
      evidenceScope: string;
      facts: ReadonlyArray<{ fieldKey: string; value: string | null }>;
      documents: ReadonlyArray<{ documentId: string; displayName: string; docType: string | null }>;
    };

    expect(content.evidenceScope).toBe('case_selected');
    expect(content.facts.map((f) => f.fieldKey)).toEqual(['passport.number']);
    expect(content.facts.some((f) => f.fieldKey === 'unrelated.hobby')).toBe(false);
    expect(content.documents.map((d) => d.displayName)).toEqual(['bank.pdf']);
    expect(content.documents.some((d) => d.documentId === unrelatedDoc.value.id)).toBe(false);
  });

  it('a manual-mode mission with no attached pack has no case-scoped selection to derive, so its snapshot honestly labels evidenceScope "all_applicant_evidence" rather than silently claiming case-scoped disclosure', async () => {
    const { account, applicantId } = await seed(db);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'Manual case',
    });
    if (!isOk(mission)) throw new Error('mission');
    await updateMissionCaseDetails(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      manualMode: true,
    });

    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'passport.number',
      value: 'A1',
    });

    const snap = await snapshotMission(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
    });
    expect(isOk(snap)).toBe(true);
    if (!isOk(snap)) return;
    const content = snap.value.content as {
      evidenceScope: string;
      facts: ReadonlyArray<{ fieldKey: string }>;
    };
    expect(content.evidenceScope).toBe('all_applicant_evidence');
    expect(content.facts.map((f) => f.fieldKey)).toEqual(['passport.number']);
  });

  it('includes an unclassified (no docType) document in a snapshot, ineligible for any specific-type requirement (finding #30, post-programme defect register)', async () => {
    const { account, applicantId } = await seed(db);
    const packVersionId = await publishedPack(db, account.id);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'UK Visa',
    });
    if (!isOk(mission)) throw new Error('mission');
    await attachPackVersion(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packVersionId,
    });

    // Deliberately no docType — classification never reached this document
    // (below CONFIDENCE_THRESHOLD, or never attempted).
    const doc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId,
      originalName: 'mystery.pdf',
    });
    if (!isOk(doc)) throw new Error('doc');
    await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: doc.value.id,
      bucket: 'CLEAN',
      objectKey: 'k',
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });

    const snap = await snapshotMission(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
    });
    expect(isOk(snap)).toBe(true);
    if (!isOk(snap)) return;
    const content = snap.value.content as {
      documents: ReadonlyArray<{ documentId: string; docType: string | null; displayName: string }>;
      requirementMapping: ReadonlyArray<{
        kind: string;
        satisfied: boolean;
        documents?: ReadonlyArray<{ documentId: string }>;
      }>;
    };

    // Present in the immutable record — not silently dropped.
    expect(content.documents).toHaveLength(1);
    expect(content.documents[0]?.documentId).toBe(doc.value.id);
    expect(content.documents[0]?.docType).toBeNull();
    expect(content.documents[0]?.displayName).toBe('mystery.pdf');

    // But it never satisfies the DOCUMENT requirement (bank_statement) —
    // grouping under a sentinel key never lets it match a real docType.
    const documentReq = content.requirementMapping.find((m) => m.kind === 'DOCUMENT');
    expect(documentReq?.satisfied).toBe(false);
    expect(documentReq?.documents ?? []).toHaveLength(0);
  });

  it('does not let a requirement whose own docType literally equals the unclassified-group sentinel string match unclassified documents (Codex review, PR-D1, round 1)', async () => {
    const { account, applicantId } = await seed(db);

    // docType is free text on both write sites (addRequirement only
    // requires non-empty; registerDocument validates nothing at all), so
    // an admin can genuinely author a requirement using the exact string
    // the sentinel grouping used to use, '__unclassified__'.
    const pack = await createPack(db, {
      actorAccountId: account.id,
      key: 'weird.pack',
      name: 'Weird',
    });
    if (!isOk(pack)) throw new Error('pack');
    const version = await addPackVersion(db, { actorAccountId: account.id, packId: pack.value.id });
    if (!isOk(version)) throw new Error('version');
    await addRequirement(db, {
      actorAccountId: account.id,
      packVersionId: version.value.id,
      kind: 'DOCUMENT',
      docType: '__unclassified__',
      citation: 'rule 1',
    });
    await approvePackVersion(db, { actorAccountId: account.id, packVersionId: version.value.id });
    await publishPackVersion(db, { actorAccountId: account.id, packVersionId: version.value.id });

    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'UK Visa',
    });
    if (!isOk(mission)) throw new Error('mission');
    await attachPackVersion(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packVersionId: version.value.id,
    });

    // Genuinely unclassified — docType null, not the literal sentinel
    // string. Otherwise identical to the finding #30 test above.
    const doc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId,
      originalName: 'mystery.pdf',
    });
    if (!isOk(doc)) throw new Error('doc');
    await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: doc.value.id,
      bucket: 'CLEAN',
      objectKey: 'k',
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });

    const snap = await snapshotMission(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
    });
    expect(isOk(snap)).toBe(true);
    if (!isOk(snap)) return;
    const content = snap.value.content as {
      documents: ReadonlyArray<{ documentId: string; docType: string | null }>;
      requirementMapping: ReadonlyArray<{
        kind: string;
        key: string;
        satisfied: boolean;
        documents?: ReadonlyArray<{ documentId: string }>;
      }>;
    };

    // Still present in the immutable record (finding #30's own guarantee,
    // unaffected by this fix).
    expect(content.documents).toHaveLength(1);
    expect(content.documents[0]?.docType).toBeNull();

    // But the '__unclassified__'-typed requirement is NOT satisfied by it —
    // a string docType can never match the symbol-keyed sentinel group.
    const documentReq = content.requirementMapping.find((m) => m.kind === 'DOCUMENT');
    expect(documentReq?.key).toBe('__unclassified__');
    expect(documentReq?.satisfied).toBe(false);
    expect(documentReq?.documents ?? []).toHaveLength(0);
  });

  it("refuses actions on another owner's mission", async () => {
    const { account, applicantId } = await seed(db);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'M',
    });
    if (!isOk(mission)) throw new Error('mission');
    const other = await provisionAccount(db, { email: 'other-m@example.com' });
    if (!isOk(other)) throw new Error('provision');
    const result = await transitionMission(db, {
      actorAccountId: other.value.id,
      missionId: mission.value.id,
      to: 'IN_PROGRESS',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('forbidden');
  });

  it('reports mission use for a field, live off the attached pack — not a specific historical version (master directive §7 "PR 8")', async () => {
    const { account, applicantId } = await seed(db);
    const packVersionId = await publishedPack(db, account.id);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'Tourist visa',
    });
    if (!isOk(mission)) throw new Error('mission');
    await attachPackVersion(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packVersionId,
    });

    // Before any fact exists for the required field, the mission still
    // "uses" it — use is about the requirement, not whether it's satisfied.
    const beforeFact = await listMissionsUsingField(db, account.id, applicantId, 'passport.number');
    expect(isOk(beforeFact)).toBe(true);
    if (isOk(beforeFact)) {
      expect(beforeFact.value.map((m) => m.missionId)).toEqual([mission.value.id]);
    }

    // An unrelated field the pack never cites: no mission uses it.
    const unrelated = await listMissionsUsingField(db, account.id, applicantId, 'given_name');
    expect(isOk(unrelated)).toBe(true);
    if (isOk(unrelated)) expect(unrelated.value).toEqual([]);

    // A second, unattached mission never shows up for this field.
    const other = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'Business visa (no pack attached)',
    });
    if (!isOk(other)) throw new Error('mission');
    const afterSecond = await listMissionsUsingField(
      db,
      account.id,
      applicantId,
      'passport.number',
    );
    expect(isOk(afterSecond)).toBe(true);
    if (isOk(afterSecond)) {
      expect(afterSecond.value.map((m) => m.missionId)).toEqual([mission.value.id]);
    }
  });

  it("refuses to report mission use for another owner's applicant", async () => {
    const { applicantId } = await seed(db);
    const other = await provisionAccount(db, { email: 'other-mu@example.com' });
    if (!isOk(other)) throw new Error('provision');
    const result = await listMissionsUsingField(db, other.value.id, applicantId, 'passport.number');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('forbidden');
  });

  it('never collides repeating-record instances in readiness or snapshots (master directive §7 "PR 10")', async () => {
    const { account, applicantId } = await seed(db);
    const packVersionId = await publishedPack(db, account.id);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'UK Visa',
    });
    if (!isOk(mission)) throw new Error('mission');
    await attachPackVersion(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packVersionId,
    });

    // passport.number is a REPEATING field (an applicant can have more than
    // one passport on file) — two instances sharing the same field key, one
    // CONFLICTED and one clean, distinguished only by repeatingRecordKey. A
    // Map/Record keyed by field key alone would silently collide these.
    await registerFieldDefinition(db, {
      key: 'passport.number',
      dataType: 'string',
      repeating: true,
    });
    await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'passport.number',
      value: 'OLD-CONFLICTED',
      status: 'CONFLICTED',
      repeatingRecordKey: 'expired-passport',
    });
    await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'passport.number',
      value: 'NEW-CLEAN',
      repeatingRecordKey: 'current-passport',
    });
    const doc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId,
      originalName: 'bank.pdf',
      docType: 'bank_statement',
    });
    if (!isOk(doc)) throw new Error('doc');
    await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: doc.value.id,
      bucket: 'CLEAN',
      objectKey: 'k',
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });

    // Readiness: satisfied by the clean instance despite the conflicted one existing too.
    const readiness = await computeReadiness(db, mission.value.id);
    expect(isOk(readiness)).toBe(true);
    if (!isOk(readiness)) return;
    expect(readiness.value.ready).toBe(true);
    expect(readiness.value.satisfiedRequired).toBe(2);
    expect(readiness.value.missing).toHaveLength(0);

    // Snapshot: BOTH instances are captured distinctly — neither overwrites the other.
    const snap = await snapshotMission(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
    });
    expect(isOk(snap)).toBe(true);
    if (!isOk(snap)) return;
    const content = snap.value.content as {
      facts: ReadonlyArray<{
        fieldKey: string;
        repeatingRecordKey: string | null;
        value: string | null;
        status: string;
      }>;
    };
    const passportEntries = content.facts.filter((f) => f.fieldKey === 'passport.number');
    expect(passportEntries).toHaveLength(2);
    const byRepeatKey = new Map(passportEntries.map((f) => [f.repeatingRecordKey, f]));
    expect(byRepeatKey.get('expired-passport')?.value).toBe('OLD-CONFLICTED');
    expect(byRepeatKey.get('expired-passport')?.status).toBe('CONFLICTED');
    expect(byRepeatKey.get('current-passport')?.value).toBe('NEW-CLEAN');
  });

  it('does not count an unsafe, still-processing, or expired document as satisfying a requirement (master directive §7 "PR 10")', async () => {
    const { account, applicantId } = await seed(db);
    const packVersionId = await publishedPack(db, account.id);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'UK Visa',
    });
    if (!isOk(mission)) throw new Error('mission');
    await attachPackVersion(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packVersionId,
    });
    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'passport.number',
      value: 'A1',
    });

    // A quarantined (unsafe) document of the right type — must not count.
    const unsafe = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId,
      originalName: 'unsafe.pdf',
      docType: 'bank_statement',
    });
    if (!isOk(unsafe)) throw new Error('doc');
    await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: unsafe.value.id,
      bucket: 'QUARANTINE',
      objectKey: 'unsafe-k',
      safetyStatus: 'QUARANTINED',
      processingStatus: 'NEEDS_ATTENTION',
    });

    const withUnsafeOnly = await computeReadiness(db, mission.value.id);
    expect(isOk(withUnsafeOnly)).toBe(true);
    if (!isOk(withUnsafeOnly)) return;
    expect(withUnsafeOnly.value.ready).toBe(false);
    expect(withUnsafeOnly.value.missing.some((m) => m.kind === 'DOCUMENT')).toBe(true);

    // An expired document of the right type, also clean/processed — still must not count.
    const expired = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId,
      originalName: 'expired.pdf',
      docType: 'bank_statement',
    });
    if (!isOk(expired)) throw new Error('doc');
    await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: expired.value.id,
      bucket: 'CLEAN',
      objectKey: 'expired-k',
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });
    await db
      .update(schema.documents)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.documents.id, expired.value.id));

    const withExpiredToo = await computeReadiness(db, mission.value.id);
    expect(isOk(withExpiredToo)).toBe(true);
    if (!isOk(withExpiredToo)) return;
    expect(withExpiredToo.value.ready).toBe(false);

    // A genuinely clean, processed, unexpired document of the right type — now it counts.
    const clean = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId,
      originalName: 'clean.pdf',
      docType: 'bank_statement',
    });
    if (!isOk(clean)) throw new Error('doc');
    await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: clean.value.id,
      bucket: 'CLEAN',
      objectKey: 'clean-k',
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });

    const final = await computeReadiness(db, mission.value.id);
    expect(isOk(final)).toBe(true);
    if (!isOk(final)) return;
    expect(final.value.ready).toBe(true);
  });

  it('does not count a document whose bytes are already erased as satisfying a requirement, and excludes it from a snapshot (Codex review, PR-B2, round 4)', async () => {
    const { account, applicantId } = await seed(db);
    const packVersionId = await publishedPack(db, account.id);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'UK Visa',
    });
    if (!isOk(mission)) throw new Error('mission');
    await attachPackVersion(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packVersionId,
    });
    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'passport.number',
      value: 'A1',
    });

    // Otherwise perfectly eligible (CLEAN/AWAITING_REVIEW, unexpired) — but
    // its own erasure job has already verified. Before this fix,
    // loadDocumentInstancesByType never consulted erasureJobs at all, so
    // this would satisfy the requirement and be captured into a snapshot
    // even though the underlying bytes provably no longer exist.
    const erased = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId,
      originalName: 'erased.pdf',
      docType: 'bank_statement',
    });
    if (!isOk(erased)) throw new Error('doc');
    const version = await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: erased.value.id,
      bucket: 'CLEAN',
      objectKey: 'erased-k',
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });
    if (!isOk(version)) throw new Error('version');
    const job = await enqueueErasureJob(db, {
      reason: 'RETENTION_PURGE',
      bucket: 'CLEAN',
      objectKey: 'erased-k',
      expectedHash: null,
      storageObjectId: version.value.storageObject.id,
      documentId: erased.value.id,
      applicantId,
    });
    await db
      .update(schema.erasureJobs)
      .set({ status: 'VERIFIED', deletionAttemptedAt: new Date(), completedAt: new Date() })
      .where(eq(schema.erasureJobs.id, job.id));

    const withErasedOnly = await computeReadiness(db, mission.value.id);
    expect(isOk(withErasedOnly)).toBe(true);
    if (!isOk(withErasedOnly)) return;
    expect(withErasedOnly.value.ready).toBe(false);
    expect(withErasedOnly.value.missing.some((m) => m.kind === 'DOCUMENT')).toBe(true);

    const snap = await snapshotMission(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
    });
    expect(isOk(snap)).toBe(true);
    if (!isOk(snap)) return;
    const content = snap.value.content as {
      requirementMapping: ReadonlyArray<{
        kind: string;
        satisfied: boolean;
        documents?: ReadonlyArray<{ documentId: string; eligible: boolean }>;
      }>;
    };
    const documentRequirement = content.requirementMapping.find((m) => m.kind === 'DOCUMENT');
    // Not satisfied overall — the requirement has no eligible candidate.
    expect(documentRequirement?.satisfied).toBe(false);
    // The erased document is still recorded as a considered candidate (a
    // snapshot should show what was weighed, not silently omit it), but
    // marked ineligible — never something a reviewer or downstream export
    // could mistake for satisfying evidence.
    const erasedEntry = documentRequirement?.documents?.find(
      (d) => d.documentId === erased.value.id,
    );
    expect(erasedEntry?.eligible).toBe(false);
  });

  it('does not count a document quarantined by the safety scanner as satisfying a requirement, and excludes it from a snapshot (PR-B3R)', async () => {
    const { account, applicantId } = await seed(db);
    const packVersionId = await publishedPack(db, account.id);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'UK Visa',
    });
    if (!isOk(mission)) throw new Error('mission');
    await attachPackVersion(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packVersionId,
    });
    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'passport.number',
      value: 'A1',
    });

    // Simulates exactly what a real arbitrary-PDF upload produces through
    // BasicSafetyScanner + processIntake: QUARANTINED/NEEDS_ATTENTION, never
    // CLEAN. isDocumentVersionUsable's safetyStatus === 'CLEAN' check is the
    // one canonical definition mission eligibility shares with preview/
    // download (documents.ts) — no separate mission-specific gate exists or
    // is needed.
    const quarantined = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId,
      originalName: 'quarantined.pdf',
      docType: 'bank_statement',
    });
    if (!isOk(quarantined)) throw new Error('doc');
    const version = await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: quarantined.value.id,
      bucket: 'QUARANTINE',
      objectKey: 'quarantined-pdf-k',
      safetyStatus: 'QUARANTINED',
      processingStatus: 'NEEDS_ATTENTION',
    });
    if (!isOk(version)) throw new Error('version');

    const withQuarantinedOnly = await computeReadiness(db, mission.value.id);
    expect(isOk(withQuarantinedOnly)).toBe(true);
    if (!isOk(withQuarantinedOnly)) return;
    expect(withQuarantinedOnly.value.ready).toBe(false);
    expect(withQuarantinedOnly.value.missing.some((m) => m.kind === 'DOCUMENT')).toBe(true);

    const snap = await snapshotMission(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
    });
    expect(isOk(snap)).toBe(true);
    if (!isOk(snap)) return;
    const content = snap.value.content as {
      requirementMapping: ReadonlyArray<{
        kind: string;
        satisfied: boolean;
        documents?: ReadonlyArray<{ documentId: string; eligible: boolean }>;
      }>;
    };
    const documentRequirement = content.requirementMapping.find((m) => m.kind === 'DOCUMENT');
    expect(documentRequirement?.satisfied).toBe(false);
    const quarantinedEntry = documentRequirement?.documents?.find(
      (d) => d.documentId === quarantined.value.id,
    );
    expect(quarantinedEntry?.eligible).toBe(false);
  });

  it('does not count an unconfirmed (EXTRACTED_PENDING) or STALE fact as satisfying a requirement (master directive §7 "PR 10")', async () => {
    const { account, applicantId } = await seed(db);
    const packVersionId = await publishedPack(db, account.id);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'UK Visa',
    });
    if (!isOk(mission)) throw new Error('mission');
    await attachPackVersion(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packVersionId,
    });
    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'passport.number',
      value: 'A1',
      status: 'STALE',
    });
    const doc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId,
      originalName: 'bank.pdf',
      docType: 'bank_statement',
    });
    if (!isOk(doc)) throw new Error('doc');
    await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: doc.value.id,
      bucket: 'CLEAN',
      objectKey: 'k',
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });

    const readiness = await computeReadiness(db, mission.value.id);
    expect(isOk(readiness)).toBe(true);
    if (!isOk(readiness)) return;
    expect(readiness.value.ready).toBe(false);
    expect(
      readiness.value.missing.some((m) => m.kind === 'FIELD' && m.key === 'passport.number'),
    ).toBe(true);
  });
});

describe('mission collaboration — evidence selection, tasks, grounded letters (master directive §7 "PR 10")', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  async function setUp(db: Db) {
    const { account, applicantId } = await seed(db);
    const packVersionId = await publishedPack(db, account.id);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'UK Visa',
    });
    if (!isOk(mission)) throw new Error('mission');
    await attachPackVersion(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packVersionId,
    });
    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    const fact = await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'passport.number',
      value: 'A1',
    });
    if (!isOk(fact)) throw new Error('fact');
    const doc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId,
      originalName: 'bank.pdf',
      docType: 'bank_statement',
    });
    if (!isOk(doc)) throw new Error('doc');
    await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: doc.value.id,
      bucket: 'CLEAN',
      objectKey: 'k',
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });

    const requirements = await db
      .select()
      .from(schema.packRequirements)
      .where(eq(schema.packRequirements.packVersionId, packVersionId));
    const fieldRequirement = requirements.find((r) => r.kind === 'FIELD');
    const documentRequirement = requirements.find((r) => r.kind === 'DOCUMENT');
    if (!fieldRequirement || !documentRequirement) throw new Error('requirements');

    return {
      account,
      applicantId,
      missionId: mission.value.id,
      factId: fact.value.fact.id,
      documentId: doc.value.id,
      fieldRequirementId: fieldRequirement.id,
      documentRequirementId: documentRequirement.id,
    };
  }

  it('selects evidence for a requirement, idempotently, and refuses cross-applicant evidence', async () => {
    const { account, missionId, factId, fieldRequirementId } = await setUp(db);

    const first = await selectEvidence(db, {
      actorAccountId: account.id,
      missionId,
      packRequirementId: fieldRequirementId,
      factId,
    });
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) return;

    // Selecting the same instance again is a no-op, not an error.
    const second = await selectEvidence(db, {
      actorAccountId: account.id,
      missionId,
      packRequirementId: fieldRequirementId,
      factId,
    });
    expect(isOk(second)).toBe(true);
    if (isOk(second)) expect(second.value.id).toBe(first.value.id);

    const list = await listSelectedEvidence(db, account.id, missionId);
    expect(isOk(list)).toBe(true);
    if (isOk(list)) expect(list.value).toHaveLength(1);

    // A fact belonging to a different applicant cannot be selected here.
    const other = await seed(db);
    await registerFieldDefinition(db, { key: 'other.field', dataType: 'string' }).catch(() => {});
    const otherFact = await editFact(db, {
      actorAccountId: other.account.id,
      applicantId: other.applicantId,
      fieldKey: 'passport.number',
      value: 'ZZ',
    });
    if (!isOk(otherFact)) throw new Error('other fact');
    const crossTenant = await selectEvidence(db, {
      actorAccountId: account.id,
      missionId,
      packRequirementId: fieldRequirementId,
      factId: otherFact.value.fact.id,
    });
    expect(isErr(crossTenant)).toBe(true);
    if (isErr(crossTenant)) expect(crossTenant.error.code).toBe('not_found');

    const removed = await unselectEvidence(db, {
      actorAccountId: account.id,
      missionId,
      selectionId: first.value.id,
    });
    expect(isOk(removed)).toBe(true);
    const afterRemoval = await listSelectedEvidence(db, account.id, missionId);
    expect(isOk(afterRemoval)).toBe(true);
    if (isOk(afterRemoval)) expect(afterRemoval.value).toHaveLength(0);
  });

  it("refuses a selection whose fact/document doesn't match the requirement's own field key/docType, even for the applicant's own data (finding #34, post-programme defect register)", async () => {
    const {
      account,
      applicantId,
      missionId,
      factId,
      documentId,
      fieldRequirementId,
      documentRequirementId,
    } = await setUp(db);

    // A genuine fact, owned by the SAME applicant, but for a DIFFERENT field
    // than fieldRequirementId (passport.number) actually requires.
    await registerFieldDefinition(db, { key: 'other.field', dataType: 'string' });
    const mismatchedFact = await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'other.field',
      value: 'irrelevant',
    });
    if (!isOk(mismatchedFact)) throw new Error('mismatched fact');
    const factMismatch = await selectEvidence(db, {
      actorAccountId: account.id,
      missionId,
      packRequirementId: fieldRequirementId,
      factId: mismatchedFact.value.fact.id,
    });
    expect(isErr(factMismatch)).toBe(true);
    if (isErr(factMismatch)) expect(factMismatch.error.code).toBe('invalid');

    // A genuine document, owned by the SAME applicant, but with a DIFFERENT
    // docType than documentRequirementId (bank_statement) actually requires.
    const mismatchedDoc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId,
      originalName: 'passport.pdf',
      docType: 'passport',
    });
    if (!isOk(mismatchedDoc)) throw new Error('mismatched document');
    await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: mismatchedDoc.value.id,
      bucket: 'CLEAN',
      objectKey: 'k2',
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });
    const docMismatch = await selectEvidence(db, {
      actorAccountId: account.id,
      missionId,
      packRequirementId: documentRequirementId,
      documentId: mismatchedDoc.value.id,
    });
    expect(isErr(docMismatch)).toBe(true);
    if (isErr(docMismatch)) expect(docMismatch.error.code).toBe('invalid');

    // Neither mismatched attempt actually inserted a row.
    const afterMismatches = await listSelectedEvidence(db, account.id, missionId);
    expect(isOk(afterMismatches)).toBe(true);
    if (isOk(afterMismatches)) expect(afterMismatches.value).toHaveLength(0);

    // Sanity: the genuinely-matching fact/document from setUp still work —
    // this isn't overly strict, just correctly scoped.
    const validFact = await selectEvidence(db, {
      actorAccountId: account.id,
      missionId,
      packRequirementId: fieldRequirementId,
      factId,
    });
    expect(isOk(validFact)).toBe(true);
    const validDoc = await selectEvidence(db, {
      actorAccountId: account.id,
      missionId,
      packRequirementId: documentRequirementId,
      documentId,
    });
    expect(isOk(validDoc)).toBe(true);
  });

  it("refuses evidence selection on another owner's mission", async () => {
    const { missionId, factId, fieldRequirementId } = await setUp(db);
    const stranger = await provisionAccount(db, { email: 'stranger-select@example.com' });
    if (!isOk(stranger)) throw new Error('provision');
    const result = await selectEvidence(db, {
      actorAccountId: stranger.value.id,
      missionId,
      packRequirementId: fieldRequirementId,
      factId,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('forbidden');
  });

  it('creates, completes, and lists mission tasks, owner-scoped', async () => {
    const { account, missionId, fieldRequirementId } = await setUp(db);
    const dueDate = new Date('2026-12-01T00:00:00Z');
    const task = await createTask(db, {
      actorAccountId: account.id,
      missionId,
      description: 'Chase the applicant for an updated bank statement.',
      packRequirementId: fieldRequirementId,
      dueDate,
    });
    expect(isOk(task)).toBe(true);
    if (!isOk(task)) return;
    expect(task.value.status).toBe('OPEN');
    // CAS-02's "overdue tasks" rollup needs a real due date on the row itself.
    expect(task.value.dueDate?.toISOString()).toBe(dueDate.toISOString());

    const decided = await decideTask(db, {
      actorAccountId: account.id,
      missionId,
      taskId: task.value.id,
      status: 'DONE',
    });
    expect(isOk(decided)).toBe(true);
    if (isOk(decided)) {
      expect(decided.value.status).toBe('DONE');
      expect(decided.value.completedAt).not.toBeNull();
    }

    // Cannot decide the same task twice.
    const redecided = await decideTask(db, {
      actorAccountId: account.id,
      missionId,
      taskId: task.value.id,
      status: 'CANCELLED',
    });
    expect(isErr(redecided)).toBe(true);

    const list = await listTasks(db, account.id, missionId);
    expect(isOk(list)).toBe(true);
    if (isOk(list)) expect(list.value).toHaveLength(1);

    const stranger = await provisionAccount(db, { email: 'stranger-task@example.com' });
    if (!isOk(stranger)) throw new Error('provision');
    const denied = await createTask(db, {
      actorAccountId: stranger.value.id,
      missionId,
      description: 'Should not be allowed.',
    });
    expect(isErr(denied)).toBe(true);
    if (isErr(denied)) expect(denied.error.code).toBe('forbidden');
  });

  it('Part 5 §4: decideTask CANCELLED cancels a still-QUEUED notice tied to that task (e.g. an NTF-04 deadline reminder not yet dispatched)', async () => {
    const { account, missionId } = await setUp(db);
    const task = await createTask(db, {
      actorAccountId: account.id,
      missionId,
      description: 'Chase the applicant for an updated bank statement.',
    });
    if (!isOk(task)) throw new Error('task');

    await db.transaction(async (tx) => {
      await enqueueNotificationBothChannels(tx, {
        eventType: 'TASK_DEADLINE',
        resourceId: task.value.id,
        recipientAccountId: account.id,
        threshold: 'due_7d',
        payload: { subject: 'Task due soon', summary: 'A task is due soon.', deepLinkPath: '/app' },
      });
    });

    const decided = await decideTask(db, {
      actorAccountId: account.id,
      missionId,
      taskId: task.value.id,
      status: 'CANCELLED',
    });
    expect(isOk(decided)).toBe(true);

    const rows = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.resourceId, task.value.id));
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.status).toBe('CANCELLED');
  });

  it('refuses a task tied to a requirement from an unrelated pack (not just an unrelated document/fact)', async () => {
    const { account, missionId } = await setUp(db);
    // A second, unrelated pack the mission was never attached to.
    const pack = await createPack(db, {
      actorAccountId: account.id,
      key: 'us.business',
      name: 'US Business',
    });
    if (!isOk(pack)) throw new Error('pack');
    const version = await addPackVersion(db, {
      actorAccountId: account.id,
      packId: pack.value.id,
    });
    if (!isOk(version)) throw new Error('version');
    const requirement = await addRequirement(db, {
      actorAccountId: account.id,
      packVersionId: version.value.id,
      kind: 'FIELD',
      fieldKey: 'employer.name',
      citation: 'rule 1',
    });
    if (!isOk(requirement)) throw new Error('requirement');

    const foreignTask = await createTask(db, {
      actorAccountId: account.id,
      missionId,
      description: 'Attached to a requirement from a different pack entirely.',
      packRequirementId: requirement.value.id,
    });
    expect(isErr(foreignTask)).toBe(true);
    if (isErr(foreignTask)) expect(foreignTask.error.code).toBe('not_found');

    const list = await listTasks(db, account.id, missionId);
    expect(isOk(list)).toBe(true);
    if (isOk(list)) expect(list.value).toHaveLength(0);
  });

  it('moves a task through OPEN -> IN_PROGRESS -> DONE, but refuses an invalid transition from a terminal state (Commercial V1 Part 4 §11)', async () => {
    const { account, missionId } = await setUp(db);
    const task = await createTask(db, {
      actorAccountId: account.id,
      missionId,
      description: 'Prepare the cover letter.',
    });
    if (!isOk(task)) throw new Error('task');

    const started = await decideTask(db, {
      actorAccountId: account.id,
      missionId,
      taskId: task.value.id,
      status: 'IN_PROGRESS',
    });
    expect(isOk(started)).toBe(true);
    if (isOk(started)) {
      expect(started.value.status).toBe('IN_PROGRESS');
      // Only DONE/CANCELLED set completedAt; starting work is not completing it.
      expect(started.value.completedAt).toBeNull();
    }

    const done = await decideTask(db, {
      actorAccountId: account.id,
      missionId,
      taskId: task.value.id,
      status: 'DONE',
    });
    expect(isOk(done)).toBe(true);
    if (isOk(done)) expect(done.value.completedAt).not.toBeNull();

    // DONE is terminal: cannot move it anywhere, including back to IN_PROGRESS.
    const reopened = await decideTask(db, {
      actorAccountId: account.id,
      missionId,
      taskId: task.value.id,
      status: 'IN_PROGRESS',
    });
    expect(isErr(reopened)).toBe(true);
    if (isErr(reopened)) expect(reopened.error.code).toBe('invalid');
  });

  it('updateTask reassigns/reschedules/re-prioritizes a task, auditing exactly what changed, and is a no-op when nothing is supplied', async () => {
    const { account, missionId } = await setUp(db);
    const original = await createTask(db, {
      actorAccountId: account.id,
      missionId,
      description: 'Confirm sponsor letter.',
      priority: 'LOW',
    });
    if (!isOk(original)) throw new Error('task');
    const otherAccount = await provisionAccount(db, { email: 'task-assignee@example.com' });
    if (!isOk(otherAccount)) throw new Error('provision');

    const dueDate = new Date('2026-11-15T00:00:00Z');
    const updated = await updateTask(db, {
      actorAccountId: account.id,
      missionId,
      taskId: original.value.id,
      assigneeAccountId: otherAccount.value.id,
      dueDate,
      dueTimezone: 'Asia/Dhaka',
      priority: 'URGENT',
    });
    expect(isOk(updated)).toBe(true);
    if (isOk(updated)) {
      expect(updated.value.assigneeAccountId).toBe(otherAccount.value.id);
      expect(updated.value.dueDate?.toISOString()).toBe(dueDate.toISOString());
      expect(updated.value.dueTimezone).toBe('Asia/Dhaka');
      expect(updated.value.priority).toBe('URGENT');
    }

    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'MISSION_TASK_UPDATED'));
    expect(events).toHaveLength(1);
    const metadata = events[0]?.metadata as {
      changes: Partial<
        Record<'priority' | 'assigneeAccountId', { before: unknown; after: unknown }>
      >;
    };
    expect(metadata.changes.priority).toEqual({ before: 'LOW', after: 'URGENT' });
    expect(metadata.changes.assigneeAccountId).toEqual({
      before: null,
      after: otherAccount.value.id,
    });

    // Calling again with no fields at all is a true no-op: same row, no new audit event.
    const noop = await updateTask(db, {
      actorAccountId: account.id,
      missionId,
      taskId: original.value.id,
    });
    expect(isOk(noop)).toBe(true);
    const eventsAfterNoop = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'MISSION_TASK_UPDATED'));
    expect(eventsAfterNoop).toHaveLength(1);
  });

  it('appointments: create, reschedule/reassign (audited), complete, list soonest-first, and stay owner-scoped across missions (Commercial V1 Part 4 §11)', async () => {
    const { account, missionId } = await setUp(db);
    const first = await createAppointment(db, {
      actorAccountId: account.id,
      missionId,
      title: 'Visa interview prep',
      localDateTime: new Date('2026-11-20T09:00:00'),
      timezone: 'Asia/Dhaka',
      place: 'Agency office',
      channel: 'In person',
    });
    expect(isOk(first)).toBe(true);
    const second = await createAppointment(db, {
      actorAccountId: account.id,
      missionId,
      title: 'Document review call',
      localDateTime: new Date('2026-11-10T09:00:00'),
      timezone: 'Asia/Dhaka',
    });
    expect(isOk(second)).toBe(true);
    if (!isOk(first) || !isOk(second)) return;

    // Soonest first - the earlier (Nov 10) appointment before the later (Nov 20) one.
    const list = await listAppointments(db, account.id, missionId);
    expect(isOk(list)).toBe(true);
    if (isOk(list)) expect(list.value.map((a) => a.id)).toEqual([second.value.id, first.value.id]);

    const rescheduled = await updateAppointment(db, {
      actorAccountId: account.id,
      missionId,
      appointmentId: first.value.id,
      localDateTime: new Date('2026-11-21T14:00:00'),
      place: 'Video call',
    });
    expect(isOk(rescheduled)).toBe(true);
    if (isOk(rescheduled)) {
      expect(rescheduled.value.place).toBe('Video call');
      expect(rescheduled.value.channel).toBe('In person'); // untouched field survives a partial update
    }
    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'MISSION_APPOINTMENT_UPDATED'));
    expect(events).toHaveLength(1);

    const completed = await decideAppointment(db, {
      actorAccountId: account.id,
      missionId,
      appointmentId: first.value.id,
      status: 'DONE',
    });
    expect(isOk(completed)).toBe(true);
    if (isOk(completed)) expect(completed.value.completedAt).not.toBeNull();
    // Already-decided cannot be decided again.
    const redecided = await decideAppointment(db, {
      actorAccountId: account.id,
      missionId,
      appointmentId: first.value.id,
      status: 'CANCELLED',
    });
    expect(isErr(redecided)).toBe(true);

    // A non-owner never reaches this mission's appointment at all, matching
    // every other mission-scoped resource's cross-tenant IDOR discipline in
    // this file (e.g. "refuses evidence selection on another owner's mission").
    const stranger = await provisionAccount(db, { email: 'stranger-appt@example.com' });
    if (!isOk(stranger)) throw new Error('provision');
    const crossOwner = await getAppointment(db, stranger.value.id, missionId, second.value.id);
    expect(isErr(crossOwner)).toBe(true);
    if (isErr(crossOwner)) expect(crossOwner.error.code).toBe('forbidden');
  });

  it('Part 5 §4: decideAppointment CANCELLED cancels a still-QUEUED notice tied to that appointment', async () => {
    const { account, missionId } = await setUp(db);
    const appointment = await createAppointment(db, {
      actorAccountId: account.id,
      missionId,
      title: 'Visa interview prep',
      localDateTime: new Date('2026-11-20T09:00:00'),
      timezone: 'Asia/Dhaka',
    });
    if (!isOk(appointment)) throw new Error('appointment');

    await db.transaction(async (tx) => {
      await enqueueNotificationBothChannels(tx, {
        eventType: 'APPOINTMENT_SCHEDULED',
        resourceId: appointment.value.id,
        recipientAccountId: account.id,
        payload: {
          subject: 'Appointment scheduled',
          summary: 'An appointment was scheduled.',
          deepLinkPath: '/app',
        },
      });
    });

    const decided = await decideAppointment(db, {
      actorAccountId: account.id,
      missionId,
      appointmentId: appointment.value.id,
      status: 'CANCELLED',
    });
    expect(isOk(decided)).toBe(true);

    const rows = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.resourceId, appointment.value.id));
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.status).toBe('CANCELLED');
  });

  it('refuses to generate a letter with nothing grounded yet, then generates one citing exact evidence, versioned', async () => {
    const { account, applicantId } = await seed(db);
    const packVersionId = await publishedPack(db, account.id);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'UK Visa',
    });
    if (!isOk(mission)) throw new Error('mission');
    await attachPackVersion(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packVersionId,
    });

    const empty = await generateCoverLetter(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
    });
    expect(isErr(empty)).toBe(true);
    if (isErr(empty)) expect(empty.error.code).toBe('invalid');

    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    const fact = await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'passport.number',
      value: 'A1',
    });
    if (!isOk(fact)) throw new Error('fact');
    const doc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId,
      originalName: 'bank.pdf',
      docType: 'bank_statement',
    });
    if (!isOk(doc)) throw new Error('doc');
    await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: doc.value.id,
      bucket: 'CLEAN',
      objectKey: 'k',
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });

    const first = await generateCoverLetter(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
    });
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) return;
    expect(first.value.version).toBe(1);
    expect(first.value.content).toContain('A1');
    const refs = first.value.groundedReferences as ReadonlyArray<{
      kind: string;
      key: string;
      factVersionId?: string;
      documentVersionId?: string;
    }>;
    expect(refs).toHaveLength(2);
    expect(refs.some((r) => r.kind === 'FIELD' && r.factVersionId)).toBe(true);
    expect(refs.some((r) => r.kind === 'DOCUMENT' && r.documentVersionId)).toBe(true);
    // Every reference is a real, resolvable id — never invented.
    const fieldRef = refs.find((r) => r.kind === 'FIELD');
    expect(fieldRef?.factVersionId).toBe(fact.value.version.id);

    const second = await generateCoverLetter(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
    });
    expect(isOk(second)).toBe(true);
    if (isOk(second)) expect(second.value.version).toBe(2);

    const outputs = await listGeneratedOutputs(db, account.id, mission.value.id);
    expect(isOk(outputs)).toBe(true);
    if (isOk(outputs)) {
      expect(outputs.value).toHaveLength(2);
      expect(outputs.value[0]?.version).toBe(2); // newest first
    }
  });

  it('ignores an eligible-but-unselected instance once a selection narrows the requirement (master directive §7 "PR 10")', async () => {
    const { account, applicantId } = await seed(db);
    const packVersionId = await publishedPack(db, account.id);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'UK Visa',
    });
    if (!isOk(mission)) throw new Error('mission');
    await attachPackVersion(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packVersionId,
    });
    await registerFieldDefinition(db, {
      key: 'passport.number',
      dataType: 'string',
      repeating: true,
    });
    // Two instances: one clean, one conflicted.
    const good = await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'passport.number',
      value: 'GOOD',
      repeatingRecordKey: 'good',
    });
    if (!isOk(good)) throw new Error('good');
    const bad = await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'passport.number',
      value: 'BAD',
      status: 'CONFLICTED',
      repeatingRecordKey: 'bad',
    });
    if (!isOk(bad)) throw new Error('bad');
    const doc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId,
      originalName: 'bank.pdf',
      docType: 'bank_statement',
    });
    if (!isOk(doc)) throw new Error('doc');
    await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: doc.value.id,
      bucket: 'CLEAN',
      objectKey: 'k',
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });

    const requirements = await db
      .select()
      .from(schema.packRequirements)
      .where(eq(schema.packRequirements.packVersionId, packVersionId));
    const fieldRequirementId = requirements.find((r) => r.kind === 'FIELD')?.id as string;

    // Before any selection: satisfied via the clean instance.
    const before = await computeReadiness(db, mission.value.id);
    expect(isOk(before)).toBe(true);
    if (isOk(before)) expect(before.value.ready).toBe(true);

    // Explicitly select ONLY the conflicted instance — the clean one, though
    // still present, must now be ignored (it was never selected).
    const selected = await selectEvidence(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packRequirementId: fieldRequirementId,
      factId: bad.value.fact.id,
    });
    expect(isOk(selected)).toBe(true);

    const after = await computeReadiness(db, mission.value.id);
    expect(isOk(after)).toBe(true);
    if (!isOk(after)) return;
    expect(after.value.ready).toBe(false);
    expect(
      after.value.missing.some((m) => m.kind === 'FIELD' && m.reason === 'unresolved_conflict'),
    ).toBe(true);

    // The snapshot's requirement mapping reflects the same narrowing — only
    // the selected (conflicted) instance appears, not the unselected clean one.
    const snap = await snapshotMission(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
    });
    expect(isOk(snap)).toBe(true);
    if (!isOk(snap)) return;
    const content = snap.value.content as {
      requirementMapping: ReadonlyArray<{
        kind: string;
        satisfied: boolean;
        facts?: ReadonlyArray<{ value: string | null }>;
      }>;
    };
    const field = content.requirementMapping.find((m) => m.kind === 'FIELD');
    expect(field?.satisfied).toBe(false);
    expect(field?.facts).toHaveLength(1);
    expect(field?.facts?.[0]?.value).toBe('BAD');
  });
});

describe('TRU-03 (Commercial V1 Part 7 §4): case material revision', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  async function setUp(db: Db) {
    const { account, applicantId } = await seed(db);
    const packVersionId = await publishedPack(db, account.id);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'UK Visa',
    });
    if (!isOk(mission)) throw new Error('mission');
    await attachPackVersion(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packVersionId,
    });
    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    const fact = await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'passport.number',
      value: 'A1',
    });
    if (!isOk(fact)) throw new Error('fact');
    const doc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId,
      originalName: 'bank.pdf',
      docType: 'bank_statement',
    });
    if (!isOk(doc)) throw new Error('doc');
    await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: doc.value.id,
      bucket: 'CLEAN',
      objectKey: 'k',
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });

    const requirements = await db
      .select()
      .from(schema.packRequirements)
      .where(eq(schema.packRequirements.packVersionId, packVersionId));
    const fieldRequirementId = requirements.find((r) => r.kind === 'FIELD')?.id;
    const documentRequirementId = requirements.find((r) => r.kind === 'DOCUMENT')?.id;
    if (!fieldRequirementId || !documentRequirementId) throw new Error('requirements');

    return {
      account,
      applicantId,
      packVersionId,
      missionId: mission.value.id,
      factId: fact.value.fact.id,
      documentId: doc.value.id,
      fieldRequirementId,
      documentRequirementId,
    };
  }

  async function revisionOf(actorAccountId: string, missionId: string): Promise<number> {
    const loaded = await getMissionForOwner(db, actorAccountId, missionId);
    if (!isOk(loaded)) throw new Error('mission');
    return loaded.value.materialRevision;
  }

  it('starts at 1 on creation, and attaching a pack version bumps it by exactly 1', async () => {
    const { account, applicantId, packVersionId } = await setUp(db);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'Fresh case',
    });
    if (!isOk(mission)) throw new Error('mission');
    expect(mission.value.materialRevision).toBe(1);

    const attached = await attachPackVersion(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packVersionId,
    });
    expect(isOk(attached)).toBe(true);
    if (isOk(attached)) expect(attached.value.materialRevision).toBe(2);
  });

  it('updateMissionCaseDetails bumps by 1 when a field is provided, and not at all when none is (presence-triggered, not a value diff)', async () => {
    const { account, missionId } = await setUp(db);
    const before = await revisionOf(account.id, missionId);

    const noop = await updateMissionCaseDetails(db, { actorAccountId: account.id, missionId });
    expect(isOk(noop)).toBe(true);
    expect(await revisionOf(account.id, missionId)).toBe(before);

    const withField = await updateMissionCaseDetails(db, {
      actorAccountId: account.id,
      missionId,
      jurisdiction: 'UK',
    });
    expect(isOk(withField)).toBe(true);
    expect(await revisionOf(account.id, missionId)).toBe(before + 1);

    // Re-providing the SAME value still counts: presence-triggered, matching
    // the same granularity updateTask's own no-op test already uses, not a
    // before/after value comparison.
    const sameValueAgain = await updateMissionCaseDetails(db, {
      actorAccountId: account.id,
      missionId,
      jurisdiction: 'UK',
    });
    expect(isOk(sameValueAgain)).toBe(true);
    expect(await revisionOf(account.id, missionId)).toBe(before + 2);
  });

  it('selectEvidence bumps by 1 on a new selection, and not at all on an idempotent re-selection', async () => {
    const { account, missionId, factId, fieldRequirementId } = await setUp(db);
    const before = await revisionOf(account.id, missionId);

    const first = await selectEvidence(db, {
      actorAccountId: account.id,
      missionId,
      packRequirementId: fieldRequirementId,
      factId,
    });
    expect(isOk(first)).toBe(true);
    expect(await revisionOf(account.id, missionId)).toBe(before + 1);

    const again = await selectEvidence(db, {
      actorAccountId: account.id,
      missionId,
      packRequirementId: fieldRequirementId,
      factId,
    });
    expect(isOk(again)).toBe(true);
    expect(await revisionOf(account.id, missionId)).toBe(before + 1);
  });

  it('unselectEvidence bumps by 1', async () => {
    const { account, missionId, factId, fieldRequirementId } = await setUp(db);
    const selected = await selectEvidence(db, {
      actorAccountId: account.id,
      missionId,
      packRequirementId: fieldRequirementId,
      factId,
    });
    if (!isOk(selected)) throw new Error('select');
    const before = await revisionOf(account.id, missionId);

    const removed = await unselectEvidence(db, {
      actorAccountId: account.id,
      missionId,
      selectionId: selected.value.id,
    });
    expect(isOk(removed)).toBe(true);
    expect(await revisionOf(account.id, missionId)).toBe(before + 1);
  });

  it('generateCoverLetter bumps by 1', async () => {
    const { account, missionId, factId, documentId, fieldRequirementId, documentRequirementId } =
      await setUp(db);
    await selectEvidence(db, {
      actorAccountId: account.id,
      missionId,
      packRequirementId: fieldRequirementId,
      factId,
    });
    await selectEvidence(db, {
      actorAccountId: account.id,
      missionId,
      packRequirementId: documentRequirementId,
      documentId,
    });
    const before = await revisionOf(account.id, missionId);

    const letter = await generateCoverLetter(db, { actorAccountId: account.id, missionId });
    expect(isOk(letter)).toBe(true);
    expect(await revisionOf(account.id, missionId)).toBe(before + 1);
  });

  it("editing an already-selected fact bumps the selecting mission's revision; editing an unselected fact does not", async () => {
    const { account, applicantId, missionId, fieldRequirementId, factId } = await setUp(db);

    // Not yet selected by any mission: re-editing the fact must not touch
    // this mission's revision at all.
    const beforeSelection = await revisionOf(account.id, missionId);
    const unselectedEdit = await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'passport.number',
      value: 'A2',
    });
    expect(isOk(unselectedEdit)).toBe(true);
    expect(await revisionOf(account.id, missionId)).toBe(beforeSelection);

    // Now select it, and edit again - a selection points at the fact's
    // stable id, not a frozen version, so this SHOULD be material.
    const selected = await selectEvidence(db, {
      actorAccountId: account.id,
      missionId,
      packRequirementId: fieldRequirementId,
      factId,
    });
    expect(isOk(selected)).toBe(true);
    const afterSelection = await revisionOf(account.id, missionId);

    const selectedEdit = await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'passport.number',
      value: 'A3',
    });
    expect(isOk(selectedEdit)).toBe(true);
    expect(await revisionOf(account.id, missionId)).toBe(afterSelection + 1);
  });

  it("adding a version to an already-selected document bumps the selecting mission's revision; an unselected document does not", async () => {
    const { account, missionId, documentRequirementId, documentId } = await setUp(db);

    const beforeSelection = await revisionOf(account.id, missionId);
    const unselectedVersion = await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId,
      bucket: 'CLEAN',
      objectKey: 'k2',
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });
    expect(isOk(unselectedVersion)).toBe(true);
    expect(await revisionOf(account.id, missionId)).toBe(beforeSelection);

    const selected = await selectEvidence(db, {
      actorAccountId: account.id,
      missionId,
      packRequirementId: documentRequirementId,
      documentId,
    });
    expect(isOk(selected)).toBe(true);
    const afterSelection = await revisionOf(account.id, missionId);

    const selectedVersion = await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId,
      bucket: 'CLEAN',
      objectKey: 'k3',
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });
    expect(isOk(selectedVersion)).toBe(true);
    expect(await revisionOf(account.id, missionId)).toBe(afterSelection + 1);
  });

  it("a fact selected by TWO different missions bumps BOTH missions' revisions on a single edit", async () => {
    const {
      account,
      applicantId,
      factId,
      fieldRequirementId,
      packVersionId,
      missionId: firstMissionId,
    } = await setUp(db);
    await selectEvidence(db, {
      actorAccountId: account.id,
      missionId: firstMissionId,
      packRequirementId: fieldRequirementId,
      factId,
    });

    // A second, independent mission for the SAME applicant, attached to the
    // same pack version, also selecting the same fact.
    const secondMission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'Second case, same applicant',
    });
    if (!isOk(secondMission)) throw new Error('mission');
    await attachPackVersion(db, {
      actorAccountId: account.id,
      missionId: secondMission.value.id,
      packVersionId,
    });
    await selectEvidence(db, {
      actorAccountId: account.id,
      missionId: secondMission.value.id,
      packRequirementId: fieldRequirementId,
      factId,
    });

    const beforeFirst = await revisionOf(account.id, firstMissionId);
    const beforeSecond = await revisionOf(account.id, secondMission.value.id);

    const edited = await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'passport.number',
      value: 'SHARED-EDIT',
    });
    expect(isOk(edited)).toBe(true);

    expect(await revisionOf(account.id, firstMissionId)).toBe(beforeFirst + 1);
    expect(await revisionOf(account.id, secondMission.value.id)).toBe(beforeSecond + 1);
  });

  it('snapshotMission captures the current revision (in content and materialRevisionAtCapture) without itself bumping it', async () => {
    const { account, missionId } = await setUp(db);
    const before = await revisionOf(account.id, missionId);

    const snap = await snapshotMission(db, { actorAccountId: account.id, missionId });
    expect(isOk(snap)).toBe(true);
    if (isOk(snap)) {
      const content = snap.value.content as { materialRevision: number };
      expect(content.materialRevision).toBe(before);
      expect(snap.value.materialRevisionAtCapture).toBe(before);
    }
    // Taking a snapshot is a read/export, not a mutation of the case's own
    // material - the live revision is unchanged.
    expect(await revisionOf(account.id, missionId)).toBe(before);
  });
});

describe('listSelectedEvidenceForOrg (EVI-05): the org-scoped sibling of listSelectedEvidence', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('lets an org with a covering MANAGE grant read what is selected, mirroring listMissionRequirementsForOrg', async () => {
    const { account, applicantId } = await seed(db);
    await setConsent(db, {
      actorAccountId: account.id,
      accountId: account.id,
      type: 'SHARING',
      granted: true,
    });
    const packVersionId = await publishedPack(db, account.id);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'V',
    });
    if (!isOk(mission)) throw new Error('mission');
    await attachPackVersion(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packVersionId,
    });
    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    const edited = await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'passport.number',
      value: 'A1',
    });
    if (!isOk(edited)) throw new Error('edit');
    const requirements = await listRequirements(db, packVersionId);
    const fieldRequirement = requirements.find((r) => r.kind === 'FIELD');
    if (!fieldRequirement) throw new Error('requirement');
    const selected = await selectEvidence(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packRequirementId: fieldRequirement.id,
      factId: edited.value.fact.id,
    });
    expect(isOk(selected)).toBe(true);

    const agent = await provisionAccount(db, { email: 'evidence-org-agent@example.com' });
    if (!isOk(agent)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agent.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    const admin = await provisionAccount(db, { email: 'evidence-org-admin@example.com' });
    if (!isOk(admin)) throw new Error('provision');
    await reviewOrganization(db, {
      reviewerAccountId: admin.value.id,
      organizationId: org.value.id,
      decision: 'ACTIVE',
      stepUpSatisfied: true,
    });
    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['MANAGE'],
      purpose: 'case_management',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agent.value.id, grantId: grant.value.id });

    const forOrg = await listSelectedEvidenceForOrg(db, org.value.id, mission.value.id);
    expect(isOk(forOrg)).toBe(true);
    if (!isOk(forOrg)) return;
    expect(forOrg.value).toHaveLength(1);
    expect(forOrg.value[0]?.factId).toBe(edited.value.fact.id);
  });

  it('denies an org with no grant on the applicant at all', async () => {
    const { account, applicantId } = await seed(db);
    const packVersionId = await publishedPack(db, account.id);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'V',
    });
    if (!isOk(mission)) throw new Error('mission');
    await attachPackVersion(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packVersionId,
    });

    const agent = await provisionAccount(db, { email: 'evidence-stranger-agent@example.com' });
    if (!isOk(agent)) throw new Error('provision');
    const org = await createOrganization(db, {
      actorAccountId: agent.value.id,
      name: 'Stranger Co',
    });
    if (!isOk(org)) throw new Error('org');

    const forOrg = await listSelectedEvidenceForOrg(db, org.value.id, mission.value.id);
    expect(isErr(forOrg)).toBe(true);
    // A case the organization does not reach answers like an unknown id (ADR 0017).
    if (isErr(forOrg)) expect(forOrg.error.code).toBe('not_found');
  });

  it('reports not_found for an unknown mission', async () => {
    const forOrg = await listSelectedEvidenceForOrg(
      db,
      '00000000-0000-0000-0000-000000000000',
      '00000000-0000-0000-0000-000000000000',
    );
    expect(isErr(forOrg)).toBe(true);
    if (isErr(forOrg)) expect(forOrg.error.code).toBe('not_found');
  });
});

describe('missions - itinerary reference linking (IAM-04: family trips stay linked, never merged)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('createMission accepts an optional itinerary reference, trimmed', async () => {
    const { account, applicantId } = await seed(db);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'UK Visa',
      itineraryRef: '  Smith Family Europe 2026  ',
    });
    expect(isOk(mission)).toBe(true);
    if (!isOk(mission)) return;
    expect(mission.value.itineraryRef).toBe('Smith Family Europe 2026');
  });

  it('leaves itineraryRef null when omitted', async () => {
    const { account, applicantId } = await seed(db);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'X',
    });
    expect(isOk(mission)).toBe(true);
    if (!isOk(mission)) return;
    expect(mission.value.itineraryRef).toBeNull();
  });

  it('setMissionItineraryRef sets and clears it (mission owner only)', async () => {
    const { account, applicantId } = await seed(db);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'X',
    });
    if (!isOk(mission)) throw new Error('mission');

    const set = await setMissionItineraryRef(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      itineraryRef: 'Family Trip',
    });
    expect(isOk(set)).toBe(true);
    if (isOk(set)) expect(set.value.itineraryRef).toBe('Family Trip');

    const cleared = await setMissionItineraryRef(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      itineraryRef: '  ',
    });
    expect(isOk(cleared)).toBe(true);
    if (isOk(cleared)) expect(cleared.value.itineraryRef).toBeNull();

    const stranger = await provisionAccount(db, { email: 'itinerary-stranger@example.com' });
    if (!isOk(stranger)) throw new Error('provision');
    const denied = await setMissionItineraryRef(db, {
      actorAccountId: stranger.value.id,
      missionId: mission.value.id,
      itineraryRef: 'Hijacked',
    });
    expect(isErr(denied)).toBe(true);
    if (isErr(denied)) expect(denied.error.code).toBe('forbidden');
  });

  it('listMissionsByItineraryRef links missions across the owner’s own applicants (the real guardian-managing-several-subjects case)', async () => {
    const { account, applicantId: selfId } = await seed(db);
    const child = await addFamilyMember(db, {
      actorAccountId: account.id,
      ownerAccountId: account.id,
      displayName: 'Child',
      relationship: 'MINOR_GUARDIAN',
      authorityConfirmed: true,
    });
    if (!isOk(child)) throw new Error('child');

    const parentMission = await createMission(db, {
      actorAccountId: account.id,
      applicantId: selfId,
      title: 'Parent leg',
      itineraryRef: 'Family Europe 2026',
    });
    const childMission = await createMission(db, {
      actorAccountId: account.id,
      applicantId: child.value.id,
      title: 'Child leg',
      itineraryRef: 'Family Europe 2026',
    });
    // A third, unrelated mission for the same account must not show up.
    await createMission(db, {
      actorAccountId: account.id,
      applicantId: selfId,
      title: 'Unrelated',
    });
    if (!isOk(parentMission) || !isOk(childMission)) throw new Error('mission setup');

    const linked = await listMissionsByItineraryRef(db, {
      actorAccountId: account.id,
      itineraryRef: 'Family Europe 2026',
    });
    expect(linked.map((m) => m.id).sort()).toEqual(
      [parentMission.value.id, childMission.value.id].sort(),
    );
  });

  it('never surfaces a different account’s missions even with an identical itinerary reference string', async () => {
    const { account: accountA, applicantId: applicantA } = await seed(db);
    const provisionedB = await provisionAccount(db, { email: 'itinerary-b@example.com' });
    if (!isOk(provisionedB)) throw new Error('provision');
    await setConsent(db, {
      actorAccountId: provisionedB.value.id,
      accountId: provisionedB.value.id,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    const applicantB = await createApplicant(db, {
      actorAccountId: provisionedB.value.id,
      ownerAccountId: provisionedB.value.id,
      displayName: 'B Owner',
    });
    if (!isOk(applicantB)) throw new Error('applicant');

    await createMission(db, {
      actorAccountId: accountA.id,
      applicantId: applicantA,
      title: 'A trip',
      itineraryRef: 'Same Label',
    });
    const missionB = await createMission(db, {
      actorAccountId: provisionedB.value.id,
      applicantId: applicantB.value.id,
      title: 'B trip',
      itineraryRef: 'Same Label',
    });
    if (!isOk(missionB)) throw new Error('mission B');

    const seenByB = await listMissionsByItineraryRef(db, {
      actorAccountId: provisionedB.value.id,
      itineraryRef: 'Same Label',
    });
    expect(seenByB.map((m) => m.id)).toEqual([missionB.value.id]);
  });

  it('returns an empty list for a blank reference rather than every mission', async () => {
    const { account } = await seed(db);
    const result = await listMissionsByItineraryRef(db, {
      actorAccountId: account.id,
      itineraryRef: '  ',
    });
    expect(result).toHaveLength(0);
  });
});

describe('missions - case-creation fields (Commercial V1 Part 4 §8 / CAS-01)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('createMission accepts and persists every CAS-01 field, none of them required', async () => {
    const { account, applicantId } = await seed(db);
    const org = await createOrganization(db, { actorAccountId: account.id, name: 'Acme Visas' });
    if (!isOk(org)) throw new Error('org');
    const travelStart = new Date('2026-11-01T00:00:00Z');
    const travelEnd = new Date('2026-11-15T00:00:00Z');
    const deadline = new Date('2026-10-01T00:00:00Z');

    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'UK Visa',
      jurisdiction: '  US Embassy Dhaka  ',
      serviceCategory: '  Tourist  ',
      travelStartDate: travelStart,
      travelEndDate: travelEnd,
      targetDeadline: deadline,
      ownerOrganizationId: org.value.id,
      manualMode: true,
    });
    expect(isOk(mission)).toBe(true);
    if (!isOk(mission)) return;
    expect(mission.value.jurisdiction).toBe('US Embassy Dhaka');
    expect(mission.value.serviceCategory).toBe('Tourist');
    expect(mission.value.travelStartDate?.toISOString()).toBe(travelStart.toISOString());
    expect(mission.value.travelEndDate?.toISOString()).toBe(travelEnd.toISOString());
    expect(mission.value.targetDeadline?.toISOString()).toBe(deadline.toISOString());
    expect(mission.value.ownerOrganizationId).toBe(org.value.id);
    expect(mission.value.manualMode).toBe(true);
  });

  it('leaves every CAS-01 field null/false when omitted', async () => {
    const { account, applicantId } = await seed(db);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'X',
    });
    expect(isOk(mission)).toBe(true);
    if (!isOk(mission)) return;
    expect(mission.value.jurisdiction).toBeNull();
    expect(mission.value.serviceCategory).toBeNull();
    expect(mission.value.travelStartDate).toBeNull();
    expect(mission.value.targetDeadline).toBeNull();
    expect(mission.value.ownerOrganizationId).toBeNull();
    expect(mission.value.manualMode).toBe(false);
  });

  it('updateMissionCaseDetails updates only the fields provided, owner-only, leaving the rest untouched', async () => {
    const { account, applicantId } = await seed(db);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'X',
      jurisdiction: 'Original Jurisdiction',
      manualMode: true,
    });
    if (!isOk(mission)) throw new Error('mission');

    const updated = await updateMissionCaseDetails(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      serviceCategory: 'Student',
    });
    expect(isOk(updated)).toBe(true);
    if (!isOk(updated)) return;
    expect(updated.value.serviceCategory).toBe('Student');
    // Untouched fields survive the partial update.
    expect(updated.value.jurisdiction).toBe('Original Jurisdiction');
    expect(updated.value.manualMode).toBe(true);

    // manualMode can be explicitly turned off once a real pack is attached.
    const turnedOff = await updateMissionCaseDetails(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      manualMode: false,
    });
    expect(isOk(turnedOff)).toBe(true);
    if (isOk(turnedOff)) expect(turnedOff.value.manualMode).toBe(false);

    const stranger = await provisionAccount(db, { email: 'case-details-stranger@example.com' });
    if (!isOk(stranger)) throw new Error('provision');
    const denied = await updateMissionCaseDetails(db, {
      actorAccountId: stranger.value.id,
      missionId: mission.value.id,
      jurisdiction: 'Hijacked',
    });
    expect(isErr(denied)).toBe(true);
  });

  it('snapshotMission captures manualMode and the other case fields, immutably, per §8\'s "visible on the case and export"', async () => {
    const { account, applicantId } = await seed(db);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'X',
      jurisdiction: 'US Embassy Dhaka',
      manualMode: true,
    });
    if (!isOk(mission)) throw new Error('mission');

    const snapshot = await snapshotMission(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
    });
    expect(isOk(snapshot)).toBe(true);
    if (!isOk(snapshot)) return;
    const content = snapshot.value.content as { manualMode: boolean; jurisdiction: string | null };
    expect(content.manualMode).toBe(true);
    expect(content.jurisdiction).toBe('US Embassy Dhaka');
  });
});

describe('NTF-01 - case-specific staleness, tracked separately from intrinsic expiry', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  /** A published pack whose DOCUMENT requirement demands evidence dated within 90 days. */
  async function publishedPackWithFreshnessRule(db: Db, actor: string): Promise<string> {
    const pack = await createPack(db, { actorAccountId: actor, key: 'uk.freshness', name: 'F' });
    if (!isOk(pack)) throw new Error('pack');
    const version = await addPackVersion(db, { actorAccountId: actor, packId: pack.value.id });
    if (!isOk(version)) throw new Error('version');
    await addRequirement(db, {
      actorAccountId: actor,
      packVersionId: version.value.id,
      kind: 'DOCUMENT',
      docType: 'bank_statement',
      citation: 'rule',
      maxAgeDays: 90,
    });
    await approvePackVersion(db, { actorAccountId: actor, packVersionId: version.value.id });
    await publishPackVersion(db, { actorAccountId: actor, packVersionId: version.value.id });
    return version.value.id;
  }

  it('rejects a non-positive or non-DOCUMENT maxAgeDays', async () => {
    const { account } = await seed(db);
    const pack = await createPack(db, { actorAccountId: account.id, key: 'x', name: 'X' });
    if (!isOk(pack)) throw new Error('pack');
    const version = await addPackVersion(db, { actorAccountId: account.id, packId: pack.value.id });
    if (!isOk(version)) throw new Error('version');

    const onField = await addRequirement(db, {
      actorAccountId: account.id,
      packVersionId: version.value.id,
      kind: 'FIELD',
      fieldKey: 'passport.number',
      citation: 'c',
      maxAgeDays: 90,
    });
    expect(isErr(onField)).toBe(true);

    const nonPositive = await addRequirement(db, {
      actorAccountId: account.id,
      packVersionId: version.value.id,
      kind: 'DOCUMENT',
      docType: 'bank_statement',
      citation: 'c',
      maxAgeDays: 0,
    });
    expect(isErr(nonPositive)).toBe(true);
  });

  it('a stale document blocks satisfaction with reason "stale_evidence", distinct from "not_provided"', async () => {
    const { account, applicantId } = await seed(db);
    const packVersionId = await publishedPackWithFreshnessRule(db, account.id);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'UK Visa',
    });
    if (!isOk(mission)) throw new Error('mission');
    await attachPackVersion(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packVersionId,
    });

    const doc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId,
      originalName: 'bank.pdf',
      docType: 'bank_statement',
    });
    if (!isOk(doc)) throw new Error('doc');
    await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: doc.value.id,
      bucket: 'CLEAN',
      objectKey: 'k',
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });

    // No date recorded yet - "unknown" freshness does not block satisfaction.
    const unknown = await computeReadiness(db, mission.value.id);
    if (!isOk(unknown)) throw new Error('readiness');
    expect(unknown.value.ready).toBe(true);

    // Dated 120 days ago - outside the 90-day window.
    const staleDate = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const dated = await setDocumentDate(db, {
      actorAccountId: account.id,
      documentId: doc.value.id,
      documentDate: staleDate,
    });
    expect(isOk(dated)).toBe(true);

    const stale = await computeReadiness(db, mission.value.id);
    if (!isOk(stale)) throw new Error('readiness');
    expect(stale.value.ready).toBe(false);
    expect(stale.value.missing).toHaveLength(1);
    expect(stale.value.missing[0]?.reason).toBe('stale_evidence');

    // The candidate view (evidence-selection UI) surfaces the same verdict, kept separate from `eligible`.
    const candidates = await getEvidenceCandidates(db, account.id, mission.value.id);
    if (!isOk(candidates)) throw new Error('candidates');
    const docCandidate = candidates.value.find((c) => c.kind === 'DOCUMENT');
    expect(docCandidate?.documentCandidates[0]?.eligible).toBe(true);
    expect(docCandidate?.documentCandidates[0]?.staleness.status).toBe('stale');

    // Recording a recent date makes the same requirement satisfied again.
    const freshDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await setDocumentDate(db, {
      actorAccountId: account.id,
      documentId: doc.value.id,
      documentDate: freshDate,
    });
    const fresh = await computeReadiness(db, mission.value.id);
    if (!isOk(fresh)) throw new Error('readiness');
    expect(fresh.value.ready).toBe(true);
  });

  it('never mutates the document intrinsic expiresAt when a freshness rule applies', async () => {
    const { account, applicantId } = await seed(db);
    const packVersionId = await publishedPackWithFreshnessRule(db, account.id);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'UK Visa',
    });
    if (!isOk(mission)) throw new Error('mission');
    await attachPackVersion(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packVersionId,
    });

    const doc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId,
      originalName: 'bank.pdf',
      docType: 'bank_statement',
    });
    if (!isOk(doc)) throw new Error('doc');
    await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: doc.value.id,
      bucket: 'CLEAN',
      objectKey: 'k',
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });
    const staleDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await setDocumentDate(db, {
      actorAccountId: account.id,
      documentId: doc.value.id,
      documentDate: staleDate,
    });
    await computeReadiness(db, mission.value.id);

    const row = (
      await db.select().from(schema.documents).where(eq(schema.documents.id, doc.value.id))
    )[0];
    expect(row?.expiresAt).toBeNull();
  });
});

describe('RUL-04 - richer per-requirement/overall readiness states (condition-driven)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  /**
   * A published pack with one always-required FIELD requirement
   * (passport.number, no condition - the zero-behavior-change control) plus
   * one FIELD requirement gated on `visa_purpose` equalling `business`.
   */
  async function publishedPackWithConditionalRequirement(
    db: Db,
    actor: string,
    conditionalOptional = false,
  ): Promise<string> {
    const pack = await createPack(db, { actorAccountId: actor, key: 'uk.conditional', name: 'C' });
    if (!isOk(pack)) throw new Error('pack');
    const version = await addPackVersion(db, { actorAccountId: actor, packId: pack.value.id });
    if (!isOk(version)) throw new Error('version');
    await addRequirement(db, {
      actorAccountId: actor,
      packVersionId: version.value.id,
      kind: 'FIELD',
      fieldKey: 'passport.number',
      citation: 'always required',
    });
    await addRequirement(db, {
      actorAccountId: actor,
      packVersionId: version.value.id,
      kind: 'FIELD',
      fieldKey: 'us_visa_history',
      citation: 'business visitors only',
      optional: conditionalOptional,
      condition: { op: 'equals', field: 'visa_purpose', value: 'business' },
    });
    await approvePackVersion(db, { actorAccountId: actor, packVersionId: version.value.id });
    await publishPackVersion(db, { actorAccountId: actor, packVersionId: version.value.id });
    return version.value.id;
  }

  async function missionWithPack(
    db: Db,
    account: { id: string },
    applicantId: string,
    packVersionId: string,
    manualMode = false,
  ) {
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'UK Visa',
      manualMode,
    });
    if (!isOk(mission)) throw new Error('mission');
    await attachPackVersion(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packVersionId,
    });
    return mission.value;
  }

  it('a requirement with no condition resolves exactly as before - CRITICAL_GAP/ATTENTION/SATISFIED, unchanged', async () => {
    const { account, applicantId } = await seed(db);
    const pack = await createPack(db, { actorAccountId: account.id, key: 'x', name: 'X' });
    if (!isOk(pack)) throw new Error('pack');
    const version = await addPackVersion(db, { actorAccountId: account.id, packId: pack.value.id });
    if (!isOk(version)) throw new Error('version');
    await addRequirement(db, {
      actorAccountId: account.id,
      packVersionId: version.value.id,
      kind: 'FIELD',
      fieldKey: 'passport.number',
      citation: 'required',
    });
    await addRequirement(db, {
      actorAccountId: account.id,
      packVersionId: version.value.id,
      kind: 'FIELD',
      fieldKey: 'middle_name',
      citation: 'optional',
      optional: true,
    });
    await approvePackVersion(db, { actorAccountId: account.id, packVersionId: version.value.id });
    await publishPackVersion(db, { actorAccountId: account.id, packVersionId: version.value.id });
    const mission = await missionWithPack(db, account, applicantId, version.value.id);

    const before = await computeReadiness(db, mission.id);
    if (!isOk(before)) throw new Error('readiness');
    const byKey = (r: typeof before.value) =>
      Object.fromEntries(r.requirementResults.map((e) => [e.key, e.state]));
    expect(byKey(before.value)).toEqual({
      'passport.number': 'CRITICAL_GAP',
      middle_name: 'ATTENTION',
    });
    expect(before.value.overallState).toBe('NEEDS_ACTION');

    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'passport.number',
      value: 'A1',
    });
    const after = await computeReadiness(db, mission.id);
    if (!isOk(after)) throw new Error('readiness');
    expect(byKey(after.value)).toEqual({
      'passport.number': 'SATISFIED',
      middle_name: 'ATTENTION',
    });
    expect(after.value.ready).toBe(true);
    expect(after.value.overallState).toBe('READY_FOR_APPLICANT_REVIEW');
  });

  it('a condition evaluating false marks NOT_APPLICABLE and excludes the requirement from requiredCount/missing', async () => {
    const { account, applicantId } = await seed(db);
    const packVersionId = await publishedPackWithConditionalRequirement(db, account.id);
    const mission = await missionWithPack(db, account, applicantId, packVersionId);

    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    await registerFieldDefinition(db, { key: 'visa_purpose', dataType: 'string' });
    await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'passport.number',
      value: 'A1',
    });
    await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'visa_purpose',
      value: 'tourism',
    });

    const readiness = await computeReadiness(db, mission.id);
    if (!isOk(readiness)) throw new Error('readiness');
    const conditional = readiness.value.requirementResults.find((r) => r.key === 'us_visa_history');
    expect(conditional?.state).toBe('NOT_APPLICABLE');
    expect(readiness.value.requiredCount).toBe(1); // only passport.number counts
    expect(readiness.value.missing).toHaveLength(0);
    expect(readiness.value.ready).toBe(true);
    expect(readiness.value.overallState).toBe('READY_FOR_APPLICANT_REVIEW');
  });

  it('a condition can read the case travel dates: unknown with no dates, then applies or not by trip length', async () => {
    const { account, applicantId } = await seed(db);
    const pack = await createPack(db, { actorAccountId: account.id, key: 'long.stay', name: 'L' });
    if (!isOk(pack)) throw new Error('pack');
    const version = await addPackVersion(db, { actorAccountId: account.id, packId: pack.value.id });
    if (!isOk(version)) throw new Error('version');
    await addRequirement(db, {
      actorAccountId: account.id,
      packVersionId: version.value.id,
      kind: 'FIELD',
      fieldKey: 'us_visa_history',
      citation: 'trips of 30 days or more',
      condition: {
        op: 'durationAtLeastDays',
        from: { kind: 'field', field: CASE_TRAVEL_START_KEY },
        to: { kind: 'field', field: CASE_TRAVEL_END_KEY },
        days: 30,
      },
    });
    await approvePackVersion(db, { actorAccountId: account.id, packVersionId: version.value.id });
    await publishPackVersion(db, { actorAccountId: account.id, packVersionId: version.value.id });
    const stateOf = async (missionId: string) => {
      const readiness = await computeReadiness(db, missionId);
      if (!isOk(readiness)) throw new Error('readiness');
      return readiness.value.requirementResults.find((r) => r.key === 'us_visa_history')?.state;
    };
    const makeCase = async (title: string, start: Date | null, end: Date | null) => {
      const created = await createMission(db, {
        actorAccountId: account.id,
        applicantId,
        title,
        manualMode: false,
        ...(start ? { travelStartDate: start } : {}),
        ...(end ? { travelEndDate: end } : {}),
      });
      if (!isOk(created)) throw new Error('mission');
      await attachPackVersion(db, {
        actorAccountId: account.id,
        missionId: created.value.id,
        packVersionId: version.value.id,
      });
      return created.value.id;
    };

    // A saved fact with the same name as a reserved key must not stand in for a case date.
    await registerFieldDefinition(db, { key: CASE_TRAVEL_END_KEY, dataType: 'string' });
    await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: CASE_TRAVEL_END_KEY,
      value: '2030-01-01',
    });
    await registerFieldDefinition(db, { key: CASE_TRAVEL_START_KEY, dataType: 'string' });
    await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: CASE_TRAVEL_START_KEY,
      value: '2026-01-01',
    });

    const noDates = await makeCase('No dates', null, null);
    expect(await stateOf(noDates)).toBe('UNVERIFIED');

    const short = await makeCase(
      'Ten days',
      new Date('2026-11-01T00:00:00Z'),
      new Date('2026-11-11T00:00:00Z'),
    );
    expect(await stateOf(short)).toBe('NOT_APPLICABLE');

    const long = await makeCase(
      'Sixty days',
      new Date('2026-11-01T00:00:00Z'),
      new Date('2026-12-31T00:00:00Z'),
    );
    expect(await stateOf(long)).toBe('CRITICAL_GAP');
  });

  it('a condition evaluating unknown marks UNVERIFIED and the case NEEDS_REVIEW, distinct from a hard CRITICAL_GAP', async () => {
    const { account, applicantId } = await seed(db);
    const packVersionId = await publishedPackWithConditionalRequirement(db, account.id);
    const mission = await missionWithPack(db, account, applicantId, packVersionId);

    // passport.number satisfied; visa_purpose never provided at all, so the
    // conditional requirement's own condition cannot be resolved.
    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'passport.number',
      value: 'A1',
    });

    const readiness = await computeReadiness(db, mission.id);
    if (!isOk(readiness)) throw new Error('readiness');
    const conditional = readiness.value.requirementResults.find((r) => r.key === 'us_visa_history');
    expect(conditional?.state).toBe('UNVERIFIED');
    // UNVERIFIED still counts as a required requirement (unlike NOT_APPLICABLE) - just not a satisfied one.
    expect(readiness.value.requiredCount).toBe(2);
    expect(readiness.value.satisfiedRequired).toBe(1);
    expect(readiness.value.ready).toBe(false);
    // A softer signal than a hard gap: NEEDS_REVIEW, never NEEDS_ACTION, for an all-UNVERIFIED shortfall.
    expect(readiness.value.overallState).toBe('NEEDS_REVIEW');
  });

  it('already-satisfied evidence reports SATISFIED even while its own condition is still unknown', async () => {
    const { account, applicantId } = await seed(db);
    const packVersionId = await publishedPackWithConditionalRequirement(db, account.id);
    const mission = await missionWithPack(db, account, applicantId, packVersionId);

    // us_visa_history itself IS provided, even though visa_purpose (what the
    // condition depends on) never is - the evidence on file is never wrong
    // to report as satisfied, regardless of the unrelated unknown.
    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    await registerFieldDefinition(db, { key: 'us_visa_history', dataType: 'string' });
    await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'passport.number',
      value: 'A1',
    });
    await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'us_visa_history',
      value: 'B2 2019-2024',
    });

    const readiness = await computeReadiness(db, mission.id);
    if (!isOk(readiness)) throw new Error('readiness');
    const conditional = readiness.value.requirementResults.find((r) => r.key === 'us_visa_history');
    expect(conditional?.state).toBe('SATISFIED');
    expect(readiness.value.ready).toBe(true);
    expect(readiness.value.overallState).toBe('READY_FOR_APPLICANT_REVIEW');
  });

  it('a conflicting instance is surfaced as CONFLICTING even when another instance of the same repeating field otherwise satisfies it', async () => {
    const { account, applicantId } = await seed(db);
    const pack = await createPack(db, { actorAccountId: account.id, key: 'y', name: 'Y' });
    if (!isOk(pack)) throw new Error('pack');
    const version = await addPackVersion(db, { actorAccountId: account.id, packId: pack.value.id });
    if (!isOk(version)) throw new Error('version');
    await addRequirement(db, {
      actorAccountId: account.id,
      packVersionId: version.value.id,
      kind: 'FIELD',
      fieldKey: 'prior_visa.number',
      citation: 'c',
    });
    await approvePackVersion(db, { actorAccountId: account.id, packVersionId: version.value.id });
    await publishPackVersion(db, { actorAccountId: account.id, packVersionId: version.value.id });
    const mission = await missionWithPack(db, account, applicantId, version.value.id);

    await registerFieldDefinition(db, {
      key: 'prior_visa.number',
      dataType: 'string',
      repeating: true,
    });
    await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'prior_visa.number',
      value: 'CLEAN-1',
      repeatingRecordKey: 'a',
    });
    await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'prior_visa.number',
      value: 'DISPUTED-2',
      repeatingRecordKey: 'b',
      status: 'CONFLICTED',
    });

    const readiness = await computeReadiness(db, mission.id);
    if (!isOk(readiness)) throw new Error('readiness');
    const entry = readiness.value.requirementResults[0];
    // The pre-existing satisfied check only needs ONE eligible instance, so
    // this requirement is (and always was) satisfied=true - but RUL-04 must
    // not let that hide the conflicted sibling instance behind a plain SATISFIED.
    expect(entry?.state).toBe('CONFLICTING');
  });

  it('MANUAL_ONLY overrides every requirement state when the mission is in manual mode', async () => {
    const { account, applicantId } = await seed(db);
    const packVersionId = await publishedPackWithConditionalRequirement(db, account.id);
    const mission = await missionWithPack(db, account, applicantId, packVersionId, true);

    // Nothing provided at all - would otherwise be NEEDS_ACTION (a genuine CRITICAL_GAP exists).
    const readiness = await computeReadiness(db, mission.id);
    if (!isOk(readiness)) throw new Error('readiness');
    expect(readiness.value.overallState).toBe('MANUAL_ONLY');
  });

  it('snapshotMission and generateCoverLetter both carry the same resultState on their requirement mapping', async () => {
    const { account, applicantId } = await seed(db);
    const packVersionId = await publishedPackWithConditionalRequirement(db, account.id);
    const mission = await missionWithPack(db, account, applicantId, packVersionId);

    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'passport.number',
      value: 'A1',
    });
    await registerFieldDefinition(db, { key: 'visa_purpose', dataType: 'string' });
    await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'visa_purpose',
      value: 'tourism',
    });

    const snapshot = await snapshotMission(db, {
      actorAccountId: account.id,
      missionId: mission.id,
    });
    if (!isOk(snapshot)) throw new Error('snapshot');
    const content = snapshot.value.content as {
      requirementMapping: ReadonlyArray<{ key: string; resultState: string }>;
      readiness: { overallState: string } | null;
    };
    const conditional = content.requirementMapping.find((e) => e.key === 'us_visa_history');
    expect(conditional?.resultState).toBe('NOT_APPLICABLE');
    expect(content.readiness?.overallState).toBe('READY_FOR_APPLICANT_REVIEW');

    // A satisfied, non-conditional requirement still grounds a cover letter as before.
    const letter = await generateCoverLetter(db, {
      actorAccountId: account.id,
      missionId: mission.id,
    });
    expect(isOk(letter)).toBe(true);
  });
});

describe('listMissionsByPackVersion (RUL-05 active-case impact list)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  async function publishedVersion(actor: string, key: string): Promise<string> {
    const pack = await createPack(db, { actorAccountId: actor, key, name: key });
    if (!isOk(pack)) throw new Error('pack');
    const version = await addPackVersion(db, { actorAccountId: actor, packId: pack.value.id });
    if (!isOk(version)) throw new Error('version');
    await addRequirement(db, {
      actorAccountId: actor,
      packVersionId: version.value.id,
      kind: 'FIELD',
      fieldKey: 'x',
      citation: 'x',
    });
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
    return published.value.id;
  }

  it('lists every mission attached to a specific pack version, and none attached to a different one', async () => {
    const { account, applicantId } = await seed(db);
    const versionA = await publishedVersion(account.id, 'impact.a');
    const versionB = await publishedVersion(account.id, 'impact.b');

    const onA = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'On A',
    });
    const alsoOnA = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'Also on A',
    });
    const onB = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'On B',
    });
    if (!isOk(onA) || !isOk(alsoOnA) || !isOk(onB)) throw new Error('mission');
    await attachPackVersion(db, {
      actorAccountId: account.id,
      missionId: onA.value.id,
      packVersionId: versionA,
    });
    await attachPackVersion(db, {
      actorAccountId: account.id,
      missionId: alsoOnA.value.id,
      packVersionId: versionA,
    });
    await attachPackVersion(db, {
      actorAccountId: account.id,
      missionId: onB.value.id,
      packVersionId: versionB,
    });

    const impact = await listMissionsByPackVersion(db, versionA);
    expect(impact.map((m) => m.missionId).sort()).toEqual([onA.value.id, alsoOnA.value.id].sort());
    expect(impact.every((m) => m.applicantId === applicantId)).toBe(true);
  });

  it('returns an empty list for a version nothing is attached to', async () => {
    const { account } = await seed(db);
    const versionA = await publishedVersion(account.id, 'impact.unused');
    expect(await listMissionsByPackVersion(db, versionA)).toEqual([]);
  });
});

describe('CAS-07 (Commercial V1 Part 7 §6): canonical case states', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  async function setUp(db: Db) {
    const { account, applicantId } = await seed(db);
    const packVersionId = await publishedPack(db, account.id);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'UK Visa',
    });
    if (!isOk(mission)) throw new Error('mission');
    await attachPackVersion(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packVersionId,
    });
    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    const fact = await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'passport.number',
      value: 'A1',
    });
    if (!isOk(fact)) throw new Error('fact');
    const requirements = await db
      .select()
      .from(schema.packRequirements)
      .where(eq(schema.packRequirements.packVersionId, packVersionId));
    const fieldRequirementId = requirements.find((r) => r.kind === 'FIELD')?.id;
    if (!fieldRequirementId) throw new Error('requirement');
    const selected = await selectEvidence(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packRequirementId: fieldRequirementId,
      factId: fact.value.fact.id,
    });
    if (!isOk(selected)) throw new Error('select');
    const snap = await snapshotMission(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
    });
    if (!isOk(snap)) throw new Error('snapshot');

    return {
      account,
      applicantId,
      missionId: mission.value.id,
      snapshotId: snap.value.id,
      checksum: snap.value.checksum,
    };
  }

  /** Acknowledge the mission's current snapshot, so it has a live acknowledgement. */
  async function acknowledge(
    db: Db,
    actorAccountId: string,
    missionId: string,
    snapshotId: string,
    checksum: string,
  ) {
    const result = await decideAcknowledgement(db, {
      actorAccountId,
      missionId,
      snapshotId,
      expectedSnapshotChecksum: checksum,
      decision: 'ACKNOWLEDGED',
      stepUpSatisfied: true,
    });
    if (!isOk(result)) throw new Error('acknowledge');
  }

  it('walks the full canonical path: DRAFT -> INTAKE -> IN_REVIEW -> AWAITING_APPLICANT -> SUBMISSION_READY -> CLOSED', async () => {
    const { account, missionId, snapshotId, checksum } = await setUp(db);

    const toIntake = await transitionMission(db, {
      actorAccountId: account.id,
      missionId,
      to: 'INTAKE',
    });
    expect(isOk(toIntake)).toBe(true);
    const toInReview = await transitionMission(db, {
      actorAccountId: account.id,
      missionId,
      to: 'IN_REVIEW',
    });
    expect(isOk(toInReview)).toBe(true);
    const toAwaiting = await transitionMission(db, {
      actorAccountId: account.id,
      missionId,
      to: 'AWAITING_APPLICANT',
    });
    expect(isOk(toAwaiting)).toBe(true);

    await acknowledge(db, account.id, missionId, snapshotId, checksum);

    const toSubmissionReady = await transitionMission(db, {
      actorAccountId: account.id,
      missionId,
      to: 'SUBMISSION_READY',
    });
    expect(isOk(toSubmissionReady)).toBe(true);
    if (isOk(toSubmissionReady)) expect(toSubmissionReady.value.state).toBe('SUBMISSION_READY');

    const toClosed = await transitionMission(db, {
      actorAccountId: account.id,
      missionId,
      to: 'CLOSED',
    });
    expect(isOk(toClosed)).toBe(true);
  });

  it('refuses AWAITING_APPLICANT -> SUBMISSION_READY without a live acknowledgement', async () => {
    const { account, missionId } = await setUp(db);
    await transitionMission(db, { actorAccountId: account.id, missionId, to: 'INTAKE' });
    await transitionMission(db, { actorAccountId: account.id, missionId, to: 'IN_REVIEW' });
    await transitionMission(db, {
      actorAccountId: account.id,
      missionId,
      to: 'AWAITING_APPLICANT',
    });

    const result = await transitionMission(db, {
      actorAccountId: account.id,
      missionId,
      to: 'SUBMISSION_READY',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe('invalid');
      expect(result.error.message).toContain('acknowledgement');
    }
  });

  it('a material change after acknowledging invalidates it, so a later SUBMISSION_READY attempt fails again (TRU-03 -> TRU-02 -> CAS-07, end to end)', async () => {
    const { account, applicantId, missionId, snapshotId, checksum } = await setUp(db);
    await transitionMission(db, { actorAccountId: account.id, missionId, to: 'INTAKE' });
    await transitionMission(db, { actorAccountId: account.id, missionId, to: 'IN_REVIEW' });
    await transitionMission(db, {
      actorAccountId: account.id,
      missionId,
      to: 'AWAITING_APPLICANT',
    });
    await acknowledge(db, account.id, missionId, snapshotId, checksum);

    // The case changes materially after acknowledging -- TRU-03's own
    // invalidation wiring (via incrementMaterialRevision) marks that
    // acknowledgement no longer live.
    const edited = await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'passport.number',
      value: 'A2',
    });
    expect(isOk(edited)).toBe(true);

    const result = await transitionMission(db, {
      actorAccountId: account.id,
      missionId,
      to: 'SUBMISSION_READY',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('invalid');
  });

  it('bridges the legacy LOCKED state to SUBMISSION_READY, but only with a live acknowledgement (directive: "Legacy locked ... requires real acknowledgement for future submission-ready claim")', async () => {
    const { account, missionId } = await setUp(db);
    // Walk the ORIGINAL legacy path, completely unchanged.
    await transitionMission(db, { actorAccountId: account.id, missionId, to: 'IN_PROGRESS' });
    await transitionMission(db, { actorAccountId: account.id, missionId, to: 'READY_FOR_REVIEW' });
    await transitionMission(db, { actorAccountId: account.id, missionId, to: 'UNDER_REVIEW' });
    await transitionMission(db, { actorAccountId: account.id, missionId, to: 'READY_TO_EXPORT' });
    const toLocked = await transitionMission(db, {
      actorAccountId: account.id,
      missionId,
      to: 'LOCKED',
    });
    expect(isOk(toLocked)).toBe(true);

    const withoutAck = await transitionMission(db, {
      actorAccountId: account.id,
      missionId,
      to: 'SUBMISSION_READY',
    });
    expect(isErr(withoutAck)).toBe(true);
    if (isErr(withoutAck)) expect(withoutAck.error.code).toBe('invalid');

    // LOCKED's own original path to CLOSED still works, unchanged.
    const stillLegacyClosed = await transitionMission(db, {
      actorAccountId: account.id,
      missionId,
      to: 'CLOSED',
    });
    expect(isOk(stillLegacyClosed)).toBe(true);
  });

  it('the legacy LOCKED -> SUBMISSION_READY bridge succeeds once a live acknowledgement exists', async () => {
    const { account, missionId, snapshotId, checksum } = await setUp(db);
    await transitionMission(db, { actorAccountId: account.id, missionId, to: 'IN_PROGRESS' });
    await transitionMission(db, { actorAccountId: account.id, missionId, to: 'READY_FOR_REVIEW' });
    await transitionMission(db, { actorAccountId: account.id, missionId, to: 'UNDER_REVIEW' });
    await transitionMission(db, { actorAccountId: account.id, missionId, to: 'READY_TO_EXPORT' });
    await transitionMission(db, { actorAccountId: account.id, missionId, to: 'LOCKED' });

    await acknowledge(db, account.id, missionId, snapshotId, checksum);

    const result = await transitionMission(db, {
      actorAccountId: account.id,
      missionId,
      to: 'SUBMISSION_READY',
    });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.state).toBe('SUBMISSION_READY');
  });

  it('SUBMITTED is not yet a legal transition target from any state (TRU-04 not built)', async () => {
    const { account, missionId, snapshotId, checksum } = await setUp(db);
    await transitionMission(db, { actorAccountId: account.id, missionId, to: 'INTAKE' });
    await transitionMission(db, { actorAccountId: account.id, missionId, to: 'IN_REVIEW' });
    await transitionMission(db, {
      actorAccountId: account.id,
      missionId,
      to: 'AWAITING_APPLICANT',
    });
    await acknowledge(db, account.id, missionId, snapshotId, checksum);
    await transitionMission(db, { actorAccountId: account.id, missionId, to: 'SUBMISSION_READY' });

    const result = await transitionMission(db, {
      actorAccountId: account.id,
      missionId,
      to: 'SUBMITTED',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('invalid');
  });

  it('DRAFT still legally reaches the original legacy IN_PROGRESS path alongside the new INTAKE one', async () => {
    const { account, missionId } = await setUp(db);
    expect(legalTransitions('DRAFT')).toEqual(
      expect.arrayContaining(['INTAKE', 'IN_PROGRESS', 'CANCELLED']),
    );
    const result = await transitionMission(db, {
      actorAccountId: account.id,
      missionId,
      to: 'IN_PROGRESS',
    });
    expect(isOk(result)).toBe(true);
  });
});

describe('OPS-04 (Commercial V1 Part 9): case analytics', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  async function events(type: string) {
    return (await db.select().from(schema.productEvents)).filter((e) => e.eventType === type);
  }

  /**
   * A case on a published pack that requires passport.number, with that field
   * selected as its evidence. A document requirement can be added on top, and
   * left unsatisfied, to give the case a gap.
   */
  async function setUp(
    options: {
      readonly document?: 'required' | 'optional';
      readonly manualMode?: boolean;
    } = {},
  ) {
    const { account, applicantId } = await seed(db);
    const pack = await createPack(db, {
      actorAccountId: account.id,
      key: 'ops04.pack',
      name: 'OPS-04 pack',
    });
    if (!isOk(pack)) throw new Error('pack');
    const version = await addPackVersion(db, { actorAccountId: account.id, packId: pack.value.id });
    if (!isOk(version)) throw new Error('version');
    await addRequirement(db, {
      actorAccountId: account.id,
      packVersionId: version.value.id,
      kind: 'FIELD',
      fieldKey: 'passport.number',
      citation: 'rule 1',
    });
    if (options.document) {
      await addRequirement(db, {
        actorAccountId: account.id,
        packVersionId: version.value.id,
        kind: 'DOCUMENT',
        docType: 'bank_statement',
        citation: 'rule 2',
        optional: options.document === 'optional',
      });
    }
    await approvePackVersion(db, { actorAccountId: account.id, packVersionId: version.value.id });
    await publishPackVersion(db, { actorAccountId: account.id, packVersionId: version.value.id });

    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'UK Visa',
      ...(options.manualMode ? { manualMode: true } : {}),
    });
    if (!isOk(mission)) throw new Error('mission');
    await attachPackVersion(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packVersionId: version.value.id,
    });
    await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
    const fact = await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'passport.number',
      value: 'A1',
    });
    if (!isOk(fact)) throw new Error('fact');
    const requirements = await db
      .select()
      .from(schema.packRequirements)
      .where(eq(schema.packRequirements.packVersionId, version.value.id));
    const fieldRequirementId = requirements.find((r) => r.kind === 'FIELD')?.id;
    if (!fieldRequirementId) throw new Error('requirement');
    const selected = await selectEvidence(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packRequirementId: fieldRequirementId,
      factId: fact.value.fact.id,
    });
    if (!isOk(selected)) throw new Error('select');
    return { account, applicantId, missionId: mission.value.id };
  }

  async function moveTo(accountId: string, missionId: string, ...states: MissionState[]) {
    for (const to of states) {
      const result = await transitionMission(db, { actorAccountId: accountId, missionId, to });
      if (!isOk(result)) throw new Error(`transition to ${to}`);
    }
  }

  /** Capture the case as it stands and acknowledge that capture. */
  async function snapshotAndAcknowledge(accountId: string, missionId: string) {
    const snap = await snapshotMission(db, { actorAccountId: accountId, missionId });
    if (!isOk(snap)) throw new Error('snapshot');
    const ack = await decideAcknowledgement(db, {
      actorAccountId: accountId,
      missionId,
      snapshotId: snap.value.id,
      expectedSnapshotChecksum: snap.value.checksum,
      decision: 'ACKNOWLEDGED',
      stepUpSatisfied: true,
    });
    if (!isOk(ack)) throw new Error('acknowledge');
  }

  it('activates an account with its first case and no other, recording how soon after sign-up that case came', async () => {
    const { account, applicantId } = await seed(db);
    for (const title of ['First case', 'Second case']) {
      const result = await createMission(db, { actorAccountId: account.id, applicantId, title });
      expect(isOk(result), title).toBe(true);
    }

    const created = await events('MISSION_CREATED');
    expect(created).toHaveLength(2);
    for (const event of created) {
      expect(event).toMatchObject({ accountId: account.id, organizationId: null });
    }
    const activated = await events('ACCOUNT_ACTIVATED');
    expect(activated).toHaveLength(1);
    expect(activated[0]).toMatchObject({
      accountId: account.id,
      organizationId: null,
      dimension: 'TRAVELLER',
    });
    // Sign-up and first case happened seconds apart inside this test.
    expect(activated[0]?.metricValue).toBeGreaterThanOrEqual(0);
    expect(activated[0]?.metricValue).toBeLessThan(120);
    expect(activated[0]?.dedupeKey).toMatch(/^[0-9a-f]{64}$/);
    expect(activated[0]?.dedupeKey).not.toContain(account.id);
  });

  it("carries the organization on an agency's case, and activates the account as an agency", async () => {
    const { account, applicantId } = await seed(db);
    const org = await createOrganization(db, { actorAccountId: account.id, name: 'Acme Visas' });
    if (!isOk(org)) throw new Error('org');
    const result = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'Agency case',
      ownerOrganizationId: org.value.id,
    });
    expect(isOk(result)).toBe(true);

    expect(await events('MISSION_CREATED')).toMatchObject([
      { accountId: account.id, organizationId: org.value.id },
    ]);
    expect(await events('ACCOUNT_ACTIVATED')).toMatchObject([
      { accountId: account.id, organizationId: org.value.id, dimension: 'AGENCY' },
    ]);
  });

  it('records every stage change by the state it moved to, and nothing for a move that is refused', async () => {
    const { account, missionId } = await setUp();
    await moveTo(account.id, missionId, 'INTAKE', 'IN_REVIEW', 'AWAITING_APPLICANT');

    // Not a legal move, and not allowed without a live acknowledgement: neither happens.
    const illegal = await transitionMission(db, {
      actorAccountId: account.id,
      missionId,
      to: 'CLOSED',
    });
    const unacknowledged = await transitionMission(db, {
      actorAccountId: account.id,
      missionId,
      to: 'SUBMISSION_READY',
    });
    expect([isErr(illegal), isErr(unacknowledged)]).toEqual([true, true]);

    const stages = await events('MISSION_STAGE_CHANGED');
    expect(stages.map((e) => e.dimension).sort()).toEqual(
      ['AWAITING_APPLICANT', 'INTAKE', 'IN_REVIEW'].sort(),
    );
    for (const event of stages) {
      expect(event).toMatchObject({
        accountId: account.id,
        organizationId: null,
        metricValue: null,
      });
    }
    expect(await events('MISSION_READY_REACHED')).toEqual([]);
  });

  it('records the first arrival at ready once, as seconds since the case was created, however often the case returns to ready', async () => {
    const { account, missionId } = await setUp();
    const twoHours = 2 * 60 * 60;
    await db
      .update(schema.missions)
      .set({ createdAt: new Date(Date.now() - twoHours * 1000) })
      .where(eq(schema.missions.id, missionId));

    await moveTo(account.id, missionId, 'INTAKE', 'IN_REVIEW', 'AWAITING_APPLICANT');
    await snapshotAndAcknowledge(account.id, missionId);
    await moveTo(account.id, missionId, 'SUBMISSION_READY');

    const first = await events('MISSION_READY_REACHED');
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      accountId: account.id,
      organizationId: null,
      dimension: null,
    });
    expect(first[0]?.metricValue).toBeGreaterThanOrEqual(twoHours);
    expect(first[0]?.metricValue).toBeLessThan(twoHours + 120);

    // Out of ready and back in: the acknowledgement is still live, so this is allowed.
    await moveTo(account.id, missionId, 'IN_REVIEW', 'AWAITING_APPLICANT', 'SUBMISSION_READY');
    expect(await events('MISSION_READY_REACHED')).toHaveLength(1);
    expect((await events('MISSION_STAGE_CHANGED')).map((e) => e.dimension).sort()).toEqual(
      [
        'INTAKE',
        'IN_REVIEW',
        'AWAITING_APPLICANT',
        'SUBMISSION_READY',
        'IN_REVIEW',
        'AWAITING_APPLICANT',
        'SUBMISSION_READY',
      ].sort(),
    );
  });

  it('treats the legacy ready-to-export state as ready too, and does not count the same case again when it later reaches submission-ready', async () => {
    const { account, missionId } = await setUp();
    await moveTo(
      account.id,
      missionId,
      'IN_PROGRESS',
      'READY_FOR_REVIEW',
      'UNDER_REVIEW',
      'READY_TO_EXPORT',
    );
    expect(await events('MISSION_READY_REACHED')).toHaveLength(1);

    await moveTo(account.id, missionId, 'LOCKED');
    await snapshotAndAcknowledge(account.id, missionId);
    await moveTo(account.id, missionId, 'SUBMISSION_READY');
    expect(await events('MISSION_READY_REACHED')).toHaveLength(1);
  });

  it('records the readiness state and the count of required items still unmet when a prepared file is captured', async () => {
    const gap = await setUp({ document: 'required' });
    const snap = await snapshotMission(db, {
      actorAccountId: gap.account.id,
      missionId: gap.missionId,
    });
    expect(isOk(snap)).toBe(true);

    const detected = await events('READINESS_GAPS_DETECTED');
    expect(detected).toHaveLength(1);
    expect(detected[0]).toMatchObject({
      accountId: gap.account.id,
      organizationId: null,
      dimension: 'NEEDS_ACTION',
      metricValue: 1,
    });
  });

  it('counts only required items as gaps: an unmet optional item is not one, and a complete case has none', async () => {
    const optional = await setUp({ document: 'optional' });
    const snap = await snapshotMission(db, {
      actorAccountId: optional.account.id,
      missionId: optional.missionId,
    });
    expect(isOk(snap)).toBe(true);
    expect(await events('READINESS_GAPS_DETECTED')).toMatchObject([
      { dimension: 'READY_FOR_APPLICANT_REVIEW', metricValue: 0 },
    ]);
  });

  it('labels a manual-mode case as manual-only, and records nothing for a case with no pack to check against', async () => {
    const manual = await setUp({ manualMode: true });
    expect(
      isOk(
        await snapshotMission(db, {
          actorAccountId: manual.account.id,
          missionId: manual.missionId,
        }),
      ),
    ).toBe(true);
    expect(await events('READINESS_GAPS_DETECTED')).toMatchObject([{ dimension: 'MANUAL_ONLY' }]);

    const packless = await createMission(db, {
      actorAccountId: manual.account.id,
      applicantId: manual.applicantId,
      title: 'No pack yet',
    });
    if (!isOk(packless)) throw new Error('mission');
    expect(
      isOk(
        await snapshotMission(db, {
          actorAccountId: manual.account.id,
          missionId: packless.value.id,
        }),
      ),
    ).toBe(true);
    expect(await events('READINESS_GAPS_DETECTED')).toHaveLength(1);
  });

  it('can label every state a case can be in, so a state added later is never silently dropped', async () => {
    const { account } = await seed(db);
    for (const state of schema.missionState.enumValues) {
      await recordProductEvent(db, {
        eventType: 'MISSION_STAGE_CHANGED',
        accountId: account.id,
        dimension: state,
      });
    }
    const labels = (await events('MISSION_STAGE_CHANGED')).map((e) => e.dimension).sort();
    expect(labels).toEqual([...schema.missionState.enumValues].sort());
  });

  it('puts nothing personal in any event across a whole case: no name, title, email or field value', async () => {
    const { account, missionId } = await setUp({ document: 'required' });
    await moveTo(account.id, missionId, 'INTAKE', 'IN_REVIEW', 'AWAITING_APPLICANT');
    await snapshotAndAcknowledge(account.id, missionId);
    await moveTo(account.id, missionId, 'SUBMISSION_READY');

    const stored = JSON.stringify(await db.select().from(schema.productEvents));
    expect(stored).toContain('MISSION_STAGE_CHANGED');
    for (const personal of ['Owner', 'UK Visa', 'm@example.com', 'A1', 'passport.number']) {
      expect(stored, personal).not.toContain(personal);
    }
  });
});

describe('LC-A1 - readiness counts only what it should (replaced, archived, deleted documents)', () => {
  /** A case on the uk.tourist pack plus one clean bank statement. */
  async function setUp(options: { readonly withoutLifecycle?: boolean } = {}) {
    const client = await createMigratedPglite();
    if (options.withoutLifecycle) {
      await client.exec(
        'drop table document_removal_requests, document_lifecycle, applicant_lifecycle, deletion_receipts cascade',
      );
    }
    const db = drizzle(client, { schema }) as unknown as Db;
    const { account, applicantId } = await seed(db);
    const packVersionId = await publishedPack(db, account.id);
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'UK Visa',
      itineraryRef: 'trip-1',
    });
    if (!isOk(mission)) throw new Error('mission');
    await attachPackVersion(db, {
      actorAccountId: account.id,
      missionId: mission.value.id,
      packVersionId,
    });
    const addDocument = async (name: string, docType = 'bank_statement') => {
      const doc = await registerDocument(db, {
        actorAccountId: account.id,
        applicantId,
        originalName: name,
        docType,
      });
      if (!isOk(doc)) throw new Error('doc');
      await addDocumentVersion(db, {
        actorAccountId: account.id,
        documentId: doc.value.id,
        bucket: 'CLEAN',
        objectKey: `k-${name}`,
        safetyStatus: 'CLEAN',
        processingStatus: 'AWAITING_REVIEW',
      });
      return doc.value.id;
    };
    const documentId = await addDocument('bank.pdf');
    const requirements = await db
      .select()
      .from(schema.packRequirements)
      .where(eq(schema.packRequirements.packVersionId, packVersionId));
    const documentRequirementId = requirements.find((r) => r.kind === 'DOCUMENT')?.id as string;
    const missionId = mission.value.id;
    const documentResult = async () => {
      const readiness = await computeReadiness(db, missionId);
      if (!isOk(readiness)) throw new Error('readiness');
      const result = readiness.value.requirementResults.find((r) => r.kind === 'DOCUMENT');
      const missing = readiness.value.missing.some((m) => m.kind === 'DOCUMENT');
      return { result, missing };
    };
    const candidates = async () => {
      const entries = await getEvidenceCandidates(db, account.id, missionId);
      if (!isOk(entries)) throw new Error('candidates');
      const entry = entries.value.find((e) => e.kind === 'DOCUMENT');
      return (entry?.documentCandidates ?? []).map((d) => d.documentId);
    };
    const select = (id: string) =>
      selectEvidence(db, {
        actorAccountId: account.id,
        missionId,
        packRequirementId: documentRequirementId,
        documentId: id,
      });
    const archive = (id: string) =>
      db
        .insert(schema.documentLifecycle)
        .values({ documentId: id, applicantId, archivedAt: new Date() });
    const markDeleted = (id: string) => {
      const now = new Date();
      return db.insert(schema.documentLifecycle).values({
        documentId: id,
        applicantId,
        deletedAt: now,
        deletePath: 'DUPLICATE',
        purgeAfter: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      });
    };
    const replace = async (id: string, docType = 'bank_statement') => {
      const newer = await addDocument('bank-newer.pdf', docType);
      await db
        .update(schema.documents)
        .set({ supersededByDocumentId: newer })
        .where(eq(schema.documents.id, id));
      return newer;
    };
    const snapshotDocumentIds = async () => {
      const snap = await snapshotMission(db, { actorAccountId: account.id, missionId });
      if (!isOk(snap)) throw new Error('snapshot');
      const content = snap.value.content as {
        documents: ReadonlyArray<{ documentId: string }>;
        requirementMapping: ReadonlyArray<{
          kind: string;
          documents?: ReadonlyArray<{ documentId: string }>;
          selectedButReplacedOrArchived?: boolean;
        }>;
      };
      return {
        documents: content.documents.map((d) => d.documentId),
        mapping: content.requirementMapping.find((m) => m.kind === 'DOCUMENT'),
      };
    };
    return {
      db,
      account,
      applicantId,
      missionId,
      documentId,
      addDocument,
      documentResult,
      candidates,
      select,
      archive,
      markDeleted,
      replace,
      snapshotDocumentIds,
    };
  }

  it('a clean, current document satisfies its requirement (baseline)', async () => {
    const t = await setUp();
    const { result, missing } = await t.documentResult();
    expect(result?.state).toBe('SATISFIED');
    expect(missing).toBe(false);
    expect(result?.selectedButReplacedOrArchived).toBeUndefined();
  });

  for (const withoutLifecycle of [false, true]) {
    const label = withoutLifecycle ? 'lifecycle tables missing' : 'lifecycle tables present';
    it(`a replaced document no longer satisfies a requirement automatically (${label})`, async () => {
      const t = await setUp({ withoutLifecycle });
      // Replaced by a usable document filed as another type: only the replaced one could match.
      await t.replace(t.documentId, 'payslip');
      const { result, missing } = await t.documentResult();
      expect(result?.state).not.toBe('SATISFIED');
      expect(missing).toBe(true);
      expect(await t.candidates()).toEqual([]);
      expect((await t.snapshotDocumentIds()).documents).not.toContain(t.documentId);
    });

    it(`a replaced document steps aside for its usable replacement (${label})`, async () => {
      const t = await setUp({ withoutLifecycle });
      const newer = await t.replace(t.documentId);
      const { result } = await t.documentResult();
      expect(result?.state).toBe('SATISFIED');
      expect(result?.selectedButReplacedOrArchived).toBeUndefined();
      expect(await t.candidates()).toEqual([newer]);
      expect((await t.snapshotDocumentIds()).documents).not.toContain(t.documentId);
    });

    it(`a replaced document counts again while its replacement is not usable (${label})`, async () => {
      const t = await setUp({ withoutLifecycle });
      const newer = await t.replace(t.documentId);
      await t.db
        .update(schema.documentVersions)
        .set({ processingStatus: 'UPLOADING' })
        .where(eq(schema.documentVersions.documentId, newer));
      const { result } = await t.documentResult();
      expect(result?.state).toBe('SATISFIED');
      expect(await t.candidates()).toEqual(expect.arrayContaining([t.documentId]));
    });

    it(`an explicitly selected replaced document stays eligible and is flagged (${label})`, async () => {
      const t = await setUp({ withoutLifecycle });
      expect(isOk(await t.select(t.documentId))).toBe(true);
      await t.replace(t.documentId);
      const { result, missing } = await t.documentResult();
      expect(result?.state).toBe('SATISFIED');
      expect(missing).toBe(false);
      expect(result?.selectedButReplacedOrArchived).toBe(true);
      expect(await t.candidates()).toContain(t.documentId);
      const snapshot = await t.snapshotDocumentIds();
      expect(snapshot.documents).toContain(t.documentId);
      expect(snapshot.mapping?.selectedButReplacedOrArchived).toBe(true);
    });
  }

  it('an archived document no longer satisfies a requirement automatically', async () => {
    const t = await setUp();
    await t.archive(t.documentId);
    const { result, missing } = await t.documentResult();
    expect(result?.state).not.toBe('SATISFIED');
    expect(missing).toBe(true);
    expect(await t.candidates()).toEqual([]);
    expect((await t.snapshotDocumentIds()).documents).not.toContain(t.documentId);
  });

  it('a replaced document counts again while its replacement is in Recently Deleted', async () => {
    const t = await setUp();
    const newer = await t.replace(t.documentId);
    await t.markDeleted(newer);
    const { result } = await t.documentResult();
    expect(result?.state).toBe('SATISFIED');
    expect(await t.candidates()).toEqual([t.documentId]);
  });

  it('an archived document leaves automatic matching but another current one still counts', async () => {
    const t = await setUp();
    const other = await t.addDocument('bank-2.pdf');
    await t.archive(t.documentId);
    const { result } = await t.documentResult();
    expect(result?.state).toBe('SATISFIED');
    expect(result?.selectedButReplacedOrArchived).toBeUndefined();
    expect(await t.candidates()).toEqual([other]);
  });

  it('an explicitly selected archived document stays eligible and is flagged (D6)', async () => {
    const t = await setUp();
    expect(isOk(await t.select(t.documentId))).toBe(true);
    await t.archive(t.documentId);
    const { result, missing } = await t.documentResult();
    expect(result?.state).toBe('SATISFIED');
    expect(missing).toBe(false);
    expect(result?.selectedButReplacedOrArchived).toBe(true);
    expect(await t.candidates()).toContain(t.documentId);
    const snapshot = await t.snapshotDocumentIds();
    expect(snapshot.documents).toContain(t.documentId);
    expect(snapshot.mapping?.selectedButReplacedOrArchived).toBe(true);
  });

  it('an archived document can still be chosen on purpose', async () => {
    const t = await setUp();
    await t.archive(t.documentId);
    expect(isOk(await t.select(t.documentId))).toBe(true);
    const { result } = await t.documentResult();
    expect(result?.state).toBe('SATISFIED');
    expect(result?.selectedButReplacedOrArchived).toBe(true);
  });

  it('a document in Recently Deleted is never eligible, even when selected, and cannot be chosen', async () => {
    const t = await setUp();
    expect(isOk(await t.select(t.documentId))).toBe(true);
    await t.markDeleted(t.documentId);
    const { result, missing } = await t.documentResult();
    expect(result?.state).not.toBe('SATISFIED');
    expect(missing).toBe(true);
    expect(await t.candidates()).toEqual([]);
    expect((await t.snapshotDocumentIds()).documents).not.toContain(t.documentId);
    const again = await t.select(t.documentId);
    expect(isErr(again)).toBe(true);
    if (isErr(again)) expect(again.error.code).toBe('not_found');
  });

  it('readiness works unchanged while the lifecycle tables are missing', async () => {
    const t = await setUp({ withoutLifecycle: true });
    const { result } = await t.documentResult();
    expect(result?.state).toBe('SATISFIED');
    expect(await t.candidates()).toEqual([t.documentId]);
    expect(isOk(await t.select(t.documentId))).toBe(true);
    expect((await t.snapshotDocumentIds()).documents).toContain(t.documentId);
    const linked = await listMissionsByItineraryRef(t.db, {
      actorAccountId: t.account.id,
      itineraryRef: 'trip-1',
    });
    expect(linked.map((m) => m.id)).toEqual([t.missionId]);
  });

  it('cases of a traveller record in Recently Deleted are not linked by itinerary reference', async () => {
    const t = await setUp();
    const linked = () =>
      listMissionsByItineraryRef(t.db, { actorAccountId: t.account.id, itineraryRef: 'trip-1' });
    expect((await linked()).map((m) => m.id)).toEqual([t.missionId]);
    const now = new Date();
    await t.db.insert(schema.applicantLifecycle).values({
      applicantId: t.applicantId,
      deletedAt: now,
      purgeAfter: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    });
    expect(await linked()).toEqual([]);
  });
});
