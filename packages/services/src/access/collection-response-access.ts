import { type SQL, and, desc, eq, gt, sql } from 'drizzle-orm';
import { appendAuditEvent } from '../audit';
import { type Db, first, schema } from '../db';
import { type ServiceError, serviceError } from '../errors';
import { isUuid } from '../lifecycle/foundation/ids';
import { getOrganization, isOrgAdmin } from '../organizations';
import { agencyCollectionRequestsEnabled } from '../umpe-collection-request-switch';
import { type ResponseLine, responseContentSha256 } from '../umpe-collection-response-evidence';
import { type AgencyCollectionScope, agencyCollectionScopeProblem } from './collection-scope';

/**
 * The proof that opens one traveller's submitted answer to an agency document request (UMPE P7).
 *
 * A response is the only way an agency reaches a traveller's record through a document request.
 * There is no grant: the response itself lists the exact document versions and fact versions the
 * traveller approved, and every read and every file link is checked against that list. So the
 * agency can never see another document of the same person, nor a later version of a document it
 * was given.
 *
 * A `CollectionResponseAccess` is made only here, from a fresh `AgencyCollectionScope` (an active
 * OWNER or ADMIN of an open agency, with the switch on), for a response that belongs to that agency
 * and has not been withdrawn. It is a class with a private constructor and a `#private` brand, like
 * the other gates: an object literal or a copy is not one. It is good for five minutes, minted for
 * one page or action, never kept. The access ratchet (`enforcement.test.ts`) counts it as a gate
 * for the applicant-owned tables, because it names exactly one person and exactly one response.
 */

let minting = false;
let mint: (fields: AccessFields) => CollectionResponseAccess;

interface AccessFields {
  readonly accountId: string;
  readonly organizationId: string;
  readonly requestId: string;
  readonly responseId: string;
  readonly applicantId: string;
}

/** Not found, whatever the reason: a refused lookup must look exactly like a missing one. */
function missing(): ServiceError {
  return serviceError('not_found', 'no such response');
}

/**
 * Only an agency VisaStack has reviewed (ACTIVE) receives or reads a traveller's answer, the rule
 * every grant follows (`organization_not_active`). An agency still awaiting review may send a
 * request, but nothing of anyone's record reaches it until it is reviewed.
 */
export async function agencyMayReceiveAnswers(db: Db, organizationId: string): Promise<boolean> {
  if (!isUuid(organizationId)) return false;
  const organization = await getOrganization(db, organizationId);
  return organization?.status === 'ACTIVE';
}

export class CollectionResponseAccess {
  readonly #brand = 'CollectionResponseAccess';
  readonly kind = 'collection_response' as const;
  readonly accountId: string;
  readonly organizationId: string;
  readonly requestId: string;
  readonly responseId: string;
  readonly applicantId: string;
  readonly #verifiedAtMs: number;

  private constructor(fields: AccessFields) {
    if (!minting) {
      throw new Error('a CollectionResponseAccess can only be made by collectionResponseAccess()');
    }
    this.accountId = fields.accountId;
    this.organizationId = fields.organizationId;
    this.requestId = fields.requestId;
    this.responseId = fields.responseId;
    this.applicantId = fields.applicantId;
    this.#verifiedAtMs = Date.now();
    Object.freeze(this);
  }

