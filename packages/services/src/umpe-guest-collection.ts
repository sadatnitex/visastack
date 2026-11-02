import { randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { type Result, err, ok } from '@visastack/core';
import { type SQL, and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { CollectionLinkProof } from './access/collection-scope';
import {
  GuestCodeDeliveryProof,
  GuestCollectionSessionProof,
  guestCodeHash,
  normalizeGuestCode,
} from './access/guest-collection';
import { appendAuditEvent } from './audit';
import { readOrganizationLogo } from './branding';
import { type Db, first, schema } from './db';
import { isEmailAddress } from './email-address';
import { type ServiceError, serviceError } from './errors';
import { queueInvitationEmail } from './invitation-email';
import { generateInvitationToken, hashInvitationToken } from './invitation-tokens';
import { isMissingRelationError } from './missing-relation';
import { cancelQueuedNotificationsForResource } from './notifications';
import { OPEN_ORGANIZATION_STATUSES } from './organization-admission';
import type { KeyManagementPort } from './ports';
import { RATE_LIMITS, checkRateLimits } from './rate-limit';
import type { BlobStore } from './storage';
import {
  type BrandSnapshot,
  type CollectionItem,
  parseBrandSnapshot,
  parseItems,
  revisionContentSha256,
} from './umpe-collection-request-items';
import { openCollectionLink } from './umpe-collection-request-service';
import { agencyCollectionRequestsEnabled } from './umpe-collection-request-switch';

/**
 * The guest desk of an agency document request (UMPE P8, ADR 0026 D4): someone answers an
 * agency's request with no VisaStack account. Nothing here creates or reads an account, applicant,
 * case, grant or document. A guest gets a bounded, request-scoped desk session instead:
 *
 * - Opening an open link starts an unverified session (the link token never reaches the cookie;
 *   only a fresh random session id does, and only its SHA-256 is stored). Unverified, the desk
 *   shows only who is asking, and only for an agency VisaStack has reviewed.
 * - The guest proves they are the intended recipient with a six-digit code sent to the email
 *   address the agency entered for that link (never one the visitor types). A link without one has
 *   no guest path. Codes are salted hashes, live 10 minutes, allow 5 tries, and are counted per
 *   link and per network address. A correct code rotates the session id.
 * - A verified session shows the exact checklist that link issued and holds the guest's pending
 *   submission (P8: the retention choice only; files arrive with P9).
 * - Every read re-checks, live, that the session is not revoked, not idle for 30 minutes and not
 *   past its 12 hour end, and that its link is still open by the same rules the public link page
 *   uses: so revoking, replacing or ending the request, or suspending the agency, ends it at once.
 *
 * Anything refused reads exactly like something missing.
 */

export const GUEST_SESSION_IDLE_MS = 30 * 60 * 1000;
export const GUEST_SESSION_MAX_MS = 12 * 60 * 60 * 1000;
export const GUEST_CODE_TTL_MS = 10 * 60 * 1000;
export const GUEST_CODE_MAX_ATTEMPTS = 5;
/**
 * Over a link's whole life, at most this many codes are sent and this many wrong tries made (on
 * top of the hourly limits). Past either, the guest path of that link is closed for good and the
 * guest is told to ask the agency for a new link: a forwarded link cannot be used to guess codes
 * for two weeks or to flood the recipient's inbox.
 */
export const GUEST_LINK_MAX_CODES = 20;
export const GUEST_LINK_MAX_WRONG_TRIES = 25;
/** Sessions of a link that ended this long ago are removed when the link next opens. */
const GUEST_SESSION_KEEP_AFTER_END_MS = 24 * 60 * 60 * 1000;

/**
 * How long, after the request closes, the guest lets the agency keep their files (owner, 2 Nov).
 * Nothing is preselected; a legal hold overrides the choice.
 */
export const GUEST_RETENTION_DAYS = [3, 7, 15, 30, 60, 90, 180] as const;
export type GuestRetentionDays = (typeof GUEST_RETENTION_DAYS)[number];

export function isGuestRetentionDays(value: unknown): value is GuestRetentionDays {
  return (GUEST_RETENTION_DAYS as readonly unknown[]).includes(value);
}

function missing(): ServiceError {
  return serviceError('not_found', 'no such document request');
}

/** A live session and the open link it belongs to. Never leaves this module. */
interface LiveSession {
  readonly sessionId: string;
  readonly linkId: string;
  readonly requestId: string;
  readonly revisionId: string;
  readonly organizationId: string;
  readonly verified: boolean;
  readonly emailHint: string | null;
}

/**
 * The link is open (the public link page's rule): not revoked, replaced or expired, its request
 * still sent, and the session is bound to that link's own request and revision.
 */
function openLinkJoin(now: Date): SQL | undefined {
  return and(
    isNull(schema.agencyCollectionLinks.revokedAt),
    isNull(schema.agencyCollectionLinks.replacedById),
    gt(schema.agencyCollectionLinks.expiresAt, now),
    eq(schema.agencyCollectionRequests.status, 'SENT'),
    eq(schema.agencyCollectionGuestSessions.requestId, schema.agencyCollectionLinks.requestId),
    eq(schema.agencyCollectionGuestSessions.revisionId, schema.agencyCollectionLinks.revisionId),
  );
}

/** The session is live: not revoked, not past its end, not idle too long. */
function liveSessionFilter(now: Date): SQL | undefined {
  return and(
    isNull(schema.agencyCollectionGuestSessions.revokedAt),
    gt(schema.agencyCollectionGuestSessions.expiresAt, now),
    gt(
      schema.agencyCollectionGuestSessions.lastSeenAt,
      new Date(now.getTime() - GUEST_SESSION_IDLE_MS),
    ),
  );
}

/**
 * The live session `match` names, with its open link, or null. Also null while the new tables are
 * missing (the migration runs after the merge).
 */
async function findLiveSession(db: Db, match: SQL, now: Date): Promise<LiveSession | null> {
  // Turning the switch off stops every desk at once, not only new ones.
  if (!agencyCollectionRequestsEnabled()) return null;
  let row:
    | {
        sessionId: string;
        linkId: string;
        requestId: string;
        revisionId: string;
        verifiedAt: Date | null;
        emailHint: string | null;
        createdBy: string | null;
        organizationId: string;
        orgStatus: string;
      }
    | undefined;
  try {
    row = first(
      await db
        .select({
          sessionId: schema.agencyCollectionGuestSessions.id,
          linkId: schema.agencyCollectionLinks.id,
          requestId: schema.agencyCollectionLinks.requestId,
          revisionId: schema.agencyCollectionLinks.revisionId,
          verifiedAt: schema.agencyCollectionGuestSessions.verifiedAt,
          emailHint: schema.agencyCollectionLinks.recipientEmailHint,
          createdBy: schema.agencyCollectionLinks.createdByAccountId,
          organizationId: schema.agencyCollectionRequests.organizationId,
          orgStatus: schema.organizations.status,
        })
        .from(schema.agencyCollectionGuestSessions)
        .innerJoin(
          schema.agencyCollectionLinks,
          eq(schema.agencyCollectionLinks.id, schema.agencyCollectionGuestSessions.linkId),
        )
        .innerJoin(
          schema.agencyCollectionRequests,
          eq(schema.agencyCollectionRequests.id, schema.agencyCollectionLinks.requestId),
        )
        .innerJoin(
          schema.organizations,
          eq(schema.organizations.id, schema.agencyCollectionRequests.organizationId),
        )
        .where(and(match, liveSessionFilter(now), openLinkJoin(now)))
        .limit(1),
    );
  } catch (error) {
    if (isMissingRelationError(error)) return null;
    throw error;
  }
  if (!row || !OPEN_ORGANIZATION_STATUSES.includes(row.orgStatus) || !row.createdBy) return null;
  // The person who made the link must still be an active owner or admin of that agency.
  const issuer = first(
    await db
      .select({ role: schema.memberships.role, active: schema.memberships.active })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.accountId, row.createdBy),
          eq(schema.memberships.organizationId, row.organizationId),
        ),
      )
      .limit(1),
  );
  if (!issuer?.active || (issuer.role !== 'OWNER' && issuer.role !== 'ADMIN')) return null;
  return {
    sessionId: row.sessionId,
    linkId: row.linkId,
    requestId: row.requestId,
    revisionId: row.revisionId,
    organizationId: row.organizationId,
    verified: row.verifiedAt !== null,
    emailHint: row.emailHint,
  };
}

