import { type Result, err, ok } from '@visastack/core';
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import {
  type AgencyCollectionScope,
  CollectionLinkProof,
  agencyCollectionRequesterScopeProblem,
  agencyCollectionScopeProblem,
  collectionIssuerMayIssue,
} from './access/collection-scope';
import { appendAuditEvent } from './audit';
import { type Db, first, schema } from './db';
import { isEmailAddress } from './email-address';
import { type ServiceError, keyedError, serviceError } from './errors';
import { queueInvitationEmail } from './invitation-email';
import { generateInvitationToken, hashInvitationToken } from './invitation-tokens';
import { isUuid } from './lifecycle/foundation/ids';
import {
  type CollectionLinkEmailRecord,
  NO_RECIPIENT_EMAIL,
  PROVIDER_UNREACHABLE_ERRORS,
  RECIPIENT_NO_LONGER_AUTHORIZED,
  cancelQueuedNotificationsForResource,
  collectionLinkEmailRecords,
} from './notifications';
import { OPEN_ORGANIZATION_STATUSES } from './organization-admission';
import { type PackMatch, type PackMatchTerms, listFittingPublicPacks } from './pack-matching';
import { getPackVersion, listRequirements, verifyPackChecksum } from './packs';
import type { KeyManagementPort } from './ports';
import { RATE_LIMITS, checkRateLimits } from './rate-limit';
import {
  type BrandSnapshot,
  type CollectionItem,
  type DraftEdit,
  applyDraftEdit,
  cleanText,
  parseBrandSnapshot,
  parseItems,
  proposeFromPack,
  replaceOfficialItems,
  revisionContentSha256,
} from './umpe-collection-request-items';
import { agencyCollectionRequestsEnabled } from './umpe-collection-request-switch';

/**
 * Agency document requests sent before any traveller record exists (UMPE P6, ADR 0026 D4).
 *
 * An agency OWNER or ADMIN (an `AgencyCollectionScope`) drafts a request for one destination,
 * gets a checklist proposed from the published official pack that fits (or starts the agency's own
 * list when none does), adds the agency's own items, and issues it: the checklist is frozen into
 * an append-only revision with the pack checksum and a SHA-256 of its content, and a private link
 * is made. A reissue adds the next revision and replaces the older links; earlier revisions stay
 * readable. Revoke or close ends the request and every link.
 *
 * Nothing here creates or reads an account, applicant, case, grant or document. Every query names
 * the scope's organization, and anything refused looks exactly like something missing. The public
 * side (`CollectionLinkProof`, the bearer link) learns only whether the link is open and, for an
 * agency VisaStack has reviewed (ACTIVE), its name and accent colour.
 */

/** How long a request link stays open. */
export const COLLECTION_LINK_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Open links one request may have at once (each email or copied link is one). */
const MAX_OPEN_LINKS = 10;
/** The newest requests the list shows. */
export const COLLECTION_LIST_LIMIT = 200;

export type CollectionRequestStatus = 'DRAFT' | 'SENT' | 'REVOKED' | 'CLOSED';
/** What the list shows: a sent request whose links have all run out reads as Expired. */
export type CollectionDisplayStatus = 'DRAFT' | 'SENT' | 'EXPIRED' | 'REVOKED' | 'CLOSED';

export const COLLECTION_STATUS_LABELS: Readonly<Record<CollectionDisplayStatus, string>> = {
  DRAFT: 'Draft',
  SENT: 'Sent',
  EXPIRED: 'Expired',
  REVOKED: 'Revoked',
  CLOSED: 'Closed',
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function missing(): ServiceError {
  return keyedError('not_found', 'umpe_collection_request_service.no_such_document_request');
}

// --- Input -----------------------------------------------------------------------------------

export interface CollectionRequestInput {
  /** The destination's two-letter code. */
  readonly destination: string;
  /** The purpose's label, or null for Not Sure Yet. */
  readonly purpose: string | null;
  /** A specific route the agency already knows, or null. */
  readonly route: string | null;
  /** Tentative travel dates (YYYY-MM-DD), each optional. */
  readonly travelFrom: string | null;
  readonly travelTo: string | null;
  readonly dueAt: Date | null;
  readonly nationality: string | null;
  readonly residence: string | null;
  readonly applicationPlace: string | null;
  readonly recipientNameHint: string | null;
  readonly recipientEmailHint: string | null;
  /**
   * Every name the destination and purpose may go by, built by the caller from its own pickers, to
   * find the published official checklist; null when the purpose is Not Sure Yet.
   */
  readonly packTerms: PackMatchTerms | null;
}

function validDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

interface CleanRequest {
  readonly destination: string;
  readonly purpose: string | null;
  readonly route: string | null;
  readonly travelFrom: string | null;
  readonly travelTo: string | null;
  readonly dueAt: Date | null;
  readonly nationality: string | null;
  readonly residence: string | null;
  readonly applicationPlace: string | null;
  readonly recipientNameHint: string | null;
  readonly recipientEmailHint: string | null;
}

function cleanRequest(input: CollectionRequestInput, now: Date): CleanRequest | string {
  const destination = input.destination.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(destination)) return 'Choose a destination.';
  const fields = {
    purpose: cleanText(input.purpose, 200),
    route: cleanText(input.route, 200),
    nationality: cleanText(input.nationality, 100),
    residence: cleanText(input.residence, 100),
    applicationPlace: cleanText(input.applicationPlace, 100),
    recipientNameHint: cleanText(input.recipientNameHint, 200),
    recipientEmailHint: cleanText(input.recipientEmailHint?.toLowerCase(), 320),
  };
  for (const value of Object.values(fields)) {
    if (value === 'too_long') return 'One of the answers is too long. Shorten it and try again.';
  }
  const email = fields.recipientEmailHint as string | null;
  if (email !== null && !isEmailAddress(email)) {
    return 'Enter a valid email address for the person, like name@example.com, or leave it empty.';
  }
  const travelFrom = cleanText(input.travelFrom, 10);
  const travelTo = cleanText(input.travelTo, 10);
  for (const value of [travelFrom, travelTo]) {
    if (value !== null && (value === 'too_long' || !validDate(value))) {
      return 'Enter travel dates as full dates.';
    }
  }
  if (travelFrom && travelTo && travelFrom > travelTo) {
    return 'The return date must be on or after the travel date.';
  }
  if (input.dueAt !== null) {
    if (Number.isNaN(input.dueAt.getTime())) return 'Enter a valid due date.';
    if (input.dueAt.getTime() <= now.getTime()) return 'Choose a due date in the future.';
  }
  return {
    destination,
    purpose: fields.purpose as string | null,
    route: fields.route as string | null,
    travelFrom: travelFrom as string | null,
    travelTo: travelTo as string | null,
    dueAt: input.dueAt,
    nationality: fields.nationality as string | null,
    residence: fields.residence as string | null,
    applicationPlace: fields.applicationPlace as string | null,
    recipientNameHint: fields.recipientNameHint as string | null,
    recipientEmailHint: email,
  };
}

