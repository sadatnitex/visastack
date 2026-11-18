import { randomBytes } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { type Result, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import {
  acceptClientInvitation,
  createClientInvitation,
  declineClientInvitation,
  revokeClientInvitation,
  sweepAbandonedClientInvitations,
} from './client-invitations';
import { setConsent } from './consent';
import {
  beginContributorSubmission,
  createContributorRequest,
  declineContributorRequest,
  revokeContributorRequest,
} from './contributor-requests';
import type { Db } from './db';
import type { ServiceError } from './errors';
import { invitationDeclineAvailable } from './invitation-decline-ready';
import { hashInvitationToken } from './invitation-tokens';
import {
  acceptOrganizationInvitation,
  createOrganizationInvitation,
  declineOrganizationInvitation,
  revokeOrganizationInvitation,
  sweepAbandonedOrganizationInvitations,
} from './invitations';
import { createMission } from './missions';
import { createOrganization, reviewOrganization } from './organizations';
import type { KeyManagementPort } from './ports';
import { RATE_LIMITS } from './rate-limit';
import { exhaustRateLimit } from './rate-limit.test-support';
import {
  acceptSharingInvitation,
  createSharingInvitation,
  declineSharingInvitation,
  revokeSharingInvitation,
} from './sharing-invitations';

const key = randomBytes(32);
const encryption: KeyManagementPort = {
  currentKeyVersion: () => 'fixture-v1',
  generateDataKey: async () => ({
    keyVersion: 'fixture-v1',
    plaintextDataKey: key,
    wrappedDataKey: new Uint8Array([1]),
  }),
  unwrapDataKey: async () => key,
};

let client: PGlite;
let db: Db;

beforeEach(async () => {
  client = await createMigratedPglite();
  db = drizzle(client, { schema }) as unknown as Db;
});
afterEach(async () => {
  await client.close();
});

async function account(email: string): Promise<string> {
  const made = await provisionAccount(db, { email });
  if (!made.ok) throw new Error('fixture');
  for (const type of ['CORE_PROCESSING', 'SHARING'] as const)
    await setConsent(db, {
      actorAccountId: made.value.id,
      accountId: made.value.id,
      type,
      granted: true,
    });
  return made.value.id;
}

function value<T>(result: Result<T, ServiceError>): T {
  if (!result.ok) throw new Error(`fixture: ${result.error.message}`);
  return result.value;
}

function messageKey(result: Result<unknown, ServiceError>): string | undefined {
  return result.ok ? undefined : result.error.messageKey;
}

async function auditRows(eventType: string) {
  return db.select().from(schema.auditEvents).where(eq(schema.auditEvents.eventType, eventType));
}

/** One kind of invitation, set up the same way for every shared rule below. */
interface Kind {
  readonly name: string;
  readonly eventType: string;
  /** The one answer every refused decline gives. */
  readonly answer: string;
  /** Makes a pending invitation to `email` and returns its link token and id. */
  invite(email: string): Promise<{ readonly id: string; readonly token: string }>;
  decline(accountId: string, email: string, token: string): Promise<Result<unknown, ServiceError>>;
  accept(accountId: string, email: string, token: string): Promise<Result<unknown, ServiceError>>;
  revoke(id: string): Promise<void>;
  status(id: string): Promise<{ readonly status: string; readonly tokenHash: string }>;
  expire(id: string): Promise<void>;
  /** What accepting creates, which a decline must never create. */
  created(): Promise<number>;
}

let ownerId = '';

async function sharingKind(): Promise<Kind> {
  ownerId = await account('owner@example.test');
  const applicant = value(
    await createApplicant(db, {
      actorAccountId: ownerId,
      ownerAccountId: ownerId,
      displayName: 'Synthetic Traveller',
    }),
  );
  const t = schema.sharingInvitations;
  return {
    name: 'sharing',
    eventType: 'SHARING_INVITATION_DECLINED',
    answer: 'sharing.inviteUnavailable',
    async invite(email) {
      const made = value(
        await createSharingInvitation(db, {
          actorAccountId: ownerId,
          applicantId: applicant.id,
          email,
          actions: ['VIEW_METADATA'],
          purpose: 'Synthetic review',
          encryption,
        }),
      );
      return { id: made.invitation.id, token: made.rawToken };
    },
    decline: (accountId, _email, rawToken) =>
      declineSharingInvitation(db, { actorAccountId: accountId, rawToken }),
    accept: (accountId, _email, rawToken) =>
      acceptSharingInvitation(db, { actorAccountId: accountId, rawToken }),
    async revoke(id) {
      value(await revokeSharingInvitation(db, ownerId, id));
    },
    async status(id) {
      const [row] = await db.select().from(t).where(eq(t.id, id));
      return { status: row?.status ?? '', tokenHash: row?.tokenHash ?? '' };
    },
    async expire(id) {
      await db
        .update(t)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(t.id, id));
    },
    created: async () => (await db.select().from(schema.grants)).length,
  };
}

