import type {
  AccountId,
  AgencyId,
  ApplicantId,
  DocumentId,
  MissionId,
  PermissionAction,
} from '@visastack/core';
import { type Result, err, ok } from '@visastack/core';
import { type Actor as PolicyActor, type Grant as PolicyGrant, authorize } from '@visastack/policy';
import { and, eq } from 'drizzle-orm';
import { getApplicant } from './applicants';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { RATE_LIMITS, checkRateLimit } from './rate-limit';

/**
 * Sharing — scoped, accepted, time-limited grants (Build Spec §4.4; PRD §5).
 *
 * A grant is the ONLY way access crosses tenants. The applicant owner creates
 * it (purpose-bound, action-scoped, optionally mission/category/document-scoped
 * and time limited); it takes effect only once the recipient accepts, and is
 * revocable at any time. The policy engine consumes these rows; this service
 * manages their lifecycle and gives the owner full access transparency.
 */

export type Grant = typeof schema.grants.$inferSelect;

/** Map the grant rows for an applicant into the policy engine's Grant shape. */
export async function loadGrantsForPolicy(db: Db, applicantId: string): Promise<PolicyGrant[]> {
  const rows = await db
    .select()
    .from(schema.grants)
    .where(eq(schema.grants.applicantId, applicantId));
  return rows.map((row) => ({
    applicantId: row.applicantId as ApplicantId,
    actions: row.actions as PermissionAction[],
    purpose: row.purpose,
    status: row.status,
    startAt: row.startAt.toISOString(),
    ...(row.recipientAccountId ? { recipientAccountId: row.recipientAccountId as AccountId } : {}),
    ...(row.recipientOrganizationId
      ? { recipientOrganizationId: row.recipientOrganizationId as AgencyId }
      : {}),
    ...(row.missionId ? { missionId: row.missionId as MissionId } : {}),
    ...(row.categories ? { categories: row.categories } : {}),
    ...(row.documentIds ? { documentIds: row.documentIds as DocumentId[] } : {}),
    ...(row.acceptedAt ? { acceptedAt: row.acceptedAt.toISOString() } : {}),
    ...(row.expiryAt ? { expiryAt: row.expiryAt.toISOString() } : {}),
  }));
}

async function ownsApplicant(
  db: Db,
  actorAccountId: string,
  applicantId: string,
): Promise<boolean> {
  const applicant = await getApplicant(db, applicantId);
  return applicant !== undefined && applicant.ownerAccountId === actorAccountId;
}

export interface CreateGrantInput {
  readonly actorAccountId: string;
  readonly applicantId: string;
  readonly recipientAccountId?: string;
  readonly recipientOrganizationId?: string;
  readonly actions: readonly PermissionAction[];
  readonly purpose: string;
  readonly categories?: readonly string[];
  readonly documentIds?: readonly string[];
  readonly missionId?: string;
  readonly expiryAt?: Date;
}

/** Create a pending, purpose-bound grant (applicant owner only). */
export async function createGrant(
  db: Db,
  input: CreateGrantInput,
): Promise<Result<Grant, ServiceError>> {
  if (!(await ownsApplicant(db, input.actorAccountId, input.applicantId))) {
    return err(serviceError('forbidden', 'only the applicant owner can grant access'));
  }
  if (!input.recipientAccountId && !input.recipientOrganizationId) {
    return err(serviceError('invalid', 'a grant must name a recipient'));
  }
  if (input.actions.length === 0)
    return err(serviceError('invalid', 'a grant needs at least one action'));
  if (input.purpose.trim().length === 0)
    return err(serviceError('invalid', 'a purpose is required'));

  const rateLimit = await checkRateLimit(
    db,
    { subjectId: input.actorAccountId, action: 'grant.create' },
    RATE_LIMITS.GRANT_CREATE,
  );
  if (!rateLimit.allowed) return err(serviceError('rate_limited', rateLimit.reason));

  return db.transaction(async (tx) => {
    const grant = required(
      first(
        await tx
          .insert(schema.grants)
          .values({
            applicantId: input.applicantId,
            recipientAccountId: input.recipientAccountId ?? null,
            recipientOrganizationId: input.recipientOrganizationId ?? null,
            missionId: input.missionId ?? null,
            actions: [...input.actions],
            categories: input.categories ? [...input.categories] : null,
            documentIds: input.documentIds ? [...input.documentIds] : null,
            purpose: input.purpose.trim(),
            expiryAt: input.expiryAt ?? null,
          })
          .returning(),
      ),
      'grant',
    );
    await appendAuditEvent(tx, {
      eventType: 'GRANT_CREATED',
      actorAccountId: input.actorAccountId,
      action: 'SHARE',
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: input.applicantId,
      grantId: grant.id,
      resourceType: 'grant',
      resourceId: grant.id,
      metadata: { purpose: grant.purpose, actions: input.actions.length },
    });
    return ok(grant);
  });
}

