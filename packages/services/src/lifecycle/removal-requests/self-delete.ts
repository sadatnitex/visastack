import { type Result, err, ok } from '@visastack/core';
import { and, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { LIVE_GRANT_STATUSES } from '../../access/grant-scope';
import { AuthorizedApplicant } from '../../access/require-access';
import { appendAuditEvent } from '../../audit';
import { type Db, first, schema } from '../../db';
import { type ServiceError, serviceError } from '../../errors';
import { documentBlockedByLegalHold } from '../../legal-hold';
// Imported by the foundation's path, which the read-path guard recognises.
import { presentDocumentCondition } from '../../lifecycle/foundation/conditions';
import { enqueueNotificationBothChannels } from '../../notifications';
import { recordProductEvent } from '../../product-events';
import { RATE_LIMITS, checkRateLimit } from '../../rate-limit';
import { assignReferenceCodes, referenceCodesFor } from '../../reference-codes';
import { documentBlockReasons } from '../duplicates/status';
import { lifecycleCommandCovers } from '../foundation/access';
import { isUuid } from '../foundation/ids';
import { lifecycleTablesPresent } from '../foundation/presence';
import { openDeletionReceipt } from '../foundation/receipts';
import { enqueueDocumentRemoval } from '../foundation/removal';
import { getDocumentLifecycle } from '../foundation/state';
import { receiptKindOf } from '../recently-deleted/delete';
import {
  type RemovalImpact,
  applyOpenCaseEffects,
  removalImpact,
  removalUploaderRole,
  tellAgenciesOfRemoval,
} from './effects';

/*
 * Delete My File (owner decision of 3 Nov 2026, PROGRAMME D12, reversing D1).
 *
 * The record owner removes one of their own documents for good, at once, without waiting for
 * support. Irreversible, so the authority is exactly one thing: the record owner's genuine MANAGE
 * proof for that traveller (a family record is deleted by the account that manages it). No
 * contributor, agency member, grant holder, staff member or job can reach it: it is typed to
 * `AuthorizedApplicant<'MANAGE'>` and checks the proof again at run time.
 *
 * One transaction, in the lock order of the removal engine and the erasure worker (the traveller
 * row, then the document row): the hold, the refusals and the impact are all read under those
 * locks, so a hold being placed or a share being made is seen. What the person confirmed on
 * screen is compared with what is true now; if more would change, nothing is deleted and they
 * look again. The file is hidden and unservable at commit; the bytes are destroyed and verified by
 * the erasure worker, and the Removal Record reads Removing Securely, then Removed.
 */

/** The word the person types to confirm. Checked here, never only on the screen. */
export const SELF_DELETE_WORD = 'DELETE';

/** Refusal messages; the web layer maps these exact strings to its own words. */
export const SELF_DELETE_REFUSALS = {
  notOwner: 'only the record owner can delete a document',
  unavailable: 'deleting a document is not available yet',
  notLive: 'only a current or archived document can be deleted',
  alreadyGone: 'this document is already deleted',
  legalHold: 'a legal hold covers this document',
  finishedCase: 'a finished case used this document',
  agencyAnswer: 'this document answered an agency request',
  word: 'type the word to confirm',
  impact: 'the confirmation is not valid',
  stale: 'what deleting this document changes has changed since you looked',
  stepUp: 'deleting this document needs a fresh sign-in',
  rateLimited: 'too many deletions in a short time, try again later',
} as const;

/**
 * What deleting one file changes, as counts the person confirms on screen. A file used by a
 * finished case or an agency's answer is refused outright, so those are not counted here.
 */
export interface SelfDeleteImpact {
  /** Open cases that used it: each will ask for another document. */
  readonly openCases: number;
  /** Agencies that lose access now and are told: those working an open case that used it, and those it was shared with by name. */
  readonly agencies: number;
  /** Live shares that name it, with agencies or people. */
  readonly shares: number;
  /** Profile details read from it: they stay, without this file as their source. */
  readonly profileDetails: number;
  /** AI app choices of it. */
  readonly aiChoices: number;
  /** Trips that use it as shared evidence. */
  readonly trips: number;
  /** Hand-overs from people the owner invited. */
  readonly contributorHandovers: number;
}

export const SELF_DELETE_IMPACT_KEYS = [
  'openCases',
  'agencies',
  'shares',
  'profileDetails',
  'aiChoices',
  'trips',
  'contributorHandovers',
] as const satisfies readonly (keyof SelfDeleteImpact)[];

export interface SelfDeletePreview {
  readonly impact: SelfDeleteImpact;
  /** Deleting needs a fresh sign-in: the file is shared, or an open case uses it. */
  readonly needsFreshSignIn: boolean;
}

export interface SelfDeleteOutcome {
  readonly receiptId: string;
  readonly documentCode: string;
  /** QUEUED: the files are being removed securely; REMOVED: the document had no stored file. */
  readonly removal: 'QUEUED' | 'REMOVED';
  readonly openCasesUpdated: number;
  readonly agenciesTold: number;
}

export interface DeleteMyFileInput {
  readonly documentId: string;
  /** What the person typed; must be the confirmation word. */
  readonly typed: string;
  /** What the person saw on screen. Anything that would now change more than this is refused. */
  readonly confirmed: SelfDeleteImpact;
  /** Honestly derived from a genuine fresh sign-in (apps/web/src/lib/step-up.ts), never asserted by the browser. */
  readonly stepUpSatisfied: boolean;
}

function ownerProblem(access: AuthorizedApplicant<'MANAGE'>): ServiceError | undefined {
  if (
    !(access instanceof AuthorizedApplicant) ||
    !lifecycleCommandCovers(access, access.applicant.id) ||
    access.actor.kind !== 'applicant_owner'
  ) {
    return serviceError('forbidden', SELF_DELETE_REFUSALS.notOwner);
  }
  return undefined;
}

/** Thrown inside the transaction once something was written, so everything rolls back. */
class RollBack extends Error {
  constructor(readonly refusal: ServiceError) {
    super(refusal.message);
  }
}

const count = sql<number>`count(*)::int`;

interface Assessment {
  readonly impact: SelfDeleteImpact;
  readonly base: RemovalImpact;
  /** Agencies given the document by name with a live active share. */
  readonly sharedOrganizationIds: readonly string[];
  readonly document: {
    readonly docType: string | null;
    readonly createdAt: Date;
    readonly uploaderAccountId: string | null;
    readonly source: string | null;
  };
}

/** The agency requests and answers that used a document: a finished record, so it is kept. */
async function answeredCollectionRequest(tx: Db, documentId: string): Promise<boolean> {
  const items = schema.agencyCollectionResponseItems;
  const withdrawals = schema.agencyCollectionResponseWithdrawals;
  const row = first(
    await tx
      .select({ id: items.id })
      .from(items)
      .where(
        and(
          eq(items.documentId, documentId),
          // A withdrawn answer ends the agency's access: it no longer keeps the file.
          sql`not exists (select 1 from ${withdrawals} where ${withdrawals.responseId} = ${items.responseId})`,
        ),
      )
      .limit(1),
  );
  return row !== undefined;
}

/**
 * Everything that decides whether the file may go and what it changes, read through `tx`. Under
 * the caller's locks during a deletion; unlocked for the preview. The refusals come in a fixed
 * order: not here, not live, a legal hold, a finished case, an agency's answer.
 */
async function assess(
  tx: Db,
  access: AuthorizedApplicant<'MANAGE'>,
  documentId: string,
  now: Date,
  lock: boolean,
): Promise<Result<Assessment, ServiceError>> {
  const applicantId = access.applicant.id;
  const query = tx
    .select({
      id: schema.documents.id,
      docType: schema.documents.docType,
      createdAt: schema.documents.createdAt,
      uploaderAccountId: schema.documents.uploaderAccountId,
      source: schema.documents.source,
    })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.id, documentId),
        eq(schema.documents.applicantId, applicantId),
        presentDocumentCondition(),
      ),
    );
  const document = first(await (lock ? query.for('update') : query));
  if (!document) {
    const deleted = first(
      await tx
        .select({ deletedAt: schema.documentLifecycle.deletedAt })
        .from(schema.documentLifecycle)
        .where(
          and(
            eq(schema.documentLifecycle.documentId, documentId),
            eq(schema.documentLifecycle.applicantId, applicantId),
          ),
        ),
    );
    return deleted?.deletedAt
      ? err(serviceError('stale', SELF_DELETE_REFUSALS.alreadyGone))
      : err(serviceError('not_found', 'document not found'));
  }
  const lifecycle = await getDocumentLifecycle(tx, documentId, access, { now });
  if (!lifecycle || (lifecycle.state !== 'CURRENT' && lifecycle.state !== 'ARCHIVED')) {
    return err(serviceError('invalid', SELF_DELETE_REFUSALS.notLive));
  }
  if (await documentBlockedByLegalHold(tx, { applicantId, documentId })) {
    return err(serviceError('invalid', SELF_DELETE_REFUSALS.legalHold));
  }
  const reasons = await documentBlockReasons(tx, { applicantId, documentId }, access, { now });
  if (reasons.has('FINISHED_CASE')) {
    return err(serviceError('invalid', SELF_DELETE_REFUSALS.finishedCase));
  }
  if (reasons.has('AGENCY_REQUEST_ANSWER') || (await answeredCollectionRequest(tx, documentId))) {
    return err(serviceError('invalid', SELF_DELETE_REFUSALS.agencyAnswer));
  }

  const base = await removalImpact(tx, applicantId, documentId, now, access);
  const grants = schema.grants;
  const shareRows = await tx
    .select({ status: grants.status, organizationId: grants.recipientOrganizationId })
    .from(grants)
    .where(
      and(
        eq(grants.applicantId, applicantId),
        inArray(grants.status, [...LIVE_GRANT_STATUSES]),
        or(isNull(grants.expiryAt), gt(grants.expiryAt, now)),
        or(
          sql`${documentId}::uuid = any(${grants.documentIds})`,
          sql`${documentId}::uuid = any(${grants.documentScopeSnapshot})`,
        ),
      ),
    );
  const sharedOrganizationIds = [
    ...new Set(
      shareRows.flatMap((row) =>
        row.status === 'ACTIVE' && row.organizationId ? [row.organizationId] : [],
      ),
    ),
  ].sort();
  const agencies = new Set([...base.agenciesByCase.values()].flat());
  for (const id of sharedOrganizationIds) agencies.add(id);

  const sourced = await tx
    .selectDistinct({ factId: schema.factVersions.factId })
    .from(schema.factVersions)
    .innerJoin(
      schema.documentVersions,
      eq(schema.documentVersions.id, schema.factVersions.sourceDocumentVersionId),
    )
    .where(eq(schema.documentVersions.documentId, documentId));
  const [ai] = await tx
    .select({ n: count })
    .from(schema.aiConnectionDocuments)
    .where(eq(schema.aiConnectionDocuments.documentId, documentId));
  const trips = await tx
    .selectDistinct({ tripId: schema.umpeTripEvidence.tripId })
    .from(schema.umpeTripEvidence)
    .where(
      and(
        eq(schema.umpeTripEvidence.documentId, documentId),
        isNull(schema.umpeTripEvidence.removedAt),
      ),
    );
  const [handovers] = await tx
    .select({ n: count })
    .from(schema.contributorRequests)
    .where(eq(schema.contributorRequests.submittedDocumentId, documentId));

  return ok({
    impact: {
      openCases: base.openCaseIds.length,
      agencies: agencies.size,
      shares: shareRows.length,
      profileDetails: sourced.length,
      aiChoices: Number(ai?.n ?? 0),
      trips: trips.length,
      contributorHandovers: Number(handovers?.n ?? 0),
    },
    base,
    sharedOrganizationIds,
    document: {
      docType: document.docType,
      createdAt: document.createdAt,
      uploaderAccountId: document.uploaderAccountId,
      source: document.source,
    },
  });
}