async function activeOrganization(): Promise<string> {
  ownerId = await account('admin@agency.example');
  const org = value(await createOrganization(db, { actorAccountId: ownerId, name: 'Acme Visas' }));
  const reviewer = value(await provisionAccount(db, { email: 'reviewer@platform.example.com' }));
  value(
    await reviewOrganization(db, {
      reviewerAccountId: reviewer.id,
      organizationId: org.id,
      decision: 'ACTIVE',
      stepUpSatisfied: true,
    }),
  );
  return org.id;
}

async function clientKind(): Promise<Kind> {
  const organizationId = await activeOrganization();
  const t = schema.clientInvitations;
  return {
    name: 'client',
    eventType: 'CLIENT_INVITATION_DECLINED',
    answer: 'client_invitations.invitation_not_found',
    async invite(email) {
      const made = value(
        await createClientInvitation(db, {
          actorAccountId: ownerId,
          organizationId,
          caseOwnerAccountId: ownerId,
          displayName: 'Jane Traveller',
          contactDestination: email,
          requestedRoute: 'US B1/B2 business visa',
        }),
      );
      return { id: made.invitation.id, token: made.rawToken };
    },
    decline: (accountId, _email, rawToken) =>
      declineClientInvitation(db, { actorAccountId: accountId, rawToken }),
    accept: (accountId, _email, rawToken) =>
      acceptClientInvitation(db, {
        actorAccountId: accountId,
        rawToken,
        applicantChoice: { kind: 'new' },
      }),
    async revoke(id) {
      value(
        await revokeClientInvitation(db, {
          actorAccountId: ownerId,
          organizationId,
          invitationId: id,
        }),
      );
    },
    async status(id) {
      const [row] = await db.select().from(t).where(eq(t.id, id));
      return { status: row?.status ?? '', tokenHash: row?.tokenHash ?? '' };
    },
    async expire(id) {
      await db
        .update(t)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(t.id, id));
    },
    created: async () =>
      (await db.select().from(schema.grants)).length +
      (await db.select().from(schema.missions)).length,
  };
}

async function organizationKind(): Promise<Kind> {
  const organizationId = await activeOrganization();
  const t = schema.organizationInvitations;
  const members = async () =>
    (
      await db
        .select()
        .from(schema.memberships)
        .where(eq(schema.memberships.organizationId, organizationId))
    ).length;
  const baseline = await members();
  return {
    name: 'organization',
    eventType: 'ORGANIZATION_INVITATION_DECLINED',
    answer: 'invitations.invitation_not_found',
    async invite(email) {
      const made = value(
        await createOrganizationInvitation(db, {
          actorAccountId: ownerId,
          organizationId,
          email,
          role: 'CASE_MANAGER',
        }),
      );
      return { id: made.invitation.id, token: made.rawToken };
    },
    decline: (accountId, email, rawToken) =>
      declineOrganizationInvitation(db, { actorAccountId: accountId, actorEmail: email, rawToken }),
    accept: (accountId, email, rawToken) =>
      acceptOrganizationInvitation(db, { actorAccountId: accountId, actorEmail: email, rawToken }),
    async revoke(id) {
      value(
        await revokeOrganizationInvitation(db, {
          actorAccountId: ownerId,
          organizationId,
          invitationId: id,
        }),
      );
    },
    async status(id) {
      const [row] = await db.select().from(t).where(eq(t.id, id));
      return { status: row?.status ?? '', tokenHash: row?.tokenHash ?? '' };
    },
    async expire(id) {
      await db
        .update(t)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(t.id, id));
    },
    created: async () => (await members()) - baseline,
  };
}