/** The live session a proof names; any use of it keeps it from going idle. */
async function liveSessionFor(
  db: Db,
  proof: GuestCollectionSessionProof,
  now: Date,
): Promise<LiveSession | null> {
  const session = await findLiveSession(
    db,
    eq(schema.agencyCollectionGuestSessions.sessionHash, proof.sessionHash),
    now,
  );
  if (session) await touch(db, session, now);
  return session;
}

/** Keep a live session from going idle. */
async function touch(db: Db, session: LiveSession, now: Date): Promise<void> {
  await db
    .update(schema.agencyCollectionGuestSessions)
    .set({ lastSeenAt: now })
    .where(
      and(
        eq(schema.agencyCollectionGuestSessions.id, session.sessionId),
        eq(schema.agencyCollectionGuestSessions.linkId, session.linkId),
      ),
    );
}

/** The agency's name, accent and whether it has a logo, only while VisaStack has reviewed it. */
async function activeBrand(
  db: Db,
  organizationId: string,
): Promise<(BrandSnapshot & { readonly hasLogo: boolean }) | null> {
  const org = first(
    await db
      .select({
        name: schema.organizations.name,
        status: schema.organizations.status,
        accentColor: schema.organizations.accentColor,
        logoObjectKey: schema.organizations.logoObjectKey,
      })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, organizationId))
      .limit(1),
  );
  if (!org || org.status !== 'ACTIVE') return null;
  return {
    name: org.name,
    accentColor: org.accentColor ?? null,
    hasLogo: org.logoObjectKey !== null,
  };
}

