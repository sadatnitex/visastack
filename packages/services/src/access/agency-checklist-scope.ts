import { type Result, err, ok } from '@visastack/core';
import { eq } from 'drizzle-orm';
import { type Db, first, schema } from '../db';
import { type ServiceError, serviceError } from '../errors';
import { isUuid } from '../lifecycle/foundation/ids';
import { OPEN_ORGANIZATION_STATUSES } from '../organization-admission';
import { isOrgAdmin } from '../organizations';

/**
 * The proof that lets an agency owner or admin change the agency's own country checklists
 * (Owner, 6 Nov 2026: "Make It Our Own").
 *
 * An agency checklist is a pack owned by one organization. Nothing about it is an applicant's
 * record, but it decides what that agency's travellers are asked for, so it is never changed
 * without a proof that this person, right now, is an active owner or admin of one open agency.
 * `agencyChecklistPrincipal` makes the proof, checking the membership and the organization's
 * status live. Every service that takes one calls `agencyChecklistScopeProblem` first and puts
 * the scope's organization id in every WHERE, so a list of another agency is simply not found.
 *
 * It is a class with a private constructor and a `#private` brand, like the other gates: an
 * object literal or a spread copy is not one, at compile time or at run time. It is made for one
 * page or action and never kept (five minutes at most).
 */

let minting = false;
let mint: (accountId: string, organizationId: string) => AgencyChecklistScope;

export class AgencyChecklistScope {
  readonly #brand = 'AgencyChecklistScope';
  readonly kind = 'agency_checklist' as const;
  readonly accountId: string;
  readonly organizationId: string;
  // A number in a private field, as in the other gates: the check time cannot be moved.
  readonly #verifiedAtMs: number;

  private constructor(accountId: string, organizationId: string) {
    if (!minting) {
      throw new Error('an AgencyChecklistScope can only be made by agencyChecklistPrincipal()');
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
  static isGenuine(value: unknown): value is AgencyChecklistScope {
    return typeof value === 'object' && value !== null && #brand in value;
  }

  static {
    mint = (accountId: string, organizationId: string): AgencyChecklistScope => {
      minting = true;
      try {
        return new AgencyChecklistScope(accountId, organizationId);
      } finally {
        minting = false;
      }
    };
  }
}

/** How long a scope stays good for: made for one page or action, never kept. */
const SCOPE_MAX_AGE_MS = 5 * 60 * 1000;

/** The one wording of every refusal, so a refused lookup looks exactly like a missing one. */
export const AGENCY_CHECKLIST_REFUSAL =
  'Only an owner or an admin of the agency can change its checklists.';

function refused(): ServiceError {
  return serviceError('forbidden', AGENCY_CHECKLIST_REFUSAL);
}

/**
 * The scope for this person acting for this agency, or a refusal. Live checks: the person is an
 * active OWNER or ADMIN of the organization, and the organization is open (active or awaiting
 * review). Only the agency checklist service and the agency checklist pages may call this
 * (`enforcement.test.ts`), and the pages must pass the signed-in account of `withSession`.
 */
export async function agencyChecklistPrincipal(
  db: Db,
  accountId: string,
  organizationId: string,
): Promise<Result<AgencyChecklistScope, ServiceError>> {
  if (!isUuid(accountId) || !isUuid(organizationId)) return err(refused());
  if (!(await isOrgAdmin(db, accountId, organizationId))) return err(refused());
  const org = first(
    await db
      .select({ status: schema.organizations.status })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, organizationId))
      .limit(1),
  );
  if (!org || !OPEN_ORGANIZATION_STATUSES.includes(org.status)) return err(refused());
  return ok(mint(accountId, organizationId));
}

/**
 * The refusal for a scope that is not a genuine, fresh one, or undefined when it is. Every service
 * that takes an `AgencyChecklistScope` calls this before anything else.
 */
export function agencyChecklistScopeProblem(scope: unknown): ServiceError | undefined {
  if (!AgencyChecklistScope.isGenuine(scope)) return refused();
  const age = Date.now() - scope.verifiedAt.getTime();
  if (!(age >= 0 && age <= SCOPE_MAX_AGE_MS)) return refused();
  return undefined;
}
