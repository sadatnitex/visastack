import { type Result, err, ok } from '@visastack/core';
import { and, eq, sql } from 'drizzle-orm';
import { type Db, first, schema } from '../db';
import { type ServiceError, serviceError } from '../errors';
import { hashInvitationToken } from '../invitation-tokens';
import { isUuid } from '../lifecycle/foundation/ids';
import { OPEN_ORGANIZATION_STATUSES } from '../organization-admission';
import { getOrganization } from '../organizations';
import { agencyCollectionRequestsEnabled } from '../umpe-collection-request-switch';

/**
 * The two proofs that open the agency document request tables (UMPE P6, ADR 0026 D4). Those tables
 * carry no person column, because no person record exists yet; they are still never read without a
 * proof, and the access ratchet (`enforcement.test.ts`) holds every exported service that touches
 * them to taking one of these.
 *
 * - `AgencyCollectionScope`: an agency OWNER or ADMIN (authority `ADMIN`), or a member an owner or
 *   admin gave May Request Documents (authority `REQUESTER`, UMPE G3), acting for exactly one open
 *   organization
 *   (active or awaiting review), checked live against the membership, the organization's status and
 *   the `AGENCY_COLLECTION_REQUESTS` switch when it is made. Only
 *   `agencyCollectionPrincipal` makes one. Services call `agencyCollectionScopeProblem` first and put
 *   the scope's organization id in every WHERE.
 * - `CollectionLinkProof`: possession of a request link's raw token, the bearer secret the agency
 *   handed out. It names nothing else. Only `collectionLinkProof` makes one, and a static test
 *   allows only the public `/collect` route and the notification worker (which holds the sealed link
 *   at send time) to call it.
 *
 * Both are classes with a private constructor and a `#private` brand, like `SelfScope`: an object
 * literal or a spread copy is not one, at compile time or at run time.
 */

let mintingAgencyScope = false;
let mintAgencyScope: (
  accountId: string,
  organizationId: string,
  authority: AgencyCollectionAuthority,
) => AgencyCollectionScope;
let mintingLinkProof = false;
let mintLinkProof: (tokenHash: string) => CollectionLinkProof;

/** Not found, whatever the reason: a refused lookup must look exactly like a missing one. */
function missing(): ServiceError {
  return serviceError('not_found', 'no such document request');
}

/**
 * What an agency scope may do (UMPE G3, A18). `ADMIN`: an active owner or admin, everything the
 * request pages offer. `REQUESTER`: an active case manager or reviewer an owner or admin gave May Request Documents;
 * they may create, send and end their own requests and nothing else (never answers or files).
 */
export type AgencyCollectionAuthority = 'ADMIN' | 'REQUESTER';

/** The one capability today: create and send document requests (UMPE G3). */
export const REQUEST_DOCUMENTS_CAPABILITY = 'REQUEST_DOCUMENTS';

export class AgencyCollectionScope {
  readonly #brand = 'AgencyCollectionScope';
  readonly kind = 'agency_collection' as const;
  readonly accountId: string;
  readonly organizationId: string;
  readonly authority: AgencyCollectionAuthority;
  // A number in a private field, as in SelfScope: the check time cannot be moved.
  readonly #verifiedAtMs: number;

  private constructor(
    accountId: string,
    organizationId: string,
    authority: AgencyCollectionAuthority,
  ) {
    if (!mintingAgencyScope) {
      throw new Error('an AgencyCollectionScope can only be made by agencyCollectionPrincipal()');
    }
    this.accountId = accountId;
    this.organizationId = organizationId;
    this.authority = authority;
    this.#verifiedAtMs = Date.now();
    Object.freeze(this);
  }

