import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { type Db, schema as dbSchema } from './db';
import {
  acceptOrganizationInvitation,
  addMemberByEmail,
  createOrganizationInvitation,
  listOrganizationInvitations,
  revokeOrganizationInvitation,
  sweepAbandonedOrganizationInvitations,
} from './invitations';
import { createOrganization, isOrgAdmin } from './organizations';
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

describe('organization invitations - secure member invitations for a recipient with no account yet (Commercial V1 Part 4 §5)', () => {
  let db: Db;
  let ownerId: string;
  let orgId: string;

  beforeEach(async () => {
    db = await freshDb();
    ownerId = await account(db, 'owner@agency.example');
    const created = await createOrganization(db, { actorAccountId: ownerId, name: 'Acme Visas' });
    if (!isOk(created)) throw new Error('org setup failed');
    orgId = created.value.id;
  });

  describe('rate limiting (Part 9 SEC-02)', () => {
    const invite = (actorAccountId: string, organizationId: string, email: string) =>
      createOrganizationInvitation(db, {
        actorAccountId,
        organizationId,
        email,
        role: 'CASE_MANAGER',
      });

    it('refuses with rate_limited once the actor has hit their invitation limit, and creates nothing', async () => {
      await exhaustRateLimit(
        db,
        ownerId,
        'org_invitation.create',
        RATE_LIMITS.ORG_INVITATION_CREATE,
      );

      const result = await invite(ownerId, orgId, 'blocked@example.com');

      expect(isErr(result)).toBe(true);
      if (isOk(result)) return;
      expect(result.error.code).toBe('rate_limited');
      expect(await db.select().from(dbSchema.organizationInvitations)).toHaveLength(0);
    });

    it("refuses once the ORGANIZATION's shared bucket is full, even though this actor is under their own limit", async () => {
      await exhaustRateLimit(
        db,
        orgId,
        'org_invitation.create.org',
        RATE_LIMITS.ORG_INVITATION_CREATE_ORG,
      );

      const result = await invite(ownerId, orgId, 'blocked@example.com');

      expect(isErr(result)).toBe(true);
      if (isOk(result)) return;
      expect(result.error.code).toBe('rate_limited');
    });

    it("a refused actor does not spend the organization's shared bucket (one abusive admin cannot drain the rest of the org)", async () => {
      await exhaustRateLimit(
        db,
        ownerId,
        'org_invitation.create',
        RATE_LIMITS.ORG_INVITATION_CREATE,
      );

      const refused = await invite(ownerId, orgId, 'blocked@example.com');
      // Without this, the assertion below would also pass if nothing were limited at all.
      expect(isErr(refused) && refused.error.code).toBe('rate_limited');

      const orgBuckets = await db
        .select()
        .from(dbSchema.rateLimitBuckets)
        .where(eq(dbSchema.rateLimitBuckets.subjectId, orgId));
      expect(orgBuckets).toHaveLength(0);
    });

    it('limits the account-exists probe too: a refused call never reveals whether an email is already registered', async () => {
      await account(db, 'already-registered@example.com');
      await exhaustRateLimit(
        db,
        ownerId,
        'org_invitation.create',
        RATE_LIMITS.ORG_INVITATION_CREATE,
      );

      const result = await invite(ownerId, orgId, 'already-registered@example.com');

      expect(isErr(result)).toBe(true);
      if (isOk(result)) return;
      // rate_limited, NOT the "already has a VisaStack account" refusal that would leak registration.
      expect(result.error.code).toBe('rate_limited');
      expect(result.error.message).not.toContain('account');
    });

    it("another organization's admin is unaffected by this actor being limited", async () => {
      await exhaustRateLimit(
        db,
        ownerId,
        'org_invitation.create',
        RATE_LIMITS.ORG_INVITATION_CREATE,
      );
      const otherOwner = await account(db, 'other-owner@agency.example');
      const otherOrg = await createOrganization(db, {
        actorAccountId: otherOwner,
        name: 'Other Agency',
      });
      if (!isOk(otherOrg)) throw new Error('org setup failed');

      // The limited actor really is refused (so this is not vacuous)...
      const limited = await invite(ownerId, orgId, 'blocked@example.com');
      expect(isErr(limited) && limited.error.code).toBe('rate_limited');
      // ...while an unrelated actor in an unrelated organization is not.
      const result = await invite(otherOwner, otherOrg.value.id, 'fine@example.com');

      expect(isOk(result)).toBe(true);
    });

    it('explains the refusal in plain language, never naming the internal action', async () => {
      await exhaustRateLimit(
        db,
        ownerId,
        'org_invitation.create',
        RATE_LIMITS.ORG_INVITATION_CREATE,
      );

      const result = await invite(ownerId, orgId, 'blocked@example.com');

      if (isOk(result)) throw new Error('expected a refusal');
      expect(result.error.message).toContain('invitation');
      expect(result.error.message).not.toContain('org_invitation');
    });
  });

  describe('addMemberByEmail (Part 9 SEC-02: authorize, then limit, then look up)', () => {
    const addByEmail = (actorAccountId: string, email: string, organizationId = orgId) =>
      addMemberByEmail(db, { actorAccountId, organizationId, email, role: 'CASE_MANAGER' });

    async function memberRows(accountId: string) {
      return db
        .select()
        .from(dbSchema.memberships)
        .where(eq(dbSchema.memberships.accountId, accountId));
    }

    it('adds an existing account immediately', async () => {
      const existingId = await account(db, 'existing@example.com');

      const result = await addByEmail(ownerId, 'Existing@Example.com');

      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;
      expect(result.value.kind).toBe('added');
      expect(await memberRows(existingId)).toHaveLength(1);
    });

    it('mints a single-use invitation for an email with no account', async () => {
      const result = await addByEmail(ownerId, 'nobody@example.com');

      expect(isOk(result)).toBe(true);
      if (!isOk(result) || result.value.kind !== 'invited')
        throw new Error('expected an invitation');
      expect(result.value.rawToken.length).toBeGreaterThan(20);
      expect(result.value.invitation.status).toBe('PENDING');
    });

    it('a non-admin is forbidden identically whether or not the email is registered (no oracle for outsiders)', async () => {
      await account(db, 'registered@example.com');
      const outsiderId = await account(db, 'outsider@example.com');

      const forRegistered = await addByEmail(outsiderId, 'registered@example.com');
      const forUnregistered = await addByEmail(outsiderId, 'unregistered@example.com');

      expect(isErr(forRegistered) && forRegistered.error.code).toBe('forbidden');
      expect(isErr(forUnregistered) && forUnregistered.error.code).toBe('forbidden');
      expect(isErr(forRegistered) && isErr(forUnregistered) && forRegistered.error.message).toBe(
        isErr(forUnregistered) ? forUnregistered.error.message : undefined,
      );
    });

    it('once the actor is limited, a REGISTERED email is refused and not added, exactly like an unregistered one (the oracle is closed for both branches)', async () => {
      const registeredId = await account(db, 'registered@example.com');
      await exhaustRateLimit(
        db,
        ownerId,
        'org_invitation.create',
        RATE_LIMITS.ORG_INVITATION_CREATE,
      );

      const forRegistered = await addByEmail(ownerId, 'registered@example.com');
      const forUnregistered = await addByEmail(ownerId, 'unregistered@example.com');

      expect(isErr(forRegistered) && forRegistered.error.code).toBe('rate_limited');
      expect(isErr(forUnregistered) && forUnregistered.error.code).toBe('rate_limited');
      // Indistinguishable to the caller, and the registered account was NOT silently added.
      expect(isErr(forRegistered) && forRegistered.error.message).toBe(
        isErr(forUnregistered) ? forUnregistered.error.message : undefined,
      );
      expect(await memberRows(registeredId)).toHaveLength(0);
    });

    it('costs exactly one unit per call whichever branch it takes (the invite branch is not charged twice)', async () => {
      await account(db, 'registered@example.com');

      await addByEmail(ownerId, 'registered@example.com');
      await addByEmail(ownerId, 'unregistered@example.com');

      const [actorBucket] = await db
        .select()
        .from(dbSchema.rateLimitBuckets)
        .where(eq(dbSchema.rateLimitBuckets.subjectId, ownerId));
      const [orgBucket] = await db
        .select()
        .from(dbSchema.rateLimitBuckets)
        .where(eq(dbSchema.rateLimitBuckets.subjectId, orgId));
      expect(actorBucket?.count).toBe(2);
      expect(orgBucket?.count).toBe(2);
    });

    it("an unauthorized caller never spends the target organization's bucket (the org bucket is keyed on a caller-supplied id)", async () => {
      const outsiderId = await account(db, 'outsider@example.com');

      const refused = await addByEmail(outsiderId, 'whoever@example.com');
      expect(isErr(refused) && refused.error.code).toBe('forbidden');

      const orgBuckets = await db
        .select()
        .from(dbSchema.rateLimitBuckets)
        .where(eq(dbSchema.rateLimitBuckets.subjectId, orgId));
      expect(orgBuckets).toHaveLength(0);
    });

    it('createOrganizationInvitation likewise never lets a non-admin spend the organization bucket', async () => {
      const outsiderId = await account(db, 'outsider2@example.com');

      const refused = await createOrganizationInvitation(db, {
        actorAccountId: outsiderId,
        organizationId: orgId,
        email: 'whoever@example.com',
        role: 'CASE_MANAGER',
      });
      expect(isErr(refused) && refused.error.code).toBe('forbidden');

      const orgBuckets = await db
        .select()
        .from(dbSchema.rateLimitBuckets)
        .where(eq(dbSchema.rateLimitBuckets.subjectId, orgId));
      expect(orgBuckets).toHaveLength(0);
    });

    it('an empty email is invalid and costs nothing', async () => {
      const result = await addByEmail(ownerId, '   ');

      expect(isErr(result) && result.error.code).toBe('invalid');
      expect(await db.select().from(dbSchema.rateLimitBuckets)).toHaveLength(0);
    });
  });

  describe('createOrganizationInvitation', () => {
    it('creates a PENDING invitation and returns a raw token that is never the stored value', async () => {
      const result = await createOrganizationInvitation(db, {
        actorAccountId: ownerId,
        organizationId: orgId,
        email: 'New.Colleague@Example.com',
        role: 'CASE_MANAGER',
      });
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;
      expect(result.value.invitation.status).toBe('PENDING');
      // Email normalized (lowercased/trimmed).
      expect(result.value.invitation.email).toBe('new.colleague@example.com');
      expect(result.value.rawToken.length).toBeGreaterThan(20);
      // The stored row never contains the raw token, only its hash.
      const [row] = await db
        .select()
        .from(dbSchema.organizationInvitations)
        .where(eq(dbSchema.organizationInvitations.id, result.value.invitation.id));
      expect(row?.tokenHash).not.toBe(result.value.rawToken);
      expect(row?.tokenHash.length).toBe(64); // sha256 hex
    });

    it('refuses a non-admin actor', async () => {
      const outsiderId = await account(db, 'outsider@example.com');
      const result = await createOrganizationInvitation(db, {
        actorAccountId: outsiderId,
        organizationId: orgId,
        email: 'someone@example.com',
        role: 'REVIEWER',
      });
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.error.message).toContain('OWNER/ADMIN');
    });

    it('refuses an email that already has a VisaStack account (addMembership is the right path for that)', async () => {
      await account(db, 'existing@example.com');
      const result = await createOrganizationInvitation(db, {
        actorAccountId: ownerId,
        organizationId: orgId,
        email: 'existing@example.com',
        role: 'REVIEWER',
      });
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.error.message).toContain('already has a VisaStack account');
    });

    it('supersedes an earlier still-pending invitation for the same email: the old token stops working', async () => {
      const first = await createOrganizationInvitation(db, {
        actorAccountId: ownerId,
        organizationId: orgId,
        email: 'twice@example.com',
        role: 'REVIEWER',
      });
      if (!isOk(first)) throw new Error('setup failed');

      const second = await createOrganizationInvitation(db, {
        actorAccountId: ownerId,
        organizationId: orgId,
        email: 'twice@example.com',
        role: 'ADMIN',
      });
      expect(isOk(second)).toBe(true);

      const recipientId = await account(db, 'twice@example.com');
      const acceptedOldToken = await acceptOrganizationInvitation(db, {
        actorAccountId: recipientId,
        actorEmail: 'twice@example.com',
        rawToken: first.value.rawToken,
      });
      expect(isErr(acceptedOldToken)).toBe(true);
    });
  });

  describe('acceptOrganizationInvitation', () => {
    it('accepts a valid invitation and creates the membership with the invited role', async () => {
      const invited = await createOrganizationInvitation(db, {
        actorAccountId: ownerId,
        organizationId: orgId,
        email: 'recipient@example.com',
        role: 'CASE_MANAGER',
      });
      if (!isOk(invited)) throw new Error('setup failed');

      const recipientId = await account(db, 'recipient@example.com');
      const result = await acceptOrganizationInvitation(db, {
        actorAccountId: recipientId,
        actorEmail: 'recipient@example.com',
        rawToken: invited.value.rawToken,
      });
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;
      expect(result.value.membership.role).toBe('CASE_MANAGER');
      expect(result.value.organizationId).toBe(orgId);
      expect(await isOrgAdmin(db, recipientId, orgId)).toBe(false); // CASE_MANAGER, not admin

      const [row] = await db
        .select()
        .from(dbSchema.organizationInvitations)
        .where(eq(dbSchema.organizationInvitations.id, invited.value.invitation.id));
      expect(row?.status).toBe('ACCEPTED');
      expect(row?.acceptedByAccountId).toBe(recipientId);
    });

    it('rejects an unknown token, honestly, never inventing a match', async () => {
      const result = await acceptOrganizationInvitation(db, {
        actorAccountId: await account(db, 'x@example.com'),
        actorEmail: 'x@example.com',
        rawToken: 'not-a-real-token-at-all',
      });
      expect(isErr(result)).toBe(true);
    });

    it('rejects acceptance from an account whose authenticated email does not match the invitation (a stolen/forwarded link)', async () => {
      const invited = await createOrganizationInvitation(db, {
        actorAccountId: ownerId,
        organizationId: orgId,
        email: 'intended@example.com',
        role: 'REVIEWER',
      });
      if (!isOk(invited)) throw new Error('setup failed');

      const attackerId = await account(db, 'attacker@example.com');
      const result = await acceptOrganizationInvitation(db, {
        actorAccountId: attackerId,
        actorEmail: 'attacker@example.com',
        rawToken: invited.value.rawToken,
      });
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.error.message).toContain('different email');
      expect(await isOrgAdmin(db, attackerId, orgId)).toBe(false);
    });

    it('rejects an expired invitation even with the correct token and email', async () => {
      const invited = await createOrganizationInvitation(db, {
        actorAccountId: ownerId,
        organizationId: orgId,
        email: 'late@example.com',
        role: 'REVIEWER',
      });
      if (!isOk(invited)) throw new Error('setup failed');
      await db
        .update(dbSchema.organizationInvitations)
        .set({ expiresAt: new Date(0) })
        .where(eq(dbSchema.organizationInvitations.id, invited.value.invitation.id));

      const recipientId = await account(db, 'late@example.com');
      const result = await acceptOrganizationInvitation(db, {
        actorAccountId: recipientId,
        actorEmail: 'late@example.com',
        rawToken: invited.value.rawToken,
      });
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.error.message).toContain('expired');
    });

    it('is single-use: a second acceptance attempt with the same token fails (replay)', async () => {
      const invited = await createOrganizationInvitation(db, {
        actorAccountId: ownerId,
        organizationId: orgId,
        email: 'once@example.com',
        role: 'REVIEWER',
      });
      if (!isOk(invited)) throw new Error('setup failed');
      const recipientId = await account(db, 'once@example.com');

      const firstAccept = await acceptOrganizationInvitation(db, {
        actorAccountId: recipientId,
        actorEmail: 'once@example.com',
        rawToken: invited.value.rawToken,
      });
      expect(isOk(firstAccept)).toBe(true);

      const replay = await acceptOrganizationInvitation(db, {
        actorAccountId: recipientId,
        actorEmail: 'once@example.com',
        rawToken: invited.value.rawToken,
      });
      expect(isErr(replay)).toBe(true);
      if (isErr(replay)) expect(replay.error.message).toContain('already been used');
    });

    it('under real concurrency, two simultaneous accept attempts for the same token never both succeed (race safety, not sequentially simulated)', async () => {
      const invited = await createOrganizationInvitation(db, {
        actorAccountId: ownerId,
        organizationId: orgId,
        email: 'racer@example.com',
        role: 'REVIEWER',
      });
      if (!isOk(invited)) throw new Error('setup failed');
      const recipientId = await account(db, 'racer@example.com');

      const [a, b] = await Promise.all([
        acceptOrganizationInvitation(db, {
          actorAccountId: recipientId,
          actorEmail: 'racer@example.com',
          rawToken: invited.value.rawToken,
        }),
        acceptOrganizationInvitation(db, {
          actorAccountId: recipientId,
          actorEmail: 'racer@example.com',
          rawToken: invited.value.rawToken,
        }),
      ]);
      const results = [a, b];
      expect(results.filter(isOk)).toHaveLength(1);
      expect(results.filter(isErr)).toHaveLength(1);
    });

    it('a revoked invitation cannot be accepted even before it would have expired', async () => {
      const invited = await createOrganizationInvitation(db, {
        actorAccountId: ownerId,
        organizationId: orgId,
        email: 'revoked@example.com',
        role: 'REVIEWER',
      });
      if (!isOk(invited)) throw new Error('setup failed');
      const revoked = await revokeOrganizationInvitation(db, {
        actorAccountId: ownerId,
        organizationId: orgId,
        invitationId: invited.value.invitation.id,
      });
      expect(isOk(revoked)).toBe(true);

      const recipientId = await account(db, 'revoked@example.com');
      const result = await acceptOrganizationInvitation(db, {
        actorAccountId: recipientId,
        actorEmail: 'revoked@example.com',
        rawToken: invited.value.rawToken,
      });
      expect(isErr(result)).toBe(true);
    });
  });

  describe('revokeOrganizationInvitation', () => {
    it('refuses a non-admin actor', async () => {
      const invited = await createOrganizationInvitation(db, {
        actorAccountId: ownerId,
        organizationId: orgId,
        email: 'target@example.com',
        role: 'REVIEWER',
      });
      if (!isOk(invited)) throw new Error('setup failed');
      const outsiderId = await account(db, 'outsider2@example.com');
      const result = await revokeOrganizationInvitation(db, {
        actorAccountId: outsiderId,
        organizationId: orgId,
        invitationId: invited.value.invitation.id,
      });
      expect(isErr(result)).toBe(true);
    });

    it('refuses to revoke an invitation belonging to a DIFFERENT organization, even for that org’s own admin (cross-tenant IDOR)', async () => {
      const invited = await createOrganizationInvitation(db, {
        actorAccountId: ownerId,
        organizationId: orgId,
        email: 'target2@example.com',
        role: 'REVIEWER',
      });
      if (!isOk(invited)) throw new Error('setup failed');

      const otherOwnerId = await account(db, 'other-owner@example.com');
      const otherOrg = await createOrganization(db, {
        actorAccountId: otherOwnerId,
        name: 'Other Agency',
      });
      if (!isOk(otherOrg)) throw new Error('setup failed');

      const result = await revokeOrganizationInvitation(db, {
        actorAccountId: otherOwnerId,
        organizationId: otherOrg.value.id,
        invitationId: invited.value.invitation.id,
      });
      expect(isErr(result)).toBe(true);

      // Proves it wasn't actually revoked by the cross-tenant attempt.
      const recipientId = await account(db, 'target2@example.com');
      const accepted = await acceptOrganizationInvitation(db, {
        actorAccountId: recipientId,
        actorEmail: 'target2@example.com',
        rawToken: invited.value.rawToken,
      });
      expect(isOk(accepted)).toBe(true);
    });
  });

  describe('listOrganizationInvitations', () => {
    it('lists this org’s invitations newest first, admin only', async () => {
      await createOrganizationInvitation(db, {
        actorAccountId: ownerId,
        organizationId: orgId,
        email: 'one@example.com',
        role: 'REVIEWER',
      });
      await createOrganizationInvitation(db, {
        actorAccountId: ownerId,
        organizationId: orgId,
        email: 'two@example.com',
        role: 'REVIEWER',
      });
      const result = await listOrganizationInvitations(db, {
        actorAccountId: ownerId,
        organizationId: orgId,
      });
      expect(isOk(result)).toBe(true);
      if (!isOk(result)) return;
      expect(result.value).toHaveLength(2);
      expect(result.value[0]?.email).toBe('two@example.com');
    });

    it('refuses a non-admin actor', async () => {
      const outsiderId = await account(db, 'outsider3@example.com');
      const result = await listOrganizationInvitations(db, {
        actorAccountId: outsiderId,
        organizationId: orgId,
      });
      expect(isErr(result)).toBe(true);
    });
  });

  describe('sweepAbandonedOrganizationInvitations (PRV-02, Part 7 §11: "abandoned invite metadata: 30d")', () => {
    it('sweeps a PENDING invitation whose acceptance window expired 30+ days ago', async () => {
      const invited = await createOrganizationInvitation(db, {
        actorAccountId: ownerId,
        organizationId: orgId,
        email: 'long-abandoned@example.com',
        role: 'REVIEWER',
      });
      if (!isOk(invited)) throw new Error('setup failed');
      const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
      await db
        .update(dbSchema.organizationInvitations)
        .set({ expiresAt: thirtyOneDaysAgo })
        .where(eq(dbSchema.organizationInvitations.id, invited.value.invitation.id));

      const result = await sweepAbandonedOrganizationInvitations(db);
      expect(result).toEqual({ checked: 1, deleted: 1 });

      const remaining = await db
        .select()
        .from(dbSchema.organizationInvitations)
        .where(eq(dbSchema.organizationInvitations.id, invited.value.invitation.id));
      expect(remaining).toHaveLength(0);
    });

    it('does not sweep a PENDING invitation still within the 30-day grace window past its own expiry', async () => {
      const invited = await createOrganizationInvitation(db, {
        actorAccountId: ownerId,
        organizationId: orgId,
        email: 'recently-expired@example.com',
        role: 'REVIEWER',
      });
      if (!isOk(invited)) throw new Error('setup failed');
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      await db
        .update(dbSchema.organizationInvitations)
        .set({ expiresAt: tenDaysAgo })
        .where(eq(dbSchema.organizationInvitations.id, invited.value.invitation.id));

      const result = await sweepAbandonedOrganizationInvitations(db);
      expect(result).toEqual({ checked: 0, deleted: 0 });
    });

    it('sweeps an invitation REVOKED 30+ days ago', async () => {
      const invited = await createOrganizationInvitation(db, {
        actorAccountId: ownerId,
        organizationId: orgId,
        email: 'revoked-long-ago@example.com',
        role: 'REVIEWER',
      });
      if (!isOk(invited)) throw new Error('setup failed');
      const revoked = await revokeOrganizationInvitation(db, {
        actorAccountId: ownerId,
        organizationId: orgId,
        invitationId: invited.value.invitation.id,
      });
      expect(isOk(revoked)).toBe(true);
      const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
      await db
        .update(dbSchema.organizationInvitations)
        .set({ revokedAt: thirtyOneDaysAgo })
        .where(eq(dbSchema.organizationInvitations.id, invited.value.invitation.id));

      const result = await sweepAbandonedOrganizationInvitations(db);
      expect(result).toEqual({ checked: 1, deleted: 1 });
    });

    it('never sweeps an ACCEPTED invitation, regardless of age -- it is a legitimate historical record, not abandoned metadata', async () => {
      const invited = await createOrganizationInvitation(db, {
        actorAccountId: ownerId,
        organizationId: orgId,
        email: 'accepted-long-ago@example.com',
        role: 'REVIEWER',
      });
      if (!isOk(invited)) throw new Error('setup failed');
      const recipientId = await account(db, 'accepted-long-ago@example.com');
      const accepted = await acceptOrganizationInvitation(db, {
        actorAccountId: recipientId,
        actorEmail: 'accepted-long-ago@example.com',
        rawToken: invited.value.rawToken,
      });
      expect(isOk(accepted)).toBe(true);
      const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
      await db
        .update(dbSchema.organizationInvitations)
        .set({ expiresAt: oneYearAgo })
        .where(eq(dbSchema.organizationInvitations.id, invited.value.invitation.id));

      const result = await sweepAbandonedOrganizationInvitations(db);
      expect(result).toEqual({ checked: 0, deleted: 0 });

      const remaining = await db
        .select()
        .from(dbSchema.organizationInvitations)
        .where(eq(dbSchema.organizationInvitations.id, invited.value.invitation.id));
      expect(remaining).toHaveLength(1);
    });
  });
});
