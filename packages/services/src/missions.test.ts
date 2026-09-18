import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { addFamilyMember, createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { addDocumentVersion, registerDocument } from './documents';
import { enqueueErasureJob } from './erasure';
import {
  attachPackVersion,
  computeReadiness,
  createMission,
  createTask,
  decideTask,
  generateCoverLetter,
  getMissionForOwner,
  getMissionSnapshot,
  listGeneratedOutputs,
  listMissionSnapshots,
  listMissions,
  listMissionsByItineraryRef,
  listMissionsUsingField,
  listSelectedEvidence,
  listSelectedEvidenceForOrg,
  listTasks,
  selectEvidence,
  setMissionItineraryRef,
  snapshotMission,
  transitionMission,
  unselectEvidence,
  updateMissionCaseDetails,
} from './missions';
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
import { editFact, registerFieldDefinition } from './profile';
import { acceptGrant, createGrant } from './sharing';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
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
    if (isErr(forOrg)) expect(forOrg.error.code).toBe('forbidden');
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
