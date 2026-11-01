/*
 * Shared setup for the resource lifecycle acceptance journeys (LC-Z, PROGRAMME section 8) and for
 * any later lifecycle test: a fresh migrated database (with or without the lifecycle tables), an
 * owner with a traveller, documents with a chosen fingerprint and stored file, a published case
 * selecting a document, an active agency with a grant, staff scopes, and the two scheduled jobs
 * that finish a removal (the Recently Deleted purge and the erasure worker).
 *
 * Named `.test-support.ts` so the read-path guard (lifecycle/foundation/read-paths.test.ts) and
 * the package index leave it alone: it reads `schema.documents` directly to check what is left,
 * which only a test may do.
 */
import { PGlite } from '@electric-sql/pglite';
import { type PermissionAction, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { type StaffScope, accountPrincipal, staffPrincipal } from '../../access/principal';
import { type AuthorizedApplicant, requireAccess } from '../../access/require-access';
import { systemScopeForTest } from '../../access/system-scope.test-support';
import { provisionAccount } from '../../accounts';
import { createApplicant } from '../../applicants';
import { setConsent } from '../../consent';
import type { Db } from '../../db';
import { addDocumentVersion, registerDocument } from '../../documents';
import { type ErasureWorkerResult, runErasureWorker } from '../../erasure';
import { attachPackVersion, createMission, selectEvidence } from '../../missions';
import { createOrganization, reviewOrganization } from '../../organizations';
import {
  addPackVersion,
  addRequirement,
  approvePackVersion,
  createPack,
  publishPackVersion,
} from '../../packs';
import type { PlatformAction } from '../../platform-roles';
import { acceptGrant, createGrant } from '../../sharing';
import type {
  BlobStore,
  ListObjectsPage,
  PutObjectInput,
  StorageBucket,
  StoredBytes,
} from '../../storage';
import { type PurgeDueDocumentsResult, purgeDueDocuments } from '../recently-deleted/purge';

/** Journeys run several services end to end on an in-process database; CI machines are slower. */
export const JOURNEY_TIMEOUT = 180_000;
export const DAY_MS = 86_400_000;
export const SHA_A = 'a'.repeat(64);
export const SHA_B = 'b'.repeat(64);
export const SHA_C = 'c'.repeat(64);
export const MISSING_TABLES_SQL =
  'drop table document_removal_requests, document_lifecycle, applicant_lifecycle, deletion_receipts cascade';

export interface JourneyDb {
  readonly db: Db;
  readonly client: PGlite;
}

/** A fresh, fully migrated database; `withoutLifecycle` gives the database as it was before 0113. */
export async function freshJourneyDb(
  options: { readonly withoutLifecycle?: boolean } = {},
): Promise<JourneyDb> {
  const client = await createMigratedPglite();
  if (options.withoutLifecycle) await client.exec(MISSING_TABLES_SQL);
  return { db: drizzle(client, { schema }) as unknown as Db, client };
}

/** A restorable copy of `client` as it is now: the backup a later restore drill starts from. */
export async function backupOf(client: PGlite): Promise<JourneyDb> {
  const dump = await client.dumpDataDir('none');
  const copy = new PGlite({ loadDataDir: dump });
  return { db: drizzle(copy, { schema }) as unknown as Db, client: copy };
}

/** In-memory private storage, enough for a real erasure worker pass. */
export class MemoryBlobStore implements BlobStore {
  readonly objects = new Map<string, StoredBytes>();
  async putObject(input: PutObjectInput): Promise<void> {
    this.objects.set(input.objectKey, { contentType: input.contentType, bytes: input.bytes });
  }
  async getObject(objectKey: string): Promise<StoredBytes | undefined> {
    return this.objects.get(objectKey);
  }
  async deleteObject(_bucket: StorageBucket, objectKey: string): Promise<void> {
    this.objects.delete(objectKey);
  }
  async listObjectKeys(): Promise<ListObjectsPage> {
    return { objectKeys: [...this.objects.keys()], cursor: undefined };
  }
}

export interface JourneyOwner {
  readonly accountId: string;
  readonly applicantId: string;
  readonly email: string;
}

let counter = 0;
/** A per-run unique number for object keys, pack keys and emails. */
export function nextKey(): number {
  counter += 1;
  return counter;
}

/** A signed-up account with core processing and sharing consent. */
export async function seedAccount(db: Db, email: string): Promise<string> {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error(`provision ${email}`);
  const accountId = provisioned.value.id;
  for (const type of ['CORE_PROCESSING', 'SHARING'] as const) {
    await setConsent(db, { actorAccountId: accountId, accountId, type, granted: true });
  }
  return accountId;
}

/** A traveller record on `accountId`. */
export async function addTraveller(
  db: Db,
  accountId: string,
  options: {
    readonly relationship?: 'SELF' | 'FAMILY_MEMBER';
    readonly displayName?: string;
  } = {},
): Promise<string> {
  const relationship = options.relationship ?? 'SELF';
  const created = await createApplicant(db, {
    actorAccountId: accountId,
    ownerAccountId: accountId,
    displayName: options.displayName ?? 'Synthetic Traveller',
    relationship,
    authorityConfirmed: true,
  });
  if (!isOk(created)) throw new Error(`applicant: ${created.error.code}`);
  return created.value.id;
}

/** An owner with one Myself traveller record. */
export async function seedOwner(
  db: Db,
  email: string,
  options: { readonly displayName?: string } = {},
): Promise<JourneyOwner> {
  const accountId = await seedAccount(db, email);
  const applicantId = await addTraveller(db, accountId, {
    relationship: 'SELF',
    ...(options.displayName ? { displayName: options.displayName } : {}),
  });
  return { accountId, applicantId, email };
}

export interface UploadOptions {
  /** The file's fingerprint; null records none. */
  readonly sha?: string | null;
  readonly name?: string;
  readonly docType?: string;
  /** Usable (scanned clean); false leaves it still being checked. Default true. */
  readonly ready?: boolean;
  /** Puts the bytes into this store so the erasure worker has something to remove. */
  readonly storage?: MemoryBlobStore;
  readonly sizeBytes?: number;
  readonly expiresAt?: Date;
  readonly createdAt?: Date;
}

export interface UploadedDocument {
  readonly documentId: string;
  readonly versionId: string;
  readonly objectKey: string;
}

/** Upload one document with one version, as the upload action registers it. */
export async function uploadDocument(
  db: Db,
  owner: Pick<JourneyOwner, 'accountId' | 'applicantId'>,
  options: UploadOptions = {},
): Promise<UploadedDocument> {
  const doc = await registerDocument(db, {
    actorAccountId: owner.accountId,
    applicantId: owner.applicantId,
    originalName: options.name ?? 'synthetic.pdf',
    docType: options.docType ?? 'PASSPORT',
  });
  if (!isOk(doc)) throw new Error(`document: ${doc.error.code}`);
  const documentId = doc.value.id;
  if (options.createdAt || options.expiresAt) {
    await db
      .update(schema.documents)
      .set({
        ...(options.createdAt ? { createdAt: options.createdAt } : {}),
        ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
      })
      .where(eq(schema.documents.id, documentId));
  }
  const objectKey = `lc-z-journey-${nextKey()}`;
  const ready = options.ready ?? true;
  const sha = options.sha === undefined ? SHA_A : options.sha;
  const version = await addDocumentVersion(db, {
    actorAccountId: owner.accountId,
    documentId,
    bucket: ready ? 'CLEAN' : 'QUARANTINE',
    objectKey,
    safetyStatus: ready ? 'CLEAN' : 'PENDING',
    processingStatus: ready ? 'AWAITING_REVIEW' : 'SCANNING',
    ...(sha === null ? {} : { sha256: sha }),
  });
  if (!isOk(version)) throw new Error(`version: ${version.error.code}`);
  const sizeBytes = options.sizeBytes ?? 10;
  await db
    .update(schema.storageObjects)
    .set({ sizeBytes })
    .where(eq(schema.storageObjects.objectKey, objectKey));
  await options.storage?.putObject({
    bucket: ready ? 'CLEAN' : 'QUARANTINE',
    objectKey,
    contentType: 'application/pdf',
    bytes: new Uint8Array(sizeBytes),
  });
  return { documentId, versionId: version.value.version.id, objectKey };
}

export interface OpenedCase {
  readonly missionId: string;
  readonly requirementId: string;
}

/**
 * A published case for `owner` asking for one document of `docType`; with `documentId` that
 * document is selected for it. `state` moves the case on (a finished case).
 */
export async function openCase(
  db: Db,
  owner: Pick<JourneyOwner, 'accountId' | 'applicantId'>,
  options: {
    readonly documentId?: string;
    readonly docType?: string;
    readonly state?: 'SUBMITTED' | 'CLOSED';
    readonly title?: string;
  } = {},
): Promise<OpenedCase> {
  const key = nextKey();
  const pack = await createPack(db, {
    actorAccountId: owner.accountId,
    key: `lcz.case.${key}`,
    name: 'Synthetic Pack',
  });
  if (!isOk(pack)) throw new Error('pack');
  const version = await addPackVersion(db, {
    actorAccountId: owner.accountId,
    packId: pack.value.id,
  });
  if (!isOk(version)) throw new Error('pack version');
  const requirement = await addRequirement(db, {
    actorAccountId: owner.accountId,
    packVersionId: version.value.id,
    kind: 'DOCUMENT',
    docType: options.docType ?? 'PASSPORT',
    citation: 'rule 1',
  });
  if (!isOk(requirement)) throw new Error('requirement');
  await approvePackVersion(db, {
    actorAccountId: owner.accountId,
    packVersionId: version.value.id,
  });
  await publishPackVersion(db, {
    actorAccountId: owner.accountId,
    packVersionId: version.value.id,
  });
  const mission = await createMission(db, {
    actorAccountId: owner.accountId,
    applicantId: owner.applicantId,
    title: options.title ?? `Synthetic case ${key}`,
  });
  if (!isOk(mission)) throw new Error('mission');
  await attachPackVersion(db, {
    actorAccountId: owner.accountId,
    missionId: mission.value.id,
    packVersionId: version.value.id,
  });
  if (options.documentId) {
    const selected = await selectEvidence(db, {
      actorAccountId: owner.accountId,
      missionId: mission.value.id,
      packRequirementId: requirement.value.id,
      documentId: options.documentId,
    });
    if (!isOk(selected)) throw new Error(`select: ${selected.error.code}`);
  }
  if (options.state) {
    await db
      .update(schema.missions)
      .set({
        state: options.state,
        ...(options.state === 'CLOSED' ? { closedAt: new Date() } : {}),
      })
      .where(eq(schema.missions.id, mission.value.id));
  }
  return { missionId: mission.value.id, requirementId: requirement.value.id };
}

/** The owner's own access proof for the whole traveller record. */
export async function ownerProof<A extends PermissionAction = 'MANAGE'>(
  db: Db,
  owner: Pick<JourneyOwner, 'accountId' | 'applicantId'>,
  action?: A,
): Promise<AuthorizedApplicant<A>> {
  const result = await requireAccess(
    db,
    accountPrincipal(owner.accountId),
    (action ?? 'MANAGE') as A,
    { applicantId: owner.applicantId },
    { purpose: 'self' },
  );
  if (!result.ok) throw new Error(`proof: ${result.error.code}`);
  return result.value;
}

/** A bootstrap staff scope for `action` (fresh, so it may act). */
export async function staffScope<A extends PlatformAction>(
  db: Db,
  email: string,
  action: A,
): Promise<StaffScope<A> & { readonly accountId: string }> {
  const existing = await db
    .select({ id: schema.accounts.id })
    .from(schema.accounts)
    .where(eq(schema.accounts.email, email));
  let accountId = existing[0]?.id;
  if (!accountId) {
    const created = await provisionAccount(db, { email });
    if (!isOk(created)) throw new Error('staff account');
    accountId = created.value.id;
  }
  const scope = await staffPrincipal(db, { accountId, email, bootstrapEmails: [email] }, action);
  if (!scope.ok) throw new Error(`staff scope: ${scope.error.code}`);
  return scope.value as StaffScope<A> & { readonly accountId: string };
}

export interface SeededAgency {
  readonly agentAccountId: string;
  readonly organizationId: string;
  readonly grantId: string;
}

/** An active agency whose member accepted a grant on `owner`'s record. */
export async function seedAgencyWithGrant(
  db: Db,
  owner: Pick<JourneyOwner, 'accountId' | 'applicantId'>,
  options: {
    readonly actions?: readonly PermissionAction[];
    readonly missionId?: string;
    readonly active?: boolean;
  } = {},
): Promise<SeededAgency> {
  const key = nextKey();
  const agent = await provisionAccount(db, { email: `lcz-agent-${key}@example.com` });
  if (!isOk(agent)) throw new Error('agent');
  const org = await createOrganization(db, {
    actorAccountId: agent.value.id,
    name: `Agency ${key}`,
  });
  if (!isOk(org)) throw new Error('organization');
  const reviewer = await provisionAccount(db, { email: `lcz-reviewer-${key}@example.com` });
  if (!isOk(reviewer)) throw new Error('reviewer');
  await reviewOrganization(db, {
    reviewerAccountId: reviewer.value.id,
    organizationId: org.value.id,
    decision: 'ACTIVE',
    stepUpSatisfied: true,
  });
  const grant = await createGrant(db, {
    actorAccountId: owner.accountId,
    applicantId: owner.applicantId,
    recipientOrganizationId: org.value.id,
    actions: [...(options.actions ?? ['VIEW_METADATA', 'MANAGE'])],
    purpose: 'review',
    ...(options.missionId ? { missionId: options.missionId } : {}),
  });
  if (!isOk(grant)) throw new Error(`grant: ${grant.error.code}`);
  const accepted = await acceptGrant(db, {
    actorAccountId: agent.value.id,
    grantId: grant.value.id,
  });
  if (!isOk(accepted)) throw new Error('accept grant');
  if (options.active === false) {
    await db
      .update(schema.organizations)
      .set({ status: 'SUSPENDED' })
      .where(eq(schema.organizations.id, org.value.id));
  }
  return { agentAccountId: agent.value.id, organizationId: org.value.id, grantId: grant.value.id };
}

/** The scheduled Recently Deleted purge, as the erasure job runs it, at `now`. */
export function runPurge(db: Db, now?: Date): Promise<PurgeDueDocumentsResult> {
  return purgeDueDocuments(db, systemScopeForTest('process-erasure'), now ? { now } : {});
}

/** One pass of the erasure worker against `storage`. */
export function runErasure(db: Db, storage: BlobStore): Promise<ErasureWorkerResult> {
  return runErasureWorker(db, storage, { limit: 50 });
}

export function daysAfter(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY_MS);
}