function audit(
  tx: Db,
  session: LiveSession,
  eventType: string,
  result: 'ALLOWED' | 'DENIED',
  metadata: Record<string, string | number | boolean> = {},
) {
  return appendAuditEvent(tx, {
    eventType,
    actorAccountId: null,
    method: 'MANUAL',
    result,
    resourceType: 'agency_collection_request',
    resourceId: session.requestId,
    metadata: { organizationId: session.organizationId, ...metadata },
  });
}

/** Whether this link's guest path is used up: too many codes sent or wrong tries made, ever. */
async function linkGuestPathSpent(db: Db, linkId: string): Promise<boolean> {
  const usage = first(
    await db
      .select({
        codes: sql<number>`count(*)::int`,
        wrong: sql<number>`coalesce(sum(${schema.agencyCollectionGuestCodes.attempts}), 0)::int`,
      })
      .from(schema.agencyCollectionGuestCodes)
      .where(eq(schema.agencyCollectionGuestCodes.linkId, linkId)),
  );
  return (
    Number(usage?.codes ?? 0) >= GUEST_LINK_MAX_CODES ||
    Number(usage?.wrong ?? 0) >= GUEST_LINK_MAX_WRONG_TRIES
  );
}

const SPENT_MESSAGE =
  'This link can no longer be opened without an account. Ask the agency for a new link.';

/** Lock this session's row for the rest of the transaction, or undefined when it is gone. */
async function lockSession(tx: Db, session: LiveSession, sessionHash: string) {
  return first(
    await tx
      .select({ id: schema.agencyCollectionGuestSessions.id })
      .from(schema.agencyCollectionGuestSessions)
      .where(
        and(
          eq(schema.agencyCollectionGuestSessions.id, session.sessionId),
          eq(schema.agencyCollectionGuestSessions.sessionHash, sessionHash),
          isNull(schema.agencyCollectionGuestSessions.revokedAt),
          isNull(schema.agencyCollectionGuestSessions.verifiedAt),
        ),
      )
      .limit(1)
      .for('update'),
  );
}

// --- Starting a desk session ---------------------------------------------------------------------

export interface StartedGuestSession {
  /** The raw session id for the cookie, only when a new session was made. */
  readonly rawSessionId: string | null;
}

/**
 * Open a link into a desk session. The link must be open (`openCollectionLink`, which also records
 * the look). When `current` already names a live session of this same link, it is kept, so opening
 * the link again on the same device keeps a verified guest verified. Otherwise a new, unverified
 * session is made; it proves nothing about who is looking. Null when the link is not open.
 */
