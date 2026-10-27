import { createHash } from 'node:crypto';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import {
  DEFAULT_CLIENT_GRANT_ACTIONS,
  acceptClientInvitation,
  createClientInvitation,
  getClientsJoined,
  getPublicClientInvitationView,
  readPublicClientInvitationLogo,
  revokeClientInvitation,
} from './client-invitations';
import { setConsent } from './consent';
import { type Db, schema as dbSchema } from './db';
import { addMembership, createOrganization, reviewOrganization } from './organizations';
import { resetProductEventLogForTests } from './product-events';
import type { BlobStore } from './storage';

/**
 * Growth loop 1, part A (G8a): the public view of a client invitation (it names the agency and shows
 * the terms before anyone signs in), the two invitation events, and the "clients joined" counter.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

async function freshDb(): Promise<Db> {
  return drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
}

async function account(db: Db, email: string): Promise<string> {
  const result = await provisionAccount(db, { email });
  if (!isOk(result)) throw new Error('provision failed');
  return result.value.id;
}

async function activate(db: Db, organizationId: string): Promise<void> {
  const reviewer = await account(db, `reviewer-${organizationId}@platform.example.com`);
  const reviewed = await reviewOrganization(db, {
    reviewerAccountId: reviewer,
    organizationId,
    decision: 'ACTIVE',
    stepUpSatisfied: true,
  });
  if (!isOk(reviewed)) throw new Error('org activation failed');
}

async function consentedTraveller(db: Db, email: string): Promise<string> {
  const id = await account(db, email);
  for (const type of ['CORE_PROCESSING', 'SHARING'] as const) {
    const set = await setConsent(db, { actorAccountId: id, accountId: id, type, granted: true });
    if (!isOk(set)) throw new Error('consent setup failed');
  }
  return id;
}

interface Agency {
  readonly orgId: string;
  readonly adminId: string;
  readonly ownerId: string;
}

async function agency(db: Db, tag: string, name: string, verified: boolean): Promise<Agency> {
  const adminId = await account(db, `admin-${tag}@agency.example`);
  const org = await createOrganization(db, { actorAccountId: adminId, name });
  if (!isOk(org)) throw new Error('org setup failed');
  if (verified) await activate(db, org.value.id);
  const ownerId = await account(db, `owner-${tag}@agency.example`);
  const member = await addMembership(db, {
    actorAccountId: adminId,
    organizationId: org.value.id,
    accountId: ownerId,
    role: 'CASE_MANAGER',
  });
  if (!isOk(member)) throw new Error('member setup failed');
  return { orgId: org.value.id, adminId, ownerId };
}

async function invite(db: Db, a: Agency, email = 'jane@example.com') {
  const created = await createClientInvitation(db, {
    actorAccountId: a.adminId,
    organizationId: a.orgId,
    caseOwnerAccountId: a.ownerId,
    displayName: 'Jane Traveller',
    contactDestination: email,
    requestedRoute: 'UK Standard Visitor',
  });
  if (!isOk(created)) throw new Error('invite failed');
  return created.value;
}

const logoStorage = (bytes: Uint8Array): Pick<BlobStore, 'getObject'> =>
  ({
    getObject: async () => ({ bytes }),
  }) as unknown as Pick<BlobStore, 'getObject'>;

async function productEventRows(db: Db) {
  return db.select().from(dbSchema.productEvents);
}

describe('the public view of a client invitation', () => {
  let db: Db;
  let a: Agency;

  beforeEach(async () => {
    db = await freshDb();
    a = await agency(db, 'a', 'Acme Visas', true);
  });

  it('names the agency and gives the expiry, the real grant and nothing about the person invited', async () => {
    const sent = await invite(db, a);
    const view = await getPublicClientInvitationView(db, sent.rawToken);
    expect(view).not.toBeNull();
    expect(view?.agencyName).toBe('Acme Visas');
    expect(view?.verified).toBe(true);
    expect(view?.expiresAt.getTime()).toBe(sent.invitation.expiresAt.getTime());
    // Only these fields exist: no address, no typed name, no route, no id of anything.
    expect(Object.keys(view ?? {}).sort()).toEqual([
      'accentColor',
      'agencyName',
      'expiresAt',
      'grantActions',
      'logoVersion',
      'verified',
    ]);
    const everything = JSON.stringify(view);
    for (const secret of [
      'jane@example.com',
      'Jane',
      'UK Standard Visitor',
      a.orgId,
      a.adminId,
      sent.invitation.id,
      sent.rawToken,
    ]) {
      expect(everything).not.toContain(secret);
    }
  });

  it('shows exactly the access the agency really receives on acceptance', async () => {
    const sent = await invite(db, a);
    const traveller = await consentedTraveller(db, 'jane@example.com');
    const view = await getPublicClientInvitationView(db, sent.rawToken);
    const accepted = await acceptClientInvitation(db, {
      actorAccountId: traveller,
      rawToken: sent.rawToken,
      applicantChoice: { kind: 'new' },
    });
    if (!isOk(accepted)) throw new Error('accept failed');
    const [grant] = await db
      .select()
      .from(dbSchema.grants)
      .where(eq(dbSchema.grants.applicantId, accepted.value.applicantId));
    expect([...(view?.grantActions ?? [])].sort()).toEqual([...(grant?.actions ?? [])].sort());
    expect([...DEFAULT_CLIENT_GRANT_ACTIONS].sort()).toEqual([...(grant?.actions ?? [])].sort());
  });

  it('never spends the invitation: it can still be accepted after any number of views', async () => {
    const sent = await invite(db, a);
    for (let i = 0; i < 3; i += 1) await getPublicClientInvitationView(db, sent.rawToken);
    const traveller = await consentedTraveller(db, 'jane@example.com');
    const accepted = await acceptClientInvitation(db, {
      actorAccountId: traveller,
      rawToken: sent.rawToken,
      applicantChoice: { kind: 'new' },
    });
    expect(isOk(accepted)).toBe(true);
  });

  it('gives a verified agency its accent colour and logo, and an unreviewed one neither', async () => {
    await db
      .update(dbSchema.organizations)
      .set({
        accentColor: '#1a4f8b',
        logoObjectKey: 'branding/org/logo-abc123.png',
        logoContentType: 'image/png',
      })
      .where(eq(dbSchema.organizations.id, a.orgId));
    const verifiedView = await getPublicClientInvitationView(db, (await invite(db, a)).rawToken);
    expect(verifiedView).toMatchObject({ verified: true, accentColor: '#1a4f8b' });
    expect(verifiedView?.logoVersion).toMatch(/^[A-Za-z0-9]{1,12}$/);

    const pending = await agency(db, 'p', 'Waiting Agency', false);
    await db
      .update(dbSchema.organizations)
      .set({
        accentColor: '#aa0000',
        logoObjectKey: 'branding/org/logo-zzz999.png',
        logoContentType: 'image/png',
      })
      .where(eq(dbSchema.organizations.id, pending.orgId));
    const pendingView = await getPublicClientInvitationView(
      db,
      (await invite(db, pending)).rawToken,
    );
    // Named, so the traveller knows who is asking, but never dressed as a reviewed agency.
    expect(pendingView).toMatchObject({
      agencyName: 'Waiting Agency',
      verified: false,
      accentColor: null,
      logoVersion: null,
    });
  });

  describe('is the same answer (null) whatever the reason it is not open', () => {
    it('for a token that never existed', async () => {
      expect(await getPublicClientInvitationView(db, 'N'.repeat(43))).toBeNull();
      expect(await getPublicClientInvitationView(db, '')).toBeNull();
    });

    it('for an expired, withdrawn, used or phone-number invitation, and for a closed agency', async () => {
      const expired = await invite(db, a, 'expired@example.com');
      await db
        .update(dbSchema.clientInvitations)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(dbSchema.clientInvitations.id, expired.invitation.id));

      const revoked = await invite(db, a, 'revoked@example.com');
      const revokedOk = await revokeClientInvitation(db, {
        actorAccountId: a.adminId,
        organizationId: a.orgId,
        invitationId: revoked.invitation.id,
      });
      expect(isOk(revokedOk)).toBe(true);

      const used = await invite(db, a, 'used@example.com');
      const traveller = await consentedTraveller(db, 'used@example.com');
      const usedOk = await acceptClientInvitation(db, {
        actorAccountId: traveller,
        rawToken: used.rawToken,
        applicantChoice: { kind: 'new' },
      });
      expect(isOk(usedOk)).toBe(true);

      const phone = await invite(db, a, 'phone@example.com');
      await db
        .update(dbSchema.clientInvitations)
        .set({ contactDestination: '+8801700000000' })
        .where(eq(dbSchema.clientInvitations.id, phone.invitation.id));

      const closedAgency = await agency(db, 'c', 'Closed Agency', true);
      const fromClosed = await invite(db, closedAgency, 'closed@example.com');
      for (const status of ['SUSPENDED', 'REJECTED', 'CLOSED'] as const) {
        await db
          .update(dbSchema.organizations)
          .set({ status })
          .where(eq(dbSchema.organizations.id, closedAgency.orgId));
        expect(await getPublicClientInvitationView(db, fromClosed.rawToken), status).toBeNull();
      }

      const answers = await Promise.all(
        [expired, revoked, used, phone].map((sent) =>
          getPublicClientInvitationView(db, sent.rawToken),
        ),
      );
      expect(answers).toEqual([null, null, null, null]);
    });

    it('and a link that is still open stops being open the moment it is withdrawn', async () => {
      const sent = await invite(db, a);
      expect(await getPublicClientInvitationView(db, sent.rawToken)).not.toBeNull();
      await revokeClientInvitation(db, {
        actorAccountId: a.adminId,
        organizationId: a.orgId,
        invitationId: sent.invitation.id,
      });
      expect(await getPublicClientInvitationView(db, sent.rawToken)).toBeNull();
    });

    it('treats the very end of the seventh day as closed, exactly as acceptance does', async () => {
      const sent = await invite(db, a);
      const justBefore = new Date(sent.invitation.expiresAt.getTime() - 1000);
      const justAfter = new Date(sent.invitation.expiresAt.getTime() + 1);
      expect(await getPublicClientInvitationView(db, sent.rawToken, justBefore)).not.toBeNull();
      expect(await getPublicClientInvitationView(db, sent.rawToken, justAfter)).toBeNull();
    });
  });

  describe('the logo for the public page', () => {
    const BYTES = new Uint8Array([137, 80, 78, 71]);

    beforeEach(async () => {
      await db
        .update(dbSchema.organizations)
        .set({ logoObjectKey: 'branding/org/logo-abc123.png', logoContentType: 'image/png' })
        .where(eq(dbSchema.organizations.id, a.orgId));
    });

    it('is served for an open invitation from a verified agency', async () => {
      const sent = await invite(db, a);
      const logo = await readPublicClientInvitationLogo(db, logoStorage(BYTES), sent.rawToken);
      expect(logo?.contentType).toBe('image/png');
      expect(logo?.bytes).toEqual(BYTES);
    });

    it('is withheld for an unreviewed agency, a closed invitation and an unknown token', async () => {
      const pending = await agency(db, 'p', 'Waiting Agency', false);
      await db
        .update(dbSchema.organizations)
        .set({ logoObjectKey: 'branding/org/logo-zzz999.png', logoContentType: 'image/png' })
        .where(eq(dbSchema.organizations.id, pending.orgId));
      const fromPending = await invite(db, pending);
      expect(
        await readPublicClientInvitationLogo(db, logoStorage(BYTES), fromPending.rawToken),
      ).toBeUndefined();

      const closed = await invite(db, a, 'closed@example.com');
      await revokeClientInvitation(db, {
        actorAccountId: a.adminId,
        organizationId: a.orgId,
        invitationId: closed.invitation.id,
      });
      expect(
        await readPublicClientInvitationLogo(db, logoStorage(BYTES), closed.rawToken),
      ).toBeUndefined();
      expect(
        await readPublicClientInvitationLogo(db, logoStorage(BYTES), 'N'.repeat(43)),
      ).toBeUndefined();
    });
  });
});

describe('invitation events (growth loop 1)', () => {
  let db: Db;
  let a: Agency;

  beforeEach(async () => {
    resetProductEventLogForTests();
    db = await freshDb();
    a = await agency(db, 'e', 'Acme Visas', true);
  });

  it('records one sent event when an invitation is created, with the agency and nothing else', async () => {
    const sent = await invite(db, a);
    const rows = (await productEventRows(db)).filter((r) => r.eventType === 'CLIENT_INVITE_SENT');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      accountId: a.adminId,
      organizationId: a.orgId,
      dimension: null,
      metricValue: null,
    });
    expect(rows[0]?.dedupeKey).toBe(
      createHash('sha256').update(`CLIENT_INVITE_SENT:${sent.invitation.id}`).digest('hex'),
    );
    const everything = JSON.stringify(rows);
    for (const personal of ['jane@example.com', 'Jane', 'UK Standard Visitor', sent.rawToken]) {
      expect(everything).not.toContain(personal);
    }
  });

  it('records an accepted event once, with the seconds from sent to accepted', async () => {
    const sent = await invite(db, a);
    await db
      .update(dbSchema.clientInvitations)
      .set({ createdAt: new Date(Date.now() - 3600 * 1000) })
      .where(eq(dbSchema.clientInvitations.id, sent.invitation.id));
    const traveller = await consentedTraveller(db, 'jane@example.com');
    const input = {
      actorAccountId: traveller,
      rawToken: sent.rawToken,
      applicantChoice: { kind: 'new' },
    } as const;
    expect(isOk(await acceptClientInvitation(db, input))).toBe(true);
    // A second try is refused and records nothing more.
    expect(isErr(await acceptClientInvitation(db, input))).toBe(true);

    const rows = (await productEventRows(db)).filter(
      (r) => r.eventType === 'CLIENT_INVITE_ACCEPTED',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      accountId: traveller,
      organizationId: a.orgId,
      dimension: null,
    });
    expect(rows[0]?.dedupeKey).toBe(
      createHash('sha256').update(`CLIENT_INVITE_ACCEPTED:${sent.invitation.id}`).digest('hex'),
    );
    expect(rows[0]?.metricValue).toBeGreaterThanOrEqual(3600);
    expect(rows[0]?.metricValue).toBeLessThan(3700);
    expect(JSON.stringify(rows)).not.toContain('jane@example.com');
  });

  it('records no accepted event for a refused attempt (someone else, or after withdrawal)', async () => {
    const sent = await invite(db, a);
    const stranger = await consentedTraveller(db, 'stranger@example.com');
    const refused = await acceptClientInvitation(db, {
      actorAccountId: stranger,
      rawToken: sent.rawToken,
      applicantChoice: { kind: 'new' },
    });
    expect(isErr(refused)).toBe(true);
    expect(
      (await productEventRows(db)).filter((r) => r.eventType === 'CLIENT_INVITE_ACCEPTED'),
    ).toHaveLength(0);
  });

  it('never stands in the way of the invitation when the event log cannot be written', async () => {
    await db.execute(sql`drop table product_events cascade`);
    const sent = await invite(db, a);
    expect(sent.invitation.status).toBe('PENDING');
    const traveller = await consentedTraveller(db, 'jane@example.com');
    const accepted = await acceptClientInvitation(db, {
      actorAccountId: traveller,
      rawToken: sent.rawToken,
      applicantChoice: { kind: 'new' },
    });
    expect(isOk(accepted)).toBe(true);
  });
});

describe('clients joined (agency dashboard counter)', () => {
  let db: Db;
  let a: Agency;
  let other: Agency;

  beforeEach(async () => {
    db = await freshDb();
    a = await agency(db, 'j', 'Acme Visas', true);
    other = await agency(db, 'k', 'Other Visas', true);
  });

  async function accepted(agencyOf: Agency, email: string, daysAgo = 0) {
    const sent = await invite(db, agencyOf, email);
    const traveller = await consentedTraveller(db, email);
    const result = await acceptClientInvitation(db, {
      actorAccountId: traveller,
      rawToken: sent.rawToken,
      applicantChoice: { kind: 'new' },
    });
    if (!isOk(result)) throw new Error('accept failed');
    if (daysAgo > 0) {
      await db
        .update(dbSchema.clientInvitations)
        .set({ acceptedAt: new Date(Date.now() - daysAgo * DAY_MS) })
        .where(eq(dbSchema.clientInvitations.id, sent.invitation.id));
    }
  }

  it('is zero and zero before anyone has joined, even with invitations waiting', async () => {
    await invite(db, a, 'waiting@example.com');
    const result = await getClientsJoined(db, {
      actorAccountId: a.adminId,
      organizationId: a.orgId,
    });
    expect(isOk(result) && result.value).toEqual({ total: 0, last30Days: 0 });
  });

  it('counts accepted invitations all time and in the last 30 days, and nothing else', async () => {
    await accepted(a, 'new1@example.com');
    await accepted(a, 'new2@example.com', 29);
    await accepted(a, 'old1@example.com', 31);
    await accepted(a, 'old2@example.com', 200);
    // Waiting and withdrawn invitations are not clients who joined.
    await invite(db, a, 'waiting@example.com');
    const withdrawn = await invite(db, a, 'withdrawn@example.com');
    await revokeClientInvitation(db, {
      actorAccountId: a.adminId,
      organizationId: a.orgId,
      invitationId: withdrawn.invitation.id,
    });
    const result = await getClientsJoined(db, {
      actorAccountId: a.adminId,
      organizationId: a.orgId,
    });
    expect(isOk(result) && result.value).toEqual({ total: 4, last30Days: 2 });
  });

  it('is counted from the invitation records, so past invitations count even with an empty event log', async () => {
    await accepted(a, 'past@example.com');
    await db.delete(dbSchema.productEvents);
    const result = await getClientsJoined(db, {
      actorAccountId: a.adminId,
      organizationId: a.orgId,
    });
    expect(isOk(result) && result.value.total).toBe(1);
  });

  it('keeps each agency to its own clients', async () => {
    await accepted(a, 'mine@example.com');
    await accepted(other, 'theirs1@example.com');
    await accepted(other, 'theirs2@example.com');
    const mine = await getClientsJoined(db, { actorAccountId: a.adminId, organizationId: a.orgId });
    const theirs = await getClientsJoined(db, {
      actorAccountId: other.adminId,
      organizationId: other.orgId,
    });
    expect(isOk(mine) && mine.value.total).toBe(1);
    expect(isOk(theirs) && theirs.value.total).toBe(2);
  });

  it('shows to any active member, and refuses a stranger, another agency and a deactivated member', async () => {
    await accepted(a, 'mine@example.com');
    const asMember = await getClientsJoined(db, {
      actorAccountId: a.ownerId,
      organizationId: a.orgId,
    });
    expect(isOk(asMember) && asMember.value.total).toBe(1);

    const stranger = await account(db, 'stranger@example.com');
    for (const actorAccountId of [stranger, other.adminId]) {
      const refused = await getClientsJoined(db, { actorAccountId, organizationId: a.orgId });
      expect(isErr(refused) && refused.error.code).toBe('forbidden');
    }

    await db
      .update(dbSchema.memberships)
      .set({ active: false })
      .where(eq(dbSchema.memberships.accountId, a.ownerId));
    const left = await getClientsJoined(db, { actorAccountId: a.ownerId, organizationId: a.orgId });
    expect(isErr(left) && left.error.code).toBe('forbidden');
  });

  it('answers with the number only: no names or addresses anywhere in the result', async () => {
    await accepted(a, 'private-person@example.com');
    const result = await getClientsJoined(db, {
      actorAccountId: a.adminId,
      organizationId: a.orgId,
    });
    expect(Object.keys(isOk(result) ? result.value : {}).sort()).toEqual(['last30Days', 'total']);
    expect(JSON.stringify(result)).not.toContain('private-person');
  });
});