// --- Reads a journey checks -------------------------------------------------------------------

export async function documentExists(db: Db, documentId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(eq(schema.documents.id, documentId));
  return rows.length === 1;
}

export async function receiptRow(db: Db, receiptId: string) {
  const [row] = await db
    .select()
    .from(schema.deletionReceipts)
    .where(eq(schema.deletionReceipts.id, receiptId));
  return row;
}

export async function receiptsOf(db: Db, applicantId: string) {
  return db
    .select()
    .from(schema.deletionReceipts)
    .where(eq(schema.deletionReceipts.applicantId, applicantId));
}

export async function lifecycleRow(db: Db, documentId: string) {
  const [row] = await db
    .select()
    .from(schema.documentLifecycle)
    .where(eq(schema.documentLifecycle.documentId, documentId));
  return row;
}

export async function selectedDocumentsOf(db: Db, missionId: string): Promise<string[]> {
  const rows = await db
    .select({ documentId: schema.selectedEvidence.documentId })
    .from(schema.selectedEvidence)
    .where(eq(schema.selectedEvidence.missionId, missionId));
  return rows.flatMap((row) => (row.documentId ? [row.documentId] : []));
}

export async function revisionOf(db: Db, missionId: string): Promise<number> {
  const [row] = await db
    .select({ revision: schema.missions.materialRevision })
    .from(schema.missions)
    .where(eq(schema.missions.id, missionId));
  if (!row) throw new Error('mission');
  return row.revision;
}

export async function erasureJobsFor(db: Db, documentId: string) {
  return db.select().from(schema.erasureJobs).where(eq(schema.erasureJobs.documentId, documentId));
}

export async function productEventTypes(db: Db): Promise<string[]> {
  const rows = await db
    .select({ eventType: schema.productEvents.eventType })
    .from(schema.productEvents);
  return rows.map((row) => row.eventType);
}

export async function auditEventsOf(db: Db, eventType: string) {
  return db
    .select({
      eventType: schema.auditEvents.eventType,
      resourceId: schema.auditEvents.resourceId,
      metadata: schema.auditEvents.metadata,
    })
    .from(schema.auditEvents)
    .where(eq(schema.auditEvents.eventType, eventType));
}