async function contributorKind(): Promise<Kind> {
  ownerId = await account('case-owner@example.test');
  const applicant = value(
    await createApplicant(db, {
      actorAccountId: ownerId,
      ownerAccountId: ownerId,
      displayName: 'Owner',
    }),
  );
  const mission = value(
    await createMission(db, {
      actorAccountId: ownerId,
      applicantId: applicant.id,
      title: 'UK Student Visa',
    }),
  );
  const t = schema.contributorRequests;
  return {
    name: 'contributor',
    eventType: 'CONTRIBUTOR_REQUEST_DECLINED',
    answer: 'contributor_requests.request_not_found',
    async invite(email) {
      const made = value(
        await createContributorRequest(db, {
          actorAccountId: ownerId,
          missionId: mission.id,
          contributorEmail: email,
          docType: 'bank_statement',
          purpose: 'To support the financial sponsorship section of this visa case.',
        }),
      );
      return { id: made.request.id, token: made.rawToken };
    },
    decline: (accountId, email, rawToken) =>
      declineContributorRequest(db, { actorAccountId: accountId, actorEmail: email, rawToken }),
    accept: (accountId, email, rawToken) =>
      beginContributorSubmission(db, {
        actorAccountId: accountId,
        actorEmail: email,
        rawToken,
        allowWalletReuse: false,
      }),
    async revoke(id) {
      value(
        await revokeContributorRequest(db, {
          actorAccountId: ownerId,
          missionId: mission.id,
          requestId: id,
        }),
      );
    },
    async status(id) {
      const [row] = await db.select().from(t).where(eq(t.id, id));
      return { status: row?.status ?? '', tokenHash: row?.tokenHash ?? '' };
    },
    async expire(id) {
      await db
        .update(t)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(t.id, id));
    },
    created: async () => (await db.select().from(t).where(eq(t.status, 'SUBMITTED'))).length,
  };
}

const KINDS: readonly [string, () => Promise<Kind>][] = [
  ['sharing', sharingKind],
  ['client', clientKind],
  ['organization', organizationKind],
  ['contributor', contributorKind],
];

const INVITED = 'invited@example.test';

