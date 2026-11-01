import { type Result, err, ok } from '@visastack/core';
import { and, desc, eq, gt, isNotNull, isNull, lte, or } from 'drizzle-orm';
import { getApplicant } from './applicants';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { queueInvitationEmail } from './invitation-email';
import { generateInvitationToken, hashInvitationToken } from './invitation-tokens';
import { cancelQueuedNotificationsForResource } from './notifications';
import type { KeyManagementPort } from './ports';
import { lifecycleTablesPresent, presentApplicantCondition } from './lifecycle/foundation';

/**
 * CAS-08 - Contributor request (Commercial V1 Part 4 §14): lets a mission
 * owner ask a named third party (a sponsor, a family member) who is NOT the
 * applicant for exactly one piece of evidence, without ever giving them a
 * wallet, profile, or case view of any kind. Reuses the same hashed-token
 * primitive as organizationInvitations/clientInvitations
 * (invitation-tokens.ts) and, at submission, the applicant's existing
 * upload pipeline (uploads.ts's reserveUpload/finalizeUpload,
 * documents.ts's registerDocumentWithVersion) - "no household portal is
 * required."
 *
 * State machine is deliberately just PENDING -> SUBMITTED (or -> REVOKED):
 * unlike the two invitation flows, there is no separate "accepted, standing
 * created" step before the one action that matters - accepting the
 * invitation IS submitting the named evidence. A submission attempt is
 * treated as a reservation, mirroring uploads.ts's own
 * reserve/finalize/fail shape: `beginContributorSubmission` claims the
 * single use atomically (compare-and-set, race-safe) BEFORE the actual
 * upload pipeline runs; `completeContributorSubmission` finishes it on
 * success; `abandonContributorSubmission` releases the claim back to
 * PENDING on any failure downstream, so a contributor whose upload merely
 * failed (a bad file, a transient storage error) is never permanently
 * locked out by a token their own attempt already consumed.
 */

export type ContributorRequest = typeof schema.contributorRequests.$inferSelect;

const DEFAULT_EXPIRY_DAYS = 7;

async function ownedMissionApplicant(
  db: Db,
  actorAccountId: string,
  missionId: string,
): Promise<{ readonly applicantId: string } | null> {
  const mission = first(
    await db.select().from(schema.missions).where(eq(schema.missions.id, missionId)).limit(1),
  );
  if (!mission) return null;
  const applicant = await getApplicant(db, mission.applicantId);
  if (!applicant || applicant.ownerAccountId !== actorAccountId) return null;
  return { applicantId: mission.applicantId };
}

export interface CreateContributorRequestInput {
  readonly actorAccountId: string;
  readonly missionId: string;
  readonly contributorEmail: string;
  readonly docType: string;
  readonly purpose: string;
  readonly message?: string;
  /** With the key service, the contributor is emailed the link (sealed in the outbox). */
  readonly encryption?: KeyManagementPort;
}

export interface CreatedContributorRequest {
  readonly request: ContributorRequest;
  /** An email with the link was queued for the contributor. */
  readonly emailQueued: boolean;
  /** The raw, unhashed token. Exists only here and in whatever link the caller hands to the contributor, never logged, never persisted. */
  readonly rawToken: string;
}

