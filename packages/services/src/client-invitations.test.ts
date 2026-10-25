import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant, listApplicants } from './applicants';
import {
  acceptClientInvitation,
  createClientInvitation,
  listClientInvitations,
  previewClientInvitation,
  revokeClientInvitation,
  sweepAbandonedClientInvitations,
} from './client-invitations';
import { setConsent } from './consent';
import { type Db, schema as dbSchema } from './db';
import { addMembership, createOrganization, reviewOrganization } from './organizations';
import { RATE_LIMITS } from './rate-limit';
import { exhaustRateLimit } from './rate-limit.test-support';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

async function account(db: Db, email: string): Promise<string> {
  const result = await provisionAccount(db, { email });
  if (!isOk(result)) throw new Error('provision failed');
  return result.value.id;
}

/** Independently verify a PENDING_VERIFICATION org: `createGrant` (called by `acceptClientInvitation`) requires an ACTIVE, verified recipient organization. */
async function activateOrg(db: Db, organizationId: string): Promise<void> {
  const reviewer = await provisionAccount(db, {
    email: `reviewer-${organizationId}@platform.example.com`,
  });
  if (!isOk(reviewer)) throw new Error('reviewer setup failed');
  const reviewed = await reviewOrganization(db, {
    reviewerAccountId: reviewer.value.id,
    organizationId,
    decision: 'ACTIVE',
    stepUpSatisfied: true,
  });
  if (!isOk(reviewed)) throw new Error('org activation failed');
}

async function grantConsent(
  db: Db,
  accountId: string,
  type: 'CORE_PROCESSING' | 'SHARING',
): Promise<void> {
  const result = await setConsent(db, {
    actorAccountId: accountId,
    accountId,
    type,
    granted: true,
  });
  if (!isOk(result)) throw new Error('consent setup failed');
}

/** A traveller account holding both consents `acceptClientInvitation` needs end to end (CORE_PROCESSING for the applicant/mission, SHARING for the grant). */
async function consentedTraveller(db: Db, email: string): Promise<string> {
  const id = await account(db, email);
  await grantConsent(db, id, 'CORE_PROCESSING');
  await grantConsent(db, id, 'SHARING');
  return id;
}

