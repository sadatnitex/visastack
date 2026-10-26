import type {
  AccountId,
  AgencyId,
  ApplicantId,
  DocumentId,
  MembershipRole,
  MissionId,
  PermissionAction,
} from '@visastack/core';

/**
 * Authorization types for the VisaStack policy engine.
 *
 * The engine is the authoritative decision point for applicant resources
 * (Build Spec §15) — WorkOS supplies identity, not authorization. Every
 * decision is explicit and default-deny (Build Spec §11).
 */

/** An accepted, scoped, time-bound delegation from an applicant (Build Spec §4.4). */
export type GrantStatus = 'PENDING_ACCEPTANCE' | 'ACTIVE' | 'PAUSED' | 'REVOKED' | 'EXPIRED';

export interface Grant {
  readonly applicantId: ApplicantId;
  /** Recipient is a specific account and/or an organization. */
  readonly recipientAccountId?: AccountId;
  readonly recipientOrganizationId?: AgencyId;
  /** Mission-scoped grant. Absent = applicant-wide (still category/document constrained). */
  readonly missionId?: MissionId;
  /**
   * Per-case sharing exceptions (ADR 0017): cases an all-cases grant does NOT
   * cover, because the owner said no for that one case. Meaningful only when
   * `missionId` is absent; a mission-scoped grant already covers one case.
   * Absent or empty = the grant covers every case of the applicant. Only
   * case resources are affected: documents and profile details keep their
   * own scope (law 9).
   */
  readonly excludedMissionIds?: readonly MissionId[];
  /** Category allow-list. Absent = no category constraint. */
  readonly categories?: readonly string[];
  /** Document allow-list. Absent = no document constraint. */
  readonly documentIds?: readonly DocumentId[];
  /**
   * The documents a `categories` grant actually covers, snapshotted at
   * creation (PRD SHR-01: "categories do not automatically include future
   * documents by default"). Absent = no snapshot restriction (an
   * unrestricted or `documentIds`-only grant has nothing to snapshot).
   * Meaningless without `categories` also set.
   */
  readonly categoryScopeDocumentIds?: readonly DocumentId[];
  readonly actions: readonly PermissionAction[];
  readonly purpose: string;
  readonly status: GrantStatus;
  /** ISO-8601. Recipient acceptance is required for the grant to take effect. */
  readonly acceptedAt?: string;
  /** ISO-8601 window. */
  readonly startAt: string;
  readonly expiryAt?: string;
}

export interface Membership {
  readonly organizationId: AgencyId;
  readonly role: MembershipRole;
  /** Removing/suspending a member terminates access immediately (Build Spec §2). */
  readonly active: boolean;
  /**
   * True only if the organization's own status is ACTIVE right now - SHR-02:
   * "termination of an organisation... denies the next request even with a
   * previously issued token." Independent of `active` above: a member's own
   * row can stay active while the ORGANIZATION itself is suspended or
   * closed, and neither implies the other. Callers must fetch this fresh
   * from the organization's current row, never trust a cached/mint-time
   * value, exactly like `active` itself already must be.
   */
  readonly organizationActive: boolean;
}

export type Actor =
  | { readonly kind: 'applicant_owner'; readonly applicantId: ApplicantId }
  | {
      readonly kind: 'organization_member';
      readonly accountId: AccountId;
      readonly membership: Membership;
    }
  /**
   * A grant recipient with no organization involved at all — the direct
   * account-to-account sharing path (`Grant.recipientAccountId` with no
   * `recipientOrganizationId`). Distinct from `organization_member`, which
   * requires a real `Membership` and is meaningless for a plain individual.
   */
  | { readonly kind: 'individual_recipient'; readonly accountId: AccountId }
  | { readonly kind: 'support_admin'; readonly accountId: AccountId };

export interface Resource {
  readonly applicantId: ApplicantId;
  readonly missionId?: MissionId;
  readonly documentId?: DocumentId;
  readonly category?: string;
  /** Restricted category — requires step-up for preview/download (Build Spec §14). */
  readonly restricted?: boolean;
}

export interface AuthContext {
  readonly now: Date;
  readonly purpose: string;
  /** Whether step-up authentication has been satisfied for this request. */
  readonly stepUpSatisfied: boolean;
  /** Grants visible to the actor for the target applicant. */
  readonly grants: readonly Grant[];
}

export interface AuthorizeInput {
  readonly actor: Actor;
  readonly action: PermissionAction;
  readonly resource: Resource;
  readonly context: AuthContext;
}

export type DenyReason =
  | 'default_deny'
  | 'grant_not_accepted'
  | 'grant_not_started'
  | 'grant_expired'
  | 'grant_revoked'
  | 'action_not_granted'
  | 'scope_mismatch'
  | 'purpose_mismatch'
  | 'step_up_required'
  | 'support_access_not_role'
  | 'organization_not_active';

export type Decision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: DenyReason };