  /** When the live check ran (a copy: changing it changes nothing). */
  get verifiedAt(): Date {
    return new Date(this.#verifiedAtMs);
  }

  /** Run-time check that `value` is a genuine scope, not a copy. */
  static isGenuine(value: unknown): value is AgencyCollectionScope {
    return typeof value === 'object' && value !== null && #brand in value;
  }

  static {
    mintAgencyScope = (
      accountId: string,
      organizationId: string,
      authority: AgencyCollectionAuthority,
    ): AgencyCollectionScope => {
      mintingAgencyScope = true;
      try {
        return new AgencyCollectionScope(accountId, organizationId, authority);
      } finally {
        mintingAgencyScope = false;
      }
    };
  }
}

export class CollectionLinkProof {
  readonly #brand = 'CollectionLinkProof';
  readonly kind = 'collection_link' as const;
  /** The SHA-256 of the presented token: what the link table stores. */
  readonly tokenHash: string;

  private constructor(tokenHash: string) {
    if (!mintingLinkProof) {
      throw new Error('a CollectionLinkProof can only be made by collectionLinkProof()');
    }
    this.tokenHash = tokenHash;
    Object.freeze(this);
  }

  /** Run-time check that `value` is a genuine proof, not a copy. */
  static isGenuine(value: unknown): value is CollectionLinkProof {
    return typeof value === 'object' && value !== null && #brand in value;
  }

  static {
    mintLinkProof = (tokenHash: string): CollectionLinkProof => {
      mintingLinkProof = true;
      try {
        return new CollectionLinkProof(tokenHash);
      } finally {
        mintingLinkProof = false;
      }
    };
  }
}

/** A raw link token: 32 random bytes in base64url (`generateInvitationToken`). */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/**
 * Whether the G3 permission table exists yet. Code goes live before its migration runs, and a
 * missing table means nobody holds a permission (none can have been given). `to_regclass` never
 * raises, so a caller's transaction is never disturbed. Nothing is cached.
 */
export async function memberCapabilitiesPresent(db: Db): Promise<boolean> {
  const row = first(
    await db
      .select({ present: sql<boolean>`to_regclass('agency_member_capabilities') is not null` })
      .from(sql`(select 1) as probe`),
  );
  return row?.present === true;
}

/** Whether the active member holds a capability (false before the G3 migration runs). */
async function memberHoldsCapability(
  db: Db,
  membershipId: string,
  organizationId: string,
  capability: string,
): Promise<boolean> {
  if (!(await memberCapabilitiesPresent(db))) return false;
  const row = first(
    await db
      .select({ id: schema.agencyMemberCapabilities.id })
      .from(schema.agencyMemberCapabilities)
      .where(
        and(
          eq(schema.agencyMemberCapabilities.membershipId, membershipId),
          eq(schema.agencyMemberCapabilities.organizationId, organizationId),
          eq(schema.agencyMemberCapabilities.capability, capability),
        ),
      )
      .limit(1),
  );
  return row !== undefined;
}

/**
 * The authority an account has over this agency's document requests, read live: `ADMIN` for an
 * active owner or admin, `REQUESTER` for an active member who holds May Request Documents, or null.
 * It does not look at the agency's status; callers do.
 */
export async function collectionAuthorityOf(
  db: Db,
  accountId: string,
  organizationId: string,
): Promise<AgencyCollectionAuthority | null> {
  if (!isUuid(accountId) || !isUuid(organizationId)) return null;
  const membership = first(
    await db
      .select({
        id: schema.memberships.id,
        role: schema.memberships.role,
        active: schema.memberships.active,
      })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.accountId, accountId),
          eq(schema.memberships.organizationId, organizationId),
        ),
      )
      .limit(1),
  );
  if (!membership?.active) return null;
  if (membership.role === 'OWNER' || membership.role === 'ADMIN') return 'ADMIN';
  return (await memberHoldsCapability(
    db,
    membership.id,
    organizationId,
    REQUEST_DOCUMENTS_CAPABILITY,
  ))
    ? 'REQUESTER'
    : null;
}

/**
 * Whether the person who made a link may still keep it open: an active owner or admin, or an active
 * member who still holds May Request Documents. A link of anyone else stops opening at once.
 */