describe.each(KINDS)('declining a %s invitation (DECL1)', (_name, make) => {
  it('ends it for good: DECLINED, the link no longer matches, nothing is created, one audit row', async () => {
    const kind = await make();
    const { id, token } = await kind.invite(INVITED);
    const invited = await account(INVITED);

    expect(isOk(await kind.decline(invited, INVITED, token))).toBe(true);
    const after = await kind.status(id);
    expect(after.status).toBe('DECLINED');
    expect(after.tokenHash).not.toBe(hashInvitationToken(token));
    expect(after.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await kind.created()).toBe(0);

    // The same link can never be declined or accepted again.
    expect(messageKey(await kind.decline(invited, INVITED, token))).toBe(kind.answer);
    expect((await kind.accept(invited, INVITED, token)).ok).toBe(false);
    expect((await kind.status(id)).status).toBe('DECLINED');
    expect(await kind.created()).toBe(0);

    const allowed = (await auditRows(kind.eventType)).filter((row) => row.result === 'ALLOWED');
    expect(allowed).toHaveLength(1);
    expect(allowed[0]?.resourceId).toBe(id);
    expect(allowed[0]?.actorAccountId).toBe(invited);
    expect(JSON.stringify(allowed)).not.toContain(INVITED);
  }, 60_000);

  it('gives the one answer for someone else, a used, withdrawn, expired or unknown link, and changes nothing', async () => {
    const kind = await make();
    const forSomeoneElse = await kind.invite(INVITED);
    const invited = await account(INVITED);
    const stranger = await account('stranger@example.test');

    expect(
      messageKey(await kind.decline(stranger, 'stranger@example.test', forSomeoneElse.token)),
    ).toBe(kind.answer);
    expect((await kind.status(forSomeoneElse.id)).status).toBe('PENDING');

    const withdrawn = await kind.invite('withdrawn@example.test');
    const withdrawnAccount = await account('withdrawn@example.test');
    await kind.revoke(withdrawn.id);
    expect(
      messageKey(await kind.decline(withdrawnAccount, 'withdrawn@example.test', withdrawn.token)),
    ).toBe(kind.answer);
    expect((await kind.status(withdrawn.id)).status).toBe('REVOKED');

    const expired = await kind.invite('late@example.test');
    const lateAccount = await account('late@example.test');
    await kind.expire(expired.id);
    expect(messageKey(await kind.decline(lateAccount, 'late@example.test', expired.token))).toBe(
      kind.answer,
    );
    expect((await kind.status(expired.id)).status).toBe('PENDING');

    expect(messageKey(await kind.decline(invited, INVITED, 'not-a-real-token'))).toBe(kind.answer);
    expect(messageKey(await kind.decline(invited, INVITED, 'A'.repeat(43)))).toBe(kind.answer);

    // Each refusal is recorded as a kind and who tried, never which invitation, person or address.
    const denied = (await auditRows(kind.eventType)).filter((row) => row.result === 'DENIED');
    expect(denied).toHaveLength(5);
    for (const row of denied) {
      expect(row.resourceId).toBeNull();
      expect(row.applicantId).toBeNull();
      expect(row.metadata).toBeNull();
    }
    expect(
      (await auditRows(kind.eventType)).filter((row) => row.result === 'ALLOWED'),
    ).toHaveLength(0);
  }, 60_000);

  it('ends one way only when it races an accept, in either order', async () => {
    const kind = await make();
    const acceptedFirst = await kind.invite(INVITED);

    const invited = await account(INVITED);
    expect(isOk(await kind.accept(invited, INVITED, acceptedFirst.token))).toBe(true);
    expect(messageKey(await kind.decline(invited, INVITED, acceptedFirst.token))).toBe(kind.answer);
    expect((await kind.status(acceptedFirst.id)).status).not.toBe('DECLINED');

    const declinedFirst = await kind.invite('second@example.test');
    const second = await account('second@example.test');
    const before = await kind.created();
    expect(isOk(await kind.decline(second, 'second@example.test', declinedFirst.token))).toBe(true);
    expect((await kind.accept(second, 'second@example.test', declinedFirst.token)).ok).toBe(false);
    expect((await kind.status(declinedFirst.id)).status).toBe('DECLINED');
    expect(await kind.created()).toBe(before);
  }, 60_000);

  it('cannot be revoked once declined, and a withdrawal first leaves nothing to decline', async () => {
    const kind = await make();
    const { id, token } = await kind.invite(INVITED);
    const invited = await account(INVITED);
    expect(isOk(await kind.decline(invited, INVITED, token))).toBe(true);
    await expect(kind.revoke(id)).rejects.toThrow();
    expect((await kind.status(id)).status).toBe('DECLINED');
  }, 60_000);

  it('is limited per account like every other try of a link, and a limited try records nothing', async () => {
    const kind = await make();
    const { id, token } = await kind.invite(INVITED);
    const invited = await account(INVITED);
    await exhaustRateLimit(
      db,
      invited,
      'invitation.decline',
      RATE_LIMITS.INVITATION_DECLINE_ACCOUNT,
    );
    expect(messageKey(await kind.decline(invited, INVITED, token))).toBe(kind.answer);
    expect((await kind.status(id)).status).toBe('PENDING');
    expect(await auditRows(kind.eventType)).toHaveLength(0);
  }, 60_000);
});

