import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AgencyCollectionScope,
  agencyCollectionPrincipal,
  agencyCollectionScopeProblem,
  collectionLinkProof,
} from './access/collection-scope';
import { provisionAccount } from './accounts';
import type { Db } from './db';
import { runNotificationWorker } from './notifications';
import { addMembership, createOrganization, reviewOrganization } from './organizations';
import type { PackMatchTerms } from './pack-matching';
import { buildManifest, listRequirements } from './packs';
import type { KeyManagementPort, SendEmailInput } from './ports';
import { parseItems } from './umpe-collection-request-items';
import {
  type CollectionRequestInput,
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

/** Synthetic data only. Agency document requests before any traveller record (UMPE P6). */

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
const UK_TOURISM: PackMatchTerms = {
  country: ['GB', 'United Kingdom'],
  purpose: ['tourism', 'Tourism'],
  traveller: { nationality: NONE, residence: NONE },
};

function input(overrides: Partial<CollectionRequestInput> = {}): CollectionRequestInput {
  return {
    destination: 'GB',
    purpose: 'Tourism',
    route: null,
    travelFrom: '2027-03-01',
    travelTo: '2027-03-15',
    dueAt: null,
    nationality: 'Bangladesh',
    residence: null,
    applicationPlace: null,
    recipientNameHint: 'Synthetic Person',
    recipientEmailHint: null,
    packTerms: UK_TOURISM,
    ...overrides,
  };
}

async function count(db: Db, table: string): Promise<number> {
  const rows = await db.execute(sql.raw(`select count(*)::int as n from ${table}`));
  return Number((rows as unknown as { rows: { n: number }[] }).rows[0]?.n ?? 0);
}

describe('agency document requests before any traveller record (UMPE P6)', () => {
  let client: PGlite;
  let db: Db;
  let adminId: string;
  let orgId: string;
  let otherAdminId: string;
  let otherOrgId: string;
  let packVersionId: string;

  async function account(email: string): Promise<string> {
    const result = await provisionAccount(db, { email });
    if (!isOk(result)) throw new Error('account');
    return result.value.id;
  }

  async function activate(organizationId: string): Promise<void> {
    const reviewer = await account(`reviewer-${organizationId}@platform.example.test`);
    const reviewed = await reviewOrganization(db, {
      reviewerAccountId: reviewer,
      organizationId,
      decision: 'ACTIVE',
      stepUpSatisfied: true,
    });
    if (!isOk(reviewed)) throw new Error('activate');
  }

  async function scope(
    accountId = adminId,
    organizationId = orgId,
  ): Promise<AgencyCollectionScope> {
    const minted = await agencyCollectionPrincipal(db, accountId, organizationId);
    if (!minted.ok) throw new Error('scope refused');
    return minted.value;
  }

  async function publishedPack(): Promise<string> {
    const [pack] = await db
      .insert(schema.packs)
      .values({
        key: `synthetic.uk.${randomUUID()}`,
        name: 'Synthetic UK Visit',
        jurisdiction: 'United Kingdom',
        purpose: 'Tourism',
        authoritative: true,
      })
      .returning();
    if (!pack) throw new Error('pack');
    const [version] = await db
      .insert(schema.packVersions)
      .values({ packId: pack.id, version: 1, status: 'PUBLISHED' })
      .returning();
    if (!version) throw new Error('version');
    await db.insert(schema.packRequirements).values([
      {
        packVersionId: version.id,
        kind: 'DOCUMENT',
        docType: 'passport',
        citation: 'Synthetic rule 1',
        optional: false,
      },
      {
        packVersionId: version.id,
        kind: 'DOCUMENT',
        docType: 'bank_statement',
        citation: 'Synthetic rule 2',
        optional: true,
      },
      {
        packVersionId: version.id,
        kind: 'FIELD',
        fieldKey: 'full_name',
        citation: 'Synthetic rule 3',
        optional: false,
      },
    ]);
    const { checksum } = buildManifest(await listRequirements(db, version.id));
    await db
      .update(schema.packVersions)
      .set({ checksum })
      .where(eq(schema.packVersions.id, version.id));
    return version.id;
  }

  beforeEach(async () => {
    vi.stubEnv(AGENCY_COLLECTION_REQUESTS_SWITCH, 'true');
    client = await createMigratedPglite();
    db = drizzle(client, { schema }) as unknown as Db;
    adminId = await account('admin@agency-one.example.test');
    const org = await createOrganization(db, {
      actorAccountId: adminId,
      name: 'Synthetic Agency One',
    });
    if (!isOk(org)) throw new Error('org');
    orgId = org.value.id;
    await activate(orgId);
    otherAdminId = await account('admin@agency-two.example.test');
    const other = await createOrganization(db, {
      actorAccountId: otherAdminId,
      name: 'Synthetic Agency Two',
    });
    if (!isOk(other)) throw new Error('org two');
    otherOrgId = other.value.id;
    packVersionId = await publishedPack();
  }, 60_000);

  afterEach(async () => {
    vi.unstubAllEnvs();
    await client.close();
  });

  async function createdRequest(overrides: Partial<CollectionRequestInput> = {}): Promise<string> {
    const created = await createCollectionRequest(db, await scope(), input(overrides));
    if (!created.ok) throw new Error(created.error.message);
    return created.value.id;
  }

  async function issued(requestId: string) {
    const result = await issueCollectionRequest(db, await scope(), requestId);
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  }

  describe('the switch', () => {
    it('off: no scope, no link proof, an earlier scope stops working, and the public link reads closed', async () => {
      const live = await scope();
      const requestId = await createdRequest();
      const { link } = await issued(requestId);

      vi.stubEnv(AGENCY_COLLECTION_REQUESTS_SWITCH, '');
      const refused = await agencyCollectionPrincipal(db, adminId, orgId);
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.error.code).toBe('not_found');
      expect(agencyCollectionScopeProblem(live)?.code).toBe('not_found');
      expect((await listCollectionRequests(db, live)).ok).toBe(false);
      expect((await getCollectionRequest(db, live, requestId)).ok).toBe(false);
      expect((await createCollectionRequest(db, live, input())).ok).toBe(false);
      expect(collectionLinkProof(link.rawToken)).toBeNull();

      vi.stubEnv(AGENCY_COLLECTION_REQUESTS_SWITCH, 'yes');
      expect((await agencyCollectionPrincipal(db, adminId, orgId)).ok).toBe(false);
    });

    it('on: an owner gets a scope', async () => {
      expect((await agencyCollectionPrincipal(db, adminId, orgId)).ok).toBe(true);
    });
  });

  describe('who may act', () => {
    it('refuses a member who is not an owner or admin, and anyone outside the agency, as not found', async () => {
      const manager = await account('manager@agency-one.example.test');
      const added = await addMembership(db, {
        actorAccountId: adminId,
        organizationId: orgId,
        accountId: manager,
        role: 'CASE_MANAGER',
      });
      expect(isOk(added)).toBe(true);
      for (const [who, where] of [
        [manager, orgId],
        [otherAdminId, orgId],
        [adminId, randomUUID()],
        ['not-a-uuid', orgId],
      ] as const) {
        const refused = await agencyCollectionPrincipal(db, who, where);
        expect(refused.ok).toBe(false);
        if (!refused.ok) expect(refused.error.code).toBe('not_found');
      }
    });

    it('another agency cannot list, read, edit, issue, link or end a request: it looks missing', async () => {
      const requestId = await createdRequest();
      await issued(requestId);
      const other = await scope(otherAdminId, otherOrgId);
      const list = await listCollectionRequests(db, other);
      expect(list.ok && list.value).toEqual([]);
      const attempts = [
        await getCollectionRequest(db, other, requestId),
        await editCollectionDraft(db, other, requestId, {
          type: 'add',
          label: 'X',
          necessity: 'OPTIONAL',
        }),
        await issueCollectionRequest(db, other, requestId),
        await createCollectionLink(db, other, requestId),
        await endCollectionRequest(db, other, requestId, 'REVOKED'),
      ];
      for (const attempt of attempts) {
        expect(attempt.ok).toBe(false);
        if (!attempt.ok) {
          expect(attempt.error.code).toBe('not_found');
          expect(attempt.error.message).toBe('no such document request');
        }
      }
      // The same answer as an id that does not exist at all.
      const unknown = await getCollectionRequest(db, other, randomUUID());
      expect(!unknown.ok && unknown.error.message).toBe('no such document request');
      const own = await getCollectionRequest(db, await scope(), requestId);
      expect(own.ok && own.value.status).toBe('SENT');
    });

    it('refuses a copied or forged scope', async () => {
      const real = await scope();
      const copy = { ...real } as unknown as AgencyCollectionScope;
      expect(agencyCollectionScopeProblem(copy)?.code).toBe('not_found');
      expect((await listCollectionRequests(db, copy)).ok).toBe(false);
    });
  });

  it('creates, issues and links a request with no account, applicant, case or grant created', async () => {
    const before = await Promise.all(
      ['accounts', 'applicants', 'missions', 'grants', 'memberships'].map((t) => count(db, t)),
    );
    const requestId = await createdRequest();
    const { link } = await issued(requestId);
    const emailed = await createCollectionLink(db, await scope(), requestId, {
      email: { address: 'person@example.test', encryption },
    });
    expect(emailed.ok).toBe(true);
    expect(
      await openCollectionLink(db, collectionLinkProof(link.rawToken) as never),
    ).not.toBeNull();
    const after = await Promise.all(
      ['accounts', 'applicants', 'missions', 'grants', 'memberships'].map((t) => count(db, t)),
    );
    expect(after).toEqual(before);
  });

  describe('the checklist', () => {
    it('proposes the fitting official pack with necessity from the shared module, and keeps official items official', async () => {
      const requestId = await createdRequest();
      const detail = await getCollectionRequest(db, await scope(), requestId);
      if (!detail.ok || !detail.value.draftItems) throw new Error('detail');
      expect(detail.value.draftPack?.packVersionId).toBe(packVersionId);
      const items = detail.value.draftItems;
      expect(items.map((i) => [i.label, i.necessity, i.provenance])).toEqual([
        ['Full Name', 'MANDATORY', 'OFFICIAL'],
        ['Passport', 'MANDATORY', 'OFFICIAL'],
        ['Bank Statement', 'OPTIONAL', 'OFFICIAL'],
      ]);
      const mandatory = items[1];
      const optional = items[2];
      if (!mandatory || !optional) throw new Error('items');
      const s = await scope();
      const removeMandatory = await editCollectionDraft(db, s, requestId, {
        type: 'remove',
        itemId: mandatory.id,
      });
      expect(removeMandatory.ok).toBe(false);
      const retitle = await editCollectionDraft(db, s, requestId, {
        type: 'necessity',
        itemId: mandatory.id,
        necessity: 'OPTIONAL',
      });
      expect(retitle.ok).toBe(false);
      expect(
        (await editCollectionDraft(db, s, requestId, { type: 'remove', itemId: optional.id })).ok,
      ).toBe(true);
      const noted = await editCollectionDraft(db, s, requestId, {
        type: 'note',
        itemId: mandatory.id,
        note: 'Bring the original',
      });
      expect(noted.ok && noted.value.items.find((i) => i.id === mandatory.id)?.note).toBe(
        'Bring the original',
      );
    });

    it('lets the agency add, reorder and choose the necessity of its own items, never Mandatory If It Applies', async () => {
      const requestId = await createdRequest();
      const s = await scope();
      const added = await editCollectionDraft(db, s, requestId, {
        type: 'add',
        label: 'Employer letter',
        necessity: 'RECOMMENDED',
        note: 'On letterhead',
      });
      if (!added.ok) throw new Error(added.error.message);
      const agencyItem = added.value.items.at(-1);
      expect(agencyItem).toMatchObject({
        label: 'Employer letter',
        provenance: 'AGENCY_ADDED',
        source: 'agency',
        necessity: 'RECOMMENDED',
        citation: null,
      });
      if (!agencyItem) throw new Error('item');
      expect(
        (
          await editCollectionDraft(db, s, requestId, {
            type: 'add',
            label: 'Condition item',
            necessity: 'CONDITIONAL',
          })
        ).ok,
      ).toBe(false);
      const moved = await editCollectionDraft(db, s, requestId, {
        type: 'move',
        itemId: agencyItem.id,
        direction: 'up',
      });
      expect(moved.ok && moved.value.items.map((i) => i.label)).toEqual([
        'Full Name',
        'Passport',
        'Employer letter',
        'Bank Statement',
      ]);
      const changed = await editCollectionDraft(db, s, requestId, {
        type: 'necessity',
        itemId: agencyItem.id,
        necessity: 'MANDATORY',
      });
      expect(changed.ok).toBe(true);
    });

    it('starts as the agency own list when no official pack fits, and never labels those items official', async () => {
      const requestId = await createdRequest({ destination: 'JP', packTerms: null, purpose: null });
      const s = await scope();
      const detail = await getCollectionRequest(db, s, requestId);
      expect(detail.ok && detail.value.draftPack).toBeNull();
      expect(detail.ok && detail.value.draftItems).toEqual([]);
      await editCollectionDraft(db, s, requestId, {
        type: 'add',
        label: 'Passport copy',
        necessity: 'MANDATORY',
      });
      const { revisionId } = await issued(requestId);
      const read = await getCollectionRequest(db, s, requestId);
      const revision = read.ok ? read.value.revisions.find((r) => r.id === revisionId) : undefined;
      expect(revision?.packVersionId).toBeNull();
      expect(revision?.items.every((i) => i.provenance === 'AGENCY_ADDED')).toBe(true);
      // A stored agency item that claims a pack source is not read as an item at all.
      expect(
        parseItems([
          {
            id: 'x',
            label: 'Fake',
            kind: 'DOCUMENT',
            fieldKey: null,
            docType: null,
            necessity: 'MANDATORY',
            provenance: 'AGENCY_ADDED',
            groupKey: null,
            note: null,
            order: 0,
            source: randomUUID(),
            citation: null,
          },
        ]),
      ).toBeNull();
    });

    it('refuses to issue from an official checklist that is no longer published', async () => {
      const requestId = await createdRequest();
      await db
        .update(schema.packVersions)
        .set({ status: 'WITHDRAWN' })
        .where(eq(schema.packVersions.id, packVersionId));
      const refused = await issueCollectionRequest(db, await scope(), requestId);
      expect(!refused.ok && refused.error.code).toBe('stale');
    });

    it('refuses to issue when the pack no longer matches its checksum', async () => {
      const requestId = await createdRequest();
      await db
        .update(schema.packRequirements)
        .set({ citation: 'Tampered rule' })
        .where(
          and(
            eq(schema.packRequirements.packVersionId, packVersionId),
            eq(schema.packRequirements.docType, 'passport'),
          ),
        );
      const refused = await issueCollectionRequest(db, await scope(), requestId);
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.error.code).toBe('stale');
      expect(await count(db, 'agency_collection_request_revisions')).toBe(0);
    });
  });

  describe('issued revisions', () => {
    it('are immutable in the database, re-verified on read, and a reissue keeps revision 1 readable', async () => {
      const requestId = await createdRequest();
      const first = await issued(requestId);
      expect(first.revisionNo).toBe(1);
      const s = await scope();
      await editCollectionDraft(db, s, requestId, {
        type: 'add',
        label: 'Hotel booking',
        necessity: 'OPTIONAL',
      });
      const second = await issued(requestId);
      expect(second.revisionNo).toBe(2);

      const detail = await getCollectionRequest(db, s, requestId);
      if (!detail.ok) throw new Error('detail');
      const [r2, r1] = detail.value.revisions;
      expect(r1?.revisionNo).toBe(1);
      expect(r1?.intact).toBe(true);
      expect(r1?.items.map((i) => i.label)).not.toContain('Hotel booking');
      expect(r2?.items.map((i) => i.label)).toContain('Hotel booking');
      expect(r1?.packChecksum).toMatch(/^[0-9a-f]{64}$/);
      expect(r1?.brand).toEqual({ name: 'Synthetic Agency One', accentColor: null });
      // The first link was replaced by the reissue, and says so.
      const states = detail.value.links.map((l) => [l.revisionNo, l.state]);
      expect(states).toEqual([
        [2, 'OPEN'],
        [1, 'REPLACED'],
      ]);

      await expect(
        db.execute(
          sql`update agency_collection_request_revisions set items = '[]'::jsonb where id = ${first.revisionId}`,
        ),
      ).rejects.toThrow();
      await expect(
        db.execute(
          sql`delete from agency_collection_request_revisions where id = ${first.revisionId}`,
        ),
      ).rejects.toThrow();

      // Tampering simulated: only with the trigger dropped can a row change, and the read notices.
      await db.execute(
        sql`drop trigger "agency_collection_revisions_append_only" on "agency_collection_request_revisions"`,
      );
      await db.execute(
        sql`update agency_collection_request_revisions set items = jsonb_set(items, '{0,label}', '"Changed"') where id = ${first.revisionId}`,
      );
      const tampered = await getCollectionRequest(db, s, requestId);
      const r1Again = tampered.ok
        ? tampered.value.revisions.find((r) => r.id === first.revisionId)
        : undefined;
      expect(r1Again?.intact).toBe(false);
      expect(r1Again?.items).toEqual([]);
    });

    it('stores only the SHA-256 of each link token, nowhere the token itself', async () => {
      const requestId = await createdRequest();
      const { link } = await issued(requestId);
      const emailed = await createCollectionLink(db, await scope(), requestId, {
        email: { address: 'person@example.test', encryption },
      });
      if (!emailed.ok) throw new Error('email');
      const rows = await db.select().from(schema.agencyCollectionLinks);
      expect(rows.map((r) => r.tokenHash).sort()).toEqual(
        [link.rawToken, emailed.value.link.rawToken]
          .map((t) => createHash('sha256').update(t).digest('hex'))
          .sort(),
      );
      const everything = JSON.stringify([
        rows,
        await db.select().from(schema.agencyCollectionRequests),
        await db.select().from(schema.agencyCollectionRequestRevisions),
        await db.select().from(schema.notifications),
        await db.select().from(schema.auditEvents),
      ]);
      expect(everything).not.toContain(link.rawToken);
      expect(everything).not.toContain(emailed.value.link.rawToken);
    });
  });

  describe('the public link', () => {
    it('shows only the reviewed agency brand, and gives one answer for unknown, expired, revoked, replaced and ended links', async () => {
      const s = await scope();
      const requestId = await createdRequest();
      const first = await issued(requestId);
      const view = await openCollectionLink(db, collectionLinkProof(first.link.rawToken) as never);
      expect(view).toEqual({
        linkId: first.link.id,
        agency: { name: 'Synthetic Agency One', accentColor: null },
        expiresAt: first.link.expiresAt,
      });
      expect(Object.keys(view ?? {}).sort()).toEqual(['agency', 'expiresAt', 'linkId']);

      const second = await issued(requestId);
      const replaced = await openCollectionLink(
        db,
        collectionLinkProof(first.link.rawToken) as never,
      );
      const unknown = await openCollectionLink(
        db,
        collectionLinkProof(randomBytes(32).toString('base64url')) as never,
      );
      const later = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
      const expired = await openCollectionLink(
        db,
        collectionLinkProof(second.link.rawToken) as never,
        later,
      );
      await endCollectionRequest(db, s, requestId, 'REVOKED');
      const revoked = await openCollectionLink(
        db,
        collectionLinkProof(second.link.rawToken) as never,
      );
      expect([replaced, unknown, expired, revoked]).toEqual([null, null, null, null]);
      expect(collectionLinkProof('short')).toBeNull();
      expect(collectionLinkProof(null)).toBeNull();

      const list = await listCollectionRequests(db, s);
      expect(list.ok && list.value.map((r) => r.status)).toEqual(['REVOKED']);
    });

    it('names no agency that VisaStack has not reviewed, and closes for a suspended agency or a removed issuer', async () => {
      // Agency Two is still pending review.
      const s2 = await scope(otherAdminId, otherOrgId);
      const created = await createCollectionRequest(
        db,
        s2,
        input({ packTerms: null, purpose: null }),
      );
      if (!created.ok) throw new Error('create');
      await editCollectionDraft(db, s2, created.value.id, {
        type: 'add',
        label: 'Passport',
        necessity: 'MANDATORY',
      });
      const result = await issueCollectionRequest(db, s2, created.value.id);
      if (!result.ok) throw new Error(result.error.message);
      const proof = () => collectionLinkProof(result.value.link.rawToken) as never;
      expect((await openCollectionLink(db, proof()))?.agency).toBeNull();
      const detail = await getCollectionRequest(db, s2, created.value.id);
      expect(detail.ok && detail.value.revisions[0]?.brand).toBeNull();

      await db
        .update(schema.memberships)
        .set({ active: false })
        .where(eq(schema.memberships.accountId, otherAdminId));
      expect(await openCollectionLink(db, proof())).toBeNull();
      await db
        .update(schema.memberships)
        .set({ active: true })
        .where(eq(schema.memberships.accountId, otherAdminId));
      expect(await openCollectionLink(db, proof())).not.toBeNull();
      await db
        .update(schema.organizations)
        .set({ status: 'SUSPENDED' })
        .where(eq(schema.organizations.id, otherOrgId));
      expect(await openCollectionLink(db, proof())).toBeNull();
      for (const status of ['CLOSED', 'REJECTED'] as const) {
        await db
          .update(schema.organizations)
          .set({ status })
          .where(eq(schema.organizations.id, otherOrgId));
        expect(await openCollectionLink(db, proof())).toBeNull();
        // Nor can its admins act on requests any more.
        expect((await agencyCollectionPrincipal(db, otherAdminId, otherOrgId)).ok).toBe(false);
      }
    });
  });

  describe('email', () => {
    const sent: SendEmailInput[] = [];
    const emailPort = {
      async send(message: SendEmailInput) {
        sent.push(message);
        return { providerMessageId: randomUUID() };
      },
    };
    const run = () =>
      runNotificationWorker(db, emailPort, 'https://app.example.test', { encryption });

    beforeEach(() => {
      sent.length = 0;
    });

    it('sends a neutral email with the sealed link, naming the agency only when reviewed', async () => {
      const requestId = await createdRequest({
        route: 'Standard Visitor',
        recipientNameHint: 'Synthetic Person',
      });
      await issued(requestId);
      const emailed = await createCollectionLink(db, await scope(), requestId, {
        email: { address: 'person@example.test', encryption },
      });
      if (!emailed.ok) throw new Error('email');
      expect((await run()).sent).toBe(1);
      const message = sent[0];
      expect(message?.to).toBe('person@example.test');
      expect(message?.subject).toBe(
        'Synthetic Agency One asked you for documents through VisaStack',
      );
      const words = `${message?.subject} ${message?.body}`;
      for (const secret of [
        'Standard Visitor',
        'Synthetic Person',
        'Passport',
        'Tourism',
        'United Kingdom',
      ]) {
        expect(words).not.toContain(secret);
      }
      expect(message?.body).toContain(
        `https://app.example.test/collect/open?token=${emailed.value.link.rawToken}`,
      );
    });

    it('suppresses the email at send time once the link is closed, even if it is still queued', async () => {
      const requestId = await createdRequest();
      await issued(requestId);
      const emailed = await createCollectionLink(db, await scope(), requestId, {
        email: { address: 'person@example.test', encryption },
      });
      if (!emailed.ok) throw new Error('email');
      // Closed without cancelling the queued email, so only the send-time check stands in the way.
      await db
        .update(schema.agencyCollectionLinks)
        .set({ revokedAt: new Date() })
        .where(eq(schema.agencyCollectionLinks.id, emailed.value.link.id));
      const result = await run();
      expect(result.sent).toBe(0);
      expect(sent).toEqual([]);
      const [row] = await db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.resourceId, emailed.value.link.id));
      expect(row?.status).toBe('FAILED');
      expect(row?.lastError).toBe('recipient no longer authorized');
    });

    it('never sends unchecked: when the link cannot be checked the email waits for a retry', async () => {
      const requestId = await createdRequest();
      await issued(requestId);
      const emailed = await createCollectionLink(db, await scope(), requestId, {
        email: { address: 'person@example.test', encryption },
      });
      if (!emailed.ok) throw new Error('email');
      const broken: KeyManagementPort = {
        ...encryption,
        async unwrapDataKey() {
          throw new Error('key service unavailable');
        },
      };
      const first = await runNotificationWorker(db, emailPort, 'https://app.example.test', {
        encryption: broken,
      });
      expect(first.sent).toBe(0);
      expect(sent).toEqual([]);
      const [row] = await db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.resourceId, emailed.value.link.id));
      expect(row?.status).toBe('QUEUED');
      expect(row?.nextAttemptAt).not.toBeNull();
    });

    it('cancels a queued email when the request is revoked', async () => {
      const requestId = await createdRequest();
      await issued(requestId);
      const emailed = await createCollectionLink(db, await scope(), requestId, {
        email: { address: 'person@example.test', encryption },
      });
      if (!emailed.ok) throw new Error('email');
      await endCollectionRequest(db, await scope(), requestId, 'REVOKED');
      await run();
      expect(sent).toEqual([]);
      const [row] = await db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.resourceId, emailed.value.link.id));
      expect(row?.status).toBe('CANCELLED');
    });
  });
});
