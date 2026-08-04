import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import type { Membership } from '@visastack/policy';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import {
  addDocumentVersion,
  downloadDocument,
  listDocuments,
  previewDocument,
  registerDocument,
  registerDocumentWithVersion,
} from './documents';
import { enqueueErasureJob } from './erasure';
import type { AccessRef, IssueReadRefInput, StoragePort } from './storage';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

/** Deterministic in-memory storage port — no S3, no network. */
class FakeStorage implements StoragePort {
  public readonly calls: IssueReadRefInput[] = [];
  async issueReadRef(input: IssueReadRefInput): Promise<AccessRef> {
    this.calls.push(input);
    return {
      url: `fake://${input.bucket}/${input.objectKey}?d=${input.disposition}&v=${input.variant}`,
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000).toISOString(),
      disposition: input.disposition,
      variant: input.variant,
    };
  }
}

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

async function seedOwnerWithDocument(db: Db, email: string) {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision failed');
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
  if (!isOk(applicant)) throw new Error('applicant failed');

  const doc = await registerDocument(db, {
    actorAccountId: account.id,
    applicantId: applicant.value.id,
    originalName: 'passport.pdf',
    docType: 'passport',
  });
  if (!isOk(doc)) throw new Error('document failed');

  const version = await addDocumentVersion(db, {
    actorAccountId: account.id,
    documentId: doc.value.id,
    bucket: 'CLEAN',
    objectKey: `obj-${email}`,
    sizeBytes: 1024,
    safetyStatus: 'CLEAN',
    processingStatus: 'APPROVED',
  });
  if (!isOk(version)) throw new Error('version failed');

  return { account, applicant: applicant.value, document: doc.value };
}

async function seedOwner(db: Db, email: string) {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision failed');
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
  if (!isOk(applicant)) throw new Error('applicant failed');
  return { account, applicant: applicant.value };
}

describe('document vault — registration & versioning', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('registers a document and adds an incrementing version', async () => {
    const { account, document } = await seedOwnerWithDocument(db, 'v1@example.com');

    const second = await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: document.id,
      bucket: 'CLEAN',
      objectKey: 'obj-v1-2',
    });
    expect(isOk(second)).toBe(true);
    if (!isOk(second)) return;
    expect(second.value.version.versionNumber).toBe(2);

    const docs = await listDocuments(db, account.id, document.applicantId);
    expect(isOk(docs)).toBe(true);
    if (isOk(docs)) expect(docs.value).toHaveLength(1);
  });

  it('refuses registration by a non-owner', async () => {
    const { document } = await seedOwnerWithDocument(db, 'v2@example.com');
    const intruder = await provisionAccount(db, { email: 'intruder-v2@example.com' });
    if (!isOk(intruder)) throw new Error('provision failed');
    const result = await addDocumentVersion(db, {
      actorAccountId: intruder.value.id,
      documentId: document.id,
      bucket: 'CLEAN',
      objectKey: 'x',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('forbidden');
  });
});

describe('registerDocumentWithVersion — atomic first-version registration (master directive §7 "PR 6")', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('registers a document and its first version together', async () => {
    const { account, applicant } = await seedOwner(db, 'atomic-ok@example.com');

    const result = await registerDocumentWithVersion(db, {
      actorAccountId: account.id,
      applicantId: applicant.id,
      originalName: 'passport.pdf',
      source: 'UPLOAD',
      bucket: 'QUARANTINE',
      objectKey: 'atomic-ok-key',
      sizeBytes: 1024,
      sha256: 'a'.repeat(64),
    });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.version.versionNumber).toBe(1);
    expect(result.value.version.documentId).toBeTruthy();

    const docs = await listDocuments(db, account.id, applicant.id);
    expect(isOk(docs)).toBe(true);
    if (isOk(docs)) expect(docs.value).toHaveLength(1);
  });

  it('leaves no versionless orphan document behind when the version half of the write fails — ' +
    'the exact partial-commit the two calls used to risk when made separately', async () => {
    const { account, applicant } = await seedOwner(db, 'atomic-rollback@example.com');

    // Pre-occupy the object key so the version insert's unique constraint
    // collides — a real mid-transaction failure, not a modeled Result err,
    // exercising the same db.transaction() rollback either way would use.
    await db.insert(schema.storageObjects).values({
      bucket: 'QUARANTINE',
      objectKey: 'taken-key',
    });

    await expect(
      registerDocumentWithVersion(db, {
        actorAccountId: account.id,
        applicantId: applicant.id,
        originalName: 'passport.pdf',
        source: 'UPLOAD',
        bucket: 'QUARANTINE',
        objectKey: 'taken-key',
      }),
    ).rejects.toThrow();

    const docs = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.applicantId, applicant.id));
    expect(docs).toHaveLength(0);
  });
});