  /** When the live check ran (a copy: changing it changes nothing). */
  get verifiedAt(): Date {
    return new Date(this.#verifiedAtMs);
  }

  /** Run-time check that `value` is a genuine proof, not a copy. */
  static isGenuine(value: unknown): value is CollectionResponseAccess {
    return typeof value === 'object' && value !== null && #brand in value;
  }

  static {
    mint = (fields: AccessFields): CollectionResponseAccess => {
      minting = true;
      try {
        return new CollectionResponseAccess(fields);
      } finally {
        minting = false;
      }
    };
  }
}

/**
 * Whether the response tables exist yet. Code goes live before its migration runs, so a missing
 * table means "no responses", which is exact because none can have been written. `to_regclass`
 * never raises, so an outer transaction is never disturbed. Nothing is cached.
 */
export async function collectionResponsesPresent(db: Db): Promise<boolean> {
  const row = first(
    await db
      .select({
        present: sql<boolean>`to_regclass('agency_collection_responses') is not null and to_regclass('agency_collection_response_items') is not null and to_regclass('agency_collection_response_withdrawals') is not null`,
      })
      .from(sql`(select 1) as probe`),
  );
  return row?.present === true;
}

/**
 * A response the agency may still reach: it has no withdrawal (by the person, or replaced by their
 * newer answer) and its request was not revoked. Built at call time, never at module load.
 */
export function liveCollectionResponse(): SQL {
  const responses = schema.agencyCollectionResponses;
  return sql`(not exists (select 1 from agency_collection_response_withdrawals w where w.response_id = ${responses.id}) and exists (select 1 from agency_collection_requests r where r.id = ${responses.requestId} and r.status <> 'REVOKED'))`;
}

/**
 * Whether a response is still live for its agency, for the notification worker's send-time check
 * of a "Submitted to Agency" notice: it exists for that agency, is not withdrawn or replaced, its
 * request is not revoked and the agency is still reviewed. Reads nothing of the person.
 */
export async function collectionResponseStillLive(
  db: Db,
  responseId: string,
  organizationId: string,
): Promise<boolean> {
  if (!isUuid(responseId) || !isUuid(organizationId)) return false;
  if (!(await collectionResponsesPresent(db))) return false;
  if (!(await agencyMayReceiveAnswers(db, organizationId))) return false;
  const responses = schema.agencyCollectionResponses;
  const row = first(
    await db
      .select({ id: responses.id })
      .from(responses)
      .where(
        and(
          eq(responses.id, responseId),
          eq(responses.organizationId, organizationId),
          liveCollectionResponse(),
        ),
      )
      .limit(1),
  );
  return row !== undefined;
}

/** The newest responses one request may list at once. */
export const COLLECTION_RESPONSE_LIST_LIMIT = 100;

/**
 * One access per live response to this agency's request (not withdrawn, request not revoked),
 * newest first, or none at all when the scope is not genuine and fresh, the switch is off, the
 * agency is not reviewed or the request is not this agency's. A withdrawn answer is never opened
 * again.
 */
export async function collectionResponseAccesses(
  db: Db,
  scope: AgencyCollectionScope,
  requestId: string,
): Promise<CollectionResponseAccess[]> {
  if (agencyCollectionScopeProblem(scope)) return [];
  if (!isUuid(requestId) || !(await collectionResponsesPresent(db))) return [];
  if (!(await agencyMayReceiveAnswers(db, scope.organizationId))) return [];
  const responses = schema.agencyCollectionResponses;
  const rows = await db
    .select({
      id: responses.id,
      requestId: responses.requestId,
      applicantId: responses.applicantId,
    })
    .from(responses)
    .where(
      and(
        eq(responses.organizationId, scope.organizationId),
        eq(responses.requestId, requestId),
        liveCollectionResponse(),
      ),
    )
    .orderBy(desc(responses.submittedAt), desc(responses.id))
    .limit(COLLECTION_RESPONSE_LIST_LIMIT);
  return rows.map((row) =>
    mint({
      accountId: scope.accountId,
      organizationId: scope.organizationId,
      requestId: row.requestId,
      responseId: row.id,
      applicantId: row.applicantId,
    }),
  );
}

/** The access to one live response of this agency, or not found for anything else. */
export async function collectionResponseAccess(
  db: Db,
  scope: AgencyCollectionScope,
  responseId: string,
): Promise<{ ok: true; value: CollectionResponseAccess } | { ok: false; error: ServiceError }> {
  if (agencyCollectionScopeProblem(scope)) return { ok: false, error: missing() };
  if (!isUuid(responseId) || !(await collectionResponsesPresent(db))) {
    return { ok: false, error: missing() };
  }
  if (!(await agencyMayReceiveAnswers(db, scope.organizationId))) {
    return { ok: false, error: missing() };
  }
  const responses = schema.agencyCollectionResponses;
  const row = first(
    await db
      .select({ requestId: responses.requestId, applicantId: responses.applicantId })
      .from(responses)
      .where(
        and(
          eq(responses.id, responseId),
          eq(responses.organizationId, scope.organizationId),
          liveCollectionResponse(),
        ),
      )
      .limit(1),
  );
  if (!row) return { ok: false, error: missing() };
  return {
    ok: true,
    value: mint({
      accountId: scope.accountId,
      organizationId: scope.organizationId,
      requestId: row.requestId,
      responseId,
      applicantId: row.applicantId,
    }),
  };
}

/** How long a response access stays good for: minted for one page or action, never kept. */
const ACCESS_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * The refusal for an access that is not a genuine, fresh one, or undefined when it is. Every
 * service that takes a `CollectionResponseAccess` calls this first; the switch is read again so
 * turning it off stops work at once.
 */
export function collectionResponseAccessProblem(
  access: unknown,
  env: Readonly<Record<string, string | undefined>> = process.env,
): ServiceError | undefined {
  if (!agencyCollectionRequestsEnabled(env)) return missing();
  const age = CollectionResponseAccess.isGenuine(access)
    ? Date.now() - access.verifiedAt.getTime()
    : Number.NaN;
  if (!(age >= 0 && age <= ACCESS_MAX_AGE_MS)) return missing();
  return undefined;
}

/** The purpose a response file link carries, binding it to exactly one response. */
const RESPONSE_PURPOSE_PREFIX = 'collection_response:';

export function collectionResponsePurpose(responseId: string): string {
  return `${RESPONSE_PURPOSE_PREFIX}${responseId}`;
}

/** The response id a signed file-link purpose names, or null when it names none. */
export function responseIdFromPurpose(purpose: string): string | null {
  if (!purpose.startsWith(RESPONSE_PURPOSE_PREFIX)) return null;
  const id = purpose.slice(RESPONSE_PURPOSE_PREFIX.length);
  return isUuid(id) ? id : null;
}

/**
 * Whether a response's stored lines still make exactly the content it was submitted with. A line
 * added after submission, or one removed with its document, changes the fingerprint, and a changed
 * answer releases nothing: no file link is minted or honoured for it.
 */
export async function collectionResponseIntact(db: Db, responseId: string): Promise<boolean> {
  if (!isUuid(responseId)) return false;
  const responses = schema.agencyCollectionResponses;
  const response = first(
    await db
      .select({
        requestId: responses.requestId,
        revisionId: responses.revisionId,
        applicantId: responses.applicantId,
        consentVersion: responses.consentVersion,
        contentSha256: responses.contentSha256,
      })
      .from(responses)
      .where(eq(responses.id, responseId))
      .limit(1),
  );
  if (!response) return false;
  const rows = await db
    .select()
    .from(schema.agencyCollectionResponseItems)
    .where(eq(schema.agencyCollectionResponseItems.responseId, responseId));
  return responseContentSha256({ ...response, lines: rows.map(lineOf) }) === response.contentSha256;
}

/** A stored line as the content fingerprint reads it (title is presentation, never content). */
export function lineOf(
  row: typeof schema.agencyCollectionResponseItems.$inferSelect,
): ResponseLine {
  if (row.kind === 'DOCUMENT' && row.documentId && row.documentVersionId) {
    return {
      itemId: row.itemId,
      kind: 'DOCUMENT',
      documentId: row.documentId,
      documentVersionId: row.documentVersionId,
    };
  }
  if (row.kind === 'FIELD' && row.factId && row.factVersionId) {
    return {
      itemId: row.itemId,
      kind: 'FIELD',
      factId: row.factId,
      factVersionId: row.factVersionId,
    };
  }
  return { itemId: row.itemId, kind: 'MISSING' };
}

/**
 * Re-checked when a response file link is opened (the serving route, through
 * `recheckDocumentAccess`), against live state only: the switch is on, the account is still an
 * active OWNER or ADMIN of an agency VisaStack has reviewed, the response is that agency's, not
 * withdrawn and unchanged since it was sent, and it still lists exactly this document version. Anything else is refused with a reason that is
 * logged, never shown.
 */
export async function collectionResponseStillCovers(
  db: Db,
  fields: {
    readonly responseId: string;
    readonly accountId: string;
    readonly organizationId: string;
    readonly documentId: string;
    readonly documentVersionId: string;
  },
): Promise<{ readonly allowed: true } | { readonly allowed: false; readonly reason: string }> {
  if (!agencyCollectionRequestsEnabled()) return { allowed: false, reason: 'switch_off' };
  const ids = [
    fields.responseId,
    fields.accountId,
    fields.organizationId,
    fields.documentId,
    fields.documentVersionId,
  ];
  if (!ids.every(isUuid)) return { allowed: false, reason: 'malformed' };
  if (!(await collectionResponsesPresent(db))) return { allowed: false, reason: 'not_migrated' };
  if (!(await isOrgAdmin(db, fields.accountId, fields.organizationId))) {
    return { allowed: false, reason: 'not_an_agency_admin' };
  }
  if (!(await agencyMayReceiveAnswers(db, fields.organizationId))) {
    return { allowed: false, reason: 'organization_not_active' };
  }
  if (!(await collectionResponseIntact(db, fields.responseId))) {
    return { allowed: false, reason: 'response_changed' };
  }
  const responses = schema.agencyCollectionResponses;
  const items = schema.agencyCollectionResponseItems;
  const row = first(
    await db
      .select({ id: items.id })
      .from(items)
      .innerJoin(responses, eq(responses.id, items.responseId))
      .where(
        and(
          eq(responses.id, fields.responseId),
          eq(responses.organizationId, fields.organizationId),
          liveCollectionResponse(),
          eq(items.kind, 'DOCUMENT'),
          eq(items.documentId, fields.documentId),
          eq(items.documentVersionId, fields.documentVersionId),
        ),
      )
      .limit(1),
  );
  if (!row) return { allowed: false, reason: 'not_in_response' };
  return { allowed: true };
}

/** How far back a wrong-account refusal for the same account and link counts as already recorded. */
const WRONG_ACCOUNT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Whether this signed-in account may answer a request link. A link with no recipient address may be
 * answered by whoever holds it and signs in (the agency handed it out). A link with one may be
 * answered only by an account with exactly that address, compared as account addresses are stored
 * (trimmed, lower case), the rule client invitations follow. A wrong account gets the same answer
 * as a closed link, and the refusal is recorded once per account and link (who, never what), so a
 * reload or a retry does not fill the audit trail (looked up within the link's lifetime, on the
 * trail's time index). Lives here with the other gate decisions,
 * because it decides who may act on the link.
 */
export async function collectionRecipientAllowed(
  db: Db,
  input: {
    readonly linkId: string;
    readonly organizationId: string;
    readonly emailHint: string | null;
    readonly accountId: string;
  },
): Promise<boolean> {
  if (!isUuid(input.accountId) || !isUuid(input.linkId)) return false;
  const hint = input.emailHint?.trim().toLowerCase() ?? '';
  if (hint.length === 0) return true;
  const account = first(
    await db
      .select({ email: schema.accounts.email })
      .from(schema.accounts)
      .where(eq(schema.accounts.id, input.accountId))
      .limit(1),
  );
  if (account && account.email.trim().toLowerCase() === hint) return true;
  try {
    // In its own savepoint: a failed look or write never aborts a caller's transaction.
    await db.transaction(async (tx) => {
      const already = first(
        await tx
          .select({ seq: schema.auditEvents.seq })
          .from(schema.auditEvents)
          .where(
            and(
              // The time index bounds the look: a link lives 14 days, so 30 days covers its life.
              gt(schema.auditEvents.occurredAt, new Date(Date.now() - WRONG_ACCOUNT_WINDOW_MS)),
              eq(schema.auditEvents.eventType, 'AGENCY_COLLECTION_RESPONSE_WRONG_ACCOUNT'),
              eq(schema.auditEvents.actorAccountId, input.accountId),
              eq(schema.auditEvents.resourceId, input.linkId),
            ),
          )
          .limit(1),
      );
      if (already) return;
      await appendAuditEvent(tx, {
        eventType: 'AGENCY_COLLECTION_RESPONSE_WRONG_ACCOUNT',
        actorAccountId: input.accountId,
        method: 'MANUAL',
        result: 'DENIED',
        resourceType: 'agency_collection_link',
        resourceId: input.linkId,
        reason: 'wrong_recipient',
        metadata: { organizationId: input.organizationId },
      });
    });
  } catch {
    // The refusal stands whether or not it could be recorded.
  }
  return false;
}
