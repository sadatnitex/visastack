import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { getConsents, listConsentHistory, setConsent } from './consent';
import type { Db } from './db';
import {
  cancelAccountDeletion,
  executeAccountDeletion,
  getDeletionImpactSummary,
  getPendingDeletion,
  requestAccountDeletion,
} from './deletion';
import { addDocumentVersion, registerDocument } from './documents';
import { runErasureWorker } from './erasure';
import { exportAccount } from './export';
import { buildExportCsvTables } from './export-csv';
import { placeLegalHold } from './legal-hold';
import { createMission } from './missions';
import { grantPlatformRole } from './platform-roles';
import { editFact, registerFieldDefinition } from './profile';
import type {
  BlobStore,
  ListObjectsPage,
  PutObjectInput,
  StorageBucket,
  StoredBytes,
} from './storage';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

/** Deterministic in-memory blob store — no S3, no network. */
class FakeBlobStore implements BlobStore {
  private readonly objects = new Map<string, StoredBytes>();
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

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

/** Seed a consented account with an applicant carrying a fact and a document. */
async function seedFullAccount(db: Db, email: string) {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision');
  const account = provisioned.value;
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
  await registerFieldDefinition(db, { key: 'passport.number', dataType: 'string' });
  await editFact(db, {
    actorAccountId: account.id,
    applicantId: applicant.value.id,
    fieldKey: 'passport.number',
    value: 'A1',
  });
  const doc = await registerDocument(db, {
    actorAccountId: account.id,
    applicantId: applicant.value.id,
    originalName: 'p.pdf',
  });
  if (!isOk(doc)) throw new Error('doc');
  await addDocumentVersion(db, {
    actorAccountId: account.id,
    documentId: doc.value.id,
    bucket: 'CLEAN',
    objectKey: `obj-${email}`,
  });
  return { account, applicantId: applicant.value.id };
}

describe('account export', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('assembles a full snapshot for the owner', async () => {
    const { account } = await seedFullAccount(db, 'exp@example.com');
    const result = await exportAccount(db, { actorAccountId: account.id, accountId: account.id });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.account.id).toBe(account.id);
    expect(result.value.consents.CORE_PROCESSING).toBe(true);
    expect(result.value.applicants).toHaveLength(1);
    expect(result.value.applicants[0]?.facts[0]?.versions).toHaveLength(1);
    expect(result.value.applicants[0]?.documents[0]?.versions).toHaveLength(1);
    expect(result.value.auditEvents.length).toBeGreaterThan(0);
    // Directive Part 7 §14: "consent/share history" -- the full grant/revoke
    // trail, not just current state.
    expect(result.value.consentHistory.length).toBeGreaterThan(0);
    expect(result.value.consentHistory[0]?.type).toBe('CORE_PROCESSING');
  });

