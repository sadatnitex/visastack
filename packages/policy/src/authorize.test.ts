import type { AccountId, AgencyId, ApplicantId, DocumentId, MissionId } from '@visastack/core';
import { describe, expect, it } from 'vitest';
import { authorize } from './authorize';
import type { Actor, AuthContext, Grant, Resource } from './types';

// --- Branded fixtures -------------------------------------------------------
const applicant = 'app-1' as ApplicantId;
const otherApplicant = 'app-2' as ApplicantId;
const org = 'org-1' as AgencyId;
const account = 'acc-1' as AccountId;
const supportAcct = 'sup-1' as AccountId;
const missionA = 'mis-a' as MissionId;
const missionB = 'mis-b' as MissionId;
const docA = 'doc-a' as DocumentId;
const docB = 'doc-b' as DocumentId;

const PURPOSE = 'visa_application';

const owner: Actor = { kind: 'applicant_owner', applicantId: applicant };
const member: Actor = {
  kind: 'organization_member',
  accountId: account,
  membership: { organizationId: org, role: 'REVIEWER', active: true, organizationActive: true },
};
const individual: Actor = { kind: 'individual_recipient', accountId: account };

function ctx(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    now: new Date('2026-07-19T12:00:00Z'),
    purpose: PURPOSE,
    stepUpSatisfied: false,
    grants: [],
    ...overrides,
  };
}

function res(overrides: Partial<Resource> = {}): Resource {
  return { applicantId: applicant, ...overrides };
}