describe('document vault — permission-aware access', () => {
  let db: Db;
  let storage: FakeStorage;
  beforeEach(async () => {
    db = await freshDb();
    storage = new FakeStorage();
  });

  it('lets the owner preview and download the redacted rendition', async () => {
    const { account, document } = await seedOwnerWithDocument(db, 'a1@example.com');

    const preview = await previewDocument(db, storage, {
      actor: { kind: 'applicant_owner', applicantId: document.applicantId as never },
      documentId: document.id,
      purpose: 'self_review',
    });
    expect(isOk(preview)).toBe(true);
    if (isOk(preview)) expect(preview.value.disposition).toBe('preview');

    const download = await downloadDocument(db, storage, {
      actor: { kind: 'applicant_owner', applicantId: document.applicantId as never },
      documentId: document.id,
      purpose: 'self_review',
      variant: 'redacted',
    });
    expect(isOk(download)).toBe(true);
    if (isOk(download)) expect(download.value.variant).toBe('redacted');

    // The audit trail recorded two ALLOWED accesses.
    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'DOCUMENT_ACCESS'));
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.result === 'ALLOWED')).toBe(true);
    // Owner id is not an account id — recorded by role.
    expect(events[0]?.actorRole).toBe('applicant_owner');
    void account;
  });

  it('records exactly one DOCUMENT_ACCESS event for an authorized-but-not-yet-safe-to-serve request, not an ALLOWED followed by a DENIED (Codex review, PR-B3, finding #11)', async () => {
    const { account, document } = await seedOwnerWithDocument(db, 'a10@example.com');
    const actor = { kind: 'applicant_owner', applicantId: document.applicantId as never } as const;

    // A second, later version still mid-pipeline — the owner IS authorized
    // to access this document, but the latest version isn't servable yet.
    // Before this fix, the authorization-decision block unconditionally
    // appended ALLOWED first, then the safety-state check below appended a
    // second, contradictory DENIED event for the same request.
    await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: document.id,
      bucket: 'CLEAN',
      objectKey: 'a10-v2-scanning',
      safetyStatus: 'PENDING',
      processingStatus: 'SCANNING',
    });

    const preview = await previewDocument(db, storage, {
      actor,
      documentId: document.id,
      purpose: 'self_review',
    });
    expect(isErr(preview)).toBe(true);
    if (isErr(preview)) expect(preview.error.code).toBe('forbidden');

    const events = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'DOCUMENT_ACCESS'));
    expect(events).toHaveLength(1);
    expect(events[0]?.result).toBe('DENIED');
    expect(events[0]?.reason).toBe('not_yet_safe_to_serve');
  });

  it('requires step-up for the original bytes (denied without it)', async () => {
    const { document } = await seedOwnerWithDocument(db, 'a2@example.com');
    const actor = { kind: 'applicant_owner', applicantId: document.applicantId as never } as const;

    const denied = await downloadDocument(db, storage, {
      actor,
      documentId: document.id,
      purpose: 'self_review',
      variant: 'original',
      stepUpSatisfied: false,
    });
    expect(isErr(denied)).toBe(true);
    if (isErr(denied)) expect(denied.error.message).toContain('step_up_required');

    const allowed = await downloadDocument(db, storage, {
      actor,
      documentId: document.id,
      purpose: 'self_review',
      variant: 'original',
      stepUpSatisfied: true,
    });
    expect(isOk(allowed)).toBe(true);
    if (isOk(allowed)) expect(allowed.value.variant).toBe('original');
  });

  it('denies an unrelated account with no grant (default-deny) and audits it', async () => {
    const { document } = await seedOwnerWithDocument(db, 'a3@example.com');
    const stranger = await provisionAccount(db, { email: 'stranger@example.com' });
    if (!isOk(stranger)) throw new Error('provision failed');
    const membership: Membership = {
      organizationId: '00000000-0000-0000-0000-000000000000' as never,
      role: 'CASE_MANAGER',
      active: true,
    };

    const result = await previewDocument(db, storage, {
      actor: { kind: 'organization_member', accountId: stranger.value.id as never, membership },
      documentId: document.id,
      purpose: 'snooping',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('forbidden');

    const denials = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'DOCUMENT_ACCESS'));
    expect(denials).toHaveLength(1);
    expect(denials[0]?.result).toBe('DENIED');
    expect(storage.calls).toHaveLength(0);
  });

  it('grants an organization member access via an accepted, purpose-bound grant', async () => {
    const { account, applicant, document } = await seedOwnerWithDocument(db, 'a4@example.com');
    const org = await db
      .insert(schema.organizations)
      .values({ name: 'Acme Travel', status: 'ACTIVE' })
      .returning();
    const orgId = org[0]?.id;
    if (!orgId) throw new Error('org failed');
    const member = await provisionAccount(db, { email: 'agent@acme.com' });
    if (!isOk(member)) throw new Error('provision failed');

    // Owner grants PREVIEW to the organization, accepted and purpose-bound.
    await db.insert(schema.grants).values({
      applicantId: applicant.id,
      recipientOrganizationId: orgId,
      actions: ['PREVIEW'],
      purpose: 'visa_application',
      status: 'ACTIVE',
      acceptedAt: new Date(),
    });

    const membership: Membership = {
      organizationId: orgId as never,
      role: 'CASE_MANAGER',
      active: true,
    };
    const ok = await previewDocument(db, storage, {
      actor: { kind: 'organization_member', accountId: member.value.id as never, membership },
      documentId: document.id,
      purpose: 'visa_application',
    });
    expect(isOk(ok)).toBe(true);

    // Wrong purpose is denied even with the grant.
    const wrongPurpose = await previewDocument(db, storage, {
      actor: { kind: 'organization_member', accountId: member.value.id as never, membership },
      documentId: document.id,
      purpose: 'something_else',
    });
    expect(isErr(wrongPurpose)).toBe(true);
    void account;
  });

  it('refuses to serve the latest version once its bytes are verified erased, even though the document row survives a stuck sibling (Codex review, PR-B2, round 2)', async () => {
    const { account, document } = await seedOwnerWithDocument(db, 'a5@example.com');
    const actor = { kind: 'applicant_owner', applicantId: document.applicantId as never } as const;

    // A second, later version — otherwise perfectly servable (CLEAN/APPROVED)
    // — whose OWN erasure job has already verified. Finding #13's design
    // deliberately keeps the document (and every version's row) alive as
    // long as ANY sibling job hasn't verified — simulated here directly
    // (not via a stuck sibling) since only this one version's post-erasure
    // servability is under test.
    const v2 = await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: document.id,
      bucket: 'CLEAN',
      objectKey: 'a5-v2-erased',
      safetyStatus: 'CLEAN',
      processingStatus: 'APPROVED',
    });
    if (!isOk(v2)) throw new Error('version failed');
    const job = await enqueueErasureJob(db, {
      reason: 'RETENTION_PURGE',
      bucket: 'CLEAN',
      objectKey: 'a5-v2-erased',
      expectedHash: null,
      storageObjectId: v2.value.storageObject.id,
      documentId: document.id,
      applicantId: document.applicantId,
    });
    await db
      .update(schema.erasureJobs)
      .set({ status: 'VERIFIED', completedAt: new Date() })
      .where(eq(schema.erasureJobs.id, job.id));

    const preview = await previewDocument(db, storage, {
      actor,
      documentId: document.id,
      purpose: 'self_review',
    });
    expect(isErr(preview)).toBe(true);
    if (isErr(preview)) expect(preview.error.code).toBe('forbidden');
    expect(storage.calls).toHaveLength(0); // no read reference was ever minted for erased bytes

    const denials = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'DOCUMENT_ACCESS'));
    const last = denials[denials.length - 1];
    expect(last?.result).toBe('DENIED');
    expect(last?.reason).toBe('bytes_already_erased');
  });

  it('refuses to serve a version whose erasure job is CLAIMED — bytes may already be deleted even though the job is not yet VERIFIED (Codex review, PR-B2, round 3)', async () => {
    const { account, document } = await seedOwnerWithDocument(db, 'a6@example.com');
    const actor = { kind: 'applicant_owner', applicantId: document.applicantId as never } as const;

    // A second, later version whose erasure job has only reached CLAIMED —
    // the real bytes are deleted at the CLAIMED->DELETED transition inside
    // processErasureJob, well before a job ever reaches VERIFIED. A check
    // scoped to VERIFIED alone would read `false` here even though the
    // worker could be mid-deleteObject() this very instant.
    const v2 = await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: document.id,
      bucket: 'CLEAN',
      objectKey: 'a6-v2-claimed',
      safetyStatus: 'CLEAN',
      processingStatus: 'APPROVED',
    });
    if (!isOk(v2)) throw new Error('version failed');
    const job = await enqueueErasureJob(db, {
      reason: 'RETENTION_PURGE',
      bucket: 'CLEAN',
      objectKey: 'a6-v2-claimed',
      expectedHash: null,
      storageObjectId: v2.value.storageObject.id,
      documentId: document.id,
      applicantId: document.applicantId,
    });
    await db
      .update(schema.erasureJobs)
      .set({ status: 'CLAIMED', claimedAt: new Date(), leaseOwner: 'test-worker' })
      .where(eq(schema.erasureJobs.id, job.id));

    const download = await downloadDocument(db, storage, {
      actor,
      documentId: document.id,
      purpose: 'self_review',
      variant: 'redacted',
    });
    expect(isErr(download)).toBe(true);
    if (isErr(download)) expect(download.error.code).toBe('forbidden');
    expect(storage.calls).toHaveLength(0);
  });

  it('refuses to serve a version whose erasure job reverted to PENDING after a successful delete — deletionAttemptedAt survives the retry even though status alone looks untouched (Codex review, PR-B2, rounds 4-5)', async () => {
    const { account, document } = await seedOwnerWithDocument(db, 'a7@example.com');
    const actor = { kind: 'applicant_owner', applicantId: document.applicantId as never } as const;

    // processErasureJob sets deletionAttemptedAt before ever calling
    // blobStore.deleteObject(). If the delete succeeds but the subsequent
    // getObject verification throws (store lied about the delete, or a
    // transient read error) — or even if the CAS-to-DELETED write itself
    // fails, so `status` never reaches DELETED at all (round 5) —
    // failErasureJob can send the job back to PENDING for another attempt.
    // A check keyed on `status` alone would see plain PENDING and treat the
    // bytes as untouched; deletionAttemptedAt is the signal that actually
    // survives this round-trip, set BEFORE any of those failures could
    // happen. This job is constructed already at PENDING with the marker
    // set and never passes through DELETED at all, which is exactly the
    // state such an infra failure would leave behind.
    const v2 = await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: document.id,
      bucket: 'CLEAN',
      objectKey: 'a7-v2-pending-retry',
      safetyStatus: 'CLEAN',
      processingStatus: 'APPROVED',
    });
    if (!isOk(v2)) throw new Error('version failed');
    const job = await enqueueErasureJob(db, {
      reason: 'RETENTION_PURGE',
      bucket: 'CLEAN',
      objectKey: 'a7-v2-pending-retry',
      expectedHash: null,
      storageObjectId: v2.value.storageObject.id,
      documentId: document.id,
      applicantId: document.applicantId,
    });
    await db
      .update(schema.erasureJobs)
      .set({
        status: 'PENDING',
        deletionAttemptedAt: new Date(),
        claimedAt: null,
        leaseOwner: null,
      })
      .where(eq(schema.erasureJobs.id, job.id));

    const preview = await previewDocument(db, storage, {
      actor,
      documentId: document.id,
      purpose: 'self_review',
    });
    expect(isErr(preview)).toBe(true);
    if (isErr(preview)) expect(preview.error.code).toBe('forbidden');
    expect(storage.calls).toHaveLength(0);
  });

  it('refuses to serve a version whose erasure job exhausted its retries and parked at FAILED after a successful delete (Codex review, PR-B2, rounds 4-5)', async () => {
    const { account, document } = await seedOwnerWithDocument(db, 'a8@example.com');
    const actor = { kind: 'applicant_owner', applicantId: document.applicantId as never } as const;

    // Same signal, opposite terminal state: FAILED means the worker gave up
    // retrying (attempts >= maxAttempts), not that the bytes are safe. Any
    // consumer trusting "FAILED == nothing happened, safe to serve" would be
    // exactly as wrong as one trusting PENDING above.
    const v2 = await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: document.id,
      bucket: 'CLEAN',
      objectKey: 'a8-v2-failed-after-delete',
      safetyStatus: 'CLEAN',
      processingStatus: 'APPROVED',
    });
    if (!isOk(v2)) throw new Error('version failed');
    const job = await enqueueErasureJob(db, {
      reason: 'RETENTION_PURGE',
      bucket: 'CLEAN',
      objectKey: 'a8-v2-failed-after-delete',
      expectedHash: null,
      storageObjectId: v2.value.storageObject.id,
      documentId: document.id,
      applicantId: document.applicantId,
    });
    await db
      .update(schema.erasureJobs)
      .set({
        status: 'FAILED',
        deletionAttemptedAt: new Date(),
        lastError: 'verification exhausted retries',
      })
      .where(eq(schema.erasureJobs.id, job.id));

    const download = await downloadDocument(db, storage, {
      actor,
      documentId: document.id,
      purpose: 'self_review',
      variant: 'redacted',
    });
    expect(isErr(download)).toBe(true);
    if (isErr(download)) expect(download.error.code).toBe('forbidden');
    expect(storage.calls).toHaveLength(0);
  });

  it('refuses to serve a version whose erasure job reached DELETED with no deletionAttemptedAt marker at all — the legacy-row fallback for jobs written before this column existed (Codex review, PR-B2, round 5)', async () => {
    const { account, document } = await seedOwnerWithDocument(db, 'a9@example.com');
    const actor = { kind: 'applicant_owner', applicantId: document.applicantId as never } as const;

    // Simulates a row written by code that predates deletionAttemptedAt —
    // the exact rollout window erasureInProgressOrBytesGone()'s own comment
    // documents (a migration adding a new nullable column while an old
    // deployment, unaware of it, is still live and processing jobs). Such a
    // row will never carry the marker; the restored, augmented status check
    // (`status IN ('CLAIMED','DELETED','VERIFIED')`, not just the marker)
    // is what keeps it correctly unservable regardless.
    const v2 = await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: document.id,
      bucket: 'CLEAN',
      objectKey: 'a9-v2-legacy-deleted',
      safetyStatus: 'CLEAN',
      processingStatus: 'APPROVED',
    });
    if (!isOk(v2)) throw new Error('version failed');
    const job = await enqueueErasureJob(db, {
      reason: 'RETENTION_PURGE',
      bucket: 'CLEAN',
      objectKey: 'a9-v2-legacy-deleted',
      expectedHash: null,
      storageObjectId: v2.value.storageObject.id,
      documentId: document.id,
      applicantId: document.applicantId,
    });
    await db
      .update(schema.erasureJobs)
      .set({ status: 'DELETED', claimedAt: new Date(), leaseOwner: null })
      .where(eq(schema.erasureJobs.id, job.id));

    const preview = await previewDocument(db, storage, {
      actor,
      documentId: document.id,
      purpose: 'self_review',
    });
    expect(isErr(preview)).toBe(true);
    if (isErr(preview)) expect(preview.error.code).toBe('forbidden');
    expect(storage.calls).toHaveLength(0);
  });
});

