import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import type { Membership } from '@visastack/policy';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { addDocumentVersion, previewDocument, registerDocument } from './documents';
import {
  addMembership,
  createOrganization,
  listOrgMemberships,
  reviewOrganization,
  suspendOrganization,
} from './organizations';
import {
  acceptGrant,
  createGrant,
  listAccessForApplicant,
  listAccessForApplicantDetailed,
  listGrantsForRecipientAccount,
  revokeGrant,
} from './sharing';
import type { AccessRef, IssueReadRefInput, StoragePort } from './storage';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

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
  });
  return { account, applicantId: applicant.value.id, documentId: doc.value.id };
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
    });
    expect(isErr(selfReview)).toBe(true);
    if (isErr(selfReview)) expect(selfReview.error.code).toBe('forbidden');

    const admin = await provisionAccount(db, { email: 'platform-admin@example.com' });
    if (!isOk(admin)) throw new Error('provision');
    const reviewed = await reviewOrganization(db, {
      reviewerAccountId: admin.value.id,
      organizationId: org.value.id,
      decision: 'ACTIVE',
    });
    expect(isOk(reviewed)).toBe(true);
    if (isOk(reviewed)) expect(reviewed.value.status).toBe('ACTIVE');

    const suspended = await suspendOrganization(db, {
      reviewerAccountId: admin.value.id,
      organizationId: org.value.id,
    });
    expect(isOk(suspended)).toBe(true);
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
    };
    const preview = () =>
      previewDocument(db, storage, {
        actor: { kind: 'organization_member', accountId: agentAcc.value.id as never, membership },
        documentId,
        purpose: 'visa_application',
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