export async function collectionIssuerMayIssue(
  db: Db,
  accountId: string | null,
  organizationId: string,
): Promise<boolean> {
  if (!accountId) return false;
  return (await collectionAuthorityOf(db, accountId, organizationId)) !== null;
}

/**
 * The scope of an agency OWNER or ADMIN, or of a member with May Request Documents (UMPE G3), over
 * this organization's document requests, or not found when the switch is off, the ids are
 * malformed, or the account has neither. The membership is read live on every call; nothing is
 * cached.
 */
export async function agencyCollectionPrincipal(
  db: Db,
  accountId: string,
  organizationId: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<Result<AgencyCollectionScope, ServiceError>> {
  if (!agencyCollectionRequestsEnabled(env)) return err(missing());
  if (!isUuid(accountId) || !isUuid(organizationId)) return err(missing());
  const authority = await collectionAuthorityOf(db, accountId, organizationId);
  if (!authority) return err(missing());
  // A suspended, rejected or terminated agency asks for nothing (the rule invitations follow).
  const organization = await getOrganization(db, organizationId);
  if (!organization || !OPEN_ORGANIZATION_STATUSES.includes(organization.status)) {
    return err(missing());
  }
  return ok(mintAgencyScope(accountId, organizationId, authority));
}

/** How long an agency scope stays good for: minted for one request, never kept. */
const AGENCY_SCOPE_MAX_AGE_MS = 5 * 60 * 1000;

function scopeProblem(
  scope: unknown,
  env: Readonly<Record<string, string | undefined>>,
  allowRequester: boolean,
): ServiceError | undefined {
  if (!agencyCollectionRequestsEnabled(env)) return missing();
  const age = AgencyCollectionScope.isGenuine(scope)
    ? Date.now() - scope.verifiedAt.getTime()
    : Number.NaN;
  if (!(age >= 0 && age <= AGENCY_SCOPE_MAX_AGE_MS)) return missing();
  // Deny by default: only the request services that say so take a requester's scope.
  if (!allowRequester && (scope as AgencyCollectionScope).authority !== 'ADMIN') return missing();
  return undefined;
}

/**
 * The refusal for a scope that is not a genuine, fresh owner or admin one, or undefined when it is.
 * Every service that takes an `AgencyCollectionScope` calls this (or, for creating and sending
 * requests only, `agencyCollectionRequesterScopeProblem`) first, because a type alone does not stop
 * a cast object at run time, and the switch is read again so turning it off stops work at once. A
 * member with May Request Documents is refused here exactly as a stranger is: answers, files,
 * reviews and corrections stay with owners and admins.
 */
export function agencyCollectionScopeProblem(
  scope: unknown,
  env: Readonly<Record<string, string | undefined>> = process.env,
): ServiceError | undefined {
  return scopeProblem(scope, env, false);
}

/**
 * As `agencyCollectionScopeProblem`, but a member with May Request Documents passes too (UMPE G3).
 * Only the services that create, read, send and end a request call it, and they limit a requester
 * to the requests that member created.
 */
export function agencyCollectionRequesterScopeProblem(
  scope: unknown,
  env: Readonly<Record<string, string | undefined>> = process.env,
): ServiceError | undefined {
  return scopeProblem(scope, env, true);
}

/**
 * A proof of holding a request link, or null for anything that cannot be a link token (or while
 * the switch is off). Holding a link proves nothing about who someone is: services that take this
 * show only what a link may show.
 */
export function collectionLinkProof(
  rawToken: unknown,
  env: Readonly<Record<string, string | undefined>> = process.env,
): CollectionLinkProof | null {
  if (!agencyCollectionRequestsEnabled(env)) return null;
  if (typeof rawToken !== 'string' || !TOKEN_SHAPE.test(rawToken)) return null;
  return mintLinkProof(hashInvitationToken(rawToken));
}
