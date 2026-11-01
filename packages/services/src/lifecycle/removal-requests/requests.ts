import { type Result, err, formatReferenceCode, ok } from '@visastack/core';
import { and, asc, eq, gt, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { withCaseExclusions } from '../../access/grant-scope';
import { type StaffScope, SystemScope, staffScopeProblem } from '../../access/principal';
import { AuthorizedApplicant } from '../../access/require-access';
import { appendAuditEvent } from '../../audit';
import { type Db, first, schema } from '../../db';
import { type ServiceError, serviceError } from '../../errors';
import { documentBlockedByLegalHold } from '../../legal-hold';
// Imported by the foundation's path, which the read-path guard recognises.
import { presentDocumentCondition } from '../../lifecycle/foundation/conditions';
import { incrementMaterialRevision } from '../../material-revision';
import { createTask } from '../../missions';
import { enqueueNotification, enqueueNotificationBothChannels } from '../../notifications';
import { listActivePlatformRoles } from '../../platform-roles';
import { recordProductEvent } from '../../product-events';
import {
  assignReferenceCode,
  assignReferenceCodes,
  referenceCodesFor,
} from '../../reference-codes';
import { lifecycleCommandCovers } from '../foundation/access';
import { availableDocumentActions } from '../foundation/actions';
import { isUuid } from '../foundation/ids';
import { lifecycleTablesPresent } from '../foundation/presence';
import { openDeletionReceipt } from '../foundation/receipts';
import { enqueueDocumentRemoval } from '../foundation/removal';
import { getDocumentLifecycle } from '../foundation/state';
import { FINISHED_CASE_STATES_FOR_REPLACE } from '../replace/replace';
import { REMOVAL_ALERT_WORKING_DAYS, workingDaysBetween } from './working-days';

/*
 * Ask Us to Remove This File (LC-D, PROGRAMME owner decisions D1, D3, D7, D8; lanes/D.md).
 *
 * The record owner asks for one document to be fully removed, with a reason picked from a fixed
 * list (no typed text is ever stored). Support sees the request in a queue with what approving
 * would change, and decides after a fresh sign-in check. Approving, in one transaction: refuses
 * under a legal hold, takes the document out of every open case (each gets a task and a material
 * revision bump), leaves finished cases' snapshots alone, opens the Removal Record, marks the
 * document as being removed and queues the verified erasure. Agencies working an open case that
 * used it are told without the document's name. The person is told when support decides and
 * when the file is gone.
 */

/**
 * Case states that are over (owner decision D5: closed, cancelled, submitted). A removal leaves
 * them exactly as they were: their snapshot stays, their selection is never edited here.
 */
export const FINISHED_CASE_STATES_FOR_REMOVAL = FINISHED_CASE_STATES_FOR_REPLACE;

/** What approving one removal request changes. The queue preview and the receipt read the same counts. */
export interface RemovalImpact {
  /** Open cases that selected the document: each loses the selection and gets a task. */
  readonly openCaseIds: readonly string[];
  /** Finished cases that selected it: their snapshots stay as they are. */
  readonly finishedCases: number;
  /**
   * For each open case, the agencies that can see it: an active, started, unexpired grant to the
   * agency that reaches the case (a grant for that case, or an all-cases grant without an
   * exception for it), the same rule the agency's own case list uses.
   */
  readonly agenciesByCase: ReadonlyMap<string, readonly string[]>;
  /** Active, unexpired shares that name this document. */
  readonly sharesAffected: number;
  /** Stored bytes the removal frees once every file is verified gone. */
  readonly storageBytes: number;
}

/**
 * Not exported: every caller has checked access first (access/enforcement.test.ts).
 * The impact of removing `documentId` of `applicantId`, read through `db` (a transaction during
 * approval, so the counts match what is changed). Callers have already checked access.
 */
async function removalImpact(
  db: Db,
  applicantId: string,
  documentId: string,
  now: Date,
): Promise<RemovalImpact> {
  const cases = await db
    .selectDistinct({ missionId: schema.missions.id, state: schema.missions.state })
    .from(schema.selectedEvidence)
    .innerJoin(schema.missions, eq(schema.missions.id, schema.selectedEvidence.missionId))
    .where(
      and(
        eq(schema.selectedEvidence.documentId, documentId),
        eq(schema.missions.applicantId, applicantId),
      ),
    );
  const finished: ReadonlySet<string> = new Set(FINISHED_CASE_STATES_FOR_REMOVAL);
  const open = cases
    .filter((row) => !finished.has(row.state))
    .sort((a, b) => a.missionId.localeCompare(b.missionId));
  const openCaseIds = open.map((row) => row.missionId);

  const liveGrant = and(
    eq(schema.grants.applicantId, applicantId),
    eq(schema.grants.status, 'ACTIVE'),
    lte(schema.grants.startAt, now),
    or(isNull(schema.grants.expiryAt), gt(schema.grants.expiryAt, now)),
  );
  const agenciesByCase = new Map<string, readonly string[]>();
  if (openCaseIds.length > 0) {
    await withCaseExclusions(db, async (covers) => {
      for (const missionId of openCaseIds) {
        const rows = await db
          .selectDistinct({ organizationId: schema.grants.recipientOrganizationId })
          .from(schema.grants)
          .where(and(liveGrant, covers(missionId)));
        agenciesByCase.set(
          missionId,
          rows.flatMap((row) => (row.organizationId ? [row.organizationId] : [])).sort(),
        );
      }
    });
  }

  const [shares] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.grants)
    .where(
      and(
        eq(schema.grants.applicantId, applicantId),
        liveGrant,
        sql`${documentId}::uuid = any(${schema.grants.documentIds})`,
      ),
    );

  const [bytes] = await db
    .select({
      n: sql<number>`coalesce(sum(${schema.storageObjects.sizeBytes}), 0)::bigint`,
    })
    .from(schema.storageObjects)
    .where(
      inArray(
        schema.storageObjects.id,
        db
          .selectDistinct({ id: schema.documentVersions.storageObjectId })
          .from(schema.documentVersions)
          .where(eq(schema.documentVersions.documentId, documentId)),
      ),
    );

  return {
    openCaseIds,
    finishedCases: cases.length - open.length,
    agenciesByCase,
    sharesAffected: Number(shares?.n ?? 0),
    storageBytes: Number(bytes?.n ?? 0),
  };
}