/** Ask a named third party for exactly one piece of evidence on this case (mission owner only). */
export async function createContributorRequest(
  db: Db,
  input: CreateContributorRequestInput,
): Promise<Result<CreatedContributorRequest, ServiceError>> {
  const owned = await ownedMissionApplicant(db, input.actorAccountId, input.missionId);
  if (!owned) return err(serviceError('forbidden', 'not authorized for this case'));
  const contributorEmail = input.contributorEmail.trim().toLowerCase();
  if (contributorEmail.length === 0) {
    return err(serviceError('invalid', "the contributor's email is required"));
  }
  const docType = input.docType.trim();
  if (docType.length === 0) {
    return err(serviceError('invalid', 'name exactly what document is needed'));
  }
  const purpose = input.purpose.trim();
  if (purpose.length === 0) {
    return err(serviceError('invalid', 'explain why this is needed - shown to the contributor'));
  }

  const rawToken = generateInvitationToken();
  const tokenHash = hashInvitationToken(rawToken);
  const expiresAt = new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  return db.transaction(async (tx) => {
    const request = required(
      first(
        await tx
          .insert(schema.contributorRequests)
          .values({
            missionId: input.missionId,
            applicantId: owned.applicantId,
            requestedByAccountId: input.actorAccountId,
            contributorEmail,
            docType,
            purpose,
            message: input.message?.trim() || null,
            tokenHash,
            expiresAt,
          })
          .returning(),
      ),
      'contributor request',
    );
    // The email is sealed first: it asks the key service over the network, and that wait must
    // never happen while this transaction holds the platform-wide audit lock.
    if (input.encryption) {
      await queueInvitationEmail(tx, {
        kind: 'contributor',
        invitationId: request.id,
        email: contributorEmail,
        rawToken,
        encryption: input.encryption,
      });
    }
    await appendAuditEvent(tx, {
      eventType: 'CONTRIBUTOR_REQUEST_CREATED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: owned.applicantId,
      missionId: input.missionId,
      resourceType: 'contributor_request',
      resourceId: request.id,
      metadata: { docType },
    });
    return ok({ request, rawToken, emailQueued: input.encryption !== undefined });
  });
}

export interface ContributorRequestPreview {
  readonly applicantName: string;
  readonly missionTitle: string;
  readonly docType: string;
  readonly purpose: string;
  readonly message: string | null;
  readonly expiresAt: Date;
  /** Organizations currently holding real (active, accepted, unexpired) access to this case - "intended recipients," alongside the traveller themself. */
  readonly recipientOrganizationNames: readonly string[];
  /** Informational only for the UI - beginContributorSubmission independently re-verifies this itself and never trusts this flag as the real authorization decision. */
  readonly emailMatches: boolean;
}

/**
 * Read-only lookup, deliberately never consuming the token or binding a
 * contributor account: a one-time request must not be spent as a side
 * effect of a GET request. CAS-08's own "sees purpose, intended recipients
 * and retention before upload" - purpose/recipients are computed here;
 * retention is a per-docType platform policy the caller looks up
 * separately (retention.ts's getRetentionPolicies), since it is not
 * specific to any one request.
 */
export async function previewContributorRequest(
  db: Db,
  input: { readonly rawToken: string; readonly actorEmail: string },
): Promise<Result<ContributorRequestPreview, ServiceError>> {
  const tokenHash = hashInvitationToken(input.rawToken);
  const lifecycle = await lifecycleTablesPresent(db);
  const row = first(
    await db
      .select({
        applicantId: schema.contributorRequests.applicantId,
        applicantName: schema.applicants.displayName,
        missionTitle: schema.missions.title,
        docType: schema.contributorRequests.docType,
        purpose: schema.contributorRequests.purpose,
        message: schema.contributorRequests.message,
        contributorEmail: schema.contributorRequests.contributorEmail,
        status: schema.contributorRequests.status,
        expiresAt: schema.contributorRequests.expiresAt,
      })
      .from(schema.contributorRequests)
      .innerJoin(
        schema.applicants,
        eq(schema.applicants.id, schema.contributorRequests.applicantId),
      )
      .innerJoin(schema.missions, eq(schema.missions.id, schema.contributorRequests.missionId))
      .where(
        and(
          eq(schema.contributorRequests.tokenHash, tokenHash),
          // A request into one named record: presentApplicantCondition (a traveller in Recently
          // Deleted takes in nothing new; an archived one still can).
          lifecycle ? presentApplicantCondition() : undefined,
        ),
      )
      .limit(1),
  );
  if (!row) return err(serviceError('not_found', 'request not found'));
  if (row.status !== 'PENDING') {
    return err(serviceError('invalid', 'this request has already been used or revoked'));
  }
  if (row.expiresAt.getTime() < Date.now()) {
    return err(serviceError('invalid', 'this request has expired'));
  }

  const now = new Date();
  const orgRows = await db
    .selectDistinct({ name: schema.organizations.name })
    .from(schema.grants)
    .innerJoin(
      schema.organizations,
      eq(schema.organizations.id, schema.grants.recipientOrganizationId),
    )
    .where(
      and(
        eq(schema.grants.applicantId, row.applicantId),
        eq(schema.grants.status, 'ACTIVE'),
        isNotNull(schema.grants.acceptedAt),
        lte(schema.grants.startAt, now),
        or(isNull(schema.grants.expiryAt), gt(schema.grants.expiryAt, now)),
      ),
    );

  return ok({
    applicantName: row.applicantName,
    missionTitle: row.missionTitle,
    docType: row.docType,
    purpose: row.purpose,
    message: row.message,
    expiresAt: row.expiresAt,
    recipientOrganizationNames: orgRows.map((r) => r.name),
    emailMatches: row.contributorEmail === input.actorEmail.trim().toLowerCase(),
  });
}

