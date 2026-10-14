import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import type { Membership } from '@visastack/policy';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { addDocumentVersion, previewDocument, registerDocument } from './documents';
import { createMission } from './missions';
import {
  addMembership,
  createOrganization,
  listOrgMemberships,
  reviewOrganization,
  setMembershipActive,
  suspendOrganization,
} from './organizations';
import { editFact, registerFieldDefinition } from './profile';
import { RATE_LIMITS } from './rate-limit';
import {
  acceptGrant,
  createGrant,
  expandGrantScope,
  getRecipientWorkspace,
  listAccessForApplicant,
  listAccessForApplicantDetailed,
  listGrantsForRecipientAccount,
  previewScopeExpansion,
  revokeGrant,
} from './sharing';
import type { AccessRef, IssueReadRefInput, StoragePort } from './storage';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

const TEST_ACCESS_TOKEN_SECRET = 'test-access-token-secret';

class FakeStorage implements StoragePort {
  async issueReadRef(input: IssueReadRefInput): Promise<AccessRef> {
    return {
      url: `fake://${input.objectKey}`,
      expiresAt: new Date(Date.now() + 1000).toISOString(),
      disposition: input.disposition,
      variant: input.variant,
    };
  }
}

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

async function ownerWithDoc(db: Db, email: string) {
  const p = await provisionAccount(db, { email });
  if (!isOk(p)) throw new Error('provision');
  const account = p.value;
  await setConsent(db, {
    actorAccountId: account.id,
    accountId: account.id,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  await setConsent(db, {
    actorAccountId: account.id,
    accountId: account.id,
    type: 'SHARING',
    granted: true,
  });
  const applicant = await createApplicant(db, {
    actorAccountId: account.id,
    ownerAccountId: account.id,
    displayName: 'Owner',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  const doc = await registerDocument(db, {
    actorAccountId: account.id,
    applicantId: applicant.value.id,
    originalName: 'p.pdf',
  });
  if (!isOk(doc)) throw new Error('doc');
  await addDocumentVersion(db, {
    actorAccountId: account.id,
    documentId: doc.value.id,
    bucket: 'CLEAN',
    objectKey: `obj-${email}`,
    // Simulates a version that already cleared the intake pipeline — this
    // suite exercises grant/preview authorization, not the pipeline itself,
    // and previewDocument/downloadDocument now require a servable,
    // confirmed-safe version (master directive §7 "PR 3").
    safetyStatus: 'CLEAN',
    processingStatus: 'AWAITING_REVIEW',
  });
  return { account, applicantId: applicant.value.id, documentId: doc.value.id };
}

/**
 * Independently verify a PENDING_VERIFICATION org (createGrant requires an
 * ACTIVE, verified recipient organization). The reviewer is a disposable,
 * unrelated account, matching the real rule that an org can never verify
 * itself.
 */
async function activateOrg(db: Db, organizationId: string): Promise<void> {
  const reviewer = await provisionAccount(db, {
    email: `reviewer-${organizationId}@platform.example.com`,
  });
  if (!isOk(reviewer)) throw new Error('reviewer');
  const reviewed = await reviewOrganization(db, {
    reviewerAccountId: reviewer.value.id,
    organizationId,
    decision: 'ACTIVE',
    stepUpSatisfied: true,
  });
  if (!isOk(reviewed)) throw new Error('review');
}

describe('organizations — verification and membership', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('creates PENDING and cannot self-verify; an independent reviewer activates it', async () => {
    const ownerAcc = await provisionAccount(db, { email: 'orgowner@example.com' });
    if (!isOk(ownerAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: ownerAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    expect(org.value.status).toBe('PENDING_VERIFICATION');

    // A member (the owner) cannot verify their own org.
    const selfReview = await reviewOrganization(db, {
      reviewerAccountId: ownerAcc.value.id,
      organizationId: org.value.id,
      decision: 'ACTIVE',
      stepUpSatisfied: true,
    });
    expect(isErr(selfReview)).toBe(true);
    if (isErr(selfReview)) expect(selfReview.error.code).toBe('forbidden');

    const admin = await provisionAccount(db, { email: 'platform-admin@example.com' });
    if (!isOk(admin)) throw new Error('provision');
    const reviewed = await reviewOrganization(db, {
      reviewerAccountId: admin.value.id,
      organizationId: org.value.id,
      decision: 'ACTIVE',
      stepUpSatisfied: true,
    });
    expect(isOk(reviewed)).toBe(true);
    if (isOk(reviewed)) expect(reviewed.value.status).toBe('ACTIVE');

    const suspended = await suspendOrganization(db, {
      reviewerAccountId: admin.value.id,
      organizationId: org.value.id,
      stepUpSatisfied: true,
    });
    expect(isOk(suspended)).toBe(true);
  });

  it('refuses to review an organization without step-up, even for a legitimate independent reviewer (master directive §7 "PR 5")', async () => {
    const ownerAcc = await provisionAccount(db, { email: 'oo-stepup@example.com' });
    if (!isOk(ownerAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: ownerAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    const admin = await provisionAccount(db, { email: 'platform-admin-stepup@example.com' });
    if (!isOk(admin)) throw new Error('provision');

    const denied = await reviewOrganization(db, {
      reviewerAccountId: admin.value.id,
      organizationId: org.value.id,
      decision: 'ACTIVE',
      stepUpSatisfied: false,
    });
    expect(isErr(denied)).toBe(true);
    if (isErr(denied)) expect(denied.error.code).toBe('step_up_required');
    expect(
      (
        await db
          .select()
          .from(schema.organizations)
          .where(eq(schema.organizations.id, org.value.id))
      )[0]?.status,
    ).toBe('PENDING_VERIFICATION');
  });

  it('only an OWNER/ADMIN can add members', async () => {
    const ownerAcc = await provisionAccount(db, { email: 'oo@example.com' });
    const stranger = await provisionAccount(db, { email: 'stranger-o@example.com' });
    if (!isOk(ownerAcc) || !isOk(stranger)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: ownerAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    const denied = await addMembership(db, {
      actorAccountId: stranger.value.id,
      organizationId: org.value.id,
      accountId: stranger.value.id,
      role: 'CASE_MANAGER',
    });
    expect(isErr(denied)).toBe(true);
    if (isErr(denied)) expect(denied.error.code).toBe('forbidden');
  });
});

describe('sharing — grant lifecycle end-to-end with the policy engine', () => {
  let db: Db;
  let storage: FakeStorage;
  beforeEach(async () => {
    db = await freshDb();
    storage = new FakeStorage();
  });

  it('create → accept → org member can preview; revoke → denied (transparency throughout)', async () => {
    const { account, applicantId, documentId } = await ownerWithDoc(db, 'share@example.com');

    // An active agency with a case manager.
    const agentAcc = await provisionAccount(db, { email: 'agent@acme.com' });
    if (!isOk(agentAcc)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agentAcc.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);
    const orgId = org.value.id;

    // Owner grants PREVIEW to the org, purpose-bound.
    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: orgId,
      actions: ['PREVIEW'],
      purpose: 'visa_application',
    });
    expect(isOk(grant)).toBe(true);
    if (!isOk(grant)) return;

    const membership: Membership = {
      organizationId: orgId as never,
      role: 'CASE_MANAGER',
      active: true,
      organizationActive: true,
    };
    const preview = () =>
      previewDocument(db, storage, {
        actor: { kind: 'organization_member', accountId: agentAcc.value.id as never, membership },
        documentId,
        purpose: 'visa_application',
        accessTokenSecret: TEST_ACCESS_TOKEN_SECRET,
      });

    // Before acceptance: denied (grant not accepted).
    const beforeAccept = await preview();
    expect(isErr(beforeAccept)).toBe(true);

    // Accept, then access is allowed.
    const accepted = await acceptGrant(db, {
      actorAccountId: agentAcc.value.id,
      grantId: grant.value.id,
    });
    expect(isOk(accepted)).toBe(true);
    const afterAccept = await preview();
    expect(isOk(afterAccept)).toBe(true);

    // Access transparency shows the active grant to the owner.
    const access = await listAccessForApplicant(db, account.id, applicantId);
    expect(isOk(access)).toBe(true);
    if (isOk(access)) {
      expect(access.value).toHaveLength(1);
      expect(access.value[0]?.status).toBe('ACTIVE');
    }

    // Revoke → the very next request is denied.
    await revokeGrant(db, { actorAccountId: account.id, grantId: grant.value.id });
    const afterRevoke = await preview();
    expect(isErr(afterRevoke)).toBe(true);
  });

  it('refuses to create a grant handing out DOWNLOAD_ORIGINAL without step-up (master directive §7 "PR 5")', async () => {
    const { account, applicantId } = await ownerWithDoc(db, 'sensitive-owner@example.com');
    const recipient = await provisionAccount(db, { email: 'sensitive-recipient@example.com' });
    if (!isOk(recipient)) throw new Error('provision');

    const denied = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientAccountId: recipient.value.id,
      actions: ['DOWNLOAD_ORIGINAL'],
      purpose: 'visa_application',
    });
    expect(isErr(denied)).toBe(true);
    if (isErr(denied)) expect(denied.error.code).toBe('step_up_required');
  });

  it('creates a grant handing out DOWNLOAD_ORIGINAL once step-up is honestly satisfied', async () => {
    const { account, applicantId } = await ownerWithDoc(db, 'sensitive-owner-2@example.com');
    const recipient = await provisionAccount(db, { email: 'sensitive-recipient-2@example.com' });
    if (!isOk(recipient)) throw new Error('provision');

    const created = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientAccountId: recipient.value.id,
      actions: ['DOWNLOAD_ORIGINAL'],
      purpose: 'visa_application',
      stepUpSatisfied: true,
    });
    expect(isOk(created)).toBe(true);
  });

  it('never requires step-up for an ordinary grant with no sensitive actions', async () => {
    const { account, applicantId } = await ownerWithDoc(db, 'ordinary-owner@example.com');
    const recipient = await provisionAccount(db, { email: 'ordinary-recipient@example.com' });
    if (!isOk(recipient)) throw new Error('provision');

    const created = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientAccountId: recipient.value.id,
      actions: ['PREVIEW', 'COMMENT'],
      purpose: 'visa_application',
    });
    expect(isOk(created)).toBe(true);
  });

  it('defaults an omitted expiry to 30 days out, never permanent (PRD SHR-01)', async () => {
    const { account, applicantId } = await ownerWithDoc(db, 'default-duration-owner@example.com');
    const recipient = await provisionAccount(db, {
      email: 'default-duration-recipient@example.com',
    });
    if (!isOk(recipient)) throw new Error('provision');

    const created = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientAccountId: recipient.value.id,
      actions: ['PREVIEW'],
      purpose: 'visa_application',
    });
    expect(isOk(created)).toBe(true);
    if (isOk(created)) {
      const expiryAt = created.value.expiryAt;
      if (!expiryAt) throw new Error('expected a default expiry, got none');
      const daysOut = (expiryAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
      expect(daysOut).toBeGreaterThan(29.9);
      expect(daysOut).toBeLessThanOrEqual(30);
    }
  });

  it('rejects an expiry beyond the 90-day maximum initial duration (PRD SHR-01)', async () => {
    const { account, applicantId } = await ownerWithDoc(db, 'over-duration-owner@example.com');
    const recipient = await provisionAccount(db, { email: 'over-duration-recipient@example.com' });
    if (!isOk(recipient)) throw new Error('provision');

    const denied = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientAccountId: recipient.value.id,
      actions: ['PREVIEW'],
      purpose: 'visa_application',
      expiryAt: new Date(Date.now() + 91 * 24 * 60 * 60 * 1000),
    });
    expect(isErr(denied)).toBe(true);
    if (isErr(denied)) expect(denied.error.code).toBe('invalid');
  });

  it("accepts an explicit expiry within the 90-day bound, honoring the caller's own choice", async () => {
    const { account, applicantId } = await ownerWithDoc(db, 'explicit-duration-owner@example.com');
    const recipient = await provisionAccount(db, {
      email: 'explicit-duration-recipient@example.com',
    });
    if (!isOk(recipient)) throw new Error('provision');
    const requested = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);

    const created = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientAccountId: recipient.value.id,
      actions: ['PREVIEW'],
      purpose: 'visa_application',
      expiryAt: requested,
    });
    expect(isOk(created)).toBe(true);
    if (isOk(created)) {
      expect(created.value.expiryAt?.getTime()).toBe(requested.getTime());
    }
  });

  it('rejects an expiry already in the past', async () => {
    const { account, applicantId } = await ownerWithDoc(db, 'past-duration-owner@example.com');
    const recipient = await provisionAccount(db, { email: 'past-duration-recipient@example.com' });
    if (!isOk(recipient)) throw new Error('provision');

    const denied = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientAccountId: recipient.value.id,
      actions: ['PREVIEW'],
      purpose: 'visa_application',
      expiryAt: new Date(Date.now() - 1000),
    });
    expect(isErr(denied)).toBe(true);
    if (isErr(denied)) expect(denied.error.code).toBe('invalid');
  });

  it('refuses to create further grants once the anti-automation limit is hit (Build Spec §14)', async () => {
    const { account, applicantId } = await ownerWithDoc(db, 'rate-limited-owner@example.com');
    const recipient = await provisionAccount(db, { email: 'rate-limited-recipient@example.com' });
    if (!isOk(recipient)) throw new Error('provision');

    const attempt = () =>
      createGrant(db, {
        actorAccountId: account.id,
        applicantId,
        recipientAccountId: recipient.value.id,
        actions: ['PREVIEW'],
        purpose: 'visa_application',
      });

    for (let i = 0; i < RATE_LIMITS.GRANT_CREATE.limit; i++) {
      const result = await attempt();
      expect(isOk(result)).toBe(true);
    }
    const overLimit = await attempt();
    expect(isErr(overLimit)).toBe(true);
    if (isErr(overLimit)) {
      expect(overLimit.error.code).toBe('rate_limited');
    }
  });

  it('lists incoming grants for a recipient account and org members', async () => {
    const { account, applicantId } = await ownerWithDoc(db, 'inbox-owner@example.com');
    const recipient = await provisionAccount(db, { email: 'recipient@example.com' });
    if (!isOk(recipient)) throw new Error('provision');

    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientAccountId: recipient.value.id,
      actions: ['PREVIEW'],
      purpose: 'review',
    });
    if (!isOk(grant)) throw new Error('grant');

    // The recipient sees the pending grant with the subject's name.
    const incoming = await listGrantsForRecipientAccount(db, recipient.value.id);
    expect(incoming).toHaveLength(1);
    expect(incoming[0]?.grant.status).toBe('PENDING_ACCEPTANCE');
    expect(incoming[0]?.applicantName.length).toBeGreaterThan(0);

    // Org membership listing is admin-gated and resolves emails.
    const org = await createOrganization(db, { actorAccountId: account.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    const members = await listOrgMemberships(db, account.id, org.value.id);
    expect(isOk(members)).toBe(true);
    if (isOk(members)) {
      expect(members.value).toHaveLength(1);
      expect(members.value[0]?.role).toBe('OWNER');
      expect(members.value[0]?.email).toBe('inbox-owner@example.com');
    }
    // A non-member cannot list members.
    const denied = await listOrgMemberships(db, recipient.value.id, org.value.id);
    expect(isErr(denied)).toBe(true);
  });

  it('resolves a grant recipient to a human-readable identity (account email or org name)', async () => {
    const { account, applicantId } = await ownerWithDoc(db, 'recip-owner@example.com');
    const recipient = await provisionAccount(db, { email: 'recip-agent@example.com' });
    if (!isOk(recipient)) throw new Error('provision');
    const accountGrant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientAccountId: recipient.value.id,
      actions: ['PREVIEW'],
      purpose: 'review',
    });
    if (!isOk(accountGrant)) throw new Error('grant');

    const org = await createOrganization(db, { actorAccountId: account.id, name: 'Acme Travel' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);
    const orgGrant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['PREVIEW'],
      purpose: 'visa_application',
    });
    if (!isOk(orgGrant)) throw new Error('grant');

    const detailed = await listAccessForApplicantDetailed(db, account.id, applicantId);
    expect(isOk(detailed)).toBe(true);
    if (!isOk(detailed)) return;
    const byId = new Map(detailed.value.map((g) => [g.id, g.recipient]));
    expect(byId.get(accountGrant.value.id)).toEqual({
      kind: 'account',
      label: 'recip-agent@example.com',
    });
    expect(byId.get(orgGrant.value.id)).toEqual({ kind: 'organization', label: 'Acme Travel' });
  });

  it('only the recipient can accept, and only the owner can create/revoke', async () => {
    const { account, applicantId } = await ownerWithDoc(db, 'share2@example.com');
    const other = await provisionAccount(db, { email: 'other-share@example.com' });
    if (!isOk(other)) throw new Error('provision');

    // A non-owner cannot create a grant.
    const badCreate = await createGrant(db, {
      actorAccountId: other.value.id,
      applicantId,
      recipientAccountId: other.value.id,
      actions: ['PREVIEW'],
      purpose: 'x',
    });
    expect(isErr(badCreate)).toBe(true);
    if (isErr(badCreate)) expect(badCreate.error.code).toBe('forbidden');

    // Owner creates a grant to a specific account; a stranger cannot accept it.
    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientAccountId: other.value.id,
      actions: ['PREVIEW'],
      purpose: 'x',
    });
    if (!isOk(grant)) throw new Error('grant');
    const stranger = await provisionAccount(db, { email: 'stranger2@example.com' });
    if (!isOk(stranger)) throw new Error('provision');
    const badAccept = await acceptGrant(db, {
      actorAccountId: stranger.value.id,
      grantId: grant.value.id,
    });
    expect(isErr(badAccept)).toBe(true);
    if (isErr(badAccept)) expect(badAccept.error.code).toBe('forbidden');
  });
});

