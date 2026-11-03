import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectionResponseAccess } from './access/collection-response-access';
import {
  type AgencyCollectionScope,
  agencyCollectionPrincipal,
  agencyCollectionScopeProblem,
  collectionLinkProof,
} from './access/collection-scope';
import { provisionAccount } from './accounts';
import type { Db } from './db';
import { emailAgencyBrand, notificationEmail, renderEmail } from './email-design';
import { GUEST_CORRECTION_EMAIL_EVENT } from './invitation-email';
import { runNotificationWorker } from './notifications';
import {
  addMembership,
  createOrganization,
  listOrgMemberships,
  reviewOrganization,
  setMemberMayRequestDocuments,
  setMembershipActive,
} from './organizations';
import type { KeyManagementPort, SendEmailInput } from './ports';
import {
  type CollectionRequestInput,
  collectionEmailState,
  createCollectionLink,
  createCollectionRequest,
  editCollectionDraft,
  endCollectionRequest,
  getCollectionRequest,
  issueCollectionRequest,
  listCollectionRequests,
  openCollectionLink,
} from './umpe-collection-request-service';
import { AGENCY_COLLECTION_REQUESTS_SWITCH } from './umpe-collection-request-switch';
import { listCollectionReviews, recordCollectionReview } from './umpe-collection-response-review';
import { listGuestSubmissions } from './umpe-guest-agency';
import { guestRecipientKey } from './umpe-guest-collection';

/** Synthetic data only. UMPE G3: request permission (A18), email truth (A07), brand (A19). */

const keys = new Map<string, Uint8Array>();
const encryption: KeyManagementPort = {
  currentKeyVersion: () => 'test-v1',
  async generateDataKey() {
    const id = randomUUID();
    const key = randomBytes(32);
    keys.set(id, key);
    return { keyVersion: 'test-v1', plaintextDataKey: key, wrappedDataKey: Buffer.from(id) };
  },
  async unwrapDataKey(version, wrapped) {
    const key = keys.get(Buffer.from(wrapped).toString());
    if (version !== 'test-v1' || !key) throw new Error('Unknown key');
    return key;
  },
};

const NONE = { terms: [], known: false };

function input(overrides: Partial<CollectionRequestInput> = {}): CollectionRequestInput {
  return {
    destination: 'GB',
    purpose: 'Tourism',
    route: 'Standard Visitor',
    travelFrom: null,
    travelTo: null,
    dueAt: null,
    nationality: null,
    residence: null,
    applicationPlace: null,
    recipientNameHint: 'Synthetic Person',
    recipientEmailHint: 'guest@example.test',
    packTerms: {
      country: ['GB'],
      purpose: ['Tourism'],
      traveller: { nationality: NONE, residence: NONE },
    },
    ...overrides,
  };
}

const sha = (value: string) => createHash('sha256').update(value).digest('hex');