async function loadGrant(db: Db, grantId: string): Promise<Grant | undefined> {
  return first(await db.select().from(schema.grants).where(eq(schema.grants.id, grantId)).limit(1));
}

/** Accept a pending grant. The actor must be the named recipient. */
export async function acceptGrant(
  db: Db,
  input: { readonly actorAccountId: string; readonly grantId: string },
): Promise<Result<Grant, ServiceError>> {
  const grant = await loadGrant(db, input.grantId);
  if (!grant) return err(serviceError('not_found', 'grant not found'));
  if (grant.status !== 'PENDING_ACCEPTANCE') {
    return err(serviceError('invalid', 'grant is not pending acceptance'));
  }

  const isRecipientAccount = grant.recipientAccountId === input.actorAccountId;
  let isRecipientOrgMember = false;
  if (grant.recipientOrganizationId) {
    const m = first(
      await db
        .select()
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.accountId, input.actorAccountId),
            eq(schema.memberships.organizationId, grant.recipientOrganizationId),
          ),
        )
        .limit(1),
    );
    isRecipientOrgMember = m?.active === true;
  }
  if (!isRecipientAccount && !isRecipientOrgMember) {
    return err(serviceError('forbidden', 'only the grant recipient can accept it'));
  }

  return db.transaction(async (tx) => {
    const updated = required(
      first(
        await tx
          .update(schema.grants)
          .set({ status: 'ACTIVE', acceptedAt: new Date(), updatedAt: new Date() })
          .where(eq(schema.grants.id, input.grantId))
          .returning(),
      ),
      'grant',
    );
    await appendAuditEvent(tx, {
      eventType: 'GRANT_ACCEPTED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: grant.applicantId,
      grantId: grant.id,
      resourceType: 'grant',
      resourceId: grant.id,
    });
    return ok(updated);
  });
}

async function ownerTransition(
  db: Db,
  actorAccountId: string,
  grantId: string,
  to: Grant['status'],
  eventType: string,
): Promise<Result<Grant, ServiceError>> {
  const grant = await loadGrant(db, grantId);
  if (!grant) return err(serviceError('not_found', 'grant not found'));
  if (!(await ownsApplicant(db, actorAccountId, grant.applicantId))) {
    return err(serviceError('forbidden', 'only the applicant owner can change this grant'));
  }
  return db.transaction(async (tx) => {
    const updated = required(
      first(
        await tx
          .update(schema.grants)
          .set({ status: to, updatedAt: new Date() })
          .where(eq(schema.grants.id, grantId))
          .returning(),
      ),
      'grant',
    );
    await appendAuditEvent(tx, {
      eventType,
      actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: grant.applicantId,
      grantId: grant.id,
      resourceType: 'grant',
      resourceId: grant.id,
    });
    return ok(updated);
  });
}

/** Revoke a grant (applicant owner). Access ends on the next request. */
export function revokeGrant(
  db: Db,
  input: { readonly actorAccountId: string; readonly grantId: string },
): Promise<Result<Grant, ServiceError>> {
  return ownerTransition(db, input.actorAccountId, input.grantId, 'REVOKED', 'GRANT_REVOKED');
}

/** Pause a grant (applicant owner). */
export function pauseGrant(
  db: Db,
  input: { readonly actorAccountId: string; readonly grantId: string },
): Promise<Result<Grant, ServiceError>> {
  return ownerTransition(db, input.actorAccountId, input.grantId, 'PAUSED', 'GRANT_PAUSED');
}

/** Resume a paused grant (applicant owner). */
export function resumeGrant(
  db: Db,
  input: { readonly actorAccountId: string; readonly grantId: string },
): Promise<Result<Grant, ServiceError>> {
  return ownerTransition(db, input.actorAccountId, input.grantId, 'ACTIVE', 'GRANT_RESUMED');
}

/** A grant directed at the current account, resolved with the subject's name. */
export interface IncomingGrant {
  readonly grant: Grant;
  readonly applicantName: string;
}

/**
 * Grants whose recipient is this account (the "shared with you" inbox),
 * newest first. Used to surface pending grants the recipient can accept.
 */