function needsFreshSignIn(impact: SelfDeleteImpact): boolean {
  return impact.openCases > 0 || impact.agencies > 0 || impact.shares > 0;
}

function isImpact(confirmed: unknown): confirmed is SelfDeleteImpact {
  if (typeof confirmed !== 'object' || confirmed === null) return false;
  return SELF_DELETE_IMPACT_KEYS.every((key) => {
    const value = (confirmed as Record<string, unknown>)[key];
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
  });
}

/**
 * What deleting the file will do, for the confirmation screen: the counts it will show and
 * whether a fresh sign-in will be asked for. Refused exactly when `deleteMyFile` would refuse it
 * for who the person is or what the file is (not here, a legal hold, a finished case, an agency's
 * answer). Owner only.
 */
export async function previewDeleteMyFile(
  access: AuthorizedApplicant<'MANAGE'>,
  input: { readonly documentId: string },
  options: { readonly now?: Date } = {},
): Promise<Result<SelfDeletePreview, ServiceError>> {
  const problem = ownerProblem(access);
  if (problem) return err(problem);
  if (!isUuid(input.documentId)) return err(serviceError('not_found', 'document not found'));
  if (!(await lifecycleTablesPresent(access.tx))) {
    return err(serviceError('invalid', SELF_DELETE_REFUSALS.unavailable));
  }
  const assessed = await assess(
    access.tx,
    access,
    input.documentId.toLowerCase(),
    options.now ?? new Date(),
    false,
  );
  if (!assessed.ok) return assessed;
  return ok({
    impact: assessed.value.impact,
    needsFreshSignIn: needsFreshSignIn(assessed.value.impact),
  });
}