export interface BeginContributorSubmissionInput {
  readonly rawToken: string;
  readonly actorAccountId: string;
  /** The submitting account's own authenticated (WorkOS-verified) email, never client-supplied - CAS-08's "email verification binds the contributor." */
  readonly actorEmail: string;
  readonly allowWalletReuse: boolean;
}

/**
 * Claim the single use, atomically, before the actual upload pipeline
 * touches storage - mirrors uploads.ts's reserveUpload reserving quota
 * bytes before the blob write, not after. Fails closed on every mismatch
 * (unknown token, already-consumed/revoked, expired, wrong email), never a
 * generic "invalid token" that would help distinguish which failure mode
 * was hit.
 */
export async function beginContributorSubmission(
  db: Db,
  input: BeginContributorSubmissionInput,
): Promise<Result<ContributorRequest, ServiceError>> {
  const tokenHash = hashInvitationToken(input.rawToken);
  const request = first(
    await db
      .select()
      .from(schema.contributorRequests)
      .where(eq(schema.contributorRequests.tokenHash, tokenHash))
      .limit(1),
  );
  if (!request) return err(serviceError('not_found', 'request not found'));
  if (request.status !== 'PENDING') {
    return err(serviceError('invalid', 'this request has already been used or revoked'));
  }
  if (request.expiresAt.getTime() < Date.now()) {
    return err(serviceError('invalid', 'this request has expired'));
  }
  if (request.contributorEmail !== input.actorEmail.trim().toLowerCase()) {
    return err(serviceError('forbidden', 'this request was sent to a different email address'));
  }

  return db.transaction(async (tx) => {
    const updated = first(
      await tx
        .update(schema.contributorRequests)
        .set({
          status: 'SUBMITTED',
          contributorAccountId: input.actorAccountId,
          allowWalletReuse: input.allowWalletReuse,
          submittedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.contributorRequests.id, request.id),
            eq(schema.contributorRequests.status, 'PENDING'),
          ),
        )
        .returning(),
    );
    if (!updated) {
      return err(serviceError('invalid', 'this request has already been used or revoked'));
    }
    await appendAuditEvent(tx, {
      eventType: 'CONTRIBUTOR_SUBMISSION_STARTED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: request.applicantId,
      missionId: request.missionId,
      resourceType: 'contributor_request',
      resourceId: request.id,
    });
    return ok(updated);
  });
}

/** True only if this actor is the bound contributor for a currently in-flight (claimed, not yet completed) request naming this exact applicant. The one alternate path documents.ts's registerDocument/addDocumentVersion accept besides plain ownership. */
export async function isInFlightContributorSubmission(
  db: Db,
  input: {
    readonly contributorRequestId: string;
    readonly actorAccountId: string;
    readonly applicantId: string;
  },
): Promise<boolean> {
  const row = first(
    await db
      .select()
      .from(schema.contributorRequests)
      .where(eq(schema.contributorRequests.id, input.contributorRequestId))
      .limit(1),
  );
  if (!row) return false;
  return isInFlightContributorRow(row, input);
}