/**
 * The one published pack to propose on its own: the only fitting one known to cover the person and
 * needing no case detail the request lacks (UMPE G2: a pack limited to some application posts or
 * travel dates is never proposed on a guess).
 */
function soleCoveringPack(fitting: readonly PackMatch[]): PackMatch | null {
  const covering = fitting.filter((pack) => pack.coversTraveller);
  const only = covering.length === 1 ? (covering[0] ?? null) : null;
  return only && only.needs === undefined ? only : null;
}

/**
 * The request's own application place and first travel date added to the caller's terms (UMPE G2,
 * R05), so a pack limited to some posts or a travel window is compared with what the agency entered
 * rather than asked for again. A value the caller already gave is kept.
 */
function withRequestDetails(
  terms: PackMatchTerms,
  details: { readonly applicationPlace: string | null; readonly travelFrom: string | null },
): PackMatchTerms {
  const travelStart = details.travelFrom ? new Date(`${details.travelFrom}T00:00:00Z`) : null;
  return {
    ...terms,
    ...(terms.consularPost == null && details.applicationPlace
      ? { consularPost: details.applicationPlace }
      : {}),
    ...(terms.travelStart == null && travelStart && !Number.isNaN(travelStart.getTime())
      ? { travelStart }
      : {}),
  };
}

/** A pack's requirements as official items, or null when its checksum no longer verifies. */
async function officialProposal(db: Db, packVersionId: string): Promise<CollectionItem[] | null> {
  if (!(await verifyPackChecksum(db, packVersionId))) return null;
  return proposeFromPack(await listRequirements(db, packVersionId));
}

// --- Create, list and read ----------------------------------------------------------------------

export interface CreatedCollectionRequest {
  readonly id: string;
  /** The official checklist proposed, or null when the request starts as the agency's own list. */
  readonly proposedPack: { readonly packVersionId: string; readonly packName: string } | null;
}

export async function createCollectionRequest(
  db: Db,
  scope: AgencyCollectionScope,
  input: CollectionRequestInput,
  now: Date = new Date(),
): Promise<Result<CreatedCollectionRequest, ServiceError>> {
  const problem = agencyCollectionRequesterScopeProblem(scope);
  if (problem) return err(problem);
  const clean = cleanRequest(input, now);
  if (typeof clean === 'string') return err(serviceError('invalid', clean));

  const rateLimit = await checkRateLimits(db, [
    {
      input: { subjectId: scope.accountId, action: 'collection_request.create', label: 'request' },
      config: RATE_LIMITS.COLLECTION_REQUEST_CREATE,
    },
    {
      input: {
        subjectId: scope.organizationId,
        action: 'collection_request.create.org',
        label: 'request',
      },
      config: RATE_LIMITS.COLLECTION_REQUEST_CREATE_ORG,
    },
  ]);
  if (!rateLimit.allowed) return err(serviceError('rate_limited', rateLimit.reason));

  const fitting =
    input.packTerms && clean.purpose
      ? await listFittingPublicPacks(db, withRequestDetails(input.packTerms, clean))
      : [];
  const pack = soleCoveringPack(fitting);
  const items = pack ? await officialProposal(db, pack.packVersionId) : null;
  const proposedPack = pack && items ? pack : null;

  return db.transaction(async (tx) => {
    const created = first(
      await tx
        .insert(schema.agencyCollectionRequests)
        .values({
          organizationId: scope.organizationId,
          createdByAccountId: scope.accountId,
          status: 'DRAFT',
          ...clean,
          draftPackVersionId: proposedPack?.packVersionId ?? null,
          draftItems: items && proposedPack ? items : [],
        })
        .returning({ id: schema.agencyCollectionRequests.id }),
    );
    if (!created) throw new Error('document request insert returned nothing');
    await appendAuditEvent(tx, {
      eventType: 'AGENCY_COLLECTION_REQUEST_CREATED',
      actorAccountId: scope.accountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'agency_collection_request',
      resourceId: created.id,
      metadata: { organizationId: scope.organizationId, officialChecklist: proposedPack !== null },
    });
    return ok({
      id: created.id,
      proposedPack: proposedPack
        ? { packVersionId: proposedPack.packVersionId, packName: proposedPack.packName }
        : null,
    });
  });
}