const OPEN_CASE_TASK =
  'A document was deleted by you. Choose another document for this case, then confirm the case again.';

/**
 * Delete My File. `access` is the record owner's MANAGE proof for the traveller the document
 * belongs to. The caller (the web action) also checks the `DOCUMENT_SELF_DELETE` switch and
 * derives `stepUpSatisfied` from a genuine fresh sign-in; this function asks for it only when the
 * file is shared or an open case uses it (decided here, under the locks, never by the caller).
 */
export async function deleteMyFile(
  access: AuthorizedApplicant<'MANAGE'>,
  input: DeleteMyFileInput,
  options: { readonly now?: Date } = {},
): Promise<Result<SelfDeleteOutcome, ServiceError>> {
  const problem = ownerProblem(access);
  if (problem) return err(problem);
  if (!isUuid(input.documentId)) return err(serviceError('not_found', 'document not found'));
  if (typeof input.typed !== 'string' || input.typed.trim().toUpperCase() !== SELF_DELETE_WORD) {
    return err(serviceError('invalid', SELF_DELETE_REFUSALS.word));
  }
  if (!isImpact(input.confirmed)) {
    return err(serviceError('invalid', SELF_DELETE_REFUSALS.impact));
  }
  if (!(await lifecycleTablesPresent(access.tx))) {
    return err(serviceError('invalid', SELF_DELETE_REFUSALS.unavailable));
  }
  const confirmed = input.confirmed;
  const applicantId = access.applicant.id;
  const documentId = input.documentId.toLowerCase();
  const ownerAccountId = access.applicant.ownerAccountId;
  const now = options.now ?? new Date();

  try {
    return await access.tx.transaction(
      async (tx): Promise<Result<SelfDeleteOutcome, ServiceError>> => {
        // The same lock order as the removal engine and the erasure worker: the traveller, then the
        // document (taken inside `assess`), so a legal hold being placed is seen.
        await tx
          .select({ id: schema.applicants.id })
          .from(schema.applicants)
          .where(eq(schema.applicants.id, applicantId))
          .for('update');
        const assessed = await assess(tx, access, documentId, now, true);
        if (!assessed.ok) return assessed;
        const { impact, base, sharedOrganizationIds, document } = assessed.value;

        // Nothing decided before the locks is trusted: more would change than the person saw.
        if (SELF_DELETE_IMPACT_KEYS.some((key) => impact[key] > confirmed[key])) {
          return err(serviceError('stale', SELF_DELETE_REFUSALS.stale));
        }
        if (needsFreshSignIn(impact) && input.stepUpSatisfied !== true) {
          return err(serviceError('step_up_required', SELF_DELETE_REFUSALS.stepUp));
        }
        // Counted last, once the deletion is certain to go ahead; kept even if it is refused here.
        const allowed = await checkRateLimit(
          tx,
          { subjectId: ownerAccountId, action: 'document.self_delete', label: 'deletion' },
          RATE_LIMITS.DOCUMENT_SELF_DELETE,
          now,
        );
        if (!allowed.allowed)
          return err(serviceError('rate_limited', SELF_DELETE_REFUSALS.rateLimited));

        // Reference codes only, never a name or title.
        await assignReferenceCodes(tx, 'D', [documentId]);
        await assignReferenceCodes(tx, 'C', base.openCaseIds);
        const documentCode = (await referenceCodesFor(tx, 'D', [documentId])).get(documentId);
        if (!documentCode) throw new Error('delete my file: no reference code for the document');
        const caseCodes = await referenceCodesFor(tx, 'C', base.openCaseIds);

        await applyOpenCaseEffects(
          tx,
          {
            applicantId,
            documentId,
            ownerAccountId,
            impact: base,
            taskDescription: OPEN_CASE_TASK,
          },
          access,
        );

        const receipt = await openDeletionReceipt(
          tx,
          {
            applicantId,
            subjectKind: 'DOCUMENT',
            subjectCode: documentCode,
            documentKind: receiptKindOf(document.docType),
            uploadedAt: document.createdAt,
            uploadedByRole: removalUploaderRole(document, ownerAccountId),
            path: 'REQUEST',
            requestedByAccountId: ownerAccountId,
            approvedByAccountId: null,
            requestedAt: now,
            scheduledFor: now,
            status: 'SCHEDULED',
            effects: {
              ...(base.openCaseIds.length > 0
                ? { casesFlagged: base.openCaseIds.flatMap((id) => caseCodes.get(id) ?? []) }
                : {}),
              sharesAffected: impact.shares,
            },
          },
          access,
        );
        if (!receipt.ok) throw new Error(`delete my file: receipt refused (${receipt.error.code})`);

        const lifecycle = {
          deletedAt: now,
          deletedByAccountId: ownerAccountId,
          deletePath: 'REQUEST' as const,
          purgeAfter: now,
          receiptId: receipt.value.id,
          updatedAt: now,
        };
        await tx
          .insert(schema.documentLifecycle)
          .values({ documentId, applicantId, ...lifecycle })
          .onConflictDoUpdate({ target: schema.documentLifecycle.documentId, set: lifecycle });

        // A request for the same file that support has not decided is closed: it is done.
        const closed = await tx
          .update(schema.documentRemovalRequests)
          .set({ status: 'COMPLETED', completedAt: now, receiptId: receipt.value.id })
          .where(
            and(
              eq(schema.documentRemovalRequests.documentId, documentId),
              eq(schema.documentRemovalRequests.status, 'PENDING'),
            ),
          )
          .returning({ id: schema.documentRemovalRequests.id });

        const removal = await enqueueDocumentRemoval(
          tx,
          { documentId, applicantId, receiptId: receipt.value.id },
          access,
          { now },
        );
        if (!removal.ok) throw new Error(`delete my file: removal refused (${removal.error.code})`);
        // The hold was checked under the same locks, so BLOCKED here means something changed in
        // between: roll everything back rather than record a deletion that removes nothing.
        if (removal.value.outcome === 'BLOCKED') {
          throw new RollBack(serviceError('invalid', SELF_DELETE_REFUSALS.legalHold));
        }

        const told = await tellAgenciesOfRemoval(
          tx,
          {
            applicantId,
            resourceId: receipt.value.id,
            ownerAccountId,
            impact: base,
            caseCodes,
            otherOrganizationIds: sharedOrganizationIds,
          },
          access,
        );
        // The owner is told every time, so a deletion made from a stolen session is noticed.
        await enqueueNotificationBothChannels(tx, {
          eventType: 'DOCUMENT_SELF_DELETED',
          recipientAccountId: ownerAccountId,
          resourceId: receipt.value.id,
          applicantId,
          payload: {
            subject: 'A document was removed',
            summary: `Document ${documentCode} was removed from VisaStack. If this was not you, secure your account and contact support.`,
            deepLinkPath: `/app/applicant/${applicantId}/removal-records`,
          },
        });

        await appendAuditEvent(tx, {
          eventType: 'DOCUMENT_SELF_DELETED',
          actorAccountId: ownerAccountId,
          method: 'MANUAL',
          result: 'ALLOWED',
          applicantId,
          resourceType: 'document',
          resourceId: documentId,
          metadata: {
            receiptId: receipt.value.id,
            path: 'SELF',
            openCases: impact.openCases,
            caseTasksFor: base.openCaseIds,
            finishedCases: base.finishedCases,
            agenciesTold: told.size,
            shares: impact.shares,
            profileDetails: impact.profileDetails,
            aiChoices: impact.aiChoices,
            trips: impact.trips,
            requestsClosed: closed.length,
          },
        });
        await recordProductEvent(tx, {
          eventType: 'DOCUMENT_SELF_DELETED',
          accountId: ownerAccountId,
        });
        return ok({
          receiptId: receipt.value.id,
          documentCode,
          removal: removal.value.outcome,
          openCasesUpdated: base.openCaseIds.length,
          agenciesTold: told.size,
        });
      },
    );
  } catch (error) {
    if (error instanceof RollBack) return err(error.refusal);
    throw error;
  }
}