  it('refuses to export another account', async () => {
    const { account } = await seedFullAccount(db, 'exp2@example.com');
    const other = await provisionAccount(db, { email: 'other-exp@example.com' });
    if (!isOk(other)) throw new Error('provision');
    const result = await exportAccount(db, {
      actorAccountId: other.value.id,
      accountId: account.id,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('forbidden');
  });

  it('manifest counts match the actual exported data exactly, and honestly lists known gaps (PRV-04, Part 7 §14: "manifest")', async () => {
    const { account } = await seedFullAccount(db, 'exp-manifest@example.com');
    const result = await exportAccount(db, { actorAccountId: account.id, accountId: account.id });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;

    // seedFullAccount creates exactly: 1 applicant, 1 fact (1 version), 1
    // document (1 version), 0 missions.
    expect(result.value.manifest.counts).toMatchObject({
      applicants: 1,
      facts: 1,
      factVersions: 1,
      documents: 1,
      documentVersions: 1,
      missions: 0,
      missionSnapshots: 0,
    });
    expect(result.value.manifest.counts.consentHistoryEntries).toBe(
      result.value.consentHistory.length,
    );
    expect(result.value.manifest.counts.auditEvents).toBe(result.value.auditEvents.length);

    // Never conflate a permanent, by-design exclusion with a genuine,
    // temporary implementation gap -- both lists must be real and non-empty.
    expect(result.value.manifest.excludedByDesign.length).toBeGreaterThan(0);
    // CSV format shipped in PRV-04 chunk 2 -- only the original document
    // bytes (which need the directive's async export job) remain a gap.
    expect(result.value.manifest.knownGaps.map((g) => g.item)).toEqual(['original document bytes']);
  });

  it('CSV tables mirror the manifest counts exactly, for every table the manifest counts (PRV-04, Part 7 §14: "readable JSON/CSV metadata")', async () => {
    const { account } = await seedFullAccount(db, 'exp-csv@example.com');
    const result = await exportAccount(db, { actorAccountId: account.id, accountId: account.id });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;

    const tables = buildExportCsvTables(result.value);
    const rowCount = (name: string) => tables.find((t) => t.name === name)?.rowCount;

    expect(rowCount('applicants.csv')).toBe(result.value.manifest.counts.applicants);
    expect(rowCount('facts.csv')).toBe(result.value.manifest.counts.facts);
    expect(rowCount('fact_versions.csv')).toBe(result.value.manifest.counts.factVersions);
    expect(rowCount('documents.csv')).toBe(result.value.manifest.counts.documents);
    expect(rowCount('document_versions.csv')).toBe(result.value.manifest.counts.documentVersions);
    expect(rowCount('missions.csv')).toBe(result.value.manifest.counts.missions);
    expect(rowCount('mission_snapshots.csv')).toBe(result.value.manifest.counts.missionSnapshots);
    expect(rowCount('grants_granted.csv')).toBe(result.value.manifest.counts.grantsGranted);
    expect(rowCount('grants_received.csv')).toBe(result.value.manifest.counts.grantsReceived);
    expect(rowCount('evidence_requests.csv')).toBe(result.value.manifest.counts.evidenceRequests);
    expect(rowCount('ai_extraction_runs.csv')).toBe(result.value.manifest.counts.aiExtractionRuns);
    expect(rowCount('audit_events.csv')).toBe(result.value.manifest.counts.auditEvents);
    expect(rowCount('product_events.csv')).toBe(result.value.manifest.counts.productEvents);
    expect(rowCount('consent_history.csv')).toBe(
      result.value.manifest.counts.consentHistoryEntries,
    );

    // A single-row table (the account's own current state) renders as a
    // one-line-plus-header CSV, never an empty string.
    const accountTable = tables.find((t) => t.name === 'account.csv');
    expect(accountTable?.rowCount).toBe(1);
    expect(accountTable?.csv).toContain(account.id);
  });
});

describe('account deletion workflow', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('is reversible during the grace window', async () => {
    const { account } = await seedFullAccount(db, 'del1@example.com');
    const req = await requestAccountDeletion(db, {
      actorAccountId: account.id,
      accountId: account.id,
    });
    expect(isOk(req)).toBe(true);

    // Too early to execute.
    const early = await executeAccountDeletion(db, { accountId: account.id });
    expect(isErr(early)).toBe(true);
    if (isErr(early)) expect(early.error.code).toBe('invalid');

    const cancelled = await cancelAccountDeletion(db, {
      actorAccountId: account.id,
      accountId: account.id,
    });
    expect(isOk(cancelled)).toBe(true);
    // Account still present.
    const rows = await db.select().from(schema.accounts).where(eq(schema.accounts.id, account.id));
    expect(rows).toHaveLength(1);
  });

  it('executes after the window, removing owned data and preserving audit', async () => {
    const { account, applicantId } = await seedFullAccount(db, 'del2@example.com');
    const storage = new FakeBlobStore();
    await storage.putObject({
      bucket: 'CLEAN',
      objectKey: 'obj-del2@example.com',
      contentType: 'application/pdf',
      bytes: new Uint8Array([9, 9, 9]),
    });
    const req = await requestAccountDeletion(db, {
      actorAccountId: account.id,
      accountId: account.id,
      gracePeriodMs: 0,
    });
    expect(isOk(req)).toBe(true);

    const executed = await executeAccountDeletion(db, { accountId: account.id });
    expect(isOk(executed)).toBe(true);
    if (isOk(executed)) expect(executed.value.status).toBe('EXECUTED');

    // Account and applicant are gone immediately (the logical cascade).
    expect(
      await db.select().from(schema.accounts).where(eq(schema.accounts.id, account.id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(schema.applicants).where(eq(schema.applicants.id, applicantId)),
    ).toHaveLength(0);
    // Storage objects survive the logical cascade — erasure.ts owns removing
    // them, only after the external bytes are verified deleted. One erasure
    // job is queued, carrying the object's bucket/key/hash independently of
    // the (already-gone) document version that used to reference it.
    expect(await db.select().from(schema.storageObjects)).toHaveLength(1);
    const jobs = await db.select().from(schema.erasureJobs);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe('PENDING');
    expect(jobs[0]?.reason).toBe('ACCOUNT_DELETION');

    // The worker completes the job: bytes deleted, verified, then (and only
    // then) the storage object row itself is removed.
    const workerResult = await runErasureWorker(db, storage, { limit: 5 });
    expect(workerResult).toEqual({ processed: 1, blocked: 0, failed: 0 });
    expect(await db.select().from(schema.storageObjects)).toHaveLength(0);
    expect(await storage.getObject('obj-del2@example.com')).toBeUndefined();

    // The audit trail is preserved (anonymized) and the tombstone remains.
    expect((await db.select().from(schema.auditEvents)).length).toBeGreaterThan(0);
    const tombstone = await db.select().from(schema.accountDeletionRequests);
    expect(tombstone[0]?.status).toBe('EXECUTED');
    expect(tombstone[0]?.accountId).toBeNull();
  });

  it("revokes (not just orphans) a deleted non-sole-owner account's platform-role grant, preserving history anonymized (finding #17; Codex review, PR #65)", async () => {
    const { account } = await seedFullAccount(db, 'del-role@example.com');
    const secondOwner = await provisionAccount(db, { email: 'del-role-2@example.com' });
    if (!isOk(secondOwner)) throw new Error('provision');
    const bootstrapAuth = {
      accountId: account.id,
      email: 'del-role@example.com',
      bootstrapEmails: ['del-role@example.com'],
    };
    const granted = await grantPlatformRole(db, {
      actor: bootstrapAuth,
      targetAccountId: account.id,
      role: 'PLATFORM_OWNER',
      reason: 'bootstrap',
      stepUpSatisfied: true,
    });
    if (!isOk(granted)) throw new Error('grant');
    // A second owner, so the account deleted below is not the sole owner —
    // see the separate "blocks deleting the sole active platform owner"
    // test for that scenario.
    const secondGrant = await grantPlatformRole(db, {
      actor: bootstrapAuth,
      targetAccountId: secondOwner.value.id,
      role: 'PLATFORM_OWNER',
      reason: 'second owner',
      stepUpSatisfied: true,
    });
    expect(isOk(secondGrant)).toBe(true);

    const req = await requestAccountDeletion(db, {
      actorAccountId: account.id,
      accountId: account.id,
      gracePeriodMs: 0,
    });
    expect(isOk(req)).toBe(true);
    const executed = await executeAccountDeletion(db, { accountId: account.id });
    expect(isOk(executed)).toBe(true);

    // The account is gone, but the role-history row survives with its
    // account reference nulled — never cascaded away — preserving the
    // append-only role-history invariant
    // (docs/audits/post-programme-defect-register.md finding #17). It is
    // now properly revoked, not left dangling "active" with a null account
    // (Codex review, PR #65).
    const roleRows = await db
      .select()
      .from(schema.platformRoles)
      .where(eq(schema.platformRoles.id, granted.value.id));
    expect(roleRows).toHaveLength(1);
    expect(roleRows[0]?.accountId).toBeNull();
    expect(roleRows[0]?.role).toBe('PLATFORM_OWNER');
    expect(roleRows[0]?.workosUserId).toBe(granted.value.workosUserId);
    expect(roleRows[0]?.revokedAt).not.toBeNull();
    expect(roleRows[0]?.revokedReason).toBe('account deleted');
  });

  it('blocks deleting the sole active platform owner (Codex review, PR #65)', async () => {
    const { account } = await seedFullAccount(db, 'del-sole-owner@example.com');
    const bootstrapAuth = {
      accountId: account.id,
      email: 'del-sole-owner@example.com',
      bootstrapEmails: ['del-sole-owner@example.com'],
    };
    const granted = await grantPlatformRole(db, {
      actor: bootstrapAuth,
      targetAccountId: account.id,
      role: 'PLATFORM_OWNER',
      reason: 'bootstrap',
      stepUpSatisfied: true,
    });
    if (!isOk(granted)) throw new Error('grant');

    const req = await requestAccountDeletion(db, {
      actorAccountId: account.id,
      accountId: account.id,
      gracePeriodMs: 0,
    });
    expect(isOk(req)).toBe(true);

    const executed = await executeAccountDeletion(db, { accountId: account.id });
    expect(isErr(executed)).toBe(true);
    if (isErr(executed)) expect(executed.error.code).toBe('invalid');

    // Nothing was touched: fails closed, not partially — the account, its
    // grant, and the pending deletion request all remain exactly as they
    // were, so ownership can still be transferred before retrying.
    expect(
      await db.select().from(schema.accounts).where(eq(schema.accounts.id, account.id)),
    ).toHaveLength(1);
    const roleRows = await db
      .select()
      .from(schema.platformRoles)
      .where(eq(schema.platformRoles.id, granted.value.id));
    expect(roleRows[0]?.accountId).toBe(account.id);
    expect(roleRows[0]?.revokedAt).toBeNull();
    const pending = await getPendingDeletion(db, account.id);
    expect(pending?.status).toBe('PENDING');
  });

  it("revokes a deleted account's active non-owner platform-role grant too (Codex review, PR #65)", async () => {
    const owner = await provisionAccount(db, { email: 'del-owner-actor@example.com' });
    if (!isOk(owner)) throw new Error('provision');
    const { account } = await seedFullAccount(db, 'del-support-admin@example.com');
    const ownerAuth = {
      accountId: owner.value.id,
      email: 'del-owner-actor@example.com',
      bootstrapEmails: ['del-owner-actor@example.com'],
    };
    const ownerGrant = await grantPlatformRole(db, {
      actor: ownerAuth,
      targetAccountId: owner.value.id,
      role: 'PLATFORM_OWNER',
      reason: 'bootstrap',
      stepUpSatisfied: true,
    });
    expect(isOk(ownerGrant)).toBe(true);
    const supportGrant = await grantPlatformRole(db, {
      actor: ownerAuth,
      targetAccountId: account.id,
      role: 'SUPPORT_ADMIN',
      reason: 'support',
      stepUpSatisfied: true,
    });
    if (!isOk(supportGrant)) throw new Error('support grant');

    const req = await requestAccountDeletion(db, {
      actorAccountId: account.id,
      accountId: account.id,
      gracePeriodMs: 0,
    });
    expect(isOk(req)).toBe(true);
    const executed = await executeAccountDeletion(db, { accountId: account.id });
    expect(isOk(executed)).toBe(true);

    const roleRows = await db
      .select()
      .from(schema.platformRoles)
      .where(eq(schema.platformRoles.id, supportGrant.value.id));
    expect(roleRows[0]?.accountId).toBeNull();
    expect(roleRows[0]?.revokedAt).not.toBeNull();
    expect(roleRows[0]?.revokedReason).toBe('account deleted');
  });

  it('refuses a deletion request for another account', async () => {
    const { account } = await seedFullAccount(db, 'del3@example.com');
    const other = await provisionAccount(db, { email: 'other-del@example.com' });
    if (!isOk(other)) throw new Error('provision');
    const result = await requestAccountDeletion(db, {
      actorAccountId: other.value.id,
      accountId: account.id,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('forbidden');
  });

  it('refuses a second deletion request while one is already pending', async () => {
    const { account } = await seedFullAccount(db, 'del-dup@example.com');
    const first = await requestAccountDeletion(db, {
      actorAccountId: account.id,
      accountId: account.id,
    });
    expect(isOk(first)).toBe(true);

    const second = await requestAccountDeletion(db, {
      actorAccountId: account.id,
      accountId: account.id,
    });
    expect(isErr(second)).toBe(true);
    if (isErr(second)) expect(second.error.code).toBe('invalid');
  });

  it('under real concurrency, two requests racing for the same account never both create a PENDING row', async () => {
    const { account } = await seedFullAccount(db, 'del-race@example.com');
    const [a, b] = await Promise.all([
      requestAccountDeletion(db, { actorAccountId: account.id, accountId: account.id }),
      requestAccountDeletion(db, { actorAccountId: account.id, accountId: account.id }),
    ]);
    const results = [a, b];
    expect(results.filter(isOk)).toHaveLength(1);
    expect(results.filter(isErr)).toHaveLength(1);

    const pendingRows = await db
      .select()
      .from(schema.accountDeletionRequests)
      .where(eq(schema.accountDeletionRequests.accountId, account.id));
    expect(pendingRows.filter((r) => r.status === 'PENDING')).toHaveLength(1);
  });

  it('exposes the pending request via getPendingDeletion, cleared on cancel', async () => {
    const { account } = await seedFullAccount(db, 'del4@example.com');
    expect(await getPendingDeletion(db, account.id)).toBeUndefined();

    const req = await requestAccountDeletion(db, {
      actorAccountId: account.id,
      accountId: account.id,
    });
    expect(isOk(req)).toBe(true);

    const pending = await getPendingDeletion(db, account.id);
    expect(pending?.status).toBe('PENDING');

    await cancelAccountDeletion(db, { actorAccountId: account.id, accountId: account.id });
    expect(await getPendingDeletion(db, account.id)).toBeUndefined();
  });

  it('refuses a deletion request while an active legal hold exists on any applicant this account owns (PRV-03, Part 7 §12 step 4)', async () => {
    const { account, applicantId } = await seedFullAccount(db, 'del-hold@example.com');
    const hold = await placeLegalHold(db, {
      actorAccountId: account.id,
      applicantId,
      reason: 'pending dispute',
      reviewAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      stepUpSatisfied: true,
    });
    expect(isOk(hold)).toBe(true);

    const result = await requestAccountDeletion(db, {
      actorAccountId: account.id,
      accountId: account.id,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.message).toContain('legal hold');
    // Never even got as far as opening a request.
    expect(await getPendingDeletion(db, account.id)).toBeUndefined();
  });

  it('revokes every currently-granted optional-processing consent at request time, leaving CORE_PROCESSING untouched (PRV-03, Part 7 §12 step 6)', async () => {
    const { account } = await seedFullAccount(db, 'del-consent@example.com');
    for (const type of ['AI_EXTRACTION', 'SHARING', 'MARKETING', 'ISSUER_CONTACT'] as const) {
      const granted = await setConsent(db, {
        actorAccountId: account.id,
        accountId: account.id,
        type,
        granted: true,
      });
      expect(isOk(granted)).toBe(true);
    }

    const req = await requestAccountDeletion(db, {
      actorAccountId: account.id,
      accountId: account.id,
    });
    expect(isOk(req)).toBe(true);

    const consents = await getConsents(db, account.id);
    expect(consents.CORE_PROCESSING).toBe(true);
    expect(consents.AI_EXTRACTION).toBe(false);
    expect(consents.SHARING).toBe(false);
    expect(consents.MARKETING).toBe(false);
    expect(consents.ISSUER_CONTACT).toBe(false);
  });

  it('never manufactures a revoke row for a consent type that was never granted', async () => {
    const { account } = await seedFullAccount(db, 'del-consent-untouched@example.com');
    // seedFullAccount only ever grants CORE_PROCESSING -- the other four
    // consent types have zero rows at all before this request.
    const before = await db.select().from(schema.consentRecords);
    expect(before).toHaveLength(1);

    const req = await requestAccountDeletion(db, {
      actorAccountId: account.id,
      accountId: account.id,
    });
    expect(isOk(req)).toBe(true);

    // Still just the one original CORE_PROCESSING grant row -- no spurious
    // "revoked" entries for consent types this account never granted.
    const after = await db.select().from(schema.consentRecords);
    expect(after).toHaveLength(1);
  });

  it('getDeletionImpactSummary reports the real applicants, missions, and documents this account owns (PRV-03, Part 7 §12 step 3)', async () => {
    const { account, applicantId } = await seedFullAccount(db, 'del-preview@example.com');
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'Trip',
    });
    expect(isOk(mission)).toBe(true);

    const summary = await getDeletionImpactSummary(db, account.id);
    expect(summary.applicants).toEqual([{ id: applicantId, displayName: 'Owner' }]);
    expect(summary.missionCount).toBe(1);
    expect(summary.documentCount).toBe(1);
    expect(summary.activePlatformRoleCount).toBe(0);
    expect(summary.authoredMissionNoteCount).toBe(0);
  });

  it("getDeletionImpactSummary counts an active platform-role grant and a note authored on someone else's case", async () => {
    const { account, applicantId } = await seedFullAccount(db, 'del-preview-2@example.com');
    const bootstrapAuth = {
      accountId: account.id,
      email: 'del-preview-2@example.com',
      bootstrapEmails: ['del-preview-2@example.com'],
    };
    const granted = await grantPlatformRole(db, {
      actor: bootstrapAuth,
      targetAccountId: account.id,
      role: 'SUPPORT_ADMIN',
      reason: 'test',
      stepUpSatisfied: true,
    });
    expect(isOk(granted)).toBe(true);

    // A note this account authored, on a mission it does not itself own --
    // collaborative history, anonymized (not deleted) by executeAccountDeletion.
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: "Someone else's case",
    });
    expect(isOk(mission)).toBe(true);
    if (!isOk(mission)) return;
    await db.insert(schema.missionNotes).values({
      missionId: mission.value.id,
      authorAccountId: account.id,
      body: 'internal note',
    });

    const summary = await getDeletionImpactSummary(db, account.id);
    expect(summary.activePlatformRoleCount).toBe(1);
    expect(summary.authoredMissionNoteCount).toBe(1);
  });

  it('getDeletionImpactSummary reports zero applicants/missions/documents for an account that owns none', async () => {
    const provisioned = await provisionAccount(db, { email: 'del-preview-empty@example.com' });
    if (!isOk(provisioned)) throw new Error('provision');

    const summary = await getDeletionImpactSummary(db, provisioned.value.id);
    expect(summary).toEqual({
      applicants: [],
      missionCount: 0,
      documentCount: 0,
      activePlatformRoleCount: 0,
      authoredMissionNoteCount: 0,
    });
  });

  it('records ACCOUNT_DELETION_REQUESTED with method API by default, and SYSTEM only when explicitly requested (Part 7 §11 inactive-account policy)', async () => {
    const { account: selfServiceAccount } = await seedFullAccount(db, 'del-method-api@example.com');
    const apiReq = await requestAccountDeletion(db, {
      actorAccountId: selfServiceAccount.id,
      accountId: selfServiceAccount.id,
    });
    expect(isOk(apiReq)).toBe(true);
    const apiEvents = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.resourceId, selfServiceAccount.id));
    const apiRequested = apiEvents.find((e) => e.eventType === 'ACCOUNT_DELETION_REQUESTED');
    expect(apiRequested?.method).toBe('API');

    const { account: systemAccount } = await seedFullAccount(db, 'del-method-system@example.com');
    const systemReq = await requestAccountDeletion(db, {
      actorAccountId: systemAccount.id,
      accountId: systemAccount.id,
      method: 'SYSTEM',
      reason: 'inactive account policy: no activity for 12+ months',
    });
    expect(isOk(systemReq)).toBe(true);
    const systemEvents = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.resourceId, systemAccount.id));
    const systemRequested = systemEvents.find((e) => e.eventType === 'ACCOUNT_DELETION_REQUESTED');
    expect(systemRequested?.method).toBe('SYSTEM');

