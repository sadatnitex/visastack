import { type Result, err, ok } from '@visastack/core';
import type { Db } from '../db';
import { type ServiceError, serviceError } from '../errors';
import { hashInvitationToken } from '../invitation-tokens';
import { isUuid } from '../lifecycle/foundation/ids';
import { OPEN_ORGANIZATION_STATUSES } from '../organization-admission';
import { getOrganization, isOrgAdmin } from '../organizations';
import { agencyCollectionRequestsEnabled } from '../umpe-collection-request-switch';

/**
 * The two proofs that open the agency document request tables (UMPE P6, ADR 0026 D4). Those tables
 * carry no person column, because no person record exists yet; they are still never read without a
 * proof, and the access ratchet (`enforcement.test.ts`) holds every exported service that touches
 * them to taking one of these.
 *
 * - `AgencyCollectionScope`: an agency OWNER or ADMIN acting for exactly one open organization
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
let mintAgencyScope: (accountId: string, organizationId: string) => AgencyCollectionScope;
let mintingLinkProof = false;
let mintLinkProof: (tokenHash: string) => CollectionLinkProof;

/** Not found, whatever the reason: a refused lookup must look exactly like a missing one. */
function missing(): ServiceError {
  return serviceError('not_found', 'no such document request');
}

export class AgencyCollectionScope {
  readonly #brand = 'AgencyCollectionScope';
  readonly kind = 'agency_collection' as const;
  readonly accountId: string;
  readonly organizationId: string;
  // A number in a private field, as in SelfScope: the check time cannot be moved.
  readonly #verifiedAtMs: number;

  private constructor(accountId: string, organizationId: string) {
    if (!mintingAgencyScope) {
      throw new Error('an AgencyCollectionScope can only be made by agencyCollectionPrincipal()');
    }
    this.accountId = accountId;
    this.organizationId = organizationId;
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
    mintAgencyScope = (accountId: string, organizationId: string): AgencyCollectionScope => {
      mintingAgencyScope = true;
      try {
        return new AgencyCollectionScope(accountId, organizationId);
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
 * The scope of an agency OWNER or ADMIN over this organization's document requests, or not found
 * when the switch is off, the ids are malformed, or the account is not an active OWNER or ADMIN.
 * The membership is read live on every call; nothing is cached.
 */
export async function agencyCollectionPrincipal(
  db: Db,
  accountId: string,
  organizationId: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<Result<AgencyCollectionScope, ServiceError>> {
  if (!agencyCollectionRequestsEnabled(env)) return err(missing());
  if (!isUuid(accountId) || !isUuid(organizationId)) return err(missing());
  if (!(await isOrgAdmin(db, accountId, organizationId))) return err(missing());
  // A suspended, rejected or terminated agency asks for nothing (the rule invitations follow).
  const organization = await getOrganization(db, organizationId);
  if (!organization || !OPEN_ORGANIZATION_STATUSES.includes(organization.status)) {
    return err(missing());
  }
  return ok(mintAgencyScope(accountId, organizationId));
}

/** How long an agency scope stays good for: minted for one request, never kept. */
const AGENCY_SCOPE_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * The refusal for a scope that is not a genuine, fresh one, or undefined when it is. Every service
 * that takes an `AgencyCollectionScope` calls this first, because a type alone does not stop a cast
 * object at run time, and the switch is read again so turning it off stops work at once.
 */
export function agencyCollectionScopeProblem(
  scope: unknown,
  env: Readonly<Record<string, string | undefined>> = process.env,
): ServiceError | undefined {
  if (!agencyCollectionRequestsEnabled(env)) return missing();
  const age = AgencyCollectionScope.isGenuine(scope)
    ? Date.now() - scope.verifiedAt.getTime()
    : Number.NaN;
  if (!(age >= 0 && age <= AGENCY_SCOPE_MAX_AGE_MS)) return missing();
  return undefined;
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