describe('before migration 0138 is in place (DECL1)', () => {
  it('the probe says yes once the migration ran', async () => {
    expect(await invitationDeclineAvailable(db)).toBe(true);
  });

  it('says no while the sharing check lacks DECLINED, and every decline then refuses without a write', async () => {
    // Enum values cannot be dropped, but the sharing check can be put back as it was before 0138.
    await client.exec(`
      alter table sharing_invitations drop constraint sharing_invitations_status_check;
      alter table sharing_invitations add constraint sharing_invitations_status_check
        check (status in ('PENDING', 'ACCEPTED', 'REVOKED'));
    `);
    expect(await invitationDeclineAvailable(db)).toBe(false);
    const kind = await sharingKind();
    const { id, token } = await kind.invite(INVITED);
    const invited = await account(INVITED);
    expect(messageKey(await kind.decline(invited, INVITED, token))).toBe(kind.answer);
    expect((await kind.status(id)).status).toBe('PENDING');
    expect(await auditRows(kind.eventType)).toHaveLength(0);
  }, 60_000);

  it('says no on a database whose probe finds nothing', async () => {
    const stub = {
      select: () => ({ from: async () => [{ ready: false }] }),
    } as unknown as Db;
    expect(await invitationDeclineAvailable(stub)).toBe(false);
    const empty = { select: () => ({ from: async () => [] }) } as unknown as Db;
    expect(await invitationDeclineAvailable(empty)).toBe(false);
  });
});

describe('retention sweeps include declined invitations (DECL1)', () => {
  const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);

  it('deletes a client invitation declined long ago and keeps a recent one', async () => {
    const kind = await clientKind();
    const longAgo = await kind.invite(INVITED);
    const recent = await kind.invite(INVITED);
    const invited = await account(INVITED);
    value(await declineClientInvitation(db, { actorAccountId: invited, rawToken: longAgo.token }));
    value(await declineClientInvitation(db, { actorAccountId: invited, rawToken: recent.token }));
    await db
      .update(schema.clientInvitations)
      .set({ updatedAt: old })
      .where(eq(schema.clientInvitations.id, longAgo.id));
    const swept = await sweepAbandonedClientInvitations(db);
    expect(swept.deleted).toBe(1);
    expect((await kind.status(longAgo.id)).status).toBe('');
    expect((await kind.status(recent.id)).status).toBe('DECLINED');
  }, 60_000);

  it('deletes an agency invitation declined long ago and keeps a recent one', async () => {
    const kind = await organizationKind();
    const longAgo = await kind.invite(INVITED);
    const recent = await kind.invite('recent@example.test');
    const invited = await account(INVITED);
    const recentAccount = await account('recent@example.test');
    value(
      await declineOrganizationInvitation(db, {
        actorAccountId: invited,
        actorEmail: INVITED,
        rawToken: longAgo.token,
      }),
    );
    value(
      await declineOrganizationInvitation(db, {
        actorAccountId: recentAccount,
        actorEmail: 'recent@example.test',
        rawToken: recent.token,
      }),
    );
    await db
      .update(schema.organizationInvitations)
      .set({ updatedAt: old })
      .where(
        and(
          eq(schema.organizationInvitations.id, longAgo.id),
          eq(schema.organizationInvitations.status, 'DECLINED'),
        ),
      );
    const swept = await sweepAbandonedOrganizationInvitations(db);
    expect(swept.deleted).toBe(1);
    expect((await kind.status(longAgo.id)).status).toBe('');
    expect((await kind.status(recent.id)).status).toBe('DECLINED');
  }, 60_000);
});