    // A system-initiated request is a perfectly normal, cancellable pending
    // request otherwise -- the privacy page's existing "cancel" flow applies
    // unchanged, since the row carries no marker distinguishing how it was created.
    if (!isOk(systemReq)) throw new Error('setup failed');
    expect(systemReq.value.status).toBe('PENDING');
    const cancelled = await cancelAccountDeletion(db, {
      actorAccountId: systemAccount.id,
      accountId: systemAccount.id,
    });
    expect(isOk(cancelled)).toBe(true);
  });
});

describe('consent history', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('records the full grant/revoke trail newest-first', async () => {
    const provisioned = await provisionAccount(db, { email: 'ch@example.com' });
    if (!isOk(provisioned)) throw new Error('provision');
    const accountId = provisioned.value.id;

    await setConsent(db, {
      actorAccountId: accountId,
      accountId,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    await setConsent(db, {
      actorAccountId: accountId,
      accountId,
      type: 'MARKETING',
      granted: true,
    });
    await setConsent(db, {
      actorAccountId: accountId,
      accountId,
      type: 'MARKETING',
      granted: false,
    });

    const history = await listConsentHistory(db, accountId);
    expect(history).toHaveLength(3);
    // Newest first: the MARKETING revoke is the most recent row.
    expect(history[0]?.type).toBe('MARKETING');
    expect(history[0]?.revokedAt).not.toBeNull();
    expect(history[0]?.grantedAt).toBeNull();
  });
});
