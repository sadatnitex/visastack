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
  /** Category allow-list. Absent = no category constraint. */
  readonly categories?: readonly string[];
  /** Document allow-list. Absent = no document constraint. */
  readonly documentIds?: readonly DocumentId[];
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
  | 'support_access_not_role';

export type Decision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: DenyReason };