export async function startGuestSession(
  db: Db,
  link: CollectionLinkProof,
  current: GuestCollectionSessionProof | null,
  now: Date = new Date(),
): Promise<StartedGuestSession | null> {
  if (!CollectionLinkProof.isGenuine(link)) return null;
  const view = await openCollectionLink(db, link, now);
  if (!view) return null;
  const kept =
    current && GuestCollectionSessionProof.isGenuine(current)
      ? await liveSessionFor(db, current, now)
      : null;
  if (kept && kept.linkId === view.linkId) return { rawSessionId: null };
  const linkRow = first(
    await db
      .select({
        requestId: schema.agencyCollectionLinks.requestId,
        revisionId: schema.agencyCollectionLinks.revisionId,
        organizationId: schema.agencyCollectionRequests.organizationId,
      })
      .from(schema.agencyCollectionLinks)
      .innerJoin(
        schema.agencyCollectionRequests,
        eq(schema.agencyCollectionRequests.id, schema.agencyCollectionLinks.requestId),
      )
      .where(
        and(
          eq(schema.agencyCollectionLinks.id, view.linkId),
          eq(schema.agencyCollectionLinks.tokenHash, link.tokenHash),
        ),
      )
      .limit(1),
  );
  if (!linkRow) return null;
  const rawSessionId = generateInvitationToken();
  try {
    await db.transaction(async (tx) => {
      // Sessions of this link that ended a day ago or more and never asked for a code are removed,
      // so link scanners and idle devices leave nothing behind.
      await tx.delete(schema.agencyCollectionGuestSessions).where(
        and(
          eq(schema.agencyCollectionGuestSessions.linkId, view.linkId),
          lt(
            schema.agencyCollectionGuestSessions.expiresAt,
            new Date(now.getTime() - GUEST_SESSION_KEEP_AFTER_END_MS),
          ),
          // Sessions that asked for a code stay: the link's lifetime limits count their codes.
          sql`not exists (select 1 from ${schema.agencyCollectionGuestCodes} where ${schema.agencyCollectionGuestCodes.sessionId} = ${schema.agencyCollectionGuestSessions.id})`,
        ),
      );
      const created = first(
        await tx
          .insert(schema.agencyCollectionGuestSessions)
          .values({
            sessionHash: hashInvitationToken(rawSessionId),
            linkId: view.linkId,
            requestId: linkRow.requestId,
            revisionId: linkRow.revisionId,
            createdAt: now,
            lastSeenAt: now,
            expiresAt: new Date(now.getTime() + GUEST_SESSION_MAX_MS),
          })
          .returning({ id: schema.agencyCollectionGuestSessions.id }),
      );
      if (!created) throw new Error('guest session insert returned nothing');
      await audit(
        tx,
        {
          sessionId: created.id,
          linkId: view.linkId,
          requestId: linkRow.requestId,
          revisionId: linkRow.revisionId,
          organizationId: linkRow.organizationId,
          verified: false,
          emailHint: null,
        },
        'AGENCY_COLLECTION_GUEST_SESSION_STARTED',
        'ALLOWED',
      );
    });
  } catch (error) {
    // Before the migration runs, a link opens to the neutral page with no session.
    if (isMissingRelationError(error)) return null;
    throw error;
  }
  return { rawSessionId };
}

// --- Reading the desk ----------------------------------------------------------------------------

export interface GuestDeskAgency extends BrandSnapshot {
  readonly hasLogo: boolean;
}

/** One issued checklist item as the guest sees it: exactly what the agency issued. */
export type GuestChecklistItem = Pick<
  CollectionItem,
  'id' | 'label' | 'kind' | 'necessity' | 'provenance' | 'groupKey' | 'note' | 'order'
>;

export type GuestDesk =
  | {
      readonly stage: 'landing';
      /** Only for an agency VisaStack has reviewed (ACTIVE); otherwise an unnamed agency. */
      readonly agency: GuestDeskAgency | null;
      /** False when the agency gave no email address for this link: there is no guest path. */
      readonly guestAvailable: boolean;
      /** The link's guest path is used up (too many codes or wrong tries, ever). */
      readonly guestSpent: boolean;
      /** A code was sent and can still be used. */
      readonly codePending: boolean;
    }
  | {
      readonly stage: 'verified';
      readonly agency: GuestDeskAgency | null;
      readonly revisionNo: number;
      /** Empty when the stored revision no longer matches its recorded content (never repaired). */
      readonly items: readonly GuestChecklistItem[];
      readonly intact: boolean;
      readonly retentionDays: GuestRetentionDays | null;
    };

function usableEmail(hint: string | null): string | null {
  return hint && isEmailAddress(hint) ? hint : null;
}

/**
 * What the desk may show this session, or null for every session that is not live or whose link is
 * not open (the same answer for all of them). Unverified: only the agency (when reviewed) and
 * whether a guest path exists; never the person, the route, the checklist or any account.
 * Verified: the exact checklist this link issued.
 */