export async function listGrantsForRecipientAccount(
  db: Db,
  accountId: string,
): Promise<IncomingGrant[]> {
  const rows = await db
    .select({ grant: schema.grants, applicantName: schema.applicants.displayName })
    .from(schema.grants)
    .innerJoin(schema.applicants, eq(schema.applicants.id, schema.grants.applicantId))
    .where(eq(schema.grants.recipientAccountId, accountId));
  return [...rows]
    .sort((a, b) => b.grant.createdAt.getTime() - a.grant.createdAt.getTime())
    .map((r) => ({ grant: r.grant, applicantName: r.applicantName }));
}

/** Access transparency: every grant on an applicant (owner only). */
export async function listAccessForApplicant(
  db: Db,
  actorAccountId: string,
  applicantId: string,
): Promise<Result<Grant[], ServiceError>> {
  if (!(await ownsApplicant(db, actorAccountId, applicantId))) {
    return err(serviceError('forbidden', 'not authorized to view access for this applicant'));
  }
  const rows = await db
    .select()
    .from(schema.grants)
    .where(eq(schema.grants.applicantId, applicantId));
  return ok(rows);
}

/** A grant's recipient, resolved to something a human recognizes rather than a raw id. */
export interface GrantRecipient {
  readonly kind: 'account' | 'organization' | 'unknown';
  readonly label: string;
}

export interface GrantWithRecipient extends Grant {
  readonly recipient: GrantRecipient;
}

/** Same as `listAccessForApplicant`, but resolves WHO each grant was given to. */
export async function listAccessForApplicantDetailed(
  db: Db,
  actorAccountId: string,
  applicantId: string,
): Promise<Result<GrantWithRecipient[], ServiceError>> {
  const listed = await listAccessForApplicant(db, actorAccountId, applicantId);
  if (!listed.ok) return listed;

  const result: GrantWithRecipient[] = [];
  for (const grant of listed.value) {
    let recipient: GrantRecipient = { kind: 'unknown', label: 'Unknown recipient' };
    if (grant.recipientAccountId) {
      const account = first(
        await db
          .select({ email: schema.accounts.email })
          .from(schema.accounts)
          .where(eq(schema.accounts.id, grant.recipientAccountId))
          .limit(1),
      );
      recipient = { kind: 'account', label: account?.email ?? 'Unknown recipient' };
    } else if (grant.recipientOrganizationId) {
      const organization = first(
        await db
          .select({ name: schema.organizations.name })
          .from(schema.organizations)
          .where(eq(schema.organizations.id, grant.recipientOrganizationId))
          .limit(1),
      );
      recipient = { kind: 'organization', label: organization?.name ?? 'Unknown organization' };
    }
    result.push({ ...grant, recipient });
  }
  return ok(result);
}

// --- Recipient-facing permission-filtered workspace (Release G) ------------
//
// Every prior "sharing" surface only managed the grant lifecycle
// (create/accept/revoke) or gave the OWNER transparency into who has access.
// Nothing previously re-evaluated `authorize()` from the RECIPIENT's side to
// decide what they may actually see — and critically, a direct
// account-to-account grant (the primary "share by email" flow in
// grant-form.tsx) had no `Actor` shape it could even be checked against
// (see `individual_recipient` in packages/policy). This is that missing
// permission-filtered read path.

/** Maps a document's deterministic classification to the same pack vocabulary
 * profile fields use, so one grant's `categories` allow-list can scope both
 * consistently. Unclassified/unrecognized types get no category — a grant
 * with a `categories` restriction will not surface them (fail closed).
 */
const DOC_TYPE_TO_PACK: Readonly<Record<string, string>> = {
  PASSPORT: 'universal',
  BANK_STATEMENT: 'universal',
  EMPLOYMENT_CERTIFICATE: 'professional',
};

export interface RecipientFieldView {
  readonly fieldKey: string;
  readonly value: string | null;
  readonly status: string | null;
}

export interface RecipientDocumentView {
  readonly id: string;
  readonly displayName: string;
  readonly docType: string | null;
}

export interface RecipientWorkspaceView {
  readonly applicantId: string;
  readonly applicantDisplayName: string;
  readonly grant: Grant;
  readonly fields: readonly RecipientFieldView[];
  readonly documents: readonly RecipientDocumentView[];
  /**
   * True when this grant is mission-scoped. No fact or document in today's
   * data model carries a `missionId`, so a mission-scoped grant's resources
   * never match (`scope_mismatch`, Build Spec law 5) and `fields`/`documents`
   * are always empty in that case — fail closed, not silently pretended to
   * work. The UI surfaces this flag to explain why, honestly, rather than
   * showing an unexplained blank page.
   */
  readonly missionScopeUnavailable: boolean;
}

