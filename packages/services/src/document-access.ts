import type { PermissionAction } from '@visastack/core';
import { desc, eq } from 'drizzle-orm';
import { type AuthorizedApplicant, EACH_GRANT } from './access/require-access';
import { appendAuditEvent } from './audit';
import { first, schema } from './db';
import { isDocumentVersionUsable } from './documents';
import { hasActiveOrVerifiedErasureJob } from './erasure';

/**
 * Shared steps for the services that make something from one document on request, through a
 * proof from the access gate (Visa Photo Sizes in photo-sizing.ts, safe copies in redaction.ts):
 * who to record, the purpose to record, one DOCUMENT_ACCESS audit event that never holds image
 * data, and the document's latest version only when it is safe to use.
 */

export type DocumentProof = AuthorizedApplicant<PermissionAction>;

export interface DocumentAuditActor {
  readonly actorAccountId: string | null;
  readonly actorRole: string;
  /** The account a rate limit is counted against. */
  readonly subjectAccountId: string;
}

/** Who acted, for the audit trail and rate limits. The owner is recorded by role. */
export function documentAuditActor(proof: DocumentProof): DocumentAuditActor {
  const actor = proof.actor;
  switch (actor.kind) {
    case 'applicant_owner':
      return {
        actorAccountId: null,
        actorRole: 'applicant_owner',
        subjectAccountId: proof.applicant.ownerAccountId,
      };
    case 'organization_member':
      return {
        actorAccountId: actor.accountId,
        actorRole: `org:${actor.membership.role}`,
        subjectAccountId: actor.accountId,
      };
    case 'individual_recipient':
      return {
        actorAccountId: actor.accountId,
        actorRole: 'individual_recipient',
        subjectAccountId: actor.accountId,
      };
    case 'support_admin':
      return {
        actorAccountId: actor.accountId,
        actorRole: 'support_admin',
        subjectAccountId: actor.accountId,
      };
    case 'contributor':
      return {
        actorAccountId: actor.accountId,
        actorRole: 'contributor',
        subjectAccountId: actor.accountId,
      };
  }
}

export interface DocumentPurposes {
  /** Recorded when the record owner acts. */
  readonly owner: string;
  /** Recorded when someone acts through every grant judged on its own purpose. */
  readonly shared: string;
}

/** The purpose recorded: the owner's, the shared one, or the grant purpose the caller named. */
export function documentAccessPurpose(proof: DocumentProof, purposes: DocumentPurposes): string {
  if (proof.actor.kind === 'applicant_owner') return purposes.owner;
  return proof.purpose === EACH_GRANT ? purposes.shared : proof.purpose;
}

export interface DocumentAccessEvent {
  readonly documentId: string;
  readonly applicantId: string;
  readonly allowed: boolean;
  readonly reason: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly purposes: DocumentPurposes;
}

/** One DOCUMENT_ACCESS event for the proof's action: what was asked for and the outcome. */
export async function writeDocumentAccessAudit(
  proof: DocumentProof,
  event: DocumentAccessEvent,
): Promise<void> {
  const who = documentAuditActor(proof);
  await proof.tx.transaction(async (tx) => {
    await appendAuditEvent(tx, {
      eventType: 'DOCUMENT_ACCESS',
      actorAccountId: who.actorAccountId,
      actorRole: who.actorRole,
      action: proof.action,
      result: event.allowed ? 'ALLOWED' : 'DENIED',
      method: 'API',
      applicantId: event.applicantId,
      resourceType: 'document',
      resourceId: event.documentId,
      reason: event.reason,
      metadata: { ...event.metadata, purpose: documentAccessPurpose(proof, event.purposes) },
    });
  });
}

type VersionRow = typeof schema.documentVersions.$inferSelect;

export type LatestUsableVersion =
  | { readonly kind: 'usable'; readonly version: VersionRow }
  | {
      readonly kind: 'refused';
      readonly reason: 'no_stored_version' | 'bytes_already_erased' | 'not_yet_safe_to_serve';
    };

/**
 * The latest version of the proof's document, only when it is safe to use: scanned clean, in a
 * servable state, and not being or already erased. An older version is never offered instead.
 */
export async function latestUsableVersion(proof: DocumentProof): Promise<LatestUsableVersion> {
  if (proof.resource.kind !== 'document') return { kind: 'refused', reason: 'no_stored_version' };
  const db = proof.tx;
  const version = first(
    await db
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, proof.resource.document.id))
      .orderBy(desc(schema.documentVersions.versionNumber))
      .limit(1),
  );
  if (!version) return { kind: 'refused', reason: 'no_stored_version' };
  const erased = await hasActiveOrVerifiedErasureJob(db, version.storageObjectId);
  if (erased) return { kind: 'refused', reason: 'bytes_already_erased' };
  const usable = isDocumentVersionUsable({
    safetyStatus: version.safetyStatus,
    processingStatus: version.processingStatus,
    erased,
  });
  return usable
    ? { kind: 'usable', version }
    : { kind: 'refused', reason: 'not_yet_safe_to_serve' };
}