export async function readGuestDesk(
  db: Db,
  proof: GuestCollectionSessionProof,
  now: Date = new Date(),
): Promise<GuestDesk | null> {
  if (!GuestCollectionSessionProof.isGenuine(proof)) return null;
  const session = await liveSessionFor(db, proof, now);
  if (!session) return null;
  const agency = await activeBrand(db, session.organizationId);
  if (!session.verified) {
    const pending = first(
      await db
        .select({ id: schema.agencyCollectionGuestCodes.id })
        .from(schema.agencyCollectionGuestCodes)
        .where(
          and(
            eq(schema.agencyCollectionGuestCodes.sessionId, session.sessionId),
            eq(schema.agencyCollectionGuestCodes.linkId, session.linkId),
            isNull(schema.agencyCollectionGuestCodes.consumedAt),
            gt(schema.agencyCollectionGuestCodes.expiresAt, now),
            lt(schema.agencyCollectionGuestCodes.attempts, GUEST_CODE_MAX_ATTEMPTS),
          ),
        )
        .limit(1),
    );
    return {
      stage: 'landing',
      agency,
      guestAvailable: usableEmail(session.emailHint) !== null,
      guestSpent: await linkGuestPathSpent(db, session.linkId),
      codePending: pending !== undefined,
    };
  }
  const revision = first(
    await db
      .select()
      .from(schema.agencyCollectionRequestRevisions)
      .where(
        and(
          eq(schema.agencyCollectionRequestRevisions.id, session.revisionId),
          eq(schema.agencyCollectionRequestRevisions.requestId, session.requestId),
        ),
      )
      .limit(1),
  );
  if (!revision) return null;
  const items = parseItems(revision.items);
  const brand = parseBrandSnapshot(revision.brandSnapshot);
  const intact =
    items !== null &&
    brand !== 'invalid' &&
    revisionContentSha256({
      requestId: revision.requestId,
      revisionNo: revision.revisionNo,
      packVersionId: revision.packVersionId,
      packChecksum: revision.packChecksum,
      items,
      brandSnapshot: brand,
    }) === revision.contentSha256;
  const draft = first(
    await db
      .select({ retentionDays: schema.agencyCollectionGuestDrafts.retentionDays })
      .from(schema.agencyCollectionGuestDrafts)
      .where(
        and(
          eq(schema.agencyCollectionGuestDrafts.linkId, session.linkId),
          eq(schema.agencyCollectionGuestDrafts.revisionId, session.revisionId),
        ),
      )
      .limit(1),
  );
  const retention = draft?.retentionDays ?? null;
  return {
    stage: 'verified',
    agency,
    revisionNo: revision.revisionNo,
    intact,
    items:
      intact && items
        ? [...items]
            .sort((a, b) => a.order - b.order)
            .map((item) => ({
              id: item.id,
              label: item.label,
              kind: item.kind,
              necessity: item.necessity,
              provenance: item.provenance,
              groupKey: item.groupKey,
              note: item.note,
              order: item.order,
            }))
        : [],
    retentionDays: isGuestRetentionDays(retention) ? retention : null,
  };
}

/** The reviewed agency's logo for a live desk session, or undefined. */
export async function readGuestDeskLogo(
  db: Db,
  storage: Pick<BlobStore, 'getObject'>,
  proof: GuestCollectionSessionProof,
  now: Date = new Date(),
): Promise<{ readonly bytes: Uint8Array; readonly contentType: string } | undefined> {
  if (!GuestCollectionSessionProof.isGenuine(proof)) return undefined;
  const session = await liveSessionFor(db, proof, now);
  if (!session) return undefined;
  const agency = await activeBrand(db, session.organizationId);
  if (!agency?.hasLogo) return undefined;
  return readOrganizationLogo(db, storage, session.organizationId);
}

// --- The one-time code ---------------------------------------------------------------------------