describe('client invitations - agency invites a traveller as a new client (Commercial V1 Part 4 §6, IAM-03)', () => {
  let db: Db;
  let adminId: string;
  let orgId: string;
  let caseOwnerId: string;

  beforeEach(async () => {
    db = await freshDb();
    adminId = await account(db, 'admin@agency.example');
    const org = await createOrganization(db, { actorAccountId: adminId, name: 'Acme Visas' });
    if (!isOk(org)) throw new Error('org setup failed');
    orgId = org.value.id;
    await activateOrg(db, orgId);
    caseOwnerId = await account(db, 'caseowner@agency.example');
    const membership = await addMembership(db, {
      actorAccountId: adminId,
      organizationId: orgId,
      accountId: caseOwnerId,
      role: 'CASE_MANAGER',
    });
    if (!isOk(membership)) throw new Error('case owner membership setup failed');
  });

  async function invite(overrides?: {
    readonly displayName?: string;
    readonly contactDestination?: string;
    readonly requestedRoute?: string;
    readonly caseOwnerAccountId?: string;
    readonly actorAccountId?: string;
  }) {
    return createClientInvitation(db, {
      actorAccountId: overrides?.actorAccountId ?? adminId,
      organizationId: orgId,
      caseOwnerAccountId: overrides?.caseOwnerAccountId ?? caseOwnerId,
      displayName: overrides?.displayName ?? 'Jane Traveller',
      contactDestination: overrides?.contactDestination ?? 'jane@example.com',
      requestedRoute: overrides?.requestedRoute ?? 'US B1/B2 business visa',
    });
  }

  describe('rate limiting (Part 9 SEC-02)', () => {
    it('refuses with rate_limited once the actor has hit their client-invitation limit, and creates nothing', async () => {
      await exhaustRateLimit(
        db,
        adminId,
        'client_invitation.create',
        RATE_LIMITS.CLIENT_INVITATION_CREATE,
      );

      const result = await invite();

      expect(isErr(result)).toBe(true);
      if (isOk(result)) return;
      expect(result.error.code).toBe('rate_limited');
      expect(await db.select().from(dbSchema.clientInvitations)).toHaveLength(0);
    });

    it("refuses once the ORGANIZATION's shared bucket is full, even though this actor is under their own limit", async () => {
      await exhaustRateLimit(
        db,
        orgId,
        'client_invitation.create.org',
        RATE_LIMITS.CLIENT_INVITATION_CREATE_ORG,
      );

      const result = await invite();

      expect(isErr(result) && result.error.code).toBe('rate_limited');
    });

    it("a refused actor does not spend the organization's shared bucket", async () => {
      await exhaustRateLimit(
        db,
        adminId,
        'client_invitation.create',
        RATE_LIMITS.CLIENT_INVITATION_CREATE,
      );

      const refused = await invite();
      expect(isErr(refused) && refused.error.code).toBe('rate_limited');

      const orgBuckets = await db
        .select()
        .from(dbSchema.rateLimitBuckets)
        .where(eq(dbSchema.rateLimitBuckets.subjectId, orgId));
      expect(orgBuckets).toHaveLength(0);
    });

    it('authorization is checked before the limit: a non-admin with an exhausted bucket still gets forbidden, not rate_limited', async () => {
      await exhaustRateLimit(
        db,
        caseOwnerId,
        'client_invitation.create',
        RATE_LIMITS.CLIENT_INVITATION_CREATE,
      );

      const result = await invite({ actorAccountId: caseOwnerId });

      expect(isErr(result) && result.error.code).toBe('forbidden');
    });

    it('explains the refusal in plain language, never naming the internal action', async () => {
      await exhaustRateLimit(
        db,
        adminId,
        'client_invitation.create',
        RATE_LIMITS.CLIENT_INVITATION_CREATE,
      );

      const result = await invite();

      if (isOk(result)) throw new Error('expected a refusal');
      expect(result.error.message).toContain('invitation');
      expect(result.error.message).not.toContain('client_invitation');
    });
  });

  describe('createClientInvitation', () => {
    it('creates a PENDING invitation and returns a raw token that is never the stored value', async () => {
      const result = await invite();
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;
      expect(result.value.invitation.status).toBe('PENDING');
      expect(result.value.invitation.displayName).toBe('Jane Traveller');
      expect(result.value.invitation.caseOwnerAccountId).toBe(caseOwnerId);
      expect(result.value.rawToken.length).toBeGreaterThan(20);

      const [row] = await db
        .select()
        .from(dbSchema.clientInvitations)
        .where(eq(dbSchema.clientInvitations.id, result.value.invitation.id));
      expect(row?.tokenHash).not.toBe(result.value.rawToken);
      expect(row?.tokenHash.length).toBe(64); // sha256 hex
    });

    it('refuses a non-admin member actor', async () => {
      const result = await invite({ actorAccountId: caseOwnerId });
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.error.message).toContain('OWNER/ADMIN');
    });

    it('refuses an actor with no relation to the organization at all', async () => {
      const outsiderId = await account(db, 'outsider@example.com');
      const result = await invite({ actorAccountId: outsiderId });
      expect(isErr(result)).toBe(true);
    });

    it('refuses a case owner who is not an active member of this organization', async () => {
      const nonMemberId = await account(db, 'non-member@example.com');
      const result = await invite({ caseOwnerAccountId: nonMemberId });
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.error.message).toContain('active member');
    });

    it('refuses an empty display name', async () => {
      const result = await invite({ displayName: '   ' });
      expect(isErr(result)).toBe(true);
    });

    it('refuses an empty contact destination', async () => {
      const result = await invite({ contactDestination: '  ' });
      expect(isErr(result)).toBe(true);
    });
  });

  describe('previewClientInvitation', () => {
    it('previews a valid invitation read-only, without consuming it', async () => {
      const created = await invite();
      if (!isOk(created)) throw new Error('setup failed');
      const janeId = await account(db, 'jane@example.com');

      const first = await previewClientInvitation(db, created.value.rawToken, janeId);
      expect(isOk(first)).toBe(true);
      if (!isOk(first)) return;
      expect(first.value.organizationName).toBe('Acme Visas');
      // The agency-typed person name never appears in a preview (v1.2 B09).
      expect(first.value).not.toHaveProperty('displayName');
      expect(JSON.stringify(first.value)).not.toContain('Jane Traveller');
      expect(first.value.requestedRoute).toBe('US B1/B2 business visa');
      expect(first.value.grantActions).toEqual([
        'VIEW_METADATA',
        'PREVIEW',
        'COMMENT',
        'PROPOSE_EDIT',
        'MANAGE',
      ]);

      // A second preview (a link prefetch, a scanner) must not have spent it.
      const second = await previewClientInvitation(db, created.value.rawToken, janeId);
      expect(isOk(second)).toBe(true);

      const [row] = await db
        .select()
        .from(dbSchema.clientInvitations)
        .where(eq(dbSchema.clientInvitations.id, created.value.invitation.id));
      expect(row?.status).toBe('PENDING');
    });

    it('reports not_found for an unknown token', async () => {
      const result = await previewClientInvitation(db, 'not-a-real-token-at-all', adminId);
      expect(isErr(result)).toBe(true);
    });

    it('reports expired for an expired invitation', async () => {
      const created = await invite();
      if (!isOk(created)) throw new Error('setup failed');
      await db
        .update(dbSchema.clientInvitations)
        .set({ expiresAt: new Date(0) })
        .where(eq(dbSchema.clientInvitations.id, created.value.invitation.id));

      const result = await previewClientInvitation(db, created.value.rawToken, adminId);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.error.message).toContain('expired');
    });

    it('reports invalid for an already-accepted invitation', async () => {
      const created = await invite();
      if (!isOk(created)) throw new Error('setup failed');
      const travellerId = await consentedTraveller(db, 'jane@example.com');
      const accepted = await acceptClientInvitation(db, {
        actorAccountId: travellerId,
        rawToken: created.value.rawToken,
        applicantChoice: { kind: 'new' },
      });
      expect(isOk(accepted)).toBe(true);

      const result = await previewClientInvitation(db, created.value.rawToken, travellerId);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.error.message).toContain('already been used');
    });
  });

  describe('acceptClientInvitation', () => {
    it('happy path (new applicant): creates the applicant, mission, an ACTIVE grant, and assigns the named case owner', async () => {
      const created = await invite();
      if (!isOk(created)) throw new Error('setup failed');
      const travellerId = await consentedTraveller(db, 'jane@example.com');

      const result = await acceptClientInvitation(db, {
        actorAccountId: travellerId,
        rawToken: created.value.rawToken,
        applicantChoice: { kind: 'new' },
      });
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;
      expect(result.value.organizationId).toBe(orgId);

      const applicants = await listApplicants(db, travellerId);
      expect(applicants).toHaveLength(1);
      expect(applicants[0]?.id).toBe(result.value.applicantId);
      expect(applicants[0]?.displayName).toBe('Jane Traveller');

      const [mission] = await db
        .select()
        .from(dbSchema.missions)
        .where(eq(dbSchema.missions.id, result.value.missionId));
      expect(mission?.applicantId).toBe(result.value.applicantId);
      expect(mission?.title).toBe('US B1/B2 business visa');

      const [grant] = await db
        .select()
        .from(dbSchema.grants)
        .where(eq(dbSchema.grants.applicantId, result.value.applicantId));
      expect(grant?.status).toBe('ACTIVE');
      expect(grant?.acceptedAt).not.toBeNull();
      expect(grant?.recipientOrganizationId).toBe(orgId);
      expect(grant?.missionId).toBe(result.value.missionId);
      expect(grant?.actions).toEqual(
        expect.arrayContaining(['VIEW_METADATA', 'PREVIEW', 'COMMENT', 'PROPOSE_EDIT', 'MANAGE']),
      );

      // Proves the case-owner assignment (assignMember) actually went
      // through now that the grant is ACTIVE and MANAGE-scoped, not just
      // that acceptClientInvitation returned ok.
      const [assignment] = await db
        .select()
        .from(dbSchema.assignments)
        .where(
          and(
            eq(dbSchema.assignments.missionId, result.value.missionId),
            eq(dbSchema.assignments.memberAccountId, caseOwnerId),
          ),
        );
      expect(assignment).toBeDefined();
      expect(assignment?.organizationId).toBe(orgId);

      const [invitationRow] = await db
        .select()
        .from(dbSchema.clientInvitations)
        .where(eq(dbSchema.clientInvitations.id, created.value.invitation.id));
      expect(invitationRow?.status).toBe('ACCEPTED');
      expect(invitationRow?.acceptedByAccountId).toBe(travellerId);
      expect(invitationRow?.acceptedApplicantId).toBe(result.value.applicantId);
      expect(invitationRow?.acceptedMissionId).toBe(result.value.missionId);
    });

    it('happy path (existing applicant): links to the chosen applicant instead of creating a new one', async () => {
      const created = await invite();
      if (!isOk(created)) throw new Error('setup failed');
      const travellerId = await consentedTraveller(db, 'jane@example.com');
      const existing = await createApplicant(db, {
        actorAccountId: travellerId,
        ownerAccountId: travellerId,
        displayName: 'Self',
      });
      if (!isOk(existing)) throw new Error('applicant setup failed');

      const result = await acceptClientInvitation(db, {
        actorAccountId: travellerId,
        rawToken: created.value.rawToken,
        applicantChoice: { kind: 'existing', applicantId: existing.value.id },
      });
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;
      expect(result.value.applicantId).toBe(existing.value.id);

      const applicants = await listApplicants(db, travellerId);
      expect(applicants).toHaveLength(1); // no duplicate created
    });

    it('rejects selecting an existing applicant the actor does not own', async () => {
      const created = await invite();
      if (!isOk(created)) throw new Error('setup failed');
      const travellerId = await consentedTraveller(db, 'jane@example.com');
      const otherOwnerId = await consentedTraveller(db, 'other-owner@example.com');
      const othersApplicant = await createApplicant(db, {
        actorAccountId: otherOwnerId,
        ownerAccountId: otherOwnerId,
        displayName: 'Not Yours',
      });
      if (!isOk(othersApplicant)) throw new Error('applicant setup failed');

      const result = await acceptClientInvitation(db, {
        actorAccountId: travellerId,
        rawToken: created.value.rawToken,
        applicantChoice: { kind: 'existing', applicantId: othersApplicant.value.id },
      });
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.error.message).toContain('not authorized');

      const [invitationRow] = await db
        .select()
        .from(dbSchema.clientInvitations)
        .where(eq(dbSchema.clientInvitations.id, created.value.invitation.id));
      expect(invitationRow?.status).toBe('PENDING');
    });

    it('rejects an unknown token, honestly, never inventing a match', async () => {
      const travellerId = await consentedTraveller(db, 'jane@example.com');
      const result = await acceptClientInvitation(db, {
        actorAccountId: travellerId,
        rawToken: 'not-a-real-token-at-all',
        applicantChoice: { kind: 'new' },
      });
      expect(isErr(result)).toBe(true);
    });

    it('rejects an expired invitation even with the correct token', async () => {
      const created = await invite();
      if (!isOk(created)) throw new Error('setup failed');
      await db
        .update(dbSchema.clientInvitations)
        .set({ expiresAt: new Date(0) })
        .where(eq(dbSchema.clientInvitations.id, created.value.invitation.id));
      const travellerId = await consentedTraveller(db, 'jane@example.com');

      const result = await acceptClientInvitation(db, {
        actorAccountId: travellerId,
        rawToken: created.value.rawToken,
        applicantChoice: { kind: 'new' },
      });
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.error.message).toContain('expired');
    });

    it('is single-use: a second acceptance attempt with the same token fails (replay)', async () => {
      const created = await invite();
      if (!isOk(created)) throw new Error('setup failed');
      const travellerId = await consentedTraveller(db, 'jane@example.com');

      const firstAccept = await acceptClientInvitation(db, {
        actorAccountId: travellerId,
        rawToken: created.value.rawToken,
        applicantChoice: { kind: 'new' },
      });
      expect(isOk(firstAccept)).toBe(true);

      const replay = await acceptClientInvitation(db, {
        actorAccountId: travellerId,
        rawToken: created.value.rawToken,
        applicantChoice: { kind: 'new' },
      });
      expect(isErr(replay)).toBe(true);
      if (isErr(replay)) expect(replay.error.message).toContain('already been used');

      const applicants = await listApplicants(db, travellerId);
      expect(applicants).toHaveLength(1); // the replay created nothing further
    });

    it('a revoked invitation cannot be accepted even before it would have expired', async () => {
      const created = await invite();
      if (!isOk(created)) throw new Error('setup failed');
      const revoked = await revokeClientInvitation(db, {
        actorAccountId: adminId,
        organizationId: orgId,
        invitationId: created.value.invitation.id,
      });
      expect(isOk(revoked)).toBe(true);

      const travellerId = await consentedTraveller(db, 'jane@example.com');
      const result = await acceptClientInvitation(db, {
        actorAccountId: travellerId,
        rawToken: created.value.rawToken,
        applicantChoice: { kind: 'new' },
      });
      expect(isErr(result)).toBe(true);
    });

    it('under real concurrency, two simultaneous accept attempts for the same token never both succeed (race safety, not sequentially simulated)', async () => {
      const created = await invite();
      if (!isOk(created)) throw new Error('setup failed');
      const travellerId = await consentedTraveller(db, 'jane@example.com');

      const [a, b] = await Promise.all([
        acceptClientInvitation(db, {
          actorAccountId: travellerId,
          rawToken: created.value.rawToken,
          applicantChoice: { kind: 'new' },
        }),
        acceptClientInvitation(db, {
          actorAccountId: travellerId,
          rawToken: created.value.rawToken,
          applicantChoice: { kind: 'new' },
        }),
      ]);
      const results = [a, b];
      expect(results.filter(isOk)).toHaveLength(1);
      expect(results.filter(isErr)).toHaveLength(1);

      // Exactly one applicant/mission/grant chain, not two half-built ones.
      const applicants = await listApplicants(db, travellerId);
      expect(applicants).toHaveLength(1);
    });

    it('rolls back entirely when a downstream step fails: missing SHARING consent leaves the invitation PENDING and creates nothing', async () => {
      const created = await invite();
      if (!isOk(created)) throw new Error('setup failed');
      // CORE_PROCESSING only: createApplicant/createMission would succeed,
      // but createGrant requires SHARING, so it must fail and unwind
      // everything the earlier steps in this same transaction did.
      const travellerId = await account(db, 'jane@example.com');
      await grantConsent(db, travellerId, 'CORE_PROCESSING');

      const result = await acceptClientInvitation(db, {
        actorAccountId: travellerId,
        rawToken: created.value.rawToken,
        applicantChoice: { kind: 'new' },
      });
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.error.message).toContain('Sharing consent is required');

      const applicants = await listApplicants(db, travellerId);
      expect(applicants).toHaveLength(0); // the applicant insert did not survive the rollback

      const [invitationRow] = await db
        .select()
        .from(dbSchema.clientInvitations)
        .where(eq(dbSchema.clientInvitations.id, created.value.invitation.id));
      expect(invitationRow?.status).toBe('PENDING'); // never left half-accepted
      expect(invitationRow?.acceptedApplicantId).toBeNull();
      expect(invitationRow?.acceptedMissionId).toBeNull();

      // The token still works: a retry after the traveller grants SHARING
      // consent must succeed cleanly, proving nothing was left dangling.
      await grantConsent(db, travellerId, 'SHARING');
      const retry = await acceptClientInvitation(db, {
        actorAccountId: travellerId,
        rawToken: created.value.rawToken,
        applicantChoice: { kind: 'new' },
      });
      expect(isOk(retry)).toBe(true);
    });
  });

  describe('intended-recipient binding (v1.2 PR1/S1, T03)', () => {
    it('a forwarded link shows an unrelated account no details and cannot be claimed', async () => {
      const created = await invite();
      if (!isOk(created)) throw new Error('setup failed');
      const strangerId = await consentedTraveller(db, 'someone-else@example.com');

      const preview = await previewClientInvitation(db, created.value.rawToken, strangerId);
      expect(isErr(preview)).toBe(true);
      if (isErr(preview)) {
        expect(preview.error.code).toBe('forbidden');
        expect(preview.error.message).toBe('Use the email address that received this invitation.');
        for (const secret of ['Jane', 'jane@example.com', 'US B1/B2', 'Acme Visas']) {
          expect(preview.error.message).not.toContain(secret);
        }
      }

      const accepted = await acceptClientInvitation(db, {
        actorAccountId: strangerId,
        rawToken: created.value.rawToken,
        applicantChoice: { kind: 'new' },
      });
      expect(isErr(accepted)).toBe(true);
      if (isErr(accepted)) expect(accepted.error.code).toBe('forbidden');

      // Nothing was spent or created: the real recipient can still accept.
      const [row] = await db
        .select()
        .from(dbSchema.clientInvitations)
        .where(eq(dbSchema.clientInvitations.id, created.value.invitation.id));
      expect(row?.status).toBe('PENDING');
      expect(row?.acceptedByAccountId).toBeNull();
      expect(await listApplicants(db, strangerId)).toHaveLength(0);
      const janeId = await consentedTraveller(db, 'jane@example.com');
      const real = await acceptClientInvitation(db, {
        actorAccountId: janeId,
        rawToken: created.value.rawToken,
        applicantChoice: { kind: 'new' },
      });
      expect(isOk(real)).toBe(true);
    }, 30_000);

    it('matches the invited address regardless of letter case and surrounding spaces', async () => {
      const created = await invite({ contactDestination: '  Jane.Doe@Example.COM ' });
      if (!isOk(created)) throw new Error('setup failed');
      const janeId = await consentedTraveller(db, 'jane.doe@example.com');
      expect(isOk(await previewClientInvitation(db, created.value.rawToken, janeId))).toBe(true);
      const accepted = await acceptClientInvitation(db, {
        actorAccountId: janeId,
        rawToken: created.value.rawToken,
        applicantChoice: { kind: 'new' },
      });
      expect(isOk(accepted)).toBe(true);
    }, 30_000);

    it('keeps a phone-contact invitation claimable by the signed-in holder (unverifiable contact, recorded residual)', async () => {
      const created = await invite({ contactDestination: '+880 1711 000000' });
      if (!isOk(created)) throw new Error('setup failed');
      const holderId = await consentedTraveller(db, 'holder@example.com');
      const accepted = await acceptClientInvitation(db, {
        actorAccountId: holderId,
        rawToken: created.value.rawToken,
        applicantChoice: { kind: 'new' },
      });
      expect(isOk(accepted)).toBe(true);
    }, 30_000);
  });

  describe('revokeClientInvitation', () => {
    it('refuses a non-admin actor', async () => {
      const created = await invite();
      if (!isOk(created)) throw new Error('setup failed');
      const result = await revokeClientInvitation(db, {
        actorAccountId: caseOwnerId,
        organizationId: orgId,
        invitationId: created.value.invitation.id,
      });
      expect(isErr(result)).toBe(true);
    });

    it('refuses to revoke an invitation belonging to a DIFFERENT organization, even for that org’s own admin (cross-tenant IDOR)', async () => {
      const created = await invite();
      if (!isOk(created)) throw new Error('setup failed');

      const otherAdminId = await account(db, 'other-admin@example.com');
      const otherOrg = await createOrganization(db, {
        actorAccountId: otherAdminId,
        name: 'Other Agency',
      });
      if (!isOk(otherOrg)) throw new Error('setup failed');

      const result = await revokeClientInvitation(db, {
        actorAccountId: otherAdminId,
        organizationId: otherOrg.value.id,
        invitationId: created.value.invitation.id,
      });
      expect(isErr(result)).toBe(true);

      // Proves it was not actually revoked by the cross-tenant attempt.
      const travellerId = await consentedTraveller(db, 'jane@example.com');
      const accepted = await acceptClientInvitation(db, {
        actorAccountId: travellerId,
        rawToken: created.value.rawToken,
        applicantChoice: { kind: 'new' },
      });
      expect(isOk(accepted)).toBe(true);
    });

    it('a revoked invitation stays revoked and is reflected in the org’s invitation list', async () => {
      const created = await invite();
      if (!isOk(created)) throw new Error('setup failed');
      const result = await revokeClientInvitation(db, {
        actorAccountId: adminId,
        organizationId: orgId,
        invitationId: created.value.invitation.id,
      });
      expect(isOk(result)).toBe(true);

      const listed = await listClientInvitations(db, {
        actorAccountId: adminId,
        organizationId: orgId,
      });
      expect(isOk(listed)).toBe(true);
      if (!isOk(listed)) return;
      expect(listed.value[0]?.status).toBe('REVOKED');
    });
  });

  describe('listClientInvitations', () => {
    it('lists this org’s invitations newest first, admin only', async () => {
      await invite({ displayName: 'First Traveller', contactDestination: 'first@example.com' });
      await invite({ displayName: 'Second Traveller', contactDestination: 'second@example.com' });

      const result = await listClientInvitations(db, {
        actorAccountId: adminId,
        organizationId: orgId,
      });
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;
      expect(result.value).toHaveLength(2);
      expect(result.value[0]?.displayName).toBe('Second Traveller');
    });

    it('refuses a non-admin actor', async () => {
      const result = await listClientInvitations(db, {
        actorAccountId: caseOwnerId,
        organizationId: orgId,
      });
      expect(isErr(result)).toBe(true);
    });
  });

  describe('sweepAbandonedClientInvitations (PRV-02, Part 7 §11: "abandoned invite metadata: 30d")', () => {
    it('sweeps a PENDING invitation whose acceptance window expired 30+ days ago', async () => {
      const created = await invite();
      if (!isOk(created)) throw new Error('setup failed');
      const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
      await db
        .update(dbSchema.clientInvitations)
        .set({ expiresAt: thirtyOneDaysAgo })
        .where(eq(dbSchema.clientInvitations.id, created.value.invitation.id));

      const result = await sweepAbandonedClientInvitations(db);
      expect(result).toEqual({ checked: 1, deleted: 1 });

      const remaining = await db
        .select()
        .from(dbSchema.clientInvitations)
        .where(eq(dbSchema.clientInvitations.id, created.value.invitation.id));
      expect(remaining).toHaveLength(0);
    });

    it('does not sweep a PENDING invitation still within the 30-day grace window past its own expiry', async () => {
      const created = await invite();
      if (!isOk(created)) throw new Error('setup failed');
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      await db
        .update(dbSchema.clientInvitations)
        .set({ expiresAt: tenDaysAgo })
        .where(eq(dbSchema.clientInvitations.id, created.value.invitation.id));

      const result = await sweepAbandonedClientInvitations(db);
      expect(result).toEqual({ checked: 0, deleted: 0 });
    });

    it('sweeps an invitation REVOKED 30+ days ago', async () => {
      const created = await invite();
      if (!isOk(created)) throw new Error('setup failed');
      const revoked = await revokeClientInvitation(db, {
        actorAccountId: adminId,
        organizationId: orgId,
        invitationId: created.value.invitation.id,
      });
      expect(isOk(revoked)).toBe(true);
      const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
      await db
        .update(dbSchema.clientInvitations)
        .set({ revokedAt: thirtyOneDaysAgo })
        .where(eq(dbSchema.clientInvitations.id, created.value.invitation.id));

      const result = await sweepAbandonedClientInvitations(db);
      expect(result).toEqual({ checked: 1, deleted: 1 });
    });

    it('never sweeps an ACCEPTED invitation, regardless of age -- it is a legitimate historical record, not abandoned metadata', async () => {
      const created = await invite();
      if (!isOk(created)) throw new Error('setup failed');
      const travellerId = await consentedTraveller(db, 'jane@example.com');
      const accepted = await acceptClientInvitation(db, {
        actorAccountId: travellerId,
        rawToken: created.value.rawToken,
        applicantChoice: { kind: 'new' },
      });
      expect(isOk(accepted)).toBe(true);
      const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
      await db
        .update(dbSchema.clientInvitations)
        .set({ expiresAt: oneYearAgo })
        .where(eq(dbSchema.clientInvitations.id, created.value.invitation.id));

      const result = await sweepAbandonedClientInvitations(db);
      expect(result).toEqual({ checked: 0, deleted: 0 });

      const remaining = await db
        .select()
        .from(dbSchema.clientInvitations)
        .where(eq(dbSchema.clientInvitations.id, created.value.invitation.id));
      expect(remaining).toHaveLength(1);
    });
  });
});
