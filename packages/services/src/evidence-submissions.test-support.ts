import { isOk } from '@visastack/core';
import type { Result } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { drizzle } from 'drizzle-orm/pglite';
import { EACH_GRANT, accountPrincipal, requireAccess } from './access';
import type { AuthorizedApplicant } from './access';
import { verifyStepUp } from './access/step-up-proof';
import { provisionAccount } from './accounts';
import { requestEvidence, submitEvidenceResponse } from './agency';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { addDocumentVersion, registerDocument } from './documents';
import { createOrganization, reviewOrganization } from './organizations';
import { acceptGrant, createGrant } from './sharing';
import { issueStepUpAssurance } from './step-up';
import type { AccessRef, IssueReadRefInput, StoragePort } from './storage';

export const ACCESS_TOKEN_SECRET = 'evidence-submission-token-secret';
export const STEP_UP_SECRET = 'evidence-submission-step-up-secret';

/** Deterministic storage port: records every call, reaches no network. */
export class FakeStorage implements StoragePort {
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

export async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, { schema }) as unknown as Db;
}

export interface Traveller {
  readonly accountId: string;
  readonly applicantId: string;
}

export async function traveller(db: Db, email: string): Promise<Traveller> {
  const p = await provisionAccount(db, { email });
  if (!isOk(p)) throw new Error('provision');
  for (const type of ['CORE_PROCESSING', 'SHARING'] as const) {
    await setConsent(db, {
      actorAccountId: p.value.id,
      accountId: p.value.id,
      type,
      granted: true,
    });
  }
  const applicant = await createApplicant(db, {
    actorAccountId: p.value.id,
    ownerAccountId: p.value.id,
    displayName: 'Synthetic Traveller',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  return { accountId: p.value.id, applicantId: applicant.value.id };
}

export interface Agency {
  readonly accountId: string;
  readonly organizationId: string;
}

/** An agency with one OWNER, verified by an unrelated reviewer so it can receive grants. */
export async function agency(db: Db, email: string, name: string): Promise<Agency> {
  const member = await provisionAccount(db, { email });
  if (!isOk(member)) throw new Error('provision');
  const org = await createOrganization(db, { actorAccountId: member.value.id, name });
  if (!isOk(org)) throw new Error('org');
  const reviewer = await provisionAccount(db, {
    email: `reviewer-${org.value.id}@platform.example`,
  });
  if (!isOk(reviewer)) throw new Error('reviewer');
  const reviewed = await reviewOrganization(db, {
    reviewerAccountId: reviewer.value.id,
    organizationId: org.value.id,
    decision: 'ACTIVE',
    stepUpSatisfied: true,
  });
  if (!isOk(reviewed)) throw new Error('review');
  return { accountId: member.value.id, organizationId: org.value.id };
}

/** The traveller gives the agency a MANAGE grant and the agency accepts it. Returns the grant id. */
export async function share(db: Db, t: Traveller, a: Agency, missionId?: string): Promise<string> {
  const grant = await createGrant(db, {
    actorAccountId: t.accountId,
    applicantId: t.applicantId,
    recipientOrganizationId: a.organizationId,
    actions: ['MANAGE'],
    purpose: 'collaboration',
    ...(missionId ? { missionId } : {}),
  });
  if (!isOk(grant)) throw new Error('grant');
  await acceptGrant(db, { actorAccountId: a.accountId, grantId: grant.value.id });
  return grant.value.id;
}

let counter = 0;
export function uniqueKey(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

export interface StoredDocument {
  readonly documentId: string;
  readonly versionId: string;
  readonly storageObjectId: string;
  readonly objectKey: string;
}

/** A document with one clean, servable version. */
export async function cleanDocument(
  db: Db,
  t: Traveller,
  docType = 'bank_statement',
  originalName = 'statement.pdf',
  sha256 = 'a'.repeat(64),
): Promise<StoredDocument> {
  const doc = await registerDocument(db, {
    actorAccountId: t.accountId,
    applicantId: t.applicantId,
    originalName,
    docType,
  });
  if (!isOk(doc)) throw new Error('doc');
  const version = await addVersion(db, t, doc.value.id, { sha256 });
  return { documentId: doc.value.id, ...version };
}

export async function addVersion(
  db: Db,
  t: Traveller,
  documentId: string,
  extra: {
    sha256?: string;
    safetyStatus?: 'CLEAN' | 'QUARANTINED';
    processingStatus?: 'AWAITING_REVIEW' | 'NEEDS_ATTENTION';
  } = {},
): Promise<Omit<StoredDocument, 'documentId'>> {
  const objectKey = uniqueKey('obj');
  const added = await addDocumentVersion(db, {
    actorAccountId: t.accountId,
    documentId,
    bucket: extra.safetyStatus === 'QUARANTINED' ? 'QUARANTINE' : 'CLEAN',
    objectKey,
    sizeBytes: 1234,
    ...(extra.sha256 ? { sha256: extra.sha256 } : {}),
    safetyStatus: extra.safetyStatus ?? 'CLEAN',
    processingStatus: extra.processingStatus ?? 'AWAITING_REVIEW',
  });
  if (!isOk(added)) throw new Error('version');
  return {
    versionId: added.value.version.id,
    storageObjectId: added.value.storageObject.id,
    objectKey,
  };
}

/** The agency opens a request for one kind of document. */
export async function openRequest(
  db: Db,
  a: Agency,
  t: Traveller,
  docType = 'bank_statement',
): Promise<string> {
  const req = await requestEvidence(db, {
    actorAccountId: a.accountId,
    organizationId: a.organizationId,
    applicantId: t.applicantId,
    kind: 'DOCUMENT',
    docType,
    message: 'please send',
  });
  if (!isOk(req)) throw new Error(`request: ${req.error.message}`);
  return req.value.id;
}

export function send(
  db: Db,
  t: Traveller,
  requestId: string,
  documentId: string,
  extra: { documentVersionId?: string; idempotencyKey?: string } = {},
) {
  return submitEvidenceResponse(db, {
    actorAccountId: t.accountId,
    requestId,
    documentId,
    ...(extra.documentVersionId ? { documentVersionId: extra.documentVersionId } : {}),
    ...(extra.idempotencyKey ? { idempotencyKey: extra.idempotencyKey } : {}),
  });
}

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`unexpected refusal: ${JSON.stringify(result.error)}`);
  return result.value;
}

/** The central access proof for an agency member acting for their organization on one traveller. */
export async function agencyProof(
  db: Db,
  a: Agency,
  applicantId: string,
): Promise<AuthorizedApplicant<'MANAGE'>> {
  return unwrap(
    await requireAccess(
      db,
      accountPrincipal(a.accountId),
      'MANAGE',
      { applicantId },
      { purpose: EACH_GRANT, actingFor: { organizationId: a.organizationId } },
    ),
  );
}

export async function ownerProof(db: Db, t: Traveller): Promise<AuthorizedApplicant<'MANAGE'>> {
  return unwrap(
    await requireAccess(
      db,
      accountPrincipal(t.accountId),
      'MANAGE',
      { applicantId: t.applicantId },
      { purpose: 'owner_view_sends' },
    ),
  );
}

/** A recent identity confirmation for downloading the original of one exact version. */
export function stepUpFor(accountId: string, versionId: string) {
  const binding = { accountId, action: 'DOWNLOAD_ORIGINAL' as const, resourceId: versionId };
  return verifyStepUp(STEP_UP_SECRET, issueStepUpAssurance(STEP_UP_SECRET, binding), binding);
}