/** The reasons a person can pick (migration 0113 CHECK). */
export const REMOVAL_REQUEST_REASONS = [
  'WRONG_PERSON',
  'UPLOADED_BY_MISTAKE',
  'NO_LONGER_NEEDED',
  'PRIVACY_CONCERN',
  'OTHER',
] as const;
export type RemovalRequestReason = (typeof REMOVAL_REQUEST_REASONS)[number];

/** Why support declines a request (migration 0113 CHECK, without APPROVED). */
export const REMOVAL_DECLINE_CODES = [
  'LEGAL_HOLD',
  'FINISHED_CASE_RECORD',
  'AGENCY_REQUEST_ANSWER',
  'RETENTION_REQUIRED',
  'OTHER',
] as const;
export type RemovalDeclineCode = (typeof REMOVAL_DECLINE_CODES)[number];

/** Refusal messages; the web layer maps these exact strings to its own words. */
export const REMOVAL_REQUEST_REFUSALS = {
  notOwner: 'only the record owner can ask for a document to be removed',
  unavailable: 'removal requests are not available yet',
  notLive: 'only a current or archived document can be removed by request',
  legalHold: 'a legal hold covers this document',
  alreadyPending: 'a removal request for this document is already waiting',
  notPending: 'this removal request is no longer waiting',
  reason: 'choose a reason from the list',
  declineCode: 'choose why the request is declined',
  notStaff: 'only a compliance administrator can decide removal requests',
  gone: 'the document is already gone; the request closes at the next daily check',
} as const;

const OWNER_ROLE = 'applicant_owner';

function ownerManageProblem(access: AuthorizedApplicant<'MANAGE'>): ServiceError | undefined {
  if (
    !(access instanceof AuthorizedApplicant) ||
    !lifecycleCommandCovers(access, access.applicant.id) ||
    access.actor.kind !== OWNER_ROLE
  ) {
    return serviceError('forbidden', REMOVAL_REQUEST_REFUSALS.notOwner);
  }
  return undefined;
}

/** The D- code of a document, assigned now if it has none yet. */
async function documentCode(tx: Db, documentId: string): Promise<string> {
  const code = await assignReferenceCode(tx, 'D', documentId);
  if (!code) throw new Error('removal request: reference codes are not available');
  return formatReferenceCode('D', code);
}

export interface RequestRemovalOutcome {
  readonly id: string;
  readonly documentCode: string;
}

/**
 * Ask Us to Remove This File. `access` is the record owner's MANAGE proof for the applicant the
 * document belongs to. One pending request per document; refused under a legal hold, for a
 * document that is not current or archived, and while migration 0113 has not run. The caller
 * (the web action) also checks that the `DOCUMENT_REMOVAL_REQUESTS` switch is on.
 */