/**
 * The in-flight test itself, on an already-loaded row: claimed (SUBMITTED),
 * bound to this account, naming this applicant, and not yet completed.
 * Shared with the access gate so both apply exactly the same rule.
 */
export function isInFlightContributorRow(
  row: ContributorRequest,
  input: { readonly actorAccountId: string; readonly applicantId: string },
): boolean {
  return (
    row.applicantId === input.applicantId &&
    row.status === 'SUBMITTED' &&
    row.contributorAccountId === input.actorAccountId &&
    row.submittedDocumentId === null
  );
}

/** Finish a claimed submission once the document is actually registered. */
export async function completeContributorSubmission(
  db: Db,
  input: { readonly contributorRequestId: string; readonly documentId: string },
): Promise<Result<ContributorRequest, ServiceError>> {
  const updated = first(
    await db
      .update(schema.contributorRequests)
      .set({ submittedDocumentId: input.documentId, updatedAt: new Date() })
      .where(
        and(
          eq(schema.contributorRequests.id, input.contributorRequestId),
          eq(schema.contributorRequests.status, 'SUBMITTED'),
          isNull(schema.contributorRequests.submittedDocumentId),
        ),
      )
      .returning(),
  );
  if (!updated) {
    return err(serviceError('invalid', 'contributor request not in a completable state'));
  }
  return ok(updated);
}

/** Release a claimed-but-failed submission back to PENDING - mirrors uploads.ts's failUpload releasing a reservation. Never touches a request that already completed. */
export async function abandonContributorSubmission(
  db: Db,
  contributorRequestId: string,
): Promise<void> {
  await db
    .update(schema.contributorRequests)
    .set({
      status: 'PENDING',
      contributorAccountId: null,
      submittedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.contributorRequests.id, contributorRequestId),
        eq(schema.contributorRequests.status, 'SUBMITTED'),
        isNull(schema.contributorRequests.submittedDocumentId),
      ),
    );
}

/** Revoke a still-pending request (mission owner only). */
export async function revokeContributorRequest(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly missionId: string;
    readonly requestId: string;
  },
): Promise<Result<void, ServiceError>> {
  const owned = await ownedMissionApplicant(db, input.actorAccountId, input.missionId);
  if (!owned) return err(serviceError('forbidden', 'not authorized for this case'));
  // missionId is part of the WHERE clause itself, not a separate
  // lookup-then-compare (the same cross-tenant IDOR discipline
  // invitations.ts's revokeOrganizationInvitation already documents): an
  // owner of one mission must never revoke another mission's request by ID
  // alone.
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.contributorRequests)
      .set({ status: 'REVOKED', revokedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.contributorRequests.id, input.requestId),
          eq(schema.contributorRequests.missionId, input.missionId),
          eq(schema.contributorRequests.status, 'PENDING'),
        ),
      )
      .returning({ id: schema.contributorRequests.id });
    if (updated.length === 0) {
      return err(serviceError('invalid', 'request not found, already used, or already revoked'));
    }
    // An email not sent yet must not go out for a request that no longer works.
    await cancelQueuedNotificationsForResource(tx, input.requestId);
    return ok(undefined);
  });
}

/** List a mission's contributor requests, newest first (mission owner only). */
export async function listContributorRequests(
  db: Db,
  input: { readonly actorAccountId: string; readonly missionId: string },
): Promise<Result<ContributorRequest[], ServiceError>> {
  const owned = await ownedMissionApplicant(db, input.actorAccountId, input.missionId);
  if (!owned) return err(serviceError('forbidden', 'not authorized for this case'));
  const rows = await db
    .select()
    .from(schema.contributorRequests)
    .where(eq(schema.contributorRequests.missionId, input.missionId))
    .orderBy(desc(schema.contributorRequests.createdAt));
  return ok(rows);
}