describe('getRecipientWorkspace — the actual permission-filtered read path (Release G)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  async function ownerWithFieldAndDoc(db: Db, email: string) {
    const { account, applicantId, documentId } = await ownerWithDoc(db, email);
    await registerFieldDefinition(db, {
      key: 'given_name',
      dataType: 'string',
      sensitivity: 'STANDARD',
      packId: 'universal',
    });
    const edit = await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'given_name',
      value: 'Anna',
    });
    if (!isOk(edit)) throw new Error('edit');
    return { account, applicantId, documentId };
  }

  it('a direct (individual, non-org) recipient sees exactly what their grant permits — the primary share-by-email path', async () => {
    const { account, applicantId } = await ownerWithFieldAndDoc(db, 'recipient-owner@example.com');
    const recipient = await provisionAccount(db, { email: 'recipient@example.com' });
    if (!isOk(recipient)) throw new Error('provision');

    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientAccountId: recipient.value.id,
      actions: ['VIEW_METADATA', 'PREVIEW'],
      purpose: 'visa_application',
    });
    if (!isOk(grant)) throw new Error('grant');

    // Before acceptance: no workspace.
    const beforeAccept = await getRecipientWorkspace(db, {
      actorAccountId: recipient.value.id,
      grantId: grant.value.id,
    });
    expect(isErr(beforeAccept)).toBe(true);

    const accepted = await acceptGrant(db, {
      actorAccountId: recipient.value.id,
      grantId: grant.value.id,
    });
    expect(isOk(accepted)).toBe(true);

    const workspace = await getRecipientWorkspace(db, {
      actorAccountId: recipient.value.id,
      grantId: grant.value.id,
    });
    expect(isOk(workspace)).toBe(true);
    if (!isOk(workspace)) return;
    expect(workspace.value.applicantDisplayName).toBe('Owner');
    expect(workspace.value.fields).toEqual([
      { fieldKey: 'given_name', value: 'Anna', status: 'APPLICANT_CONFIRMED' },
    ]);
    expect(workspace.value.documents).toHaveLength(1);
    expect(workspace.value.missionScopeUnavailable).toBe(false);
  });

  it('a stranger (not the grant recipient) cannot open the workspace', async () => {
    const { account, applicantId } = await ownerWithFieldAndDoc(db, 'ro2@example.com');
    const recipient = await provisionAccount(db, { email: 'r2@example.com' });
    const stranger = await provisionAccount(db, { email: 's2@example.com' });
    if (!isOk(recipient) || !isOk(stranger)) throw new Error('provision');
    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientAccountId: recipient.value.id,
      actions: ['VIEW_METADATA'],
      purpose: 'p',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: recipient.value.id, grantId: grant.value.id });

    const result = await getRecipientWorkspace(db, {
      actorAccountId: stranger.value.id,
      grantId: grant.value.id,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('forbidden');
  });

  it('an org-mediated recipient sees the same data via a real membership', async () => {
    const { account, applicantId } = await ownerWithFieldAndDoc(db, 'ro3@example.com');
    const agent = await provisionAccount(db, { email: 'agent3@example.com' });
    if (!isOk(agent)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agent.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);
    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['VIEW_METADATA', 'PREVIEW'],
      purpose: 'p',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agent.value.id, grantId: grant.value.id });

    const workspace = await getRecipientWorkspace(db, {
      actorAccountId: agent.value.id,
      grantId: grant.value.id,
    });
    expect(isOk(workspace)).toBe(true);
    if (!isOk(workspace)) return;
    expect(workspace.value.fields).toHaveLength(1);
    expect(workspace.value.documents).toHaveLength(1);
  });

  it('an org member whose membership was deactivated loses workspace access', async () => {
    const { account, applicantId } = await ownerWithFieldAndDoc(db, 'ro4@example.com');
    const agent = await provisionAccount(db, { email: 'agent4@example.com' });
    if (!isOk(agent)) throw new Error('provision');
    const org = await createOrganization(db, { actorAccountId: agent.value.id, name: 'Acme' });
    if (!isOk(org)) throw new Error('org');
    await activateOrg(db, org.value.id);
    // A second OWNER, so deactivating `agent`'s membership below does not
    // trip the last-active-owner protection (setMembershipActive) — this
    // test is about workspace access, not owner-safety, which is covered
    // separately in organizations.test.ts.
    const coOwner = await provisionAccount(db, { email: 'agent4-co-owner@example.com' });
    if (!isOk(coOwner)) throw new Error('provision');
    await addMembership(db, {
      actorAccountId: agent.value.id,
      organizationId: org.value.id,
      accountId: coOwner.value.id,
      role: 'OWNER',
    });
    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientOrganizationId: org.value.id,
      actions: ['VIEW_METADATA'],
      purpose: 'p',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: agent.value.id, grantId: grant.value.id });

    const members = await listOrgMemberships(db, agent.value.id, org.value.id);
    if (!isOk(members)) throw new Error('members');
    const membership = members.value.find((m) => m.accountId === agent.value.id);
    if (!membership) throw new Error('membership not found');
    const deactivated = await setMembershipActive(db, {
      actorAccountId: agent.value.id,
      organizationId: org.value.id,
      membershipId: membership.membershipId,
      active: false,
    });
    expect(isOk(deactivated)).toBe(true);

    const result = await getRecipientWorkspace(db, {
      actorAccountId: agent.value.id,
      grantId: grant.value.id,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('forbidden');
  });

  it('categories scope which fields are visible (pack allow-list)', async () => {
    const { account, applicantId } = await ownerWithFieldAndDoc(db, 'ro5@example.com');
    await registerFieldDefinition(db, {
      key: 'company_name',
      dataType: 'string',
      sensitivity: 'STANDARD',
      packId: 'business',
    });
    await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'company_name',
      value: 'Acme Corp',
    });
    const recipient = await provisionAccount(db, { email: 'r5@example.com' });
    if (!isOk(recipient)) throw new Error('provision');
    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientAccountId: recipient.value.id,
      actions: ['VIEW_METADATA'],
      purpose: 'p',
      categories: ['universal'],
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: recipient.value.id, grantId: grant.value.id });

    const workspace = await getRecipientWorkspace(db, {
      actorAccountId: recipient.value.id,
      grantId: grant.value.id,
    });
    expect(isOk(workspace)).toBe(true);
    if (!isOk(workspace)) return;
    // Only the universal-pack field is visible; the business-pack field is scoped out.
    expect(workspace.value.fields.map((f) => f.fieldKey)).toEqual(['given_name']);
  });

  it('accepts the new catalogue categories, shows only fields filed under them, and still refuses made-up names', async () => {
    const { account, applicantId } = await ownerWithFieldAndDoc(db, 'ro5b@example.com');
    await registerFieldDefinition(db, {
      key: 'course_name',
      dataType: 'string',
      sensitivity: 'STANDARD',
      packId: 'study',
    });
    await editFact(db, {
      actorAccountId: account.id,
      applicantId,
      fieldKey: 'course_name',
      value: 'MSc Data Science',
    });
    const recipient = await provisionAccount(db, { email: 'r5b@example.com' });
    if (!isOk(recipient)) throw new Error('provision');
    const base = {
      actorAccountId: account.id,
      applicantId,
      recipientAccountId: recipient.value.id,
      actions: ['VIEW_METADATA' as const],
      purpose: 'p',
    };

    const madeUp = await createGrant(db, { ...base, categories: ['made_up'] });
    expect(isErr(madeUp)).toBe(true);

    const studyGrant = await createGrant(db, { ...base, categories: ['study'] });
    if (!isOk(studyGrant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: recipient.value.id, grantId: studyGrant.value.id });
    const workspace = await getRecipientWorkspace(db, {
      actorAccountId: recipient.value.id,
      grantId: studyGrant.value.id,
    });
    expect(isOk(workspace)).toBe(true);
    if (!isOk(workspace)) return;
    // Only the study-pack field is visible; the universal name is not shared.
    expect(workspace.value.fields.map((f) => f.fieldKey)).toEqual(['course_name']);
  });

  it('documentIds scope which documents are visible', async () => {
    const { account, applicantId, documentId } = await ownerWithFieldAndDoc(db, 'ro6@example.com');
    // A second, unlisted document.
    const doc2 = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId,
      originalName: 'second.pdf',
    });
    if (!isOk(doc2)) throw new Error('doc2');
    await addDocumentVersion(db, {
      actorAccountId: account.id,
      documentId: doc2.value.id,
      bucket: 'CLEAN',
      objectKey: 'obj-second',
    });

    const recipient = await provisionAccount(db, { email: 'r6@example.com' });
    if (!isOk(recipient)) throw new Error('provision');
    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientAccountId: recipient.value.id,
      actions: ['PREVIEW'],
      purpose: 'p',
      documentIds: [documentId],
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: recipient.value.id, grantId: grant.value.id });

    const workspace = await getRecipientWorkspace(db, {
      actorAccountId: recipient.value.id,
      grantId: grant.value.id,
    });
    expect(isOk(workspace)).toBe(true);
    if (!isOk(workspace)) return;
    expect(workspace.value.documents.map((d) => d.id)).toEqual([documentId]);
  });

  it('a mission-scoped grant surfaces nothing and flags missionScopeUnavailable (fail closed, not fake)', async () => {
    const { account, applicantId } = await ownerWithFieldAndDoc(db, 'ro7@example.com');
    const recipient = await provisionAccount(db, { email: 'r7@example.com' });
    if (!isOk(recipient)) throw new Error('provision');
    // A real mission row is required (FK), but no fact/document ever carries
    // a missionId regardless — the scoping still fails closed with real data.
    const mission = await createMission(db, {
      actorAccountId: account.id,
      applicantId,
      title: 'UK Student Visa',
    });
    if (!isOk(mission)) throw new Error('mission');
    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientAccountId: recipient.value.id,
      actions: ['VIEW_METADATA', 'PREVIEW'],
      purpose: 'p',
      missionId: mission.value.id,
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: recipient.value.id, grantId: grant.value.id });

    const workspace = await getRecipientWorkspace(db, {
      actorAccountId: recipient.value.id,
      grantId: grant.value.id,
    });
    expect(isOk(workspace)).toBe(true);
    if (!isOk(workspace)) return;
    expect(workspace.value.fields).toEqual([]);
    expect(workspace.value.documents).toEqual([]);
    expect(workspace.value.missionScopeUnavailable).toBe(true);
  });

  it('revoking the grant immediately blocks the workspace on the next call', async () => {
    const { account, applicantId } = await ownerWithFieldAndDoc(db, 'ro8@example.com');
    const recipient = await provisionAccount(db, { email: 'r8@example.com' });
    if (!isOk(recipient)) throw new Error('provision');
    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientAccountId: recipient.value.id,
      actions: ['VIEW_METADATA'],
      purpose: 'p',
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: recipient.value.id, grantId: grant.value.id });

    const before = await getRecipientWorkspace(db, {
      actorAccountId: recipient.value.id,
      grantId: grant.value.id,
    });
    expect(isOk(before)).toBe(true);

    await revokeGrant(db, { actorAccountId: account.id, grantId: grant.value.id });

    const after = await getRecipientWorkspace(db, {
      actorAccountId: recipient.value.id,
      grantId: grant.value.id,
    });
    expect(isErr(after)).toBe(true);
    if (isErr(after)) expect(after.error.code).toBe('forbidden');
  });
});