export async function requestRemoval(
  access: AuthorizedApplicant<'MANAGE'>,
  input: { readonly documentId: string; readonly reason: RemovalRequestReason },
): Promise<Result<RequestRemovalOutcome, ServiceError>> {
  const problem = ownerManageProblem(access);
  if (problem) return err(problem);
  if (!(REMOVAL_REQUEST_REASONS as readonly string[]).includes(input.reason)) {
    return err(serviceError('invalid', REMOVAL_REQUEST_REFUSALS.reason));
  }
  if (!isUuid(input.documentId)) return err(serviceError('not_found', 'document not found'));
  const applicantId = access.applicant.id;
  const documentId = input.documentId.toLowerCase();
  if (!(await lifecycleTablesPresent(access.tx))) {
    return err(serviceError('invalid', REMOVAL_REQUEST_REFUSALS.unavailable));
  }
  const actorAccountId = access.applicant.ownerAccountId;

  return access.tx.transaction(async (tx) => {
    const document = first(
      await tx
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.id, documentId),
            eq(schema.documents.applicantId, applicantId),
            presentDocumentCondition(),
          ),
        )
        .for('update'),
    );
    if (!document) return err(serviceError('not_found', 'document not found'));
    const lifecycle = await getDocumentLifecycle(tx, documentId, access);
    if (!lifecycle || (lifecycle.state !== 'CURRENT' && lifecycle.state !== 'ARCHIVED')) {
      return err(serviceError('invalid', REMOVAL_REQUEST_REFUSALS.notLive));
    }
    const legalHold = await documentBlockedByLegalHold(tx, { applicantId, documentId });
    if (legalHold) return err(serviceError('invalid', REMOVAL_REQUEST_REFUSALS.legalHold));
    // The one place visibility is decided (PROGRAMME 3.2). Whether this is a deletable duplicate
    // is lane C's fact; until it is known the request stays allowed, as the menu shows it.
    const allowed = availableDocumentActions({
      state: lifecycle.state,
      replaced: lifecycle.replaced,
      isDuplicate: false,
      duplicateBlockReason: null,
      pendingRequest: false,
      legalHold,
      requestsSwitchOn: true,
    });
    if (!allowed.includes('REQUEST_REMOVAL')) {
      return err(serviceError('invalid', REMOVAL_REQUEST_REFUSALS.notLive));
    }
    const requests = schema.documentRemovalRequests;
    const waiting = first(
      await tx
        .select({ id: requests.id })
        .from(requests)
        .where(and(eq(requests.documentId, documentId), eq(requests.status, 'PENDING')))
        .limit(1),
    );
    if (waiting) return err(serviceError('stale', REMOVAL_REQUEST_REFUSALS.alreadyPending));

    const code = await documentCode(tx, documentId);
    const inserted = await tx
      .insert(requests)
      .values({
        applicantId,
        documentId,
        documentCode: code,
        reason: input.reason,
        status: 'PENDING',
        requestedByAccountId: actorAccountId,
        requestedAt: new Date(),
      })
      .returning({ id: requests.id });
    const id = first(inserted)?.id;
    if (!id) throw new Error('removal request: not written');

    await appendAuditEvent(tx, {
      eventType: 'DOCUMENT_REMOVAL_REQUESTED',
      actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId,
      resourceType: 'document',
      resourceId: documentId,
      metadata: { requestId: id, documentCode: code, reason: input.reason },
    });
    await recordProductEvent(tx, { eventType: 'REMOVAL_REQUESTED', accountId: actorAccountId });
    return ok({ id, documentCode: code });
  });
}

/**
 * Cancel Request: the record owner withdraws a request support has not decided yet. Refused
 * once support has decided (the request is no longer waiting).
 */
export async function cancelRemovalRequest(
  access: AuthorizedApplicant<'MANAGE'>,
  requestId: string,
): Promise<Result<{ readonly documentId: string | null }, ServiceError>> {
  const problem = ownerManageProblem(access);
  if (problem) return err(problem);
  if (!isUuid(requestId)) return err(serviceError('not_found', 'removal request not found'));
  if (!(await lifecycleTablesPresent(access.tx))) {
    return err(serviceError('not_found', 'removal request not found'));
  }
  const applicantId = access.applicant.id;
  const actorAccountId = access.applicant.ownerAccountId;
  const requests = schema.documentRemovalRequests;
  return access.tx.transaction(async (tx) => {
    const request = first(
      await tx
        .select({ id: requests.id, status: requests.status, documentId: requests.documentId })
        .from(requests)
        .where(and(eq(requests.id, requestId.toLowerCase()), eq(requests.applicantId, applicantId)))
        .for('update'),
    );
    if (!request) return err(serviceError('not_found', 'removal request not found'));
    if (request.status !== 'PENDING') {
      return err(serviceError('stale', REMOVAL_REQUEST_REFUSALS.notPending));
    }
    await tx.update(requests).set({ status: 'CANCELLED' }).where(eq(requests.id, request.id));
    await appendAuditEvent(tx, {
      eventType: 'DOCUMENT_REMOVAL_REQUEST_CANCELLED',
      actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId,
      resourceType: 'document',
      resourceId: request.documentId,
      metadata: { requestId: request.id },
    });
    return ok({ documentId: request.documentId });
  });
}

/**
 * The waiting request of each of `documentIds` (document id to request id), for the Documents
 * page's Removal Requested state. Owner only (any of the owner's own proofs); an empty map for
 * anyone else and while migration 0113 has not run.
 */
export async function pendingRemovalRequests(
  access: AuthorizedApplicant<'VIEW_METADATA' | 'MANAGE'>,
  documentIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  if (
    !(access instanceof AuthorizedApplicant) ||
    !AuthorizedApplicant.isGenuine(access, access.action) ||
    access.actor.kind !== OWNER_ROLE
  ) {
    return new Map();
  }
  const ids = [...new Set(documentIds.filter(isUuid).map((id) => id.toLowerCase()))];
  if (ids.length === 0 || !(await lifecycleTablesPresent(access.tx))) return new Map();
  const requests = schema.documentRemovalRequests;
  const rows = await access.tx
    .select({ id: requests.id, documentId: requests.documentId })
    .from(requests)
    .where(
      and(
        eq(requests.applicantId, access.applicant.id),
        eq(requests.status, 'PENDING'),
        inArray(requests.documentId, ids),
      ),
    );
  return new Map(
    rows.flatMap((row) => (row.documentId ? [[row.documentId, row.id] as const] : [])),
  );
}

