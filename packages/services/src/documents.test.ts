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
} from './documents';
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