describe('category scope snapshotting and explicit expansion (PRD SHR-01, AD-11)', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  /** Owner with one PASSPORT document (category "universal") already uploaded. */
  async function ownerWithPassport(db: Db, email: string) {
    const p = await provisionAccount(db, { email });
    if (!isOk(p)) throw new Error('provision');
    const account = p.value;
    await setConsent(db, {
      actorAccountId: account.id,
      accountId: account.id,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    await setConsent(db, {
      actorAccountId: account.id,
      accountId: account.id,
      type: 'SHARING',
      granted: true,
    });
    const applicant = await createApplicant(db, {
      actorAccountId: account.id,
      ownerAccountId: account.id,
      displayName: 'Owner',
    });
    if (!isOk(applicant)) throw new Error('applicant');
    const doc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId: applicant.value.id,
      originalName: 'passport.pdf',
      docType: 'PASSPORT',
    });
    if (!isOk(doc)) throw new Error('doc');
    return { account, applicantId: applicant.value.id, existingDocumentId: doc.value.id };
  }

  it('snapshots the current matching documents at creation; a document uploaded afterward is never silently included', async () => {
    const { account, applicantId, existingDocumentId } = await ownerWithPassport(
      db,
      'scope-owner@example.com',
    );
    const recipient = await provisionAccount(db, { email: 'scope-recipient@example.com' });
    if (!isOk(recipient)) throw new Error('provision');

    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientAccountId: recipient.value.id,
      actions: ['VIEW_METADATA', 'PREVIEW'],
      purpose: 'p',
      categories: ['universal'],
    });
    if (!isOk(grant)) throw new Error('grant');
    expect(grant.value.documentScopeSnapshot).toEqual([existingDocumentId]);
    await acceptGrant(db, { actorAccountId: recipient.value.id, grantId: grant.value.id });

    const before = await getRecipientWorkspace(db, {
      actorAccountId: recipient.value.id,
      grantId: grant.value.id,
    });
    expect(isOk(before)).toBe(true);
    if (isOk(before)) expect(before.value.documents.map((d) => d.id)).toEqual([existingDocumentId]);

    // A second PASSPORT document, uploaded AFTER the grant already exists:
    // matches the same category live, but must not appear automatically.
    const laterDoc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId,
      originalName: 'passport-renewed.pdf',
      docType: 'PASSPORT',
    });
    if (!isOk(laterDoc)) throw new Error('doc');

    const after = await getRecipientWorkspace(db, {
      actorAccountId: recipient.value.id,
      grantId: grant.value.id,
    });
    expect(isOk(after)).toBe(true);
    if (isOk(after)) {
      expect(after.value.documents.map((d) => d.id)).toEqual([existingDocumentId]);
      expect(after.value.documents.some((d) => d.id === laterDoc.value.id)).toBe(false);
    }
  });

  it('previewScopeExpansion lists only the newly matching, not-yet-included document', async () => {
    const { account, applicantId } = await ownerWithPassport(db, 'preview-owner@example.com');
    const recipient = await provisionAccount(db, { email: 'preview-recipient@example.com' });
    if (!isOk(recipient)) throw new Error('provision');
    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientAccountId: recipient.value.id,
      actions: ['VIEW_METADATA'],
      purpose: 'p',
      categories: ['universal'],
    });
    if (!isOk(grant)) throw new Error('grant');

    // Nothing new yet: the only matching document is already in the snapshot.
    const nothingYet = await previewScopeExpansion(db, {
      actorAccountId: account.id,
      grantId: grant.value.id,
    });
    expect(isOk(nothingYet)).toBe(true);
    if (isOk(nothingYet)) expect(nothingYet.value).toEqual([]);

    const laterDoc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId,
      originalName: 'passport-renewed.pdf',
      docType: 'PASSPORT',
    });
    if (!isOk(laterDoc)) throw new Error('doc');

    const candidates = await previewScopeExpansion(db, {
      actorAccountId: account.id,
      grantId: grant.value.id,
    });
    expect(isOk(candidates)).toBe(true);
    if (isOk(candidates)) {
      expect(candidates.value.map((c) => c.id)).toEqual([laterDoc.value.id]);
      expect(candidates.value[0]?.displayName).toBe('passport-renewed.pdf');
    }
  });

  it('expandGrantScope adds a confirmed candidate, which then becomes visible to the recipient', async () => {
    const { account, applicantId } = await ownerWithPassport(db, 'expand-owner@example.com');
    const recipient = await provisionAccount(db, { email: 'expand-recipient@example.com' });
    if (!isOk(recipient)) throw new Error('provision');
    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientAccountId: recipient.value.id,
      actions: ['VIEW_METADATA', 'PREVIEW'],
      purpose: 'p',
      categories: ['universal'],
    });
    if (!isOk(grant)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: recipient.value.id, grantId: grant.value.id });

    const laterDoc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId,
      originalName: 'passport-renewed.pdf',
      docType: 'PASSPORT',
    });
    if (!isOk(laterDoc)) throw new Error('doc');

    const expanded = await expandGrantScope(db, {
      actorAccountId: account.id,
      grantId: grant.value.id,
      documentIds: [laterDoc.value.id],
    });
    expect(isOk(expanded)).toBe(true);
    if (isOk(expanded)) {
      expect(expanded.value.documentScopeSnapshot).toContain(laterDoc.value.id);
    }

    const workspace = await getRecipientWorkspace(db, {
      actorAccountId: recipient.value.id,
      grantId: grant.value.id,
    });
    expect(isOk(workspace)).toBe(true);
    if (isOk(workspace)) {
      expect(workspace.value.documents.some((d) => d.id === laterDoc.value.id)).toBe(true);
      expect(workspace.value.documents).toHaveLength(2);
    }
  });

  it("refuses to expand with a document that does not match the grant's own categories", async () => {
    const { account, applicantId } = await ownerWithPassport(db, 'mismatch-owner@example.com');
    const recipient = await provisionAccount(db, { email: 'mismatch-recipient@example.com' });
    if (!isOk(recipient)) throw new Error('provision');
    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientAccountId: recipient.value.id,
      actions: ['VIEW_METADATA'],
      purpose: 'p',
      categories: ['universal'],
    });
    if (!isOk(grant)) throw new Error('grant');

    // A professional-category document: never matches this grant's "universal" allow-list.
    const otherDoc = await registerDocument(db, {
      actorAccountId: account.id,
      applicantId,
      originalName: 'employment.pdf',
      docType: 'EMPLOYMENT_CERTIFICATE',
    });
    if (!isOk(otherDoc)) throw new Error('doc');

    const denied = await expandGrantScope(db, {
      actorAccountId: account.id,
      grantId: grant.value.id,
      documentIds: [otherDoc.value.id],
    });
    expect(isErr(denied)).toBe(true);
    if (isErr(denied)) expect(denied.error.code).toBe('invalid');
  });

  it('refuses to preview or expand scope for anyone other than the applicant owner', async () => {
    const { account, applicantId } = await ownerWithPassport(db, 'stranger-owner@example.com');
    const stranger = await provisionAccount(db, { email: 'scope-stranger@example.com' });
    if (!isOk(stranger)) throw new Error('provision');
    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientAccountId: stranger.value.id,
      actions: ['VIEW_METADATA'],
      purpose: 'p',
      categories: ['universal'],
    });
    if (!isOk(grant)) throw new Error('grant');

    const previewDenied = await previewScopeExpansion(db, {
      actorAccountId: stranger.value.id,
      grantId: grant.value.id,
    });
    expect(isErr(previewDenied)).toBe(true);
    if (isErr(previewDenied)) expect(previewDenied.error.code).toBe('forbidden');

    const expandDenied = await expandGrantScope(db, {
      actorAccountId: stranger.value.id,
      grantId: grant.value.id,
      documentIds: ['00000000-0000-0000-0000-000000000000'],
    });
    expect(isErr(expandDenied)).toBe(true);
    if (isErr(expandDenied)) expect(expandDenied.error.code).toBe('forbidden');
  });

  it('a grant with no categories has nothing to expand', async () => {
    const { account, applicantId } = await ownerWithPassport(db, 'no-category-owner@example.com');
    const recipient = await provisionAccount(db, { email: 'no-category-recipient@example.com' });
    if (!isOk(recipient)) throw new Error('provision');
    const grant = await createGrant(db, {
      actorAccountId: account.id,
      applicantId,
      recipientAccountId: recipient.value.id,
      actions: ['VIEW_METADATA'],
      purpose: 'p',
    });
    if (!isOk(grant)) throw new Error('grant');
    expect(grant.value.documentScopeSnapshot).toBeNull();

    const candidates = await previewScopeExpansion(db, {
      actorAccountId: account.id,
      grantId: grant.value.id,
    });
    expect(isOk(candidates)).toBe(true);
    if (isOk(candidates)) expect(candidates.value).toEqual([]);

    const denied = await expandGrantScope(db, {
      actorAccountId: account.id,
      grantId: grant.value.id,
      documentIds: ['00000000-0000-0000-0000-000000000000'],
    });
    expect(isErr(denied)).toBe(true);
    if (isErr(denied)) expect(denied.error.code).toBe('invalid');
  });
});
