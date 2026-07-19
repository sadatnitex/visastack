import type { PermissionAction } from '@visastack/core';
import type {
  Actor,
  AuthContext,
  AuthorizeInput,
  Decision,
  DenyReason,
  Grant,
  Resource,
} from './types';

/**
 * The default-deny authorization decision function (Build Spec §11).
 *
 * Laws enforced (see docs/architecture/permission-model.md):
 *  1. Default deny.
 *  2. Organization membership alone never implies access.
 *  3. PREVIEW never implies DOWNLOAD_* (an action must be granted exactly).
 *  4. DOWNLOAD_REDACTED never implies DOWNLOAD_ORIGINAL.
 *  5. Mission access never implies the whole Vault/Profile.
 *  6. Expired/revoked/paused access fails the next request.
 *  7. Recipient acceptance is required.
 *  8. Support/admin access is not an ordinary role permission.
 */

const ALLOW: Decision = { allowed: true };

function deny(reason: DenyReason): Decision {
  return { allowed: false, reason };
}

/** Actions that always require step-up authentication (Build Spec §14). */
export const STEP_UP_ACTIONS: readonly PermissionAction[] = [
  'SHARE',
  'EXPORT_PROFILE',
  'DOWNLOAD_ORIGINAL',
];

function needsStepUp(action: PermissionAction, resource: Resource): boolean {
  if (STEP_UP_ACTIONS.includes(action)) return true;
  // Restricted categories require step-up for any preview/download.
  if (resource.restricted && (action === 'PREVIEW' || action.startsWith('DOWNLOAD_'))) {
    return true;
  }
  return false;
}

function evaluateGrant(
  grant: Grant,
  action: PermissionAction,
  resource: Resource,
  now: Date,
  purpose: string,
): Decision {
  // Status & acceptance (laws 6, 7).
  if (grant.status === 'REVOKED' || grant.status === 'PAUSED') return deny('grant_revoked');
  if (grant.status === 'PENDING_ACCEPTANCE' || grant.acceptedAt === undefined) {
    return deny('grant_not_accepted');
  }
  if (grant.status === 'EXPIRED') return deny('grant_expired');

  // Time window.
  if (now.getTime() < Date.parse(grant.startAt)) return deny('grant_not_started');
  if (grant.expiryAt !== undefined && now.getTime() > Date.parse(grant.expiryAt)) {
    return deny('grant_expired');
  }

  // Purpose-bound.
  if (grant.purpose !== purpose) return deny('purpose_mismatch');

  // Exact action required (laws 3, 4).
  if (!grant.actions.includes(action)) return deny('action_not_granted');

  // Scope (law 5): a mission-scoped grant authorizes only that mission and
  // never profile-wide (mission-less) resources.
  if (grant.missionId !== undefined) {
    if (resource.missionId === undefined || grant.missionId !== resource.missionId) {
      return deny('scope_mismatch');
    }
  }
  if (grant.documentIds !== undefined) {
    if (resource.documentId === undefined || !grant.documentIds.includes(resource.documentId)) {
      return deny('scope_mismatch');
    }
  }
  if (grant.categories !== undefined) {
    if (resource.category === undefined || !grant.categories.includes(resource.category)) {
      return deny('scope_mismatch');
    }
  }

  return ALLOW;
}

function evaluateGrants(
  action: PermissionAction,
  resource: Resource,
  context: AuthContext,
  recipientMatches: (grant: Grant) => boolean,
  noMatchReason: DenyReason,
): Decision {
  const candidates = context.grants.filter(
    (g) => g.applicantId === resource.applicantId && recipientMatches(g),
  );
  if (candidates.length === 0) return deny(noMatchReason);

  let lastReason: DenyReason = noMatchReason;
  for (const grant of candidates) {
    const result = evaluateGrant(grant, action, resource, context.now, context.purpose);
    if (result.allowed) return result;
    lastReason = result.reason;
  }
  return deny(lastReason);
}

function evaluateBase(
  actor: Actor,
  action: PermissionAction,
  resource: Resource,
  context: AuthContext,
): Decision {
  switch (actor.kind) {
    case 'applicant_owner': {
      // Cross-tenant guard: an owner may act only on their own record.
      if (actor.applicantId !== resource.applicantId) return deny('default_deny');
      return ALLOW;
    }
    case 'organization_member': {
      // Membership alone is never authorization (law 2). A member whose
      // access was terminated is denied even with a stale grant.
      if (!actor.membership.active) return deny('grant_revoked');
      return evaluateGrants(
        action,
        resource,
        context,
        (g) =>
          g.recipientOrganizationId === actor.membership.organizationId ||
          g.recipientAccountId === actor.accountId,
        'default_deny',
      );
    }
    case 'support_admin': {
      // Support access is never an ordinary role permission (law 8); it
      // requires an explicit just-in-time support grant.
      return evaluateGrants(
        action,
        resource,
        context,
        (g) => g.recipientAccountId === actor.accountId,
        'support_access_not_role',
      );
    }
  }
}

export function authorize(input: AuthorizeInput): Decision {
  const { actor, action, resource, context } = input;

  const base = evaluateBase(actor, action, resource, context);
  if (!base.allowed) return base;

  // Step-up gate applies even to authorized actors (Build Spec §14).
  if (needsStepUp(action, resource) && !context.stepUpSatisfied) {
    return deny('step_up_required');
  }
  return ALLOW;
}