describe('UMPE G3: agency request permission, email truth and brand', () => {
  let client: PGlite;
  let db: Db;
  let adminId: string;
  let orgId: string;
  let workerId: string;
  let workerMembershipId: string;
  const sent: SendEmailInput[] = [];
  const emailPort = {
    async send(message: SendEmailInput) {
      sent.push(message);
      return { providerMessageId: randomUUID() };
    },
  };
  const run = () =>
    runNotificationWorker(db, emailPort, 'https://app.example.test', { encryption });

  async function account(email: string): Promise<string> {
    const result = await provisionAccount(db, { email });
    if (!isOk(result)) throw new Error('account');
    return result.value.id;
  }

  async function scope(accountId = adminId): Promise<AgencyCollectionScope> {
    const minted = await agencyCollectionPrincipal(db, accountId, orgId);
    if (!minted.ok) throw new Error('scope refused');
    return minted.value;
  }

  async function allowWorker(allowed = true): Promise<void> {
    const changed = await setMemberMayRequestDocuments(db, await scope(), {
      membershipId: workerMembershipId,
      allowed,
    });
    if (!changed.ok) throw new Error(changed.error.message);
  }

  async function issuedRequest(by: string, overrides: Partial<CollectionRequestInput> = {}) {
    const created = await createCollectionRequest(db, await scope(by), input(overrides));
    if (!created.ok) throw new Error(created.error.message);
    const added = await editCollectionDraft(db, await scope(by), created.value.id, {
      type: 'add',
      label: 'Synthetic bank letter',
      necessity: 'MANDATORY',
    });
    if (!added.ok) throw new Error(added.error.message);
    const issued = await issueCollectionRequest(db, await scope(by), created.value.id);
    if (!issued.ok) throw new Error(issued.error.message);
    return { requestId: created.value.id, issued: issued.value };
  }

  beforeEach(async () => {
    vi.stubEnv(AGENCY_COLLECTION_REQUESTS_SWITCH, 'true');
    sent.length = 0;
    client = await createMigratedPglite();
    db = drizzle(client, { schema }) as unknown as Db;
    adminId = await account('admin@agency-g3.example.test');
    const org = await createOrganization(db, {
      actorAccountId: adminId,
      name: 'Synthetic Harbor Agency',
    });
    if (!isOk(org)) throw new Error('org');
    orgId = org.value.id;
    const reviewer = await account('reviewer@platform.example.test');
    const reviewed = await reviewOrganization(db, {
      reviewerAccountId: reviewer,
      organizationId: orgId,
      decision: 'ACTIVE',
      stepUpSatisfied: true,
    });
    if (!isOk(reviewed)) throw new Error('activate');
    workerId = await account('worker@agency-g3.example.test');
    const added = await addMembership(db, {
      actorAccountId: adminId,
      organizationId: orgId,
      accountId: workerId,
      role: 'CASE_MANAGER',
    });
    if (!isOk(added)) throw new Error('member');
    workerMembershipId = added.value.id;
  }, 60_000);

  afterEach(async () => {
    vi.unstubAllEnvs();
    await client.close();
  });

  describe('May Request Documents (A18)', () => {
    it('a member without it cannot create, list or send: everything looks missing', async () => {
      const refused = await agencyCollectionPrincipal(db, workerId, orgId);
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.error.code).toBe('not_found');
      // An admin's own request is not reachable either way.
      const { requestId } = await issuedRequest(adminId);
      const admin = await scope();
      expect((await getCollectionRequest(db, admin, requestId)).ok).toBe(true);
    });

    it('with it, a member creates, issues and emails their own request, and the link opens', async () => {
      await allowWorker();
      const worker = await scope(workerId);
      expect(worker.authority).toBe('REQUESTER');
      const { requestId, issued } = await issuedRequest(workerId);
      const emailed = await createCollectionLink(db, worker, requestId, {
        email: { address: 'guest@example.test', encryption },
      });
      expect(emailed.ok).toBe(true);
      expect(
        await openCollectionLink(db, collectionLinkProof(issued.link.rawToken) as never),
      ).not.toBeNull();
      const detail = await getCollectionRequest(db, worker, requestId);
      expect(detail.ok && detail.value.links.every((link) => link.state !== 'ISSUER_GONE')).toBe(
        true,
      );
    });

    it('a requester sees only the requests they made, never an admin request', async () => {
      await allowWorker();
      const { requestId: adminRequest } = await issuedRequest(adminId);
      const { requestId: ownRequest } = await issuedRequest(workerId);
      const worker = await scope(workerId);
      const listed = await listCollectionRequests(db, worker);
      expect(listed.ok && listed.value.map((row) => row.id)).toEqual([ownRequest]);
      const other = await getCollectionRequest(db, worker, adminRequest);
      expect(other.ok).toBe(false);
      if (!other.ok) expect(other.error.message).toBe('no such document request');
      // The admin still sees both.
      const all = await listCollectionRequests(db, await scope());
      expect(all.ok && all.value.length).toBe(2);
    });

    it('a requester cannot read answers, guest files or reviews, or decide: all look missing', async () => {
      await allowWorker();
      const { requestId } = await issuedRequest(workerId);
      const worker = await scope(workerId);
      expect(agencyCollectionScopeProblem(worker)?.code).toBe('not_found');
      expect(await listGuestSubmissions(db, worker, requestId)).toEqual([]);
      expect((await listCollectionReviews(db, worker, requestId)).size).toBe(0);
      const access = await collectionResponseAccess(db, worker, randomUUID());
      expect(access.ok).toBe(false);
      // Ending a request also takes its answers away from the admins: owners and admins only.
      const ended = await endCollectionRequest(db, worker, requestId, 'REVOKED');
      expect(ended.ok).toBe(false);
      if (!ended.ok) expect(ended.error.code).toBe('not_found');
      const review = await recordCollectionReview(db, worker, {
        source: 'guest',
        answerId: randomUUID(),
        decision: 'ACCEPTED',
      });
      expect(review.ok).toBe(false);
      if (!review.ok) expect(review.error.code).toBe('not_found');
    });

    it('only an owner or admin sets it, only for a non-admin member of the same agency; audited', async () => {
      // A member without it has no scope at all; with it, a requester still cannot hand it out.
      expect((await agencyCollectionPrincipal(db, workerId, orgId)).ok).toBe(false);
      const [adminMembership] = await db
        .select({ id: schema.memberships.id })
        .from(schema.memberships)
        .where(eq(schema.memberships.accountId, adminId));
      const onOwner = await setMemberMayRequestDocuments(db, await scope(), {
        membershipId: adminMembership?.id ?? '',
        allowed: true,
      });
      expect(onOwner.ok).toBe(false);
      if (!onOwner.ok) expect(onOwner.error.code).toBe('not_found');
      const otherOrg = await createOrganization(db, {
        actorAccountId: adminId,
        name: 'Synthetic Other Agency',
      });
      if (!isOk(otherOrg)) throw new Error('org');
      const otherScope = await agencyCollectionPrincipal(db, adminId, otherOrg.value.id);
      if (!otherScope.ok) throw new Error('other scope');
      const crossed = await setMemberMayRequestDocuments(db, otherScope.value, {
        membershipId: workerMembershipId,
        allowed: true,
      });
      expect(crossed.ok).toBe(false);
      if (!crossed.ok) expect(crossed.error.code).toBe('not_found');

      await allowWorker();
      await allowWorker(); // already on: no second record
      const members = await listOrgMemberships(db, adminId, orgId);
      expect(
        members.ok && members.value.find((m) => m.accountId === workerId)?.mayRequestDocuments,
      ).toBe(true);
      const byRequester = await setMemberMayRequestDocuments(db, await scope(workerId), {
        membershipId: workerMembershipId,
        allowed: false,
      });
      expect(byRequester.ok).toBe(false);
      await allowWorker(false);
      const audit = await db
        .select({ eventType: schema.auditEvents.eventType, metadata: schema.auditEvents.metadata })
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.resourceId, workerMembershipId));
      const kinds = audit.map((row) => row.eventType);
      expect(kinds.filter((k) => k === 'MEMBER_CAPABILITY_GRANTED')).toHaveLength(1);
      expect(kinds.filter((k) => k === 'MEMBER_CAPABILITY_REVOKED')).toHaveLength(1);
      expect(JSON.stringify(audit)).not.toContain('worker@agency-g3.example.test');
      expect((await agencyCollectionPrincipal(db, workerId, orgId)).ok).toBe(false);
    });

    it('withdrawing it, or turning the member off, closes their links at once and for good', async () => {
      await allowWorker();
      const { requestId, issued } = await issuedRequest(workerId);
      const proof = () => collectionLinkProof(issued.link.rawToken) as never;
      expect(await openCollectionLink(db, proof())).not.toBeNull();
      await allowWorker(false);
      expect(await openCollectionLink(db, proof())).toBeNull();
      const seen = await getCollectionRequest(db, await scope(), requestId);
      expect(seen.ok && seen.value.links[0]?.state).toBe('ISSUER_GONE');
      // The list agrees: no open link is left, so it no longer reads Sent.
      const listed = await listCollectionRequests(db, await scope());
      expect(listed.ok && listed.value.find((row) => row.id === requestId)?.status).not.toBe(
        'SENT',
      );

      await allowWorker();
      expect(await openCollectionLink(db, proof())).not.toBeNull();
      const off = await setMembershipActive(db, {
        actorAccountId: adminId,
        organizationId: orgId,
        membershipId: workerMembershipId,
        active: false,
      });
      expect(off.ok).toBe(true);
      expect(await openCollectionLink(db, proof())).toBeNull();
      const on = await setMembershipActive(db, {
        actorAccountId: adminId,
        organizationId: orgId,
        membershipId: workerMembershipId,
        active: true,
      });
      expect(on.ok).toBe(true);
      // Turning the member back on never quietly restores the permission.
      expect((await agencyCollectionPrincipal(db, workerId, orgId)).ok).toBe(false);
      expect(await openCollectionLink(db, proof())).toBeNull();
    });

    it('before the migration runs nobody holds it, and nothing breaks', async () => {
      await allowWorker();
      await client.exec('drop table agency_member_capabilities');
      expect((await agencyCollectionPrincipal(db, workerId, orgId)).ok).toBe(false);
      expect((await agencyCollectionPrincipal(db, adminId, orgId)).ok).toBe(true);
      const members = await listOrgMemberships(db, adminId, orgId);
      expect(members.ok && members.value.every((m) => !m.mayRequestDocuments)).toBe(true);
      const turnOn = await setMemberMayRequestDocuments(db, await scope(), {
        membershipId: workerMembershipId,
        allowed: true,
      });
      expect(turnOn.ok).toBe(false);
      const off = await setMembershipActive(db, {
        actorAccountId: adminId,
        organizationId: orgId,
        membershipId: workerMembershipId,
        active: false,
      });
      expect(off.ok).toBe(true);
    });
  });

  describe('the email state of each link (A07)', () => {
    it('reads Queued, then Sent to Mail Provider; never Delivered without a delivery signal', async () => {
      const { requestId } = await issuedRequest(adminId);
      const emailed = await createCollectionLink(db, await scope(), requestId, {
        email: { address: 'guest@example.test', encryption },
      });
      if (!emailed.ok) throw new Error('email');
      const stateOf = async () => {
        const detail = await getCollectionRequest(db, await scope(), requestId);
        if (!detail.ok) throw new Error('detail');
        return Object.fromEntries(detail.value.links.map((l) => [l.id, l.email]));
      };
      const before = await stateOf();
      expect(before[emailed.value.link.id]?.status).toBe('QUEUED');
      expect(Object.values(before).some((s) => s.status === 'NOT_EMAILED')).toBe(true);

      expect((await run()).sent).toBe(1);
      expect((await stateOf())[emailed.value.link.id]?.status).toBe('SENT');

      // A DELIVERED status without the provider's delivered time is not proof.
      await db
        .update(schema.notifications)
        .set({ status: 'DELIVERED' })
        .where(eq(schema.notifications.resourceId, emailed.value.link.id));
      expect((await stateOf())[emailed.value.link.id]?.status).toBe('SENT');
      const deliveredAt = new Date();
      await db
        .update(schema.notifications)
        .set({ deliveredAt })
        .where(eq(schema.notifications.resourceId, emailed.value.link.id));
      const delivered = (await stateOf())[emailed.value.link.id];
      expect(delivered?.status).toBe('DELIVERED');
      expect(delivered?.deliveredAt?.getTime()).toBe(deliveredAt.getTime());
    });

    it('reads Not Sent with a plain reason when the link closed before the email went', async () => {
      const { requestId } = await issuedRequest(adminId);
      const emailed = await createCollectionLink(db, await scope(), requestId, {
        email: { address: 'guest@example.test', encryption },
      });
      if (!emailed.ok) throw new Error('email');
      await db
        .update(schema.agencyCollectionLinks)
        .set({ revokedAt: new Date() })
        .where(eq(schema.agencyCollectionLinks.id, emailed.value.link.id));
      await run();
      const detail = await getCollectionRequest(db, await scope(), requestId);
      const link = detail.ok
        ? detail.value.links.find((l) => l.id === emailed.value.link.id)
        : null;
      expect(link?.email).toMatchObject({ status: 'NOT_SENT', reason: 'LINK_CLOSED' });
    });

    it('maps every outbox state truthfully', () => {
      const row = (status: string, extra: Record<string, unknown> = {}) => ({
        status,
        lastError: null,
        attempts: 0,
        sentAt: null,
        deliveredAt: null,
        ...extra,
      });
      expect(collectionEmailState(undefined, false).status).toBe('NOT_EMAILED');
      expect(collectionEmailState(undefined, true)).toMatchObject({
        status: 'NOT_SENT',
        reason: 'NOT_QUEUED',
      });
      expect(collectionEmailState(row('QUEUED', { attempts: 2 }), true)).toMatchObject({
        status: 'QUEUED',
        retrying: true,
      });
      expect(collectionEmailState(row('READ'), true).status).toBe('SENT');
      expect(collectionEmailState(row('BOUNCED'), true).status).toBe('NOT_DELIVERED');
      // A spam complaint about a delivered email: it still arrived.
      expect(
        collectionEmailState(row('BOUNCED', { deliveredAt: new Date(), sentAt: new Date() }), true)
          .status,
      ).toBe('DELIVERED');
      // Accepted, then reported failed by the provider: handed over, so never Not Sent.
      expect(
        collectionEmailState(
          row('FAILED', {
            sentAt: new Date(),
            lastError: 'The email provider rejected this message.',
          }),
          true,
        ).status,
      ).toBe('NOT_DELIVERED');
      expect(
        collectionEmailState(
          row('FAILED', { lastError: 'Email provider unavailable or request timed out' }),
          true,
        ),
      ).toMatchObject({ status: 'NOT_SENT', reason: 'PROVIDER_UNREACHABLE' });
      expect(collectionEmailState(row('CANCELLED'), true)).toMatchObject({
        status: 'NOT_SENT',
        reason: 'STOPPED',
      });
      expect(
        collectionEmailState(row('FAILED', { lastError: 'no recipient email resolvable' }), true),
      ).toMatchObject({ status: 'NOT_SENT', reason: 'NO_ADDRESS' });
      expect(
        collectionEmailState(
          row('FAILED', { lastError: 'Email provider returned status 500' }),
          true,
        ),
      ).toMatchObject({ status: 'NOT_SENT', reason: 'PROVIDER_REFUSED' });
    });
  });

  describe('agency brand on collection emails (A19)', () => {
    const content = notificationEmail({
      eventType: 'AGENCY_COLLECTION_REQUEST_SENT',
      subject: 'S',
      summary: 'A fact.',
      url: 'https://app.example.test/collect',
    });
    const context = { baseUrl: 'https://app.example.test', recipient: 'guest@example.test' };

    it('shows the agency name, a valid accent and a restrained Powered by VisaStack', () => {
      const email = renderEmail(content, {
        ...context,
        agency: { name: 'Harbor <b>Visas</b>', accentColor: '#0B5D3B' },
      });
      expect(email.html).toContain('Harbor &lt;b&gt;Visas&lt;/b&gt;');
      expect(email.html).not.toContain('<b>Visas</b>');
      expect(email.html).toContain('background:#0b5d3b');
      expect(email.html).toContain('Powered by VisaStack');
      expect(email.text).toContain('Powered by VisaStack');
    });

    it('drops an accent that is not a plain colour or is hard to read, and any blank name', () => {
      for (const accentColor of ['#ffff00', 'red', '#0b5d3b;color:red', 'url(x)', null]) {
        const email = renderEmail(content, {
          ...context,
          agency: { name: 'Harbor Visas', accentColor },
        });
        expect(email.html).toContain('background:#1d4c98');
        expect(email.html).not.toContain('color:red');
      }
      expect(emailAgencyBrand({ name: '   ', accentColor: '#0b5d3b' })).toBeNull();
      expect(renderEmail(content, context).html).not.toContain('Powered by VisaStack');
    });

    it('the worker brands the email only while the agency is ACTIVE, read at send time', async () => {
      await db
        .update(schema.organizations)
        .set({ accentColor: '#0b5d3b' })
        .where(eq(schema.organizations.id, orgId));
      const { requestId } = await issuedRequest(adminId);
      const first = await createCollectionLink(db, await scope(), requestId, {
        email: { address: 'guest@example.test', encryption },
      });
      if (!first.ok) throw new Error('email');
      await run();
      expect(sent[0]?.subject).toBe(
        'Synthetic Harbor Agency asked you for documents through VisaStack',
      );
      expect(sent[0]?.html).toContain('Synthetic Harbor Agency');
      expect(sent[0]?.html).toContain('background:#0b5d3b');
      for (const secret of ['Synthetic Person', 'Standard Visitor', 'Tourism']) {
        expect(`${sent[0]?.subject} ${sent[0]?.html}`).not.toContain(secret);
      }

      // Queued while active, sent after the agency was put back under review: no brand.
      const second = await createCollectionLink(db, await scope(), requestId, {
        email: { address: 'guest@example.test', encryption },
      });
      if (!second.ok) throw new Error('email');
      await db
        .update(schema.organizations)
        .set({ status: 'PENDING_VERIFICATION' })
        .where(eq(schema.organizations.id, orgId));
      await run();
      expect(sent).toHaveLength(2);
      // Nor does the subject or text name an agency that is no longer reviewed.
      expect(sent[1]?.subject).toBe('An agency asked you for documents through VisaStack');
      expect(`${sent[1]?.body} ${sent[1]?.html}`).not.toContain('Synthetic Harbor Agency');
      expect(sent[1]?.html).not.toContain('background:#0b5d3b');
      expect(sent[1]?.html).not.toContain('Powered by VisaStack');
    });
  });

  describe('the guest correction email (P9 gap)', () => {
    async function guestAnswer(requestId: string, revisionId: string, linkId: string) {
      const [row] = await db
        .insert(schema.agencyCollectionGuestSubmissions)
        .values({
          organizationId: orgId,
          requestId,
          revisionId,
          linkId,
          recipientKey: guestRecipientKey('guest@example.test'),
          revisionNo: 1,
          submissionNo: 1,
          retentionDays: 30,
          consentVersion: 'synthetic-v1',
          contentSha256: sha('synthetic'),
        })
        .returning({ id: schema.agencyCollectionGuestSubmissions.id });
      if (!row) throw new Error('submission');
      return row.id;
    }

    async function corrected() {
      const { requestId, issued } = await issuedRequest(adminId);
      const answerId = await guestAnswer(requestId, issued.revisionId, issued.link.id);
      const review = await recordCollectionReview(db, await scope(), {
        source: 'guest',
        answerId,
        decision: 'NEEDS_CORRECTION',
        note: 'Synthetic note about the passport page',
      });
      if (!review.ok) throw new Error(review.error.message);
      return { requestId, answerId, linkId: issued.link.id };
    }

    const correctionRows = () =>
      db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.eventType, GUEST_CORRECTION_EMAIL_EVENT));

    it('emails the guest, naming the agency and nothing else', async () => {
      await corrected();
      expect(await correctionRows()).toHaveLength(1);
      expect((await run()).sent).toBe(1);
      const message = sent[0];
      expect(message?.to).toBe('guest@example.test');
      expect(message?.subject).toBe('Synthetic Harbor Agency asked you to correct your documents');
      const words = `${message?.subject} ${message?.body} ${message?.html}`;
      for (const secret of ['Synthetic note', 'passport', 'Synthetic Person', 'Standard Visitor']) {
        expect(words).not.toContain(secret);
      }
      expect(message?.html).toContain('Powered by VisaStack');
    });

    it('is not sent once the link closes after the decision', async () => {
      const { linkId } = await corrected();
      await db
        .update(schema.agencyCollectionLinks)
        .set({ revokedAt: new Date() })
        .where(eq(schema.agencyCollectionLinks.id, linkId));
      expect((await run()).sent).toBe(0);
      expect(sent).toEqual([]);
      const [row] = await correctionRows();
      expect(row?.status).toBe('FAILED');
      expect(row?.lastError).toBe('recipient no longer authorized');
    });

    it('is not sent once the request ends, a newer decision replaces it, or the address changes', async () => {
      const ended = await corrected();
      await db
        .update(schema.agencyCollectionRequests)
        .set({ status: 'CLOSED' })
        .where(eq(schema.agencyCollectionRequests.id, ended.requestId));
      const stale = await corrected();
      const accepted = await recordCollectionReview(db, await scope(), {
        source: 'guest',
        answerId: stale.answerId,
        decision: 'ACCEPTED',
      });
      expect(accepted.ok).toBe(true);
      const moved = await corrected();
      await db
        .update(schema.agencyCollectionRequests)
        .set({ recipientEmailHint: 'someone-else@example.test' })
        .where(eq(schema.agencyCollectionRequests.id, moved.requestId));
      await db
        .update(schema.agencyCollectionLinks)
        .set({ recipientEmailHint: null })
        .where(eq(schema.agencyCollectionLinks.requestId, moved.requestId));
      expect(await correctionRows()).toHaveLength(3);
      expect((await run()).sent).toBe(0);
      expect(sent).toEqual([]);
    });

    it('queues nothing for Received or Accepted, and at most five an hour per guest', async () => {
      const { answerId } = await corrected();
      for (const decision of ['RECEIVED', 'ACCEPTED'] as const) {
        const review = await recordCollectionReview(db, await scope(), {
          source: 'guest',
          answerId,
          decision,
        });
        expect(review.ok).toBe(true);
      }
      for (let i = 0; i < 6; i++) {
        const review = await recordCollectionReview(db, await scope(), {
          source: 'guest',
          answerId,
          decision: 'NEEDS_CORRECTION',
          note: `Synthetic note ${i}`,
        });
        expect(review.ok).toBe(true);
      }
      expect(await correctionRows()).toHaveLength(5);
      const reviews = await db
        .select({ id: schema.agencyCollectionReviews.id })
        .from(schema.agencyCollectionReviews)
        .where(
          and(
            eq(schema.agencyCollectionReviews.guestSubmissionId, answerId),
            eq(schema.agencyCollectionReviews.decision, 'NEEDS_CORRECTION'),
          ),
        );
      expect(reviews).toHaveLength(7);
    });
  });
});