describe('document vault — preview never leaks originals to third parties (Milestone 2 / P0)', () => {
  let db: Db;
  let storage: FakeStorage;
  beforeEach(async () => {
    db = await freshDb();
    storage = new FakeStorage();
  });

  it('mints an ORIGINAL variant for the applicant owner previewing their own clean document', async () => {
    const { document } = await seedOwnerWithDocument(db, 'p1@example.com');

    const preview = await previewDocument(db, storage, {
      actor: { kind: 'applicant_owner', applicantId: document.applicantId as never },
      documentId: document.id,
      purpose: 'owner_preview',
    });

    expect(isOk(preview)).toBe(true);
    // The owner sees the clean original; the serving route only releases bytes
    // for an `original` variant token.
    if (isOk(preview)) expect(preview.value.variant).toBe('original');
    expect(storage.calls.at(-1)?.variant).toBe('original');
    // The display filename (original name, since nothing has been approved
    // yet) flows into the reference — never the opaque storage key.
    expect(storage.calls.at(-1)?.filename).toBe('passport.pdf');
  });

  it('mints a REDACTED variant for a granted third party — never the original bytes', async () => {
    const { applicant, document } = await seedOwnerWithDocument(db, 'p2@example.com');
    const org = await db
      .insert(schema.organizations)
      .values({ name: 'Acme Travel', status: 'ACTIVE' })
      .returning();
    const orgId = org[0]?.id;
    if (!orgId) throw new Error('org failed');
    const member = await provisionAccount(db, { email: 'agent-p2@acme.com' });
    if (!isOk(member)) throw new Error('provision failed');

    await db.insert(schema.grants).values({
      applicantId: applicant.id,
      recipientOrganizationId: orgId,
      actions: ['PREVIEW'],
      purpose: 'visa_application',
      status: 'ACTIVE',
      acceptedAt: new Date(),
    });
    const membership: Membership = {
      organizationId: orgId as never,
      role: 'CASE_MANAGER',
      active: true,
    };

    const preview = await previewDocument(db, storage, {
      actor: { kind: 'organization_member', accountId: member.value.id as never, membership },
      documentId: document.id,
      purpose: 'visa_application',
    });

    // The grant authorises PREVIEW, but the third party must NEVER receive an
    // `original` variant token — only a `redacted` one, which the serving route
    // fails closed on until real renditions exist.
    expect(isOk(preview)).toBe(true);
    if (isOk(preview)) expect(preview.value.variant).toBe('redacted');
    expect(storage.calls.at(-1)?.variant).toBe('redacted');
  });
});