/** One waiting request as support sees it: codes, counts and dates only, never a name or title. */
export interface RemovalQueueRow {
  readonly id: string;
  readonly documentCode: string;
  readonly reason: RemovalRequestReason;
  readonly requestedAt: Date;
  /** Whole working days the request has waited. */
  readonly waitingWorkingDays: number;
  readonly legalHold: boolean;
  /** The document already left VisaStack; the request closes at the next daily check. */
  readonly documentGone: boolean;
  readonly openCases: number;
  readonly finishedCases: number;
  readonly agencies: number;
  readonly sharesAffected: number;
  readonly storageBytes: number;
}

export interface RemovalQueuePage {
  readonly rows: readonly RemovalQueueRow[];
  readonly hasMore: boolean;
}

/** Staff lists show 25 rows, then Show More (Scroll Budget targets). */
export const REMOVAL_QUEUE_PAGE = 25;
const REMOVAL_QUEUE_MAX = 200;

/**
 * The waiting removal requests, oldest first, each with an impact preview built from the same
 * counts the Removal Record records. Read by a platform administrator with privacy access (the
 * compliance directory view), who names the database. An empty page while migration 0113 has
 * not run.
 */
export async function listRemovalQueue(
  staff: StaffScope<'APPLICANT_DIRECTORY_VIEW'>,
  options: { readonly db: Db; readonly limit?: number; readonly now?: Date },
): Promise<Result<RemovalQueuePage, ServiceError>> {
  const problem = staffScopeProblem(staff, 'APPLICANT_DIRECTORY_VIEW');
  if (problem) return err(problem);
  const db = options.db;
  if (!(await lifecycleTablesPresent(db))) return ok({ rows: [], hasMore: false });
  const limit = Math.min(
    Math.max(Math.trunc(options.limit ?? REMOVAL_QUEUE_PAGE), 1),
    REMOVAL_QUEUE_MAX,
  );
  const now = options.now ?? new Date();
  const requests = schema.documentRemovalRequests;
  const rows = await db
    .select({
      id: requests.id,
      applicantId: requests.applicantId,
      documentId: requests.documentId,
      documentCode: requests.documentCode,
      reason: requests.reason,
      requestedAt: requests.requestedAt,
    })
    .from(requests)
    .where(eq(requests.status, 'PENDING'))
    .orderBy(asc(requests.requestedAt), asc(requests.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  // Rows are read side by side; each is a handful of small indexed queries.
  const result = await Promise.all(
    page.map(async (row): Promise<RemovalQueueRow> => {
      const [impact, legalHold] = row.documentId
        ? await Promise.all([
            removalImpact(db, row.applicantId, row.documentId, now),
            documentBlockedByLegalHold(db, {
              applicantId: row.applicantId,
              documentId: row.documentId,
            }),
          ])
        : [null, false];
      const agencies = new Set<string>();
      for (const list of impact?.agenciesByCase.values() ?? []) {
        for (const organizationId of list) agencies.add(organizationId);
      }
      return {
        id: row.id,
        documentCode: row.documentCode,
        reason: row.reason,
        requestedAt: row.requestedAt,
        waitingWorkingDays: workingDaysBetween(row.requestedAt, now),
        legalHold,
        documentGone: row.documentId === null,
        openCases: impact?.openCaseIds.length ?? 0,
        finishedCases: impact?.finishedCases ?? 0,
        agencies: agencies.size,
        sharesAffected: impact?.sharesAffected ?? 0,
        storageBytes: impact?.storageBytes ?? 0,
      };
    }),
  );
  return ok({ rows: result, hasMore: rows.length > limit });
}

export type RemovalDecisionInput =
  | {
      readonly id: string;
      readonly decision: 'APPROVE';
      readonly stepUpSatisfied: boolean;
    }
  | {
      readonly id: string;
      readonly decision: 'DECLINE';
      readonly decisionCode: RemovalDeclineCode;
      readonly stepUpSatisfied: boolean;
    };

export type RemovalDecisionOutcome =
  | {
      readonly decision: 'APPROVED';
      /** QUEUED: files are being removed securely; REMOVED: the document had no stored file. */
      readonly removal: 'QUEUED' | 'REMOVED';
      readonly openCasesUpdated: number;
      readonly agenciesTold: number;
    }
  | { readonly decision: 'DECLINED'; readonly decisionCode: RemovalDeclineCode };

/** The person's words for each decline code, in the notice they receive. */
export const DECLINE_REASON_WORDS: Readonly<Record<RemovalDeclineCode, string>> = {
  LEGAL_HOLD: 'We have to keep it because of a legal requirement.',
  FINISHED_CASE_RECORD: 'It is part of a finished case record that we must keep.',
  AGENCY_REQUEST_ANSWER: "It answered an agency's request and is part of that record.",
  RETENTION_REQUIRED: 'We are required to keep it for now.',
  OTHER: 'Contact support if you would like to know more.',
};

const OPEN_CASE_TASK =
  'A document was removed by request. Choose another document for this case, then confirm the case again.';

/**
 * Approve or decline one waiting request. `staff` is a fresh compliance-administrator scope
 * (`RETENTION_PURGE`, the authority that decides what is destroyed); both decisions need a fresh
 * sign-in check (`stepUpSatisfied`, honestly derived from a genuine reauthentication, see
 * apps/web/src/lib/step-up.ts). Declining needs a decision code. Approving under a legal hold is
 * refused and the request stays waiting, so support can decline it with `LEGAL_HOLD`.
 */
export async function decideRemovalRequest(
  staff: StaffScope<'RETENTION_PURGE'>,
  input: RemovalDecisionInput,
  options: { readonly db: Db; readonly now?: Date },
): Promise<Result<RemovalDecisionOutcome, ServiceError>> {
  if (staffScopeProblem(staff, 'RETENTION_PURGE')) {
    return err(serviceError('forbidden', REMOVAL_REQUEST_REFUSALS.notStaff));
  }
  if (!isUuid(input.id)) return err(serviceError('not_found', 'removal request not found'));
  if (
    input.decision === 'DECLINE' &&
    !(REMOVAL_DECLINE_CODES as readonly string[]).includes(input.decisionCode)
  ) {
    return err(serviceError('invalid', REMOVAL_REQUEST_REFUSALS.declineCode));
  }
  if (input.decision !== 'APPROVE' && input.decision !== 'DECLINE') {
    return err(serviceError('invalid', 'choose approve or decline'));
  }
  if (input.stepUpSatisfied !== true) {
    return err(
      serviceError('step_up_required', 'deciding a removal request needs a fresh sign-in'),
    );
  }
  const db = options.db;
  if (!(await lifecycleTablesPresent(db))) {
    return err(serviceError('not_found', 'removal request not found'));
  }
  const now = options.now ?? new Date();
  const requests = schema.documentRemovalRequests;
  const staffAccountId = staff.accountId;

  return db.transaction(async (tx): Promise<Result<RemovalDecisionOutcome, ServiceError>> => {
    const request = first(
      await tx.select().from(requests).where(eq(requests.id, input.id.toLowerCase())).for('update'),
    );
    if (!request) return err(serviceError('not_found', 'removal request not found'));
    if (request.status !== 'PENDING') {
      return err(serviceError('stale', REMOVAL_REQUEST_REFUSALS.notPending));
    }
    const applicantId = request.applicantId;
    // The applicant row first, then the document row: the order the retention purge, the
    // erasure worker and enqueueDocumentRemoval take, so a hold being placed is seen.
    const applicant = first(
      await tx
        .select({ ownerAccountId: schema.applicants.ownerAccountId })
        .from(schema.applicants)
        .where(eq(schema.applicants.id, applicantId))
        .for('update'),
    );
    if (!applicant) return err(serviceError('not_found', 'removal request not found'));
    const ownerAccountId = applicant.ownerAccountId;
    const notifyAccountId = request.requestedByAccountId ?? ownerAccountId;

    const audit = (metadata: Record<string, unknown>) =>
      appendAuditEvent(tx, {
        eventType: 'DOCUMENT_REMOVAL_DECIDED',
        actorAccountId: staffAccountId,
        method: 'MANUAL',
        result: 'ALLOWED',
        applicantId,
        resourceType: 'document',
        resourceId: request.documentId,
        metadata: { requestId: request.id, documentCode: request.documentCode, ...metadata },
      });

    if (input.decision === 'DECLINE') {
      await tx
        .update(requests)
        .set({
          status: 'DECLINED',
          decidedByAccountId: staffAccountId,
          decidedAt: now,
          decisionCode: input.decisionCode,
        })
        .where(eq(requests.id, request.id));
      if (notifyAccountId) {
        await enqueueNotificationBothChannels(tx, {
          eventType: 'DOCUMENT_REMOVAL_DECIDED',
          recipientAccountId: notifyAccountId,
          resourceId: request.id,
          applicantId,
          payload: {
            subject: 'Your removal request was not approved',
            summary: `We could not remove document ${request.documentCode}. ${DECLINE_REASON_WORDS[input.decisionCode]}${request.documentId ? ' It stays in your documents.' : ''}`,
            deepLinkPath: `/app/applicant/${applicantId}/documents`,
          },
        });
      }
      await audit({ decision: 'DECLINED', decisionCode: input.decisionCode });
      await recordProductEvent(tx, { eventType: 'REMOVAL_DECIDED', accountId: staffAccountId });
      return ok({ decision: 'DECLINED', decisionCode: input.decisionCode });
    }

    // Approve.
    if (!request.documentId) return err(serviceError('stale', REMOVAL_REQUEST_REFUSALS.gone));
    const documentId = request.documentId;
    const document = first(
      await tx
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
        )
        .for('update'),
    );
    if (!document) return err(serviceError('stale', REMOVAL_REQUEST_REFUSALS.notLive));
    const lifecycle = await getDocumentLifecycle(tx, documentId, staff, { now });
    if (!lifecycle || (lifecycle.state !== 'CURRENT' && lifecycle.state !== 'ARCHIVED')) {
      return err(serviceError('stale', REMOVAL_REQUEST_REFUSALS.notLive));
    }
    if (await documentBlockedByLegalHold(tx, { applicantId, documentId })) {
      return err(serviceError('invalid', REMOVAL_REQUEST_REFUSALS.legalHold));
    }

    const impact = await removalImpact(tx, applicantId, documentId, now);
    await assignReferenceCodes(tx, 'C', impact.openCaseIds);
    const caseCodes = await referenceCodesFor(tx, 'C', impact.openCaseIds);

    // Open cases lose the selection, get a task and a material revision bump (their confirmation
    // no longer stands). Finished cases are not touched: their snapshots stay exact.
    for (const missionId of impact.openCaseIds) {
      await tx
        .delete(schema.selectedEvidence)
        .where(
          and(
            eq(schema.selectedEvidence.missionId, missionId),
            eq(schema.selectedEvidence.documentId, documentId),
          ),
        );
      await incrementMaterialRevision(tx, missionId);
      // createTask is the one writer of case tasks (ai-tools/tool-guard.test.ts). It records the
      // record owner as the task's author; the staff member who caused it is named on the
      // DOCUMENT_REMOVAL_DECIDED event below, with the cases it touched.
      const task = await createTask(tx, {
        actorAccountId: ownerAccountId,
        missionId,
        description: OPEN_CASE_TASK,
      });
      if (!task.ok) throw new Error(`removal request: case task refused (${task.error.code})`);
    }

    const casesFlagged = impact.openCaseIds.flatMap((id) => {
      const code = caseCodes.get(id);
      return code ? [code] : [];
    });
    const kind = document.docType?.toLowerCase() ?? null;
    const receipt = await openDeletionReceipt(
      tx,
      {
        applicantId,
        subjectKind: 'DOCUMENT',
        subjectCode: request.documentCode,
        documentKind: kind && /^[a-z][a-z0-9_.-]{0,79}$/.test(kind) ? kind : null,
        uploadedAt: document.createdAt,
        uploadedByRole: uploaderRole(document, ownerAccountId),
        path: 'REQUEST',
        requestedByAccountId: request.requestedByAccountId,
        approvedByAccountId: staffAccountId,
        requestedAt: request.requestedAt,
        scheduledFor: now,
        status: 'SCHEDULED',
        effects: {
          ...(casesFlagged.length > 0 ? { casesFlagged } : {}),
          sharesAffected: impact.sharesAffected,
        },
      },
      staff,
    );
    if (!receipt.ok) throw new Error(`removal request: receipt refused (${receipt.error.code})`);

    await tx
      .insert(schema.documentLifecycle)
      .values({
        documentId,
        applicantId,
        deletedAt: now,
        deletedByAccountId: staffAccountId,
        deletePath: 'REQUEST',
        purgeAfter: now,
        receiptId: receipt.value.id,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.documentLifecycle.documentId,
        set: {
          deletedAt: now,
          deletedByAccountId: staffAccountId,
          deletePath: 'REQUEST',
          purgeAfter: now,
          receiptId: receipt.value.id,
          updatedAt: now,
        },
      });

    await tx
      .update(requests)
      .set({
        status: 'APPROVED',
        decidedByAccountId: staffAccountId,
        decidedAt: now,
        decisionCode: 'APPROVED',
        receiptId: receipt.value.id,
      })
      .where(eq(requests.id, request.id));

    const removal = await enqueueDocumentRemoval(
      tx,
      { documentId, applicantId, receiptId: receipt.value.id },
      staff,
      { now },
    );
    if (!removal.ok) throw new Error(`removal request: removal refused (${removal.error.code})`);
    // The hold was checked under the same locks, so BLOCKED here means something changed in
    // between: roll everything back rather than record an approval that removes nothing.
    if (removal.value.outcome === 'BLOCKED') {
      throw new Error('removal request: a legal hold appeared during approval');
    }
    if (removal.value.outcome === 'REMOVED') {
      await tx
        .update(requests)
        .set({ status: 'COMPLETED', completedAt: now })
        .where(eq(requests.id, request.id));
    }

    // Agencies that can see an open case that used the document are told, never with its name,
    // and only the members who see that case: owners and admins, and members assigned to it
    // (the same rule as the agency's case list, listVisibleMissionsForMember).
    const told = new Set<string>();
    const organizationIds = [...new Set([...impact.agenciesByCase.values()].flat())];
    if (organizationIds.length > 0) {
      const members = await tx
        .select({
          accountId: schema.memberships.accountId,
          organizationId: schema.memberships.organizationId,
          role: schema.memberships.role,
        })
        .from(schema.memberships)
        .innerJoin(
          schema.organizations,
          eq(schema.organizations.id, schema.memberships.organizationId),
        )
        .where(
          and(
            inArray(schema.memberships.organizationId, organizationIds),
            eq(schema.memberships.active, true),
            eq(schema.organizations.status, 'ACTIVE'),
          ),
        );
      const assigned = await tx
        .select({
          missionId: schema.assignments.missionId,
          organizationId: schema.assignments.organizationId,
          accountId: schema.assignments.memberAccountId,
        })
        .from(schema.assignments)
        .where(
          and(
            inArray(schema.assignments.organizationId, organizationIds),
            inArray(schema.assignments.missionId, impact.openCaseIds),
          ),
        );
      for (const [missionId, organizations] of impact.agenciesByCase) {
        const code = caseCodes.get(missionId);
        for (const member of members) {
          if (!organizations.includes(member.organizationId)) continue;
          if (member.accountId === ownerAccountId) continue;
          const seesCase =
            member.role === 'OWNER' ||
            member.role === 'ADMIN' ||
            assigned.some(
              (row) =>
                row.missionId === missionId &&
                row.organizationId === member.organizationId &&
                row.accountId === member.accountId,
            );
          if (!seesCase) continue;
          told.add(member.organizationId);
          await enqueueNotification(tx, {
            eventType: 'DOCUMENT_REMOVED_BY_TRAVELLER',
            channel: 'IN_APP',
            recipientAccountId: member.accountId,
            resourceId: request.id,
            threshold: missionId,
            organizationId: member.organizationId,
            missionId,
            payload: {
              subject: 'A document was removed by the traveller',
              summary: `A document in case ${code ?? 'you work on'} was removed by the traveller. Ask them for another one if the case still needs it.`,
              deepLinkPath: `/app/agency/${member.organizationId}/cases`,
            },
          });
        }
      }
    }

    if (notifyAccountId) {
      const removed = removal.value.outcome === 'REMOVED';
      await enqueueNotificationBothChannels(tx, {
        eventType: 'DOCUMENT_REMOVAL_DECIDED',
        recipientAccountId: notifyAccountId,
        resourceId: request.id,
        applicantId,
        payload: {
          subject: 'Your removal request was approved',
          summary: removed
            ? `Document ${request.documentCode} was removed from VisaStack. Backup copies expire within 90 days and are never brought back.`
            : `Document ${request.documentCode} is being removed securely. We will tell you when it is gone.`,
          deepLinkPath: `/app/applicant/${applicantId}/documents`,
        },
      });
    }

    await audit({
      decision: 'APPROVED',
      receiptId: receipt.value.id,
      openCases: impact.openCaseIds.length,
      caseTasksFor: impact.openCaseIds,
      finishedCases: impact.finishedCases,
      agenciesTold: told.size,
    });
    await recordProductEvent(tx, { eventType: 'REMOVAL_DECIDED', accountId: staffAccountId });
    return ok({
      decision: 'APPROVED',
      removal: removal.value.outcome,
      openCasesUpdated: impact.openCaseIds.length,
      agenciesTold: told.size,
    });
  });
}

function uploaderRole(
  document: { readonly uploaderAccountId: string | null; readonly source: string | null },
  ownerAccountId: string | null,
): 'OWNER' | 'AGENCY_MEMBER' | 'CONTRIBUTOR' | 'SYSTEM' | null {
  if (document.source === 'CONTRIBUTOR') return 'CONTRIBUTOR';
  if (!document.uploaderAccountId) return null;
  if (document.uploaderAccountId === ownerAccountId) return 'OWNER';
  return 'AGENCY_MEMBER';
}

export interface RemovalSweepResult {
  /** Requests closed: the file was verified gone, or the document had already left. */
  readonly completed: number;
  /** Approved requests whose file a legal hold now keeps; the person was told. */
  readonly kept: number;
  /** Requests staff were alerted about. */
  readonly alerted: number;
}

const SWEEP_ALERT_EVENT = 'DOCUMENT_REMOVAL_REQUEST_WAITING';

/**
 * The daily pass over removal requests, run by the notification sweep:
 * - an approved request whose Removal Record reads Removed (the erasure worker verified every
 *   file gone) is marked Completed and the person is told;
 * - an approved request whose Removal Record reads Kept (a legal hold placed after approval
 *   stopped the removal) stays as it is and the person is told once;
 * - a waiting request whose document has already left VisaStack (for example through the
 *   retention purge) is closed as Completed and the person is told;
 * - with `alerts`, every compliance administrator and platform owner is told about each request
 *   waiting more than `alertAfterWorkingDays` working days, once per request (requests already
 *   alerted are skipped in the query, so a long queue never hides a newer overdue one).
 */
export async function sweepRemovalRequests(
  system: SystemScope<'process-notification-sweeps'>,
  db: Db,
  options: {
    readonly now?: Date;
    readonly alerts: boolean;
    readonly alertAfterWorkingDays?: number;
    readonly limit?: number;
  },
): Promise<Result<RemovalSweepResult, ServiceError>> {
  if (!SystemScope.isGenuine(system) || system.job !== 'process-notification-sweeps') {
    return err(serviceError('forbidden', 'only the notification sweep runs this'));
  }
  if (!(await lifecycleTablesPresent(db))) return ok({ completed: 0, kept: 0, alerted: 0 });
  const now = options.now ?? new Date();
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 200), 1), 500);
  const alertAfter = options.alertAfterWorkingDays ?? REMOVAL_ALERT_WORKING_DAYS;
  const requests = schema.documentRemovalRequests;
  const receipts = schema.deletionReceipts;
  const documentsPage = (applicantId: string) => `/app/applicant/${applicantId}/documents`;

  const recipientOf = async (
    tx: Db,
    row: { readonly requestedByAccountId: string | null; readonly applicantId: string },
  ): Promise<string | null> =>
    row.requestedByAccountId ??
    first(
      await tx
        .select({ ownerAccountId: schema.applicants.ownerAccountId })
        .from(schema.applicants)
        .where(eq(schema.applicants.id, row.applicantId)),
    )?.ownerAccountId ??
    null;

  const columns = {
    id: requests.id,
    applicantId: requests.applicantId,
    documentCode: requests.documentCode,
    requestedByAccountId: requests.requestedByAccountId,
  };

  /** Close one request as Completed (if still in `from`) and tell the person. */
  const complete = async (
    row: {
      id: string;
      applicantId: string;
      documentCode: string;
      requestedByAccountId: string | null;
    },
    from: 'APPROVED' | 'PENDING',
    summary: string,
  ): Promise<boolean> =>
    db.transaction(async (tx) => {
      const updated = await tx
        .update(requests)
        .set({ status: 'COMPLETED', completedAt: now })
        .where(and(eq(requests.id, row.id), eq(requests.status, from)))
        .returning({ id: requests.id });
      if (updated.length === 0) return false;
      const recipient = await recipientOf(tx, row);
      if (recipient) {
        await enqueueNotificationBothChannels(tx, {
          eventType: 'DOCUMENT_REMOVAL_COMPLETED',
          recipientAccountId: recipient,
          resourceId: row.id,
          applicantId: row.applicantId,
          payload: {
            subject: 'Your document was removed',
            summary,
            deepLinkPath: documentsPage(row.applicantId),
          },
        });
      }
      return true;
    });

  let completed = 0;
  const removed = await db
    .select(columns)
    .from(requests)
    .innerJoin(receipts, eq(receipts.id, requests.receiptId))
    .where(and(eq(requests.status, 'APPROVED'), eq(receipts.status, 'REMOVED')))
    .limit(limit);
  for (const row of removed) {
    const summary = `Document ${row.documentCode} was removed from VisaStack. Backup copies expire within 90 days and are never brought back.`;
    if (await complete(row, 'APPROVED', summary)) completed += 1;
  }
  const gone = await db
    .select(columns)
    .from(requests)
    .where(and(eq(requests.status, 'PENDING'), isNull(requests.documentId)))
    .limit(limit);
  for (const row of gone) {
    const summary = `Document ${row.documentCode} is no longer in VisaStack, so your removal request is closed.`;
    if (await complete(row, 'PENDING', summary)) completed += 1;
  }

  let kept = 0;
  const blocked = await db
    .select(columns)
    .from(requests)
    .innerJoin(receipts, eq(receipts.id, requests.receiptId))
    .where(and(eq(requests.status, 'APPROVED'), eq(receipts.status, 'BLOCKED')))
    .limit(limit);
  for (const row of blocked) {
    const recipient = await recipientOf(db, row);
    if (!recipient) continue;
    const queued = await enqueueNotificationBothChannels(db, {
      eventType: 'DOCUMENT_REMOVAL_KEPT',
      recipientAccountId: recipient,
      resourceId: row.id,
      applicantId: row.applicantId,
      payload: {
        subject: 'Your document is being kept for now',
        summary: `We could not remove document ${row.documentCode} yet because of a legal requirement. It is kept safely and removed once that ends.`,
        deepLinkPath: documentsPage(row.applicantId),
      },
    });
    if (queued > 0) kept += 1;
  }

  let alerted = 0;
  if (options.alerts) {
    const notices = schema.notifications;
    const waiting = await db
      .select({
        id: requests.id,
        documentCode: requests.documentCode,
        requestedAt: requests.requestedAt,
      })
      .from(requests)
      .where(
        and(
          eq(requests.status, 'PENDING'),
          lt(requests.requestedAt, now),
          sql`not exists (select 1 from ${notices} where ${notices.eventType} = ${SWEEP_ALERT_EVENT} and ${notices.resourceId} = ${requests.id}::text)`,
        ),
      )
      .orderBy(asc(requests.requestedAt), asc(requests.id))
      .limit(limit);
    const overdue = waiting.filter((row) => workingDaysBetween(row.requestedAt, now) > alertAfter);
    if (overdue.length > 0) {
      const staffIds = [
        ...new Set(
          (await listActivePlatformRoles(db)).flatMap((grant) =>
            grant.accountId &&
            (grant.role === 'COMPLIANCE_ADMIN' || grant.role === 'PLATFORM_OWNER')
              ? [grant.accountId]
              : [],
          ),
        ),
      ];
      for (const row of overdue) {
        let any = false;
        for (const accountId of staffIds) {
          const queued = await enqueueNotification(db, {
            eventType: SWEEP_ALERT_EVENT,
            channel: 'IN_APP',
            recipientAccountId: accountId,
            resourceId: row.id,
            threshold: `${alertAfter}-working-days`,
            payload: {
              subject: 'A removal request is waiting',
              summary: `The request to remove document ${row.documentCode} has waited more than ${alertAfter} working days. Decide it in Removal Requests.`,
              deepLinkPath: '/app/admin/removals',
            },
          });
          any = any || queued;
        }
        if (any) alerted += 1;
      }
    }
  }
  return ok({ completed, kept, alerted });
}