export interface CollectionRequestSummary {
  readonly id: string;
  readonly status: CollectionDisplayStatus;
  readonly destination: string;
  readonly purpose: string | null;
  readonly route: string | null;
  readonly recipientNameHint: string | null;
  readonly dueAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

function openLinkFilter(now: Date) {
  return and(
    isNull(schema.agencyCollectionLinks.revokedAt),
    isNull(schema.agencyCollectionLinks.replacedById),
    gt(schema.agencyCollectionLinks.expiresAt, now),
  );
}

function displayStatus(status: string, hasOpenLink: boolean): CollectionDisplayStatus {
  if (status === 'SENT') return hasOpenLink ? 'SENT' : 'EXPIRED';
  if (status === 'REVOKED' || status === 'CLOSED') return status;
  return 'DRAFT';
}

/** This agency's requests, newest first. */
export async function listCollectionRequests(
  db: Db,
  scope: AgencyCollectionScope,
  now: Date = new Date(),
): Promise<Result<readonly CollectionRequestSummary[], ServiceError>> {
  const problem = agencyCollectionRequesterScopeProblem(scope);
  if (problem) return err(problem);
  const rows = await db
    .select()
    .from(schema.agencyCollectionRequests)
    .where(requestsOf(scope))
    .orderBy(desc(schema.agencyCollectionRequests.createdAt))
    .limit(COLLECTION_LIST_LIMIT);
  const ids = rows.map((row) => row.id);
  const open =
    ids.length === 0
      ? []
      : await db
          .select({
            requestId: schema.agencyCollectionLinks.requestId,
            createdBy: schema.agencyCollectionLinks.createdByAccountId,
          })
          .from(schema.agencyCollectionLinks)
          .innerJoin(
            schema.agencyCollectionRequests,
            eq(schema.agencyCollectionRequests.id, schema.agencyCollectionLinks.requestId),
          )
          .where(
            and(
              eq(schema.agencyCollectionRequests.organizationId, scope.organizationId),
              inArray(schema.agencyCollectionLinks.requestId, ids),
              openLinkFilter(now),
            ),
          );
  // A link whose sender may no longer send (admin role or May Request Documents gone) is closed.
  const mayIssue = await issuersWhoMayIssue(
    db,
    scope.organizationId,
    open.map((row) => row.createdBy),
  );
  const withOpenLink = new Set(
    open.filter((row) => row.createdBy && mayIssue.has(row.createdBy)).map((row) => row.requestId),
  );
  return ok(
    rows.map((row) => ({
      id: row.id,
      status: displayStatus(row.status, withOpenLink.has(row.id)),
      destination: row.destination,
      purpose: row.purpose,
      route: row.route,
      recipientNameHint: row.recipientNameHint,
      dueAt: row.dueAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
  );
}

export interface CollectionRevisionView {
  readonly id: string;
  readonly revisionNo: number;
  readonly issuedAt: Date;
  readonly packVersionId: string | null;
  readonly packChecksum: string | null;
  /** True when the stored content still hashes to the SHA-256 recorded at issue. */
  readonly intact: boolean;
  /** The frozen checklist; empty when the revision is not intact (never shown as if it were). */
  readonly items: readonly CollectionItem[];
  readonly brand: BrandSnapshot | null;
}

/**
 * `ISSUER_GONE`: the person who made the link is no longer an owner or admin and no longer holds
 * May Request Documents, so the link no longer opens (the public page already refuses it); make a
 * new link.
 */
export type CollectionLinkState = 'OPEN' | 'EXPIRED' | 'REVOKED' | 'REPLACED' | 'ISSUER_GONE';

/**
 * What is truly known about a link's email (UMPE G3, A07), from the outbox record itself:
 * - `NOT_EMAILED`: the link was made to copy and share; no email was asked for.
 * - `QUEUED`: waiting to be handed to the mail provider (`retrying` after a refused attempt).
 * - `SENT`: the mail provider accepted it. Not the same as reaching the inbox.
 * - `DELIVERED`: only when the provider itself reported delivery (a delivered time recorded).
 * - `NOT_DELIVERED`: the provider reported the receiving server refused it.
 * - `NOT_SENT`: it was never handed over, with the reason.
 */
export type CollectionEmailStatus =
  | 'NOT_EMAILED'
  | 'QUEUED'
  | 'SENT'
  | 'DELIVERED'
  | 'NOT_DELIVERED'
  | 'NOT_SENT';

export type CollectionEmailReason =
  | 'LINK_CLOSED'
  | 'NO_ADDRESS'
  | 'PROVIDER_REFUSED'
  | 'PROVIDER_UNREACHABLE'
  | 'STOPPED'
  | 'NOT_QUEUED';

export interface CollectionEmailState {
  readonly status: CollectionEmailStatus;
  /** Set only for `NOT_SENT`. */
  readonly reason: CollectionEmailReason | null;
  /** True for `QUEUED` after an attempt the provider refused; it will be tried again. */
  readonly retrying: boolean;
  /** When the provider accepted it, for `SENT`, `DELIVERED` and `NOT_DELIVERED`. */
  readonly sentAt: Date | null;
  /** When the provider reported delivery, for `DELIVERED` only. */
  readonly deliveredAt: Date | null;
}

const NOT_EMAILED: CollectionEmailState = {
  status: 'NOT_EMAILED',
  reason: null,
  retrying: false,
  sentAt: null,
  deliveredAt: null,
};

export const COLLECTION_EMAIL_STATUS_LABELS: Readonly<Record<CollectionEmailStatus, string>> = {
  NOT_EMAILED: 'Not Emailed',
  QUEUED: 'Queued',
  SENT: 'Sent to Mail Provider',
  DELIVERED: 'Delivered',
  NOT_DELIVERED: 'Not Delivered',
  NOT_SENT: 'Not Sent',
};

export const COLLECTION_EMAIL_REASON_LABELS: Readonly<Record<CollectionEmailReason, string>> = {
  LINK_CLOSED: 'The link closed before the email could go.',
  NO_ADDRESS: 'There was no address to send it to.',
  PROVIDER_REFUSED: 'The mail provider did not accept it.',
  PROVIDER_UNREACHABLE:
    'The mail service could not be reached, or did not answer, after several tries.',
  STOPPED: 'It was stopped because the link was replaced or ended.',
  NOT_QUEUED: 'No email was recorded for this link.',
};

type EmailRow = CollectionLinkEmailRecord;

/**
 * One outbox record in plain terms. Delivered needs the provider's own delivery time; a provider
 * report after acceptance (a bounce, a later failure) reads Not Delivered, never Not Sent; and a
 * spam complaint about a delivered email still reads Delivered (it arrived).
 */
export function collectionEmailState(
  row: EmailRow | undefined,
  emailed: boolean,
): CollectionEmailState {
  if (!row) {
    return emailed ? { ...NOT_EMAILED, status: 'NOT_SENT', reason: 'NOT_QUEUED' } : NOT_EMAILED;
  }
  const base = { reason: null, retrying: false, sentAt: row.sentAt, deliveredAt: null };
  switch (row.status) {
    case 'QUEUED':
      return { ...base, status: 'QUEUED', sentAt: null, retrying: row.attempts > 0 };
    case 'SENT':
      return { ...base, status: 'SENT' };
    case 'DELIVERED':
    case 'READ':
      return row.deliveredAt
        ? { ...base, status: 'DELIVERED', deliveredAt: row.deliveredAt }
        : { ...base, status: 'SENT' };
    case 'BOUNCED':
      return row.deliveredAt
        ? { ...base, status: 'DELIVERED', deliveredAt: row.deliveredAt }
        : { ...base, status: 'NOT_DELIVERED' };
    case 'CANCELLED':
      return { ...base, status: 'NOT_SENT', reason: 'STOPPED', sentAt: null };
    default: {
      // Accepted first, then reported failed by the provider: it was handed over.
      if (row.sentAt) return { ...base, status: 'NOT_DELIVERED' };
      const reason: CollectionEmailReason =
        row.lastError === RECIPIENT_NO_LONGER_AUTHORIZED
          ? 'LINK_CLOSED'
          : row.lastError === NO_RECIPIENT_EMAIL
            ? 'NO_ADDRESS'
            : row.lastError !== null && PROVIDER_UNREACHABLE_ERRORS.has(row.lastError)
              ? 'PROVIDER_UNREACHABLE'
              : 'PROVIDER_REFUSED';
      return { ...base, status: 'NOT_SENT', reason, sentAt: null };
    }
  }
}

export interface CollectionLinkView {
  readonly id: string;
  readonly revisionNo: number;
  readonly state: CollectionLinkState;
  readonly emailed: boolean;
  /** The email's true state (UMPE G3, A07). */
  readonly email: CollectionEmailState;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly lastOpenedAt: Date | null;
}

export interface CollectionRequestDetail {
  readonly id: string;
  readonly status: CollectionDisplayStatus;
  readonly storedStatus: CollectionRequestStatus;
  readonly destination: string;
  readonly purpose: string | null;
  readonly route: string | null;
  readonly travelFrom: string | null;
  readonly travelTo: string | null;
  readonly dueAt: Date | null;
  readonly nationality: string | null;
  readonly residence: string | null;
  readonly applicationPlace: string | null;
  readonly recipientNameHint: string | null;
  readonly recipientEmailHint: string | null;
  readonly createdAt: Date;
  /** The official checklist the draft follows, or null for the agency's own list. */
  readonly draftPack: {
    readonly packVersionId: string;
    readonly packName: string;
    readonly version: number;
  } | null;
  /** Null when the stored draft cannot be read (never repaired silently). */
  readonly draftItems: readonly CollectionItem[] | null;
  /** Newest first. */
  readonly revisions: readonly CollectionRevisionView[];
  /** Newest first. */
  readonly links: readonly CollectionLinkView[];
}

type RequestRow = typeof schema.agencyCollectionRequests.$inferSelect;
type RevisionRow = typeof schema.agencyCollectionRequestRevisions.$inferSelect;

/**
 * The requests a scope may see: all of the organization's for an owner or admin, only the ones the
 * member made for a member with May Request Documents (UMPE G3).
 */
function requestsOf(scope: AgencyCollectionScope) {
  const org = eq(schema.agencyCollectionRequests.organizationId, scope.organizationId);
  return scope.authority === 'ADMIN'
    ? org
    : and(org, eq(schema.agencyCollectionRequests.createdByAccountId, scope.accountId));
}

/** Which of these link senders may still keep their links open (each distinct one checked once). */
async function issuersWhoMayIssue(
  db: Db,
  organizationId: string,
  issuers: readonly (string | null)[],
): Promise<ReadonlySet<string>> {
  const mayIssue = new Set<string>();
  for (const issuer of new Set(issuers)) {
    if (issuer && (await collectionIssuerMayIssue(db, issuer, organizationId)))
      mayIssue.add(issuer);
  }
  return mayIssue;
}

/** One request of this organization, or undefined; `forUpdate` locks it for the transaction. */
async function loadRequest(
  db: Db,
  scope: AgencyCollectionScope,
  requestId: string,
  forUpdate = false,
): Promise<RequestRow | undefined> {
  if (!isUuid(requestId)) return undefined;
  const query = db
    .select()
    .from(schema.agencyCollectionRequests)
    .where(and(eq(schema.agencyCollectionRequests.id, requestId), requestsOf(scope)))
    .limit(1);
  return first(forUpdate ? await query.for('update') : await query);
}

function revisionView(row: RevisionRow): CollectionRevisionView {
  const items = parseItems(row.items);
  const brand = parseBrandSnapshot(row.brandSnapshot);
  const intact =
    items !== null &&
    brand !== 'invalid' &&
    revisionContentSha256({
      requestId: row.requestId,
      revisionNo: row.revisionNo,
      packVersionId: row.packVersionId,
      packChecksum: row.packChecksum,
      items,
      brandSnapshot: brand,
    }) === row.contentSha256;
  return {
    id: row.id,
    revisionNo: row.revisionNo,
    issuedAt: row.issuedAt,
    packVersionId: row.packVersionId,
    packChecksum: row.packChecksum,
    intact,
    items: intact && items ? items : [],
    brand: intact ? brand : null,
  };
}

function linkState(
  row: { revokedAt: Date | null; replacedById: string | null; expiresAt: Date },
  now: Date,
): CollectionLinkState {
  if (row.revokedAt) return 'REVOKED';
  if (row.replacedById) return 'REPLACED';
  return row.expiresAt.getTime() > now.getTime() ? 'OPEN' : 'EXPIRED';
}

/** One request with its draft, every issued revision (each re-verified) and its links. */
export async function getCollectionRequest(
  db: Db,
  scope: AgencyCollectionScope,
  requestId: string,
  now: Date = new Date(),
): Promise<Result<CollectionRequestDetail, ServiceError>> {
  const problem = agencyCollectionRequesterScopeProblem(scope);
  if (problem) return err(problem);
  const request = await loadRequest(db, scope, requestId);
  if (!request) return err(missing());

  const [revisions, links, pack] = await Promise.all([
    db
      .select()
      .from(schema.agencyCollectionRequestRevisions)
      .innerJoin(
        schema.agencyCollectionRequests,
        eq(schema.agencyCollectionRequests.id, schema.agencyCollectionRequestRevisions.requestId),
      )
      .where(
        and(
          eq(schema.agencyCollectionRequestRevisions.requestId, request.id),
          eq(schema.agencyCollectionRequests.organizationId, scope.organizationId),
        ),
      )
      .orderBy(desc(schema.agencyCollectionRequestRevisions.revisionNo)),
    db
      .select({
        id: schema.agencyCollectionLinks.id,
        revisionNo: schema.agencyCollectionRequestRevisions.revisionNo,
        revokedAt: schema.agencyCollectionLinks.revokedAt,
        replacedById: schema.agencyCollectionLinks.replacedById,
        expiresAt: schema.agencyCollectionLinks.expiresAt,
        recipientEmailHint: schema.agencyCollectionLinks.recipientEmailHint,
        createdAt: schema.agencyCollectionLinks.createdAt,
        lastOpenedAt: schema.agencyCollectionLinks.lastOpenedAt,
        createdBy: schema.agencyCollectionLinks.createdByAccountId,
      })
      .from(schema.agencyCollectionLinks)
      .innerJoin(
        schema.agencyCollectionRequestRevisions,
        eq(schema.agencyCollectionRequestRevisions.id, schema.agencyCollectionLinks.revisionId),
      )
      .innerJoin(
        schema.agencyCollectionRequests,
        eq(schema.agencyCollectionRequests.id, schema.agencyCollectionLinks.requestId),
      )
      .where(
        and(
          eq(schema.agencyCollectionLinks.requestId, request.id),
          eq(schema.agencyCollectionRequests.organizationId, scope.organizationId),
        ),
      )
      .orderBy(desc(schema.agencyCollectionLinks.createdAt)),
    request.draftPackVersionId
      ? db
          .select({
            packVersionId: schema.packVersions.id,
            packName: schema.packs.name,
            version: schema.packVersions.version,
          })
          .from(schema.packVersions)
          .innerJoin(schema.packs, eq(schema.packs.id, schema.packVersions.packId))
          .where(eq(schema.packVersions.id, request.draftPackVersionId))
          .limit(1)
      : Promise.resolve([]),
  ]);

  const issuers = [...new Set(links.flatMap((row) => (row.createdBy ? [row.createdBy] : [])))];
  const mayIssue = await issuersWhoMayIssue(db, scope.organizationId, issuers);
  const emailStates = await collectionLinkEmailRecords(
    db,
    scope,
    links.map((row) => row.id),
  );
  const linkViews = links.map((row) => ({
    id: row.id,
    revisionNo: row.revisionNo,
    state:
      linkState(row, now) === 'OPEN' && !(row.createdBy && mayIssue.has(row.createdBy))
        ? ('ISSUER_GONE' as const)
        : linkState(row, now),
    emailed: row.recipientEmailHint !== null,
    email: collectionEmailState(emailStates.get(row.id), row.recipientEmailHint !== null),
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    lastOpenedAt: row.lastOpenedAt,
  }));
  return ok({
    id: request.id,
    status: displayStatus(
      request.status,
      linkViews.some((link) => link.state === 'OPEN'),
    ),
    storedStatus: request.status as CollectionRequestStatus,
    destination: request.destination,
    purpose: request.purpose,
    route: request.route,
    travelFrom: request.travelFrom,
    travelTo: request.travelTo,
    dueAt: request.dueAt,
    nationality: request.nationality,
    residence: request.residence,
    applicationPlace: request.applicationPlace,
    recipientNameHint: request.recipientNameHint,
    recipientEmailHint: request.recipientEmailHint,
    createdAt: request.createdAt,
    draftPack: first(pack) ?? null,
    draftItems: parseItems(request.draftItems),
    revisions: revisions.map((row) => revisionView(row.agency_collection_request_revisions)),
    links: linkViews,
  });
}

// --- Draft --------------------------------------------------------------------------------------

function editable(request: RequestRow): boolean {
  return request.status === 'DRAFT' || request.status === 'SENT';
}

/** The published official checklists that fit this request, for the operator to choose from. */
export async function listCollectionPackChoices(
  db: Db,
  scope: AgencyCollectionScope,
  requestId: string,
  packTerms: PackMatchTerms | null,
): Promise<Result<readonly PackMatch[], ServiceError>> {
  const problem = agencyCollectionRequesterScopeProblem(scope);
  if (problem) return err(problem);
  const request = await loadRequest(db, scope, requestId);
  if (!request) return err(missing());
  if (!packTerms || !request.purpose) return ok([]);
  return ok(await listFittingPublicPacks(db, withRequestDetails(packTerms, request)));
}

/**
 * Follow a published official checklist (its items replace the draft's official items; the
 * agency's own items stay), or none (`packVersionId` null: the request becomes the agency's own
 * list). Only a pack that fits this request's destination and purpose may be chosen.
 */
export async function chooseCollectionPack(
  db: Db,
  scope: AgencyCollectionScope,
  requestId: string,
  choice: { readonly packVersionId: string | null; readonly packTerms: PackMatchTerms | null },
): Promise<Result<{ readonly items: readonly CollectionItem[] }, ServiceError>> {
  const problem = agencyCollectionRequesterScopeProblem(scope);
  if (problem) return err(problem);
  let proposal: CollectionItem[] = [];
  if (choice.packVersionId !== null) {
    const request = await loadRequest(db, scope, requestId);
    if (!request) return err(missing());
    const fitting =
      choice.packTerms && request.purpose
        ? await listFittingPublicPacks(db, withRequestDetails(choice.packTerms, request))
        : [];
    if (!fitting.some((pack) => pack.packVersionId === choice.packVersionId)) {
      return err(
        keyedError('invalid', 'umpe_collection_request_service.that_checklist_does_not_fit_this'),
      );
    }
    const items = await officialProposal(db, choice.packVersionId);
    if (!items) {
      return err(
        keyedError(
          'stale',
          'umpe_collection_request_service.that_official_checklist_no_longer_matches',
        ),
      );
    }
    proposal = items;
  }
  return db.transaction(async (tx) => {
    const request = await loadRequest(tx, scope, requestId, true);
    if (!request) return err(missing());
    if (!editable(request))
      return err(
        keyedError('invalid', 'umpe_collection_request_service.this_request_has_ended_start_a'),
      );
    const current = parseItems(request.draftItems);
    if (!current)
      return err(
        keyedError('invalid', 'umpe_collection_request_service.this_draft_cannot_be_read_start'),
      );
    const items = replaceOfficialItems(current, proposal);
    await tx
      .update(schema.agencyCollectionRequests)
      .set({ draftPackVersionId: choice.packVersionId, draftItems: items, updatedAt: new Date() })
      .where(
        and(
          eq(schema.agencyCollectionRequests.id, request.id),
          eq(schema.agencyCollectionRequests.organizationId, scope.organizationId),
        ),
      );
    return ok({ items });
  });
}

/** One change to the working checklist (add, remove, move, note, or an agency item's necessity). */
export async function editCollectionDraft(
  db: Db,
  scope: AgencyCollectionScope,
  requestId: string,
  edit: DraftEdit,
): Promise<Result<{ readonly items: readonly CollectionItem[] }, ServiceError>> {
  const problem = agencyCollectionRequesterScopeProblem(scope);
  if (problem) return err(problem);
  return db.transaction(async (tx) => {
    const request = await loadRequest(tx, scope, requestId, true);
    if (!request) return err(missing());
    if (!editable(request))
      return err(
        keyedError('invalid', 'umpe_collection_request_service.this_request_has_ended_start_a'),
      );
    const current = parseItems(request.draftItems);
    if (!current)
      return err(
        keyedError('invalid', 'umpe_collection_request_service.this_draft_cannot_be_read_start'),
      );
    const next = applyDraftEdit(current, edit);
    if (!next.ok) return err(serviceError('invalid', next.message));
    await tx
      .update(schema.agencyCollectionRequests)
      .set({ draftItems: next.items, updatedAt: new Date() })
      .where(
        and(
          eq(schema.agencyCollectionRequests.id, request.id),
          eq(schema.agencyCollectionRequests.organizationId, scope.organizationId),
        ),
      );
    return ok({ items: next.items });
  });
}

// --- Issue, links, email, end -------------------------------------------------------------------

export interface IssuedLink {
  readonly id: string;
  /** The raw link token. Exists only here; only its hash is stored. */
  readonly rawToken: string;
  readonly expiresAt: Date;
}

export interface IssuedCollectionRequest {
  readonly revisionId: string;
  readonly revisionNo: number;
  readonly link: IssuedLink;
}

async function linkRateLimit(db: Db, scope: AgencyCollectionScope): Promise<ServiceError | null> {
  const decision = await checkRateLimits(db, [
    {
      input: { subjectId: scope.accountId, action: 'collection_link.create', label: 'link' },
      config: RATE_LIMITS.COLLECTION_LINK_CREATE,
    },
    {
      input: {
        subjectId: scope.organizationId,
        action: 'collection_link.create.org',
        label: 'link',
      },
      config: RATE_LIMITS.COLLECTION_LINK_CREATE_ORG,
    },
  ]);
  return decision.allowed ? null : serviceError('rate_limited', decision.reason);
}

async function insertLink(
  tx: Db,
  input: {
    readonly requestId: string;
    readonly revisionId: string;
    readonly accountId: string;
    readonly recipientEmailHint: string | null;
    readonly now: Date;
  },
): Promise<IssuedLink> {
  const rawToken = generateInvitationToken();
  const expiresAt = new Date(input.now.getTime() + COLLECTION_LINK_DAYS * DAY_MS);
  const link = first(
    await tx
      .insert(schema.agencyCollectionLinks)
      .values({
        requestId: input.requestId,
        revisionId: input.revisionId,
        tokenHash: hashInvitationToken(rawToken),
        recipientEmailHint: input.recipientEmailHint,
        expiresAt,
        createdByAccountId: input.accountId,
        createdAt: input.now,
      })
      .returning({ id: schema.agencyCollectionLinks.id }),
  );
  if (!link) throw new Error('request link insert returned nothing');
  return { id: link.id, rawToken, expiresAt };
}

async function organizationBrand(
  db: Db,
  organizationId: string,
): Promise<{ readonly active: boolean; readonly brand: BrandSnapshot | null }> {
  const org = first(
    await db
      .select({
        name: schema.organizations.name,
        status: schema.organizations.status,
        accentColor: schema.organizations.accentColor,
      })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, organizationId))
      .limit(1),
  );
  if (!org || org.status !== 'ACTIVE') return { active: false, brand: null };
  return { active: true, brand: { name: org.name, accentColor: org.accentColor ?? null } };
}

/** Whether every official item still is exactly a requirement of the pack it names. */
function officialItemsMatch(
  items: readonly CollectionItem[],
  rows: readonly { id: string; kind: string; fieldKey: string | null; docType: string | null }[],
): boolean {
  const byId = new Map(rows.map((row) => [row.id, row] as const));
  return items
    .filter((item) => item.provenance !== 'AGENCY_ADDED')
    .every((item) => {
      const row = byId.get(item.source);
      return (
        !!row &&
        row.kind === item.kind &&
        row.fieldKey === item.fieldKey &&
        row.docType === item.docType
      );
    });
}

/**
 * Freeze the working checklist into the next revision and make a link for it. The pack's checksum
 * is verified first and the issue refused on a mismatch. Older open links are replaced by the new
 * one, so a recipient never works from an earlier revision without knowing.
 */
export async function issueCollectionRequest(
  db: Db,
  scope: AgencyCollectionScope,
  requestId: string,
  now: Date = new Date(),
): Promise<Result<IssuedCollectionRequest, ServiceError>> {
  const problem = agencyCollectionRequesterScopeProblem(scope);
  if (problem) return err(problem);
  const limited = await linkRateLimit(db, scope);
  if (limited) return err(limited);

  return db.transaction(async (tx) => {
    const request = await loadRequest(tx, scope, requestId, true);
    if (!request) return err(missing());
    if (!editable(request))
      return err(
        keyedError('invalid', 'umpe_collection_request_service.this_request_has_ended_start_a'),
      );
    const items = parseItems(request.draftItems);
    if (!items)
      return err(
        keyedError('invalid', 'umpe_collection_request_service.this_draft_cannot_be_read_start'),
      );
    if (items.length === 0) {
      return err(
        keyedError('invalid', 'umpe_collection_request_service.add_at_least_one_item_before'),
      );
    }

    let packChecksum: string | null = null;
    const packVersionId = request.draftPackVersionId;
    if (packVersionId) {
      const version = await getPackVersion(tx, packVersionId);
      if (
        version?.status !== 'PUBLISHED' ||
        !version.checksum ||
        !(await verifyPackChecksum(tx, packVersionId))
      ) {
        return err(
          keyedError(
            'stale',
            'umpe_collection_request_service.the_official_checklist_is_no_longer',
          ),
        );
      }
      if (!officialItemsMatch(items, await listRequirements(tx, packVersionId))) {
        return err(
          keyedError(
            'stale',
            'umpe_collection_request_service.the_official_checklist_changed_choose_it',
          ),
        );
      }
      packChecksum = version.checksum;
    } else if (items.some((item) => item.provenance !== 'AGENCY_ADDED')) {
      return err(
        keyedError(
          'stale',
          'umpe_collection_request_service.choose_an_official_checklist_again_then',
        ),
      );
    }

    const { brand } = await organizationBrand(tx, scope.organizationId);
    const previous = first(
      await tx
        .select({
          revisionNo: sql<number>`coalesce(max(${schema.agencyCollectionRequestRevisions.revisionNo}), 0)`,
        })
        .from(schema.agencyCollectionRequestRevisions)
        .where(eq(schema.agencyCollectionRequestRevisions.requestId, request.id)),
    );
    const revisionNo = Number(previous?.revisionNo ?? 0) + 1;
    const contentSha256 = revisionContentSha256({
      requestId: request.id,
      revisionNo,
      packVersionId,
      packChecksum,
      items,
      brandSnapshot: brand,
    });
    const revision = first(
      await tx
        .insert(schema.agencyCollectionRequestRevisions)
        .values({
          requestId: request.id,
          revisionNo,
          packVersionId,
          packChecksum,
          items,
          brandSnapshot: brand,
          contentSha256,
          issuedAt: now,
          issuedByAccountId: scope.accountId,
        })
        .returning({ id: schema.agencyCollectionRequestRevisions.id }),
    );
    if (!revision) throw new Error('revision insert returned nothing');

    const link = await insertLink(tx, {
      requestId: request.id,
      revisionId: revision.id,
      accountId: scope.accountId,
      recipientEmailHint: null,
      now,
    });
    const replaced = await tx
      .update(schema.agencyCollectionLinks)
      .set({ replacedById: link.id })
      .where(
        and(
          eq(schema.agencyCollectionLinks.requestId, request.id),
          isNull(schema.agencyCollectionLinks.revokedAt),
          isNull(schema.agencyCollectionLinks.replacedById),
          sql`${schema.agencyCollectionLinks.id} <> ${link.id}`,
        ),
      )
      .returning({ id: schema.agencyCollectionLinks.id });
    for (const old of replaced) await cancelQueuedNotificationsForResource(tx, old.id);

    await tx
      .update(schema.agencyCollectionRequests)
      .set({ status: 'SENT', currentRevisionId: revision.id, updatedAt: now })
      .where(
        and(
          eq(schema.agencyCollectionRequests.id, request.id),
          eq(schema.agencyCollectionRequests.organizationId, scope.organizationId),
        ),
      );
    await appendAuditEvent(tx, {
      eventType: 'AGENCY_COLLECTION_REQUEST_ISSUED',
      actorAccountId: scope.accountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'agency_collection_request',
      resourceId: request.id,
      metadata: {
        organizationId: scope.organizationId,
        revisionNo,
        officialChecklist: packVersionId !== null,
        linksReplaced: replaced.length,
      },
    });
    return ok({ revisionId: revision.id, revisionNo, link });
  });
}

export interface CreatedCollectionLink {
  readonly link: IssuedLink;
  /** Whether an email was queued; false means the agency shares the link itself. */
  readonly emailQueued: boolean;
}

/**
 * Another link for the current revision: to copy and share, or (with `email`) sent by email through
 * the outbox with the link sealed in it. Earlier links stay open. The email names no route,
 * document or person, and the agency only when VisaStack has reviewed it.
 */
export async function createCollectionLink(
  db: Db,
  scope: AgencyCollectionScope,
  requestId: string,
  options: {
    readonly email?: { readonly address: string; readonly encryption: KeyManagementPort };
    readonly now?: Date;
  } = {},
): Promise<Result<CreatedCollectionLink, ServiceError>> {
  const problem = agencyCollectionRequesterScopeProblem(scope);
  if (problem) return err(problem);
  const now = options.now ?? new Date();
  const address = options.email ? options.email.address.trim().toLowerCase() : null;
  if (address !== null && (address.length > 320 || !isEmailAddress(address))) {
    return err(
      keyedError('invalid', 'umpe_collection_request_service.enter_a_valid_email_address_like'),
    );
  }
  const limited = await linkRateLimit(db, scope);
  if (limited) return err(limited);

  return db.transaction(async (tx) => {
    const request = await loadRequest(tx, scope, requestId, true);
    if (!request) return err(missing());
    if (request.status !== 'SENT' || !request.currentRevisionId) {
      return err(
        keyedError('invalid', 'umpe_collection_request_service.issue_the_request_before_you_share'),
      );
    }
    const open = await tx
      .select({ id: schema.agencyCollectionLinks.id })
      .from(schema.agencyCollectionLinks)
      .where(and(eq(schema.agencyCollectionLinks.requestId, request.id), openLinkFilter(now)));
    if (open.length >= MAX_OPEN_LINKS) {
      return err(
        serviceError(
          'invalid',
          `This request already has ${MAX_OPEN_LINKS} open links. Issue it again to replace them.`,
        ),
      );
    }
    const link = await insertLink(tx, {
      requestId: request.id,
      revisionId: request.currentRevisionId,
      accountId: scope.accountId,
      recipientEmailHint: address,
      now,
    });
    // The key service is called before the audit write: that write takes the global audit lock,
    // which must never be held while waiting on a network call.
    if (address !== null && options.email) {
      const { active, brand } = await organizationBrand(tx, scope.organizationId);
      await queueInvitationEmail(tx, {
        kind: 'collection',
        invitationId: link.id,
        organizationId: scope.organizationId,
        email: address,
        rawToken: link.rawToken,
        encryption: options.email.encryption,
        agencyName: active ? (brand?.name ?? null) : null,
      });
    }
    await appendAuditEvent(tx, {
      eventType: 'AGENCY_COLLECTION_LINK_CREATED',
      actorAccountId: scope.accountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'agency_collection_request',
      resourceId: request.id,
      metadata: {
        organizationId: scope.organizationId,
        linkId: link.id,
        emailed: address !== null,
      },
    });
    return ok({ link, emailQueued: address !== null });
  });
}

/**
 * End a request: `REVOKED` (withdrawn) or `CLOSED` (finished). Every link closes and any email still
 * waiting to go is cancelled; the worker also re-checks at send time.
 */
export async function endCollectionRequest(
  db: Db,
  scope: AgencyCollectionScope,
  requestId: string,
  outcome: 'REVOKED' | 'CLOSED',
  now: Date = new Date(),
): Promise<Result<{ readonly linksClosed: number }, ServiceError>> {
  // Owners and admins only (UMPE G3): ending a request also takes every answer and guest file it
  // received away from the agency, which a member who never sees them must not decide.
  const problem = agencyCollectionScopeProblem(scope);
  if (problem) return err(problem);
  if (outcome !== 'REVOKED' && outcome !== 'CLOSED') return err(missing());
  return db.transaction(async (tx) => {
    const request = await loadRequest(tx, scope, requestId, true);
    if (!request) return err(missing());
    if (!editable(request))
      return err(
        keyedError('invalid', 'umpe_collection_request_service.this_request_has_already_ended'),
      );
    const closed = await tx
      .update(schema.agencyCollectionLinks)
      .set({ revokedAt: now })
      .where(
        and(
          eq(schema.agencyCollectionLinks.requestId, request.id),
          isNull(schema.agencyCollectionLinks.revokedAt),
        ),
      )
      .returning({ id: schema.agencyCollectionLinks.id });
    for (const link of closed) await cancelQueuedNotificationsForResource(tx, link.id);
    await tx
      .update(schema.agencyCollectionRequests)
      .set({ status: outcome, updatedAt: now })
      .where(
        and(
          eq(schema.agencyCollectionRequests.id, request.id),
          eq(schema.agencyCollectionRequests.organizationId, scope.organizationId),
        ),
      );
    await appendAuditEvent(tx, {
      eventType:
        outcome === 'REVOKED'
          ? 'AGENCY_COLLECTION_REQUEST_REVOKED'
          : 'AGENCY_COLLECTION_REQUEST_CLOSED',
      actorAccountId: scope.accountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'agency_collection_request',
      resourceId: request.id,
      metadata: { organizationId: scope.organizationId, linksClosed: closed.length },
    });
    return ok({ linksClosed: closed.length });
  });
}

// --- Public: the bearer link ---------------------------------------------------------------------

interface OpenLink {
  readonly linkId: string;
  readonly organizationId: string;
}

/**
 * The link the proof names, only while it is open: not revoked, not replaced, not expired, its
 * request still sent, its agency still open (active or awaiting review; never suspended, rejected
 * or terminated), and the person who made it still an active owner or
 * admin of that agency. Anything else is null, all alike.
 */
async function openLinkFor(
  db: Db,
  proof: CollectionLinkProof,
  now: Date,
): Promise<OpenLink | null> {
  if (!CollectionLinkProof.isGenuine(proof) || !agencyCollectionRequestsEnabled()) return null;
  const row = first(
    await db
      .select({
        linkId: schema.agencyCollectionLinks.id,
        createdBy: schema.agencyCollectionLinks.createdByAccountId,
        organizationId: schema.agencyCollectionRequests.organizationId,
        orgStatus: schema.organizations.status,
      })
      .from(schema.agencyCollectionLinks)
      .innerJoin(
        schema.agencyCollectionRequests,
        eq(schema.agencyCollectionRequests.id, schema.agencyCollectionLinks.requestId),
      )
      .innerJoin(
        schema.organizations,
        eq(schema.organizations.id, schema.agencyCollectionRequests.organizationId),
      )
      .where(
        and(
          eq(schema.agencyCollectionLinks.tokenHash, proof.tokenHash),
          openLinkFilter(now),
          eq(schema.agencyCollectionRequests.status, 'SENT'),
        ),
      )
      .limit(1),
  );
  if (!row || !OPEN_ORGANIZATION_STATUSES.includes(row.orgStatus) || !row.createdBy) return null;
  // The person who made it must still be an owner or admin, or still hold May Request Documents.
  if (!(await collectionIssuerMayIssue(db, row.createdBy, row.organizationId))) return null;
  return { linkId: row.linkId, organizationId: row.organizationId };
}

/** What the public request page may show: never the person, route, checklist or any account. */
export interface PublicCollectionView {
  /** Which link is open, so a page can bind its cookie to it. Never shown. */
  readonly linkId: string;
  /** The agency, only when VisaStack has reviewed it (ACTIVE); otherwise an unnamed agency. */
  readonly agency: BrandSnapshot | null;
  readonly expiresAt: Date;
}

/**
 * The neutral view of an open link, or null for every link that is not open (unknown, expired,
 * revoked, replaced, ended, suspended agency, removed issuer): the same answer for all of them.
 * Records when the link was last opened.
 */
export async function openCollectionLink(
  db: Db,
  proof: CollectionLinkProof,
  now: Date = new Date(),
): Promise<PublicCollectionView | null> {
  if (!CollectionLinkProof.isGenuine(proof)) return null;
  const open = await openLinkFor(db, proof, now);
  if (!open) return null;
  const updated = first(
    await db
      .update(schema.agencyCollectionLinks)
      .set({ lastOpenedAt: now })
      .where(eq(schema.agencyCollectionLinks.id, open.linkId))
      .returning({ expiresAt: schema.agencyCollectionLinks.expiresAt }),
  );
  if (!updated) return null;
  const { brand } = await organizationBrand(db, open.organizationId);
  return { linkId: open.linkId, agency: brand, expiresAt: updated.expiresAt };
}

/**
 * Whether the link a queued email carries is still open and is the one the email was queued for.
 * The notification worker asks this at send time, so an email about a revoked, replaced or expired
 * link is never sent.
 */
export async function collectionLinkStillOpen(
  db: Db,
  proof: CollectionLinkProof,
  linkId: string,
  now: Date = new Date(),
): Promise<boolean> {
  if (!CollectionLinkProof.isGenuine(proof)) return false;
  const open = await openLinkFor(db, proof, now);
  return open !== null && open.linkId === linkId;
}