/**
 * The permission-filtered view of an applicant's shared data for ONE
 * specific, active, accepted grant. Every field and document is re-checked
 * live through `authorize()` — nothing here is a cached snapshot from
 * accept-time. Document PREVIEW/DOWNLOAD is intentionally NOT wired to serve
 * actual bytes: `/api/blob/[key]` fails closed on any non-`original` variant
 * until real redacted renditions exist (Milestone 2), so a recipient would
 * hit that 501 regardless of what this function returns — the document list
 * is scoped visibility only, not a working preview, and the UI must say so.
 */
export async function getRecipientWorkspace(
  db: Db,
  input: { readonly actorAccountId: string; readonly grantId: string },
): Promise<Result<RecipientWorkspaceView, ServiceError>> {
  const grant = await loadGrant(db, input.grantId);
  if (!grant) return err(serviceError('not_found', 'grant not found'));
  if (grant.status !== 'ACTIVE' || !grant.acceptedAt) {
    return err(serviceError('forbidden', 'this grant is not active'));
  }

  let actor: PolicyActor;
  if (grant.recipientAccountId === input.actorAccountId) {
    actor = { kind: 'individual_recipient', accountId: input.actorAccountId as AccountId };
  } else if (grant.recipientOrganizationId) {
    const membership = first(
      await db
        .select()
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.accountId, input.actorAccountId),
            eq(schema.memberships.organizationId, grant.recipientOrganizationId),
          ),
        )
        .limit(1),
    );
    if (!membership?.active) {
      return err(serviceError('forbidden', 'not authorized to view this shared workspace'));
    }
    actor = {
      kind: 'organization_member',
      accountId: input.actorAccountId as AccountId,
      membership: {
        organizationId: grant.recipientOrganizationId as AgencyId,
        role: membership.role,
        active: membership.active,
      },
    };
  } else {
    return err(serviceError('forbidden', 'not authorized to view this shared workspace'));
  }

  const applicant = await getApplicant(db, grant.applicantId);
  if (!applicant) return err(serviceError('not_found', 'applicant not found'));

  const grants = await loadGrantsForPolicy(db, grant.applicantId);
  const now = new Date();
  const authContext = { now, purpose: grant.purpose, stepUpSatisfied: false, grants };

  const fieldRows = await db
    .select({
      fieldKey: schema.fieldDefinitions.key,
      packId: schema.fieldDefinitions.packId,
      value: schema.factVersions.value,
      status: schema.factVersions.status,
    })
    .from(schema.facts)
    .innerJoin(
      schema.fieldDefinitions,
      eq(schema.facts.fieldDefinitionId, schema.fieldDefinitions.id),
    )
    .leftJoin(schema.factVersions, eq(schema.facts.currentVersionId, schema.factVersions.id))
    .where(eq(schema.facts.applicantId, grant.applicantId));

  const fields: RecipientFieldView[] = [];
  for (const row of fieldRows) {
    if (row.value === null) continue;
    const decision = authorize({
      actor,
      action: 'VIEW_METADATA',
      resource: {
        applicantId: grant.applicantId as ApplicantId,
        ...(row.packId ? { category: row.packId } : {}),
      },
      context: authContext,
    });
    if (decision.allowed) {
      fields.push({ fieldKey: row.fieldKey, value: row.value, status: row.status });
    }
  }

  const documentRows = await db
    .select({
      id: schema.documents.id,
      originalName: schema.documents.originalName,
      approvedName: schema.documents.approvedName,
      docType: schema.documents.docType,
    })
    .from(schema.documents)
    .where(eq(schema.documents.applicantId, grant.applicantId));

  const documents: RecipientDocumentView[] = [];
  for (const doc of documentRows) {
    const category = doc.docType ? DOC_TYPE_TO_PACK[doc.docType] : undefined;
    const decision = authorize({
      actor,
      action: 'PREVIEW',
      resource: {
        applicantId: grant.applicantId as ApplicantId,
        documentId: doc.id as DocumentId,
        ...(category ? { category } : {}),
      },
      context: authContext,
    });
    if (decision.allowed) {
      documents.push({
        id: doc.id,
        displayName: doc.approvedName ?? doc.originalName,
        docType: doc.docType,
      });
    }
  }

  return ok({
    applicantId: grant.applicantId,
    applicantDisplayName: applicant.displayName,
    grant,
    fields,
    documents,
    missionScopeUnavailable: grant.missionId !== null,
  });
}
