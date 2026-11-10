import { type MissionState, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { provisionAccount } from './accounts';
import { decideAcknowledgement } from './acknowledgements';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { addDocumentVersion, registerDocument } from './documents';
import {
  attachPackVersion,
  createMission,
  selectEvidence,
  snapshotMission,
  transitionMission,
} from './missions';
import {
  addPackVersion,
  addRequirement,
  approvePackVersion,
  createPack,
  publishPackVersion,
} from './packs';
import { editFact, registerFieldDefinition } from './profile';
import { recordSubmission } from './submissions';

export async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, { schema }) as unknown as Db;
}

export type Kind = 'FIELD' | 'DOCUMENT';

export interface Cases {
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

async function publishedPack(db: Db, actor: string, kind: Kind, fieldKey: string): Promise<string> {
  const pack = await createPack(db, { actorAccountId: actor, key: `freeze.${kind}`, name: 'Pack' });
  if (!isOk(pack)) throw new Error('pack');
  const version = await addPackVersion(db, { actorAccountId: actor, packId: pack.value.id });
  if (!isOk(version)) throw new Error('version');
  await addRequirement(db, {
    actorAccountId: actor,
    packVersionId: version.value.id,
    ...(kind === 'FIELD'
      ? { kind: 'FIELD' as const, fieldKey }
      : { kind: 'DOCUMENT' as const, docType: 'passport' }),
    citation: 'rule 1',
  });
  await approvePackVersion(db, { actorAccountId: actor, packVersionId: version.value.id });
  await publishPackVersion(db, { actorAccountId: actor, packVersionId: version.value.id });
  return version.value.id;
}

/** One open case and one submitted case over the same record, each with a live confirmation. */
/** `fieldKey` is the answer a FIELD case uses (the default is not in the catalogue). */
export async function twoCases(db: Db, kind: Kind, fieldKey = 'passport.number'): Promise<Cases> {
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
  const packVersionId = await publishedPack(db, accountId, kind, fieldKey);

  let factId: string | undefined;
  let documentId: string | undefined;
  if (kind === 'FIELD') {
    await registerFieldDefinition(db, { key: fieldKey, dataType: 'string' });
    const fact = await editFact(db, {
      actorAccountId: accountId,
      applicantId,
      fieldKey,
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

export async function caseRow(db: Db, missionId: string) {
  const [row] = await db.select().from(schema.missions).where(eq(schema.missions.id, missionId));
  if (!row) throw new Error('case missing');
  return row;
}

export async function liveConfirmations(db: Db, missionId: string): Promise<number> {
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

export async function setState(db: Db, missionId: string, state: MissionState, closedAt?: Date) {
  await db
    .update(schema.missions)
    .set({ state, ...(closedAt ? { closedAt } : {}) })
    .where(eq(schema.missions.id, missionId));
}