/** A valid, accepted, active org-scoped grant. Override to mutate one facet. */
function grant(overrides: Partial<Grant> = {}): Grant {
  return {
    applicantId: applicant,
    recipientOrganizationId: org,
    actions: ['PREVIEW'],
    purpose: PURPOSE,
    status: 'ACTIVE',
    acceptedAt: '2026-07-01T00:00:00Z',
    startAt: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

describe('authorize — applicant owner', () => {
  it('allows the owner on their own record', () => {
    expect(
      authorize({ actor: owner, action: 'VIEW_METADATA', resource: res(), context: ctx() }),
    ).toEqual({
      allowed: true,
    });
  });

  it('denies the owner on another applicant (cross-tenant)', () => {
    const d = authorize({
      actor: owner,
      action: 'VIEW_METADATA',
      resource: res({ applicantId: otherApplicant }),
      context: ctx(),
    });
    expect(d).toEqual({ allowed: false, reason: 'default_deny' });
  });

  it('requires step-up for EXPORT_PROFILE even for the owner', () => {
    expect(
      authorize({ actor: owner, action: 'EXPORT_PROFILE', resource: res(), context: ctx() }),
    ).toEqual({ allowed: false, reason: 'step_up_required' });
    expect(
      authorize({
        actor: owner,
        action: 'EXPORT_PROFILE',
        resource: res(),
        context: ctx({ stepUpSatisfied: true }),
      }),
    ).toEqual({ allowed: true });
  });
});

describe('authorize — membership is not authorization (law 2)', () => {
  it('denies a member with no grant, even for metadata', () => {
    expect(
      authorize({ actor: member, action: 'VIEW_METADATA', resource: res(), context: ctx() }),
    ).toEqual({
      allowed: false,
      reason: 'default_deny',
    });
  });

  it('denies a member whose membership was deactivated', () => {
    const inactive: Actor = {
      kind: 'organization_member',
      accountId: account,
      membership: {
        organizationId: org,
        role: 'REVIEWER',
        active: false,
        organizationActive: true,
      },
    };
    expect(
      authorize({
        actor: inactive,
        action: 'PREVIEW',
        resource: res(),
        context: ctx({ grants: [grant()] }),
      }),
    ).toEqual({ allowed: false, reason: 'grant_revoked' });
  });

  it('denies a still-active member of a suspended/closed organization (SHR-02: "termination of an organisation... denies the next request")', () => {
    const memberOfSuspendedOrg: Actor = {
      kind: 'organization_member',
      accountId: account,
      membership: {
        organizationId: org,
        role: 'REVIEWER',
        active: true,
        organizationActive: false,
      },
    };
    expect(
      authorize({
        actor: memberOfSuspendedOrg,
        action: 'PREVIEW',
        resource: res(),
        context: ctx({ grants: [grant()] }),
      }),
    ).toEqual({ allowed: false, reason: 'organization_not_active' });
  });
});

describe('authorize — individual_recipient (direct account-to-account sharing, no org)', () => {
  function directGrant(overrides: Partial<Grant> = {}): Grant {
    return {
      applicantId: applicant,
      recipientAccountId: account,
      actions: ['PREVIEW'],
      purpose: PURPOSE,
      status: 'ACTIVE',
      acceptedAt: '2026-07-01T00:00:00Z',
      startAt: '2026-07-01T00:00:00Z',
      ...overrides,
    };
  }

  it('denies with no grant at all', () => {
    expect(
      authorize({ actor: individual, action: 'VIEW_METADATA', resource: res(), context: ctx() }),
    ).toEqual({ allowed: false, reason: 'default_deny' });
  });

  it('allows once a direct grant is accepted and active — no membership/organization involved', () => {
    expect(
      authorize({
        actor: individual,
        action: 'PREVIEW',
        resource: res(),
        context: ctx({ grants: [directGrant()] }),
      }),
    ).toEqual({ allowed: true });
  });

  it('does not match a grant addressed to a different account', () => {
    const otherAccount = 'acc-2' as AccountId;
    expect(
      authorize({
        actor: individual,
        action: 'PREVIEW',
        resource: res(),
        context: ctx({ grants: [directGrant({ recipientAccountId: otherAccount })] }),
      }),
    ).toEqual({ allowed: false, reason: 'default_deny' });
  });

  it('respects revocation and expiry exactly like every other actor kind', () => {
    expect(
      authorize({
        actor: individual,
        action: 'PREVIEW',
        resource: res(),
        context: ctx({ grants: [directGrant({ status: 'REVOKED' })] }),
      }),
    ).toEqual({ allowed: false, reason: 'grant_revoked' });
  });

  it('still requires step-up for DOWNLOAD_ORIGINAL', () => {
    expect(
      authorize({
        actor: individual,
        action: 'DOWNLOAD_ORIGINAL',
        resource: res(),
        context: ctx({ grants: [directGrant({ actions: ['DOWNLOAD_ORIGINAL'] })] }),
      }),
    ).toEqual({ allowed: false, reason: 'step_up_required' });
  });
});

describe('authorize — action implication laws (3, 4)', () => {
  it('allows the exact granted action', () => {
    expect(
      authorize({
        actor: member,
        action: 'PREVIEW',
        resource: res(),
        context: ctx({ grants: [grant()] }),
      }),
    ).toEqual({ allowed: true });
  });

  it('PREVIEW grant does not imply DOWNLOAD_ORIGINAL', () => {
    expect(
      authorize({
        actor: member,
        action: 'DOWNLOAD_ORIGINAL',
        resource: res(),
        context: ctx({ grants: [grant({ actions: ['PREVIEW'] })] }),
      }),
    ).toEqual({ allowed: false, reason: 'action_not_granted' });
  });

  it('DOWNLOAD_REDACTED grant does not imply DOWNLOAD_ORIGINAL', () => {
    expect(
      authorize({
        actor: member,
        action: 'DOWNLOAD_ORIGINAL',
        resource: res(),
        context: ctx({ grants: [grant({ actions: ['DOWNLOAD_REDACTED'] })] }),
      }),
    ).toEqual({ allowed: false, reason: 'action_not_granted' });
  });
});

describe('authorize — scope (law 5)', () => {
  it('denies a mission-scoped grant on a different mission', () => {
    expect(
      authorize({
        actor: member,
        action: 'PREVIEW',
        resource: res({ missionId: missionB }),
        context: ctx({ grants: [grant({ missionId: missionA })] }),
      }),
    ).toEqual({ allowed: false, reason: 'scope_mismatch' });
  });

  it('denies a mission-scoped grant on a profile-wide (mission-less) resource', () => {
    expect(
      authorize({
        actor: member,
        action: 'PREVIEW',
        resource: res(),
        context: ctx({ grants: [grant({ missionId: missionA })] }),
      }),
    ).toEqual({ allowed: false, reason: 'scope_mismatch' });
  });

  it('allows a mission-scoped grant on the matching mission', () => {
    expect(
      authorize({
        actor: member,
        action: 'PREVIEW',
        resource: res({ missionId: missionA }),
        context: ctx({ grants: [grant({ missionId: missionA })] }),
      }),
    ).toEqual({ allowed: true });
  });

  it('enforces category allow-lists', () => {
    const g = grant({ categories: ['financial'] });
    expect(
      authorize({
        actor: member,
        action: 'PREVIEW',
        resource: res({ category: 'identity' }),
        context: ctx({ grants: [g] }),
      }),
    ).toEqual({ allowed: false, reason: 'scope_mismatch' });
    expect(
      authorize({
        actor: member,
        action: 'PREVIEW',
        resource: res({ category: 'financial' }),
        context: ctx({ grants: [g] }),
      }),
    ).toEqual({ allowed: true });
  });

  it('a category grant with a document snapshot excludes a matching-category document outside it (PRD SHR-01)', () => {
    const g = grant({ categories: ['financial'], categoryScopeDocumentIds: [docA] });
    // docB has the matching category but was never in the snapshot (e.g.
    // uploaded after the grant was created), denied, not silently absorbed.
    expect(
      authorize({
        actor: member,
        action: 'PREVIEW',
        resource: res({ category: 'financial', documentId: docB }),
        context: ctx({ grants: [g] }),
      }),
    ).toEqual({ allowed: false, reason: 'scope_mismatch' });
    // docA matches the category AND is in the snapshot: allowed.
    expect(
      authorize({
        actor: member,
        action: 'PREVIEW',
        resource: res({ category: 'financial', documentId: docA }),
        context: ctx({ grants: [g] }),
      }),
    ).toEqual({ allowed: true });
  });

  it('a category grant with no document snapshot is unaffected by it (facts, or a grant never snapshotted)', () => {
    const g = grant({ categories: ['financial'] });
    // A fact resource carries no documentId at all: the snapshot check
    // never applies to it, matching the PRD's "documents" scoping exactly.
    expect(
      authorize({
        actor: member,
        action: 'VIEW_METADATA',
        resource: res({ category: 'financial' }),
        context: ctx({
          grants: [grant({ categories: ['financial'], actions: ['VIEW_METADATA'] })],
        }),
      }),
    ).toEqual({ allowed: true });
    // A document resource, with no snapshot at all on the grant, still only
    // needs the category to match (unrestricted-by-snapshot).
    expect(
      authorize({
        actor: member,
        action: 'PREVIEW',
        resource: res({ category: 'financial', documentId: docB }),
        context: ctx({ grants: [g] }),
      }),
    ).toEqual({ allowed: true });
  });

  it('enforces document allow-lists', () => {
    const g = grant({ documentIds: [docA] });
    expect(
      authorize({
        actor: member,
        action: 'PREVIEW',
        resource: res({ documentId: docB }),
        context: ctx({ grants: [g] }),
      }),
    ).toEqual({ allowed: false, reason: 'scope_mismatch' });
    expect(
      authorize({
        actor: member,
        action: 'PREVIEW',
        resource: res({ documentId: docA }),
        context: ctx({ grants: [g] }),
      }),
    ).toEqual({ allowed: true });
  });
});

describe('authorize — grant lifecycle (laws 6, 7)', () => {
  it('denies a pending (unaccepted) grant', () => {
    expect(
      authorize({
        actor: member,
        action: 'PREVIEW',
        resource: res(),
        context: ctx({ grants: [grant({ status: 'PENDING_ACCEPTANCE' })] }),
      }),
    ).toEqual({ allowed: false, reason: 'grant_not_accepted' });
  });

  it('denies an accepted-flag-missing grant', () => {
    const g: Grant = {
      applicantId: applicant,
      recipientOrganizationId: org,
      actions: ['PREVIEW'],
      purpose: PURPOSE,
      status: 'ACTIVE',
      startAt: '2026-07-01T00:00:00Z',
    };
    expect(
      authorize({
        actor: member,
        action: 'PREVIEW',
        resource: res(),
        context: ctx({ grants: [g] }),
      }),
    ).toEqual({ allowed: false, reason: 'grant_not_accepted' });
  });

  it('denies a revoked grant', () => {
    expect(
      authorize({
        actor: member,
        action: 'PREVIEW',
        resource: res(),
        context: ctx({ grants: [grant({ status: 'REVOKED' })] }),
      }),
    ).toEqual({ allowed: false, reason: 'grant_revoked' });
  });

  it('denies a paused grant', () => {
    expect(
      authorize({
        actor: member,
        action: 'PREVIEW',
        resource: res(),
        context: ctx({ grants: [grant({ status: 'PAUSED' })] }),
      }),
    ).toEqual({ allowed: false, reason: 'grant_revoked' });
  });

  it('denies a not-yet-started grant', () => {
    expect(
      authorize({
        actor: member,
        action: 'PREVIEW',
        resource: res(),
        context: ctx({ grants: [grant({ startAt: '2026-08-01T00:00:00Z' })] }),
      }),
    ).toEqual({ allowed: false, reason: 'grant_not_started' });
  });

  it('denies an expired grant (by time window)', () => {
    expect(
      authorize({
        actor: member,
        action: 'PREVIEW',
        resource: res(),
        context: ctx({ grants: [grant({ expiryAt: '2026-07-10T00:00:00Z' })] }),
      }),
    ).toEqual({ allowed: false, reason: 'grant_expired' });
  });

  it('denies a purpose mismatch', () => {
    expect(
      authorize({
        actor: member,
        action: 'PREVIEW',
        resource: res(),
        context: ctx({ purpose: 'marketing', grants: [grant()] }),
      }),
    ).toEqual({ allowed: false, reason: 'purpose_mismatch' });
  });
});

describe('authorize — step-up (Build Spec §14)', () => {
  it('requires step-up for DOWNLOAD_ORIGINAL', () => {
    const g = grant({ actions: ['DOWNLOAD_ORIGINAL'] });
    expect(
      authorize({
        actor: member,
        action: 'DOWNLOAD_ORIGINAL',
        resource: res(),
        context: ctx({ grants: [g] }),
      }),
    ).toEqual({ allowed: false, reason: 'step_up_required' });
    expect(
      authorize({
        actor: member,
        action: 'DOWNLOAD_ORIGINAL',
        resource: res(),
        context: ctx({ stepUpSatisfied: true, grants: [g] }),
      }),
    ).toEqual({ allowed: true });
  });

  it('requires step-up to preview a restricted category', () => {
    const g = grant({ actions: ['PREVIEW'] });
    expect(
      authorize({
        actor: member,
        action: 'PREVIEW',
        resource: res({ restricted: true }),
        context: ctx({ grants: [g] }),
      }),
    ).toEqual({ allowed: false, reason: 'step_up_required' });
  });
});

describe('authorize — support/admin (law 8)', () => {
  it('denies a support admin with no just-in-time grant', () => {
    const support: Actor = { kind: 'support_admin', accountId: supportAcct };
    expect(
      authorize({ actor: support, action: 'VIEW_METADATA', resource: res(), context: ctx() }),
    ).toEqual({ allowed: false, reason: 'support_access_not_role' });
  });

  it('allows a support admin holding a valid account-scoped grant', () => {
    const support: Actor = { kind: 'support_admin', accountId: supportAcct };
    const g: Grant = {
      applicantId: applicant,
      recipientAccountId: supportAcct,
      actions: ['VIEW_METADATA'],
      purpose: PURPOSE,
      status: 'ACTIVE',
      acceptedAt: '2026-07-01T00:00:00Z',
      startAt: '2026-07-01T00:00:00Z',
    };
    expect(
      authorize({
        actor: support,
        action: 'VIEW_METADATA',
        resource: res(),
        context: ctx({ grants: [g] }),
      }),
    ).toEqual({ allowed: true });
  });
});