function sixDigits(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export type GuestCodeSent = { readonly codeId: string } | { readonly alreadyVerified: true };

/**
 * Send a new six-digit code to the email address the agency entered for this link, never one the
 * visitor gives. Any older unused code of this session stops working (and its queued email is
 * cancelled). Counted per link and per network address. The caller sends the queued email.
 */
export async function sendGuestCode(
  db: Db,
  proof: GuestCollectionSessionProof,
  input: {
    readonly encryption: KeyManagementPort;
    /** The visitor's network address as a short hash (`hashedSubject`), never the address. */
    readonly networkSubject: string;
    /** Tests only: a fixed code instead of a random one. */
    readonly generateCode?: () => string;
  },
  now: Date = new Date(),
): Promise<Result<GuestCodeSent, ServiceError>> {
  if (!GuestCollectionSessionProof.isGenuine(proof)) return err(missing());
  const session = await liveSessionFor(db, proof, now);
  if (!session) return err(missing());
  if (session.verified) return ok({ alreadyVerified: true });
  const email = usableEmail(session.emailHint);
  if (!email) {
    return err(
      serviceError('invalid', 'This request has no email address for a code. Ask the agency.'),
    );
  }
  const decision = await checkRateLimits(
    db,
    [
      {
        input: { subjectId: session.linkId, action: 'collect.guest_code_link', label: 'code' },
        config: RATE_LIMITS.COLLECTION_GUEST_CODE_LINK,
      },
      {
        input: { subjectId: input.networkSubject, action: 'collect.guest_code_ip', label: 'code' },
        config: RATE_LIMITS.COLLECTION_GUEST_CODE_IP,
      },
    ],
    now,
  );
  if (!decision.allowed) return err(serviceError('rate_limited', decision.reason));
  if (await linkGuestPathSpent(db, session.linkId))
    return err(serviceError('invalid', SPENT_MESSAGE));
  const code = (input.generateCode ?? sixDigits)();
  if (normalizeGuestCode(code) !== code) throw new Error('a guest code must be six digits');
  const codeId = randomUUID();
  const agency = await activeBrand(db, session.organizationId);
  const queued = await db.transaction(async (tx) => {
    // One code request at a time per session, so two at once cannot leave two codes open.
    if (!(await lockSession(tx, session, proof.sessionHash))) return false;
    const replaced = await tx
      .update(schema.agencyCollectionGuestCodes)
      .set({ consumedAt: now })
      .where(
        and(
          eq(schema.agencyCollectionGuestCodes.sessionId, session.sessionId),
          isNull(schema.agencyCollectionGuestCodes.consumedAt),
        ),
      )
      .returning({ id: schema.agencyCollectionGuestCodes.id });
    for (const old of replaced) await cancelQueuedNotificationsForResource(tx, old.id);
    await tx.insert(schema.agencyCollectionGuestCodes).values({
      id: codeId,
      sessionId: session.sessionId,
      linkId: session.linkId,
      codeHash: guestCodeHash(codeId, code),
      expiresAt: new Date(now.getTime() + GUEST_CODE_TTL_MS),
      createdAt: now,
    });
    await queueInvitationEmail(tx, {
      kind: 'guest_code',
      invitationId: codeId,
      organizationId: session.organizationId,
      email,
      rawToken: code,
      agencyName: agency?.name ?? null,
      encryption: input.encryption,
    });
    await audit(tx, session, 'AGENCY_COLLECTION_GUEST_CODE_SENT', 'ALLOWED', {
      codesReplaced: replaced.length,
    });
    return true;
  });
  return queued ? ok({ codeId }) : err(missing());
}

export type GuestCodeRefusal = 'wrong' | 'expired';

/**
 * Check a code. Right: the code is used up, the session becomes verified and gets a new id (the
 * caller replaces the cookie), and the guest's pending submission for this link exists. Wrong: one
 * try is counted, and the fifth wrong try ends that code. A code that is used, replaced, expired or
 * out of tries is refused as `expired` (ask for a new one). Counted per link and per address.
 */
export async function verifyGuestCode(
  db: Db,
  proof: GuestCollectionSessionProof,
  input: { readonly code: unknown; readonly networkSubject: string },
  now: Date = new Date(),
): Promise<
  Result<
    { readonly rawSessionId: string },
    ServiceError | { readonly code: GuestCodeRefusal; readonly message: string }
  >
> {
  if (!GuestCollectionSessionProof.isGenuine(proof)) return err(missing());
  const session = await liveSessionFor(db, proof, now);
  if (!session || session.verified) return err(missing());
  const decision = await checkRateLimits(
    db,
    [
      {
        input: { subjectId: session.linkId, action: 'collect.guest_verify_link', label: 'try' },
        config: RATE_LIMITS.COLLECTION_GUEST_VERIFY_LINK,
      },
      {
        input: { subjectId: input.networkSubject, action: 'collect.guest_verify_ip', label: 'try' },
        config: RATE_LIMITS.COLLECTION_GUEST_VERIFY_IP,
      },
    ],
    now,
  );
  if (!decision.allowed) return err(serviceError('rate_limited', decision.reason));
  const code = normalizeGuestCode(input.code);
  // A typo of the wrong shape is not a guess: it costs no try.
  if (code === null) {
    return err({ code: 'wrong' as const, message: 'Enter the six digits from the email.' });
  }
  if (await linkGuestPathSpent(db, session.linkId)) {
    return err({ code: 'expired' as const, message: SPENT_MESSAGE });
  }
  return db.transaction(async (tx) => {
    if (!(await lockSession(tx, session, proof.sessionHash))) return err(missing());
    const current = first(
      await tx
        .select()
        .from(schema.agencyCollectionGuestCodes)
        .where(
          and(
            eq(schema.agencyCollectionGuestCodes.sessionId, session.sessionId),
            eq(schema.agencyCollectionGuestCodes.linkId, session.linkId),
            isNull(schema.agencyCollectionGuestCodes.consumedAt),
            gt(schema.agencyCollectionGuestCodes.expiresAt, now),
            lt(schema.agencyCollectionGuestCodes.attempts, GUEST_CODE_MAX_ATTEMPTS),
          ),
        )
        .orderBy(desc(schema.agencyCollectionGuestCodes.createdAt))
        .limit(1)
        .for('update'),
    );
    if (!current) {
      await audit(tx, session, 'AGENCY_COLLECTION_GUEST_CODE_REFUSED', 'DENIED', {
        reason: 'no_open_code',
      });
      return err({
        code: 'expired' as const,
        message: 'This code has expired or was replaced. Ask for a new code.',
      });
    }
    const expected = Buffer.from(current.codeHash, 'hex');
    const given = Buffer.from(guestCodeHash(current.id, code), 'hex');
    const right = timingSafeEqual(expected, given);
    if (!right) {
      const attempts = current.attempts + 1;
      await tx
        .update(schema.agencyCollectionGuestCodes)
        .set({ attempts, ...(attempts >= GUEST_CODE_MAX_ATTEMPTS ? { consumedAt: now } : {}) })
        .where(
          and(
            eq(schema.agencyCollectionGuestCodes.id, current.id),
            eq(schema.agencyCollectionGuestCodes.sessionId, session.sessionId),
          ),
        );
      await audit(tx, session, 'AGENCY_COLLECTION_GUEST_CODE_REFUSED', 'DENIED', {
        reason: 'wrong_code',
        attempts,
      });
      const left = GUEST_CODE_MAX_ATTEMPTS - attempts;
      return err(
        left > 0
          ? {
              code: 'wrong' as const,
              message: `That code is not right. Check the newest email and try again (${left} ${left === 1 ? 'try' : 'tries'} left).`,
            }
          : {
              code: 'expired' as const,
              message: 'That code has had too many tries. Ask for a new code.',
            },
      );
    }
    await tx
      .update(schema.agencyCollectionGuestCodes)
      .set({ consumedAt: now })
      .where(eq(schema.agencyCollectionGuestCodes.id, current.id));
    const rawSessionId = generateInvitationToken();
    // Rotate: the id the visitor held before proving who they are stops working.
    const rotated = await tx
      .update(schema.agencyCollectionGuestSessions)
      .set({ sessionHash: hashInvitationToken(rawSessionId), verifiedAt: now, lastSeenAt: now })
      .where(
        and(
          eq(schema.agencyCollectionGuestSessions.id, session.sessionId),
          eq(schema.agencyCollectionGuestSessions.sessionHash, proof.sessionHash),
        ),
      )
      .returning({ id: schema.agencyCollectionGuestSessions.id });
    if (rotated.length === 0) throw new Error('guest session changed while it was verified');
    await tx
      .insert(schema.agencyCollectionGuestDrafts)
      .values({
        linkId: session.linkId,
        requestId: session.requestId,
        revisionId: session.revisionId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: schema.agencyCollectionGuestDrafts.linkId });
    await audit(tx, session, 'AGENCY_COLLECTION_GUEST_VERIFIED', 'ALLOWED');
    return ok({ rawSessionId });
  });
}

// --- The pending submission ----------------------------------------------------------------------

/**
 * Store how long the agency may keep the guest's files after the request closes. Only a verified
 * session, only one of the offered periods.
 */
export async function saveGuestRetentionChoice(
  db: Db,
  proof: GuestCollectionSessionProof,
  days: unknown,
  now: Date = new Date(),
): Promise<Result<{ readonly retentionDays: GuestRetentionDays }, ServiceError>> {
  if (!GuestCollectionSessionProof.isGenuine(proof)) return err(missing());
  const session = await liveSessionFor(db, proof, now);
  if (!session?.verified) return err(missing());
  if (!isGuestRetentionDays(days)) {
    return err(serviceError('invalid', 'Choose how long the agency may keep your files.'));
  }
  return db.transaction(async (tx) => {
    const saved = await tx
      .insert(schema.agencyCollectionGuestDrafts)
      .values({
        linkId: session.linkId,
        requestId: session.requestId,
        revisionId: session.revisionId,
        retentionDays: days,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.agencyCollectionGuestDrafts.linkId,
        set: { retentionDays: days, updatedAt: now },
        setWhere: and(
          eq(schema.agencyCollectionGuestDrafts.requestId, session.requestId),
          eq(schema.agencyCollectionGuestDrafts.revisionId, session.revisionId),
        ) as SQL,
      })
      .returning({ id: schema.agencyCollectionGuestDrafts.id });
    if (saved.length === 0) return err(missing());
    await audit(tx, session, 'AGENCY_COLLECTION_GUEST_RETENTION_CHOSEN', 'ALLOWED', {
      retentionDays: days,
    });
    return ok({ retentionDays: days });
  });
}

/** End this desk session now (the guest leaves). Nothing else changes. */
export async function endGuestSession(
  db: Db,
  proof: GuestCollectionSessionProof,
  now: Date = new Date(),
): Promise<boolean> {
  if (!GuestCollectionSessionProof.isGenuine(proof)) return false;
  const session = await liveSessionFor(db, proof, now);
  if (!session) return false;
  return db.transaction(async (tx) => {
    const ended = await tx
      .update(schema.agencyCollectionGuestSessions)
      .set({ revokedAt: now })
      .where(
        and(
          eq(schema.agencyCollectionGuestSessions.id, session.sessionId),
          eq(schema.agencyCollectionGuestSessions.sessionHash, proof.sessionHash),
          isNull(schema.agencyCollectionGuestSessions.revokedAt),
        ),
      )
      .returning({ id: schema.agencyCollectionGuestSessions.id });
    if (ended.length === 0) return false;
    await audit(tx, session, 'AGENCY_COLLECTION_GUEST_SESSION_ENDED', 'ALLOWED');
    return true;
  });
}

/**
 * Whether the code a queued email carries may still be sent: unused, unexpired, with tries left,
 * its session live and its link still open. The notification worker asks this at send time, so a
 * code for a revoked, replaced or ended request, or a replaced code, is never sent.
 */
export async function guestCodeStillDeliverable(
  db: Db,
  proof: GuestCodeDeliveryProof,
  now: Date = new Date(),
): Promise<boolean> {
  if (!GuestCodeDeliveryProof.isGenuine(proof)) return false;
  let code: { sessionId: string; linkId: string } | undefined;
  try {
    code = first(
      await db
        .select({
          sessionId: schema.agencyCollectionGuestCodes.sessionId,
          linkId: schema.agencyCollectionGuestCodes.linkId,
        })
        .from(schema.agencyCollectionGuestCodes)
        .where(
          and(
            eq(schema.agencyCollectionGuestCodes.id, proof.codeId),
            eq(schema.agencyCollectionGuestCodes.codeHash, proof.codeHash),
            isNull(schema.agencyCollectionGuestCodes.consumedAt),
            gt(schema.agencyCollectionGuestCodes.expiresAt, now),
            lt(schema.agencyCollectionGuestCodes.attempts, GUEST_CODE_MAX_ATTEMPTS),
          ),
        )
        .limit(1),
    );
  } catch (error) {
    if (isMissingRelationError(error)) return false;
    throw error;
  }
  if (!code) return false;
  const session = await findLiveSession(
    db,
    and(
      eq(schema.agencyCollectionGuestSessions.id, code.sessionId),
      eq(schema.agencyCollectionGuestSessions.linkId, code.linkId),
      isNull(schema.agencyCollectionGuestSessions.verifiedAt),
    ) as SQL,
    now,
  );
  return session !== null;
}

/**
 * The link a live desk session belongs to (its id and whether the guest is verified), for the
 * account path that shares the landing (P7). Null for anything not live.
 */
export async function guestSessionLink(
  db: Db,
  proof: GuestCollectionSessionProof,
  now: Date = new Date(),
): Promise<{ readonly linkId: string; readonly verified: boolean } | null> {
  if (!GuestCollectionSessionProof.isGenuine(proof)) return null;
  const session = await liveSessionFor(db, proof, now);
  return session ? { linkId: session.linkId, verified: session.verified } : null;
}
