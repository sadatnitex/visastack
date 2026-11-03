/**
 * UMPE P14 journey J4: an agency document request answered from an existing account.
 *
 * Covered here, on one migrated in-memory database with the real services:
 * 1. The operator chooses route, destination, purpose and a tentative travel date, edits the
 *    checklist and issues an immutable request revision.
 * 2. The recipient opens the neutral /collect answer: only a verified ACTIVE agency brand, nothing
 *    about the person, route, checklist or account; one answer for unknown, expired and revoked.
 * 3. The invited identity signs in, picks their own profile and shares only chosen EXACT versions;
 *    a newer upload never becomes visible to the agency.
 * 4. The agency reviews, asks for a replacement, and its reads leave audit rows with counts and
 *    kinds only.
 * Negatives: forwarded or wrong-email link, revoked link, closed request, no whole-vault grant,
 * another agency (denied looks exactly like missing), a requester-only member (G3).
 * Also: the existing account-based client invitation still works (A02).
 *
 * Not exercisable below the browser, so reported rather than faked: real Neon Auth sign-in (an
 * account row and the self scope stand in), real email delivery (the outbox row only), the
 * /collect page rendering, and the live deployment.
 *
 * Synthetic data only. Storage, keys and time are deterministic stand-ins.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  type CollectionResponseAccess,
  collectionResponseAccess,
  collectionResponseAccesses,
} from '../access/collection-response-access';
import {
  type AgencyCollectionScope,
  agencyCollectionPrincipal,
  collectionLinkProof,
} from '../access/collection-scope';
import {
  type GuestCollectionSessionProof,
  guestCollectionSessionProof,
} from '../access/guest-collection';
import { accountPrincipal, selfPrincipal } from '../access/principal';
import { type AuthorizedApplicant, requireAccess } from '../access/require-access';
import { verifyStepUp } from '../access/step-up-proof';
import { provisionAccount } from '../accounts';
import { createApplicant, listApplicants } from '../applicants';
import {
  acceptClientInvitation,
  createClientInvitation,
  previewClientInvitation,
} from '../client-invitations';
import { setConsent } from '../consent';
import type { Db } from '../db';
import { readDocumentAccessToken } from '../document-access-token';
import {
  addDocumentVersion,
  downloadCollectionResponseVersion,
  recheckDocumentAccess,
  registerDocument,
} from '../documents';
import {
  addMembership,
  createOrganization,
  reviewOrganization,
  setMemberMayRequestDocuments,
} from '../organizations';
import { buildManifest, listRequirements } from '../packs';
import type { KeyManagementPort } from '../ports';
import { issueStepUpAssurance } from '../step-up';
import type { AccessRef, IssueReadRefInput, StoragePort } from '../storage';
import {
  createCollectionLink,
  createCollectionRequest,
  editCollectionDraft,
  endCollectionRequest,
  getCollectionRequest,
  issueCollectionRequest,
  openCollectionLink,
} from '../umpe-collection-request-service';
import { AGENCY_COLLECTION_REQUESTS_SWITCH } from '../umpe-collection-request-switch';
import {
  type ItemProposal,
  RESPONSE_CONSENT_VERSION,
  documentKey,
} from '../umpe-collection-response-evidence';
import { listCollectionReviews, recordCollectionReview } from '../umpe-collection-response-review';
import {
  openCollectionResponseDesk,
  proposeCollectionResponse,
  readCollectionResponse,
  submitCollectionResponse,
} from '../umpe-collection-response-service';
import { startGuestSession } from '../umpe-guest-collection';

const TEST_TIMEOUT_MS = 120_000;
const SECRET = 'j4-test-access-token-secret';
const STEP_UP_SECRET = 'j4-test-step-up-secret';
const DAY_MS = 24 * 60 * 60 * 1000;
const TRAVELLER_EMAIL = 'j4-traveller@people.example.test';

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

/** Deterministic in-memory storage: no network. */
class FakeStorage implements StoragePort {
  async issueReadRef(input: IssueReadRefInput): Promise<AccessRef> {
    return {
      url: `https://files.example.test/${input.objectKey}?d=${input.disposition}&v=${input.variant}`,
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000).toISOString(),
      disposition: input.disposition,
      variant: input.variant,
    };
  }
}

async function count(db: Db, table: string): Promise<number> {
  const rows = await db.execute(sql.raw(`select count(*)::int as n from ${table}`));
  return Number((rows as unknown as { rows: { n: number }[] }).rows[0]?.n ?? 0);
}

describe('J4 agency request for an existing account', () => {
  let client: PGlite;
  let db: Db;
  let adminId: string;
  let orgId: string;
  let travellerId: string;
  let personId: string;
  let strangerId: string;
  let strangerPersonId: string;
  let otherAdminId: string;
  let otherOrgId: string;
  const storage = new FakeStorage();

  // The journey's shared state, filled step by step.
  let requestId = '';
  let firstRevisionId = '';
  let emailedToken = '';
  let responseId = '';
  let passport: { documentId: string; versionId: string };
  let statement: { documentId: string; versionId: string };
  let privateLetter: { documentId: string; versionId: string };
  let laterPassportVersion = '';

  async function account(email: string): Promise<string> {
    const result = await provisionAccount(db, { email });
    if (!isOk(result)) throw new Error('account');
    await setConsent(db, {
      actorAccountId: result.value.id,
      accountId: result.value.id,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    return result.value.id;
  }

  async function person(ownerId: string, displayName: string): Promise<string> {
    const created = await createApplicant(db, {
      actorAccountId: ownerId,
      ownerAccountId: ownerId,
      displayName,
    });
    if (!isOk(created)) throw new Error('applicant');
    return created.value.id;
  }

  async function activate(organizationId: string): Promise<void> {
    const reviewer = await account(`reviewer-${randomUUID()}@platform.example.test`);
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

  async function newVersion(documentId: string, ownerId: string): Promise<string> {
    const added = await addDocumentVersion(db, {
      actorAccountId: ownerId,
      documentId,
      bucket: 'CLEAN',
      objectKey: `synthetic/${randomUUID()}`,
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });
    if (!isOk(added)) throw new Error('version');
    return added.value.version.id;
  }

  async function document(applicantId: string, ownerId: string, docType: string, name: string) {
    const doc = await registerDocument(db, {
      actorAccountId: ownerId,
      applicantId,
      originalName: name,
      docType,
    });
    if (!isOk(doc)) throw new Error('document');
    return { documentId: doc.value.id, versionId: await newVersion(doc.value.id, ownerId) };
  }

  /** A published official checklist the request proposes (setup rows only; no gate involved). */
  async function publishedPack(): Promise<void> {
    const [pack] = await db
      .insert(schema.packs)
      .values({
        key: `synthetic.j4.${randomUUID()}`,
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
    ]);
    const { checksum } = buildManifest(await listRequirements(db, version.id));
    await db
      .update(schema.packVersions)
      .set({ checksum })
      .where(eq(schema.packVersions.id, version.id));
  }

  async function createRequest(by: AgencyCollectionScope, emailHint: string | null) {
    const created = await createCollectionRequest(db, by, {
      destination: 'GB',
      purpose: 'Tourism',
      route: 'Standard Visitor',
      travelFrom: '2027-03-01',
      travelTo: '2027-03-15',
      dueAt: null,
      nationality: 'Bangladesh',
      residence: null,
      applicationPlace: null,
      recipientNameHint: 'Synthetic Traveller',
      recipientEmailHint: emailHint,
      packTerms: {
        country: ['GB', 'United Kingdom'],
        purpose: ['tourism', 'Tourism'],
        traveller: {
          nationality: { terms: [], known: false },
          residence: { terms: [], known: false },
        },
      },
    });
    if (!created.ok) throw new Error(created.error.message);
    return created.value.id;
  }

  /** A second, fully issued request with its copied link token (for the negatives). */
  async function issuedRequest(emailHint: string | null = null) {
    const id = await createRequest(await scope(), emailHint);
    const issued = await issueCollectionRequest(db, await scope(), id);
    if (!issued.ok) throw new Error(issued.error.message);
    return { requestId: id, token: issued.value.link.rawToken };
  }

  /** A desk session for this link, the way the /collect page opens one. */
  async function link(token: string): Promise<GuestCollectionSessionProof> {
    const proof = collectionLinkProof(token);
    if (!proof) throw new Error('no link proof');
    const started = await startGuestSession(db, proof, null);
    const session = guestCollectionSessionProof(started?.rawSessionId ?? undefined);
    if (!session) throw new Error('no desk session');
    return session;
  }

  async function viewProof(ownerId: string, applicantId: string) {
    const proof = await requireAccess(
      db,
      accountPrincipal(ownerId),
      'VIEW_METADATA',
      { applicantId },
      { purpose: 'collection_response' },
    );
    if (!proof.ok) throw new Error('view proof');
    return proof.value;
  }

  async function shareProof(
    ownerId: string,
    applicantId: string,
  ): Promise<AuthorizedApplicant<'SHARE'>> {
    const request = { accountId: ownerId, action: 'SHARE' as const, resourceId: applicantId };
    const stepUp = verifyStepUp(
      STEP_UP_SECRET,
      issueStepUpAssurance(STEP_UP_SECRET, request),
      request,
    );
    if (!stepUp) throw new Error('step up');
    const proof = await requireAccess(
      db,
      accountPrincipal(ownerId),
      'SHARE',
      { applicantId },
      { purpose: 'collection_response', stepUp },
    );
    if (!proof.ok) throw new Error(`share proof: ${proof.error.code}`);
    return proof.value;
  }

  function item(proposals: readonly ItemProposal[], docType: string): ItemProposal {
    const found = proposals.find((p) => p.item.docType === docType);
    if (!found) throw new Error(`no item ${docType}`);
    return found;
  }

  /** Answer a request with exactly these versions for the passport item. */
  async function answerWithPassport(token: string, versionId: string) {
    const proposal = await proposeCollectionResponse(
      db,
      await link(token),
      await viewProof(travellerId, personId),
      { encryption },
    );
    if (!proposal.ok) throw new Error(`proposal: ${proposal.error.code}`);
    const passportItem = item(proposal.value.proposals, 'passport');
    return submitCollectionResponse(
      db,
      await link(token),
      await shareProof(travellerId, personId),
      {
        selections: { [passportItem.item.id]: [documentKey(versionId)] },
        consentVersion: RESPONSE_CONSENT_VERSION,
        linkId: proposal.value.desk.linkId,
        revisionId: proposal.value.desk.revisionId,
      },
    );
  }

  async function onlyAccess(forRequest: string): Promise<CollectionResponseAccess> {
    const accesses = await collectionResponseAccesses(db, await scope(), forRequest);
    expect(accesses).toHaveLength(1);
    const [first] = accesses;
    if (!first) throw new Error('no access');
    return first;
  }

  /** The agency's own read path for one file version, through to the serving route's recheck. */
  async function agencyOpens(
    access: CollectionResponseAccess,
    documentVersionId: string,
  ): Promise<'served' | 'not_found' | 'refused_at_redemption' | 'forbidden'> {
    const request = {
      accountId: adminId,
      action: 'DOWNLOAD_ORIGINAL' as const,
      resourceId: documentVersionId,
    };
    const stepUp = verifyStepUp(
      STEP_UP_SECRET,
      issueStepUpAssurance(STEP_UP_SECRET, request),
      request,
    );
    if (!stepUp) throw new Error('admin step up');
    const ref = await downloadCollectionResponseVersion(db, storage, access, {
      documentVersionId,
      accessTokenSecret: SECRET,
      stepUp,
    });
    if (!ref.ok) return ref.error.code === 'not_found' ? 'not_found' : 'forbidden';
    const parsed = new URL(ref.value.url);
    const fields = readDocumentAccessToken(parsed.searchParams);
    if (!fields) throw new Error('no access token on the link');
    const { sig: _sig, exp: _exp, ...rest } = fields;
    const recheck = await recheckDocumentAccess(
      db,
      rest,
      new Date(),
      decodeURIComponent(parsed.pathname.slice(1)),
    );
    return recheck.allowed ? 'served' : 'refused_at_redemption';
  }

  beforeAll(async () => {
    vi.stubEnv(AGENCY_COLLECTION_REQUESTS_SWITCH, 'true');
    client = await createMigratedPglite();
    db = drizzle(client, { schema }) as unknown as Db;
    adminId = await account('admin@agency-j4.example.test');
    const org = await createOrganization(db, {
      actorAccountId: adminId,
      name: 'Synthetic Agency J4',
    });
    if (!isOk(org)) throw new Error('org');
    orgId = org.value.id;
    await activate(orgId);
    otherAdminId = await account('admin@agency-j4-other.example.test');
    const other = await createOrganization(db, {
      actorAccountId: otherAdminId,
      name: 'Synthetic Agency Other',
    });
    if (!isOk(other)) throw new Error('org two');
    otherOrgId = other.value.id;
    await activate(otherOrgId);
    await publishedPack();

    travellerId = await account(TRAVELLER_EMAIL);
    personId = await person(travellerId, 'Synthetic Traveller');
    strangerId = await account('j4-stranger@people.example.test');
    strangerPersonId = await person(strangerId, 'Synthetic Stranger');
    passport = await document(personId, travellerId, 'passport', 'passport-scan.pdf');
    statement = await document(personId, travellerId, 'bank_statement', 'statement.pdf');
    privateLetter = await document(personId, travellerId, 'medical_report', 'private.pdf');
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    vi.unstubAllEnvs();
    await client.close();
  });

  it(
    'step 1: the operator chooses route, destination, purpose and date, edits the checklist and issues an immutable revision',
    async () => {
      const s = await scope();
      requestId = await createRequest(s, TRAVELLER_EMAIL);
      const added = await editCollectionDraft(db, s, requestId, {
        type: 'add',
        label: 'Employer letter',
        necessity: 'RECOMMENDED',
      });
      if (!added.ok) throw new Error(added.error.message);
      expect(added.value.items.map((i) => i.label)).toEqual(
        expect.arrayContaining(['Passport', 'Bank Statement', 'Employer letter']),
      );
      const issued = await issueCollectionRequest(db, s, requestId);
      if (!issued.ok) throw new Error(issued.error.message);
      expect(issued.value.revisionNo).toBe(1);
      firstRevisionId = issued.value.revisionId;

      const detail = await getCollectionRequest(db, s, requestId);
      if (!detail.ok) throw new Error('detail');
      expect(detail.value.revisions[0]).toMatchObject({ revisionNo: 1, intact: true });
      expect(detail.value).toMatchObject({
        destination: 'GB',
        purpose: 'Tourism',
        route: 'Standard Visitor',
        travelFrom: '2027-03-01',
      });
      // The issued revision refuses edits and deletes in the database itself.
      await expect(
        db.execute(
          sql`update agency_collection_request_revisions set items = '[]'::jsonb where id = ${firstRevisionId}`,
        ),
      ).rejects.toThrow();
      await expect(
        db.execute(
          sql`delete from agency_collection_request_revisions where id = ${firstRevisionId}`,
        ),
      ).rejects.toThrow();

      // The link goes to the invited address; nothing about any person exists yet.
      const emailed = await createCollectionLink(db, s, requestId, {
        email: { address: TRAVELLER_EMAIL, encryption },
      });
      if (!emailed.ok) throw new Error('emailed link');
      emailedToken = emailed.value.link.rawToken;
      expect(await count(db, 'grants')).toBe(0);
      expect(await count(db, 'agency_collection_responses')).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'step 2: /collect shows only the verified ACTIVE agency brand, and one answer for unknown, expired and revoked',
    async () => {
      const view = await openCollectionLink(db, collectionLinkProof(emailedToken) as never);
      expect(view).not.toBeNull();
      expect(Object.keys(view ?? {}).sort()).toEqual(['agency', 'expiresAt', 'linkId']);
      expect(view?.agency).toEqual({ name: 'Synthetic Agency J4', accentColor: null });
      const shown = JSON.stringify(view);
      for (const hidden of [
        'Synthetic Traveller',
        TRAVELLER_EMAIL,
        'Standard Visitor',
        'Employer letter',
        'Passport',
        'Tourism',
      ]) {
        expect(shown).not.toContain(hidden);
      }

      const unknown = await openCollectionLink(
        db,
        collectionLinkProof(randomBytes(32).toString('base64url')) as never,
      );
      const expired = await openCollectionLink(
        db,
        collectionLinkProof(emailedToken) as never,
        new Date(Date.now() + 15 * DAY_MS),
      );
      const ended = await issuedRequest();
      expect((await endCollectionRequest(db, await scope(), ended.requestId, 'REVOKED')).ok).toBe(
        true,
      );
      const revoked = await openCollectionLink(db, collectionLinkProof(ended.token) as never);
      expect([unknown, expired, revoked]).toEqual([null, null, null]);

      // An agency VisaStack has not verified is never named on the page.
      const pendingAdmin = await account('admin@agency-j4-pending.example.test');
      const pending = await createOrganization(db, {
        actorAccountId: pendingAdmin,
        name: 'Synthetic Unverified Agency',
      });
      if (!isOk(pending)) throw new Error('pending org');
      const ps = await scope(pendingAdmin, pending.value.id);
      const created = await createCollectionRequest(db, ps, {
        destination: 'GB',
        purpose: null,
        route: null,
        travelFrom: null,
        travelTo: null,
        dueAt: null,
        nationality: null,
        residence: null,
        applicationPlace: null,
        recipientNameHint: null,
        recipientEmailHint: null,
        packTerms: null,
      });
      if (!created.ok) throw new Error(created.error.message);
      await editCollectionDraft(db, ps, created.value.id, {
        type: 'add',
        label: 'Passport',
        necessity: 'MANDATORY',
      });
      const pendingIssued = await issueCollectionRequest(db, ps, created.value.id);
      if (!pendingIssued.ok) throw new Error(pendingIssued.error.message);
      const pendingView = await openCollectionLink(
        db,
        collectionLinkProof(pendingIssued.value.link.rawToken) as never,
      );
      expect(pendingView?.agency).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'step 3: the invited identity signs in, picks their own profile and shares only the chosen exact version',
    async () => {
      const desk = await openCollectionResponseDesk(
        db,
        await link(emailedToken),
        selfPrincipal(travellerId),
      );
      if (!desk.ok) throw new Error('desk');
      expect(desk.value.revisionId).toBe(firstRevisionId);
      // Opening the desk grants nothing.
      expect(await count(db, 'grants')).toBe(0);
      expect(await collectionResponseAccesses(db, await scope(), requestId)).toEqual([]);

      const proposal = await proposeCollectionResponse(
        db,
        await link(emailedToken),
        await viewProof(travellerId, personId),
        { encryption },
      );
      if (!proposal.ok) throw new Error('proposal');
      // The statement is proposed, but the person shares only the passport.
      expect(item(proposal.value.proposals, 'bank_statement').proposedKey).toBe(
        documentKey(statement.versionId),
      );
      const submitted = await answerWithPassport(emailedToken, passport.versionId);
      if (!submitted.ok) throw new Error(`submit: ${submitted.error.message}`);
      responseId = submitted.value.responseId;
      expect(submitted.value).toMatchObject({ documents: 1, details: 0 });

      const access = await onlyAccess(requestId);
      expect(await agencyOpens(access, passport.versionId)).toBe('served');
      expect(await agencyOpens(access, statement.versionId)).toBe('not_found');
      expect(await agencyOpens(access, privateLetter.versionId)).toBe('not_found');

      // A newer upload of the shared document never becomes visible to the agency.
      laterPassportVersion = await newVersion(passport.documentId, travellerId);
      expect(await agencyOpens(access, laterPassportVersion)).toBe('not_found');
      expect(await agencyOpens(access, passport.versionId)).toBe('served');
      const view = await readCollectionResponse(db, access, { encryption });
      if (!view.ok) throw new Error('view');
      const shownVersions = view.value.lines.flatMap((l) =>
        l.versions.flatMap((v) => (v.kind === 'DOCUMENT' ? [v.documentVersionId] : [])),
      );
      expect(shownVersions).toEqual([passport.versionId]);
      // No grant over the vault and no case: nothing broader than the selection exists.
      expect(await count(db, 'grants')).toBe(0);
      expect(await count(db, 'missions')).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'step 4: the agency reviews, asks for a replacement, and its reads are audited with counts and kinds only',
    async () => {
      const access = await onlyAccess(requestId);
      const view = await readCollectionResponse(db, access, { encryption });
      if (!view.ok) throw new Error('view');
      const passportLine = view.value.lines.find((l) => l.item.docType === 'passport');
      if (!passportLine) throw new Error('passport line');
      const review = await recordCollectionReview(db, await scope(), {
        source: 'account',
        answerId: responseId,
        decision: 'NEEDS_CORRECTION',
        itemNotes: { [passportLine.item.id]: 'The scan is cut off. Please send a full copy.' },
      });
      if (!review.ok) throw new Error(review.error.message);
      const reviews = await listCollectionReviews(db, await scope(), requestId);
      expect(reviews.get(responseId)?.[0]?.decision).toBe('NEEDS_CORRECTION');

      // The person answers again with the newer exact version: the agency sees one current answer.
      const again = await answerWithPassport(emailedToken, laterPassportVersion);
      if (!again.ok) throw new Error(`resubmit: ${again.error.message}`);
      expect(again.value.replaced).toBe(1);
      const current = await onlyAccess(requestId);
      expect(current.responseId).toBe(again.value.responseId);
      expect(await agencyOpens(current, laterPassportVersion)).toBe('served');
      expect((await readCollectionResponse(db, access)).ok).toBe(false);
      // The earlier decision stays on the earlier answer.
      const after = await listCollectionReviews(db, await scope(), requestId);
      expect(after.get(responseId)?.[0]?.decision).toBe('NEEDS_CORRECTION');

      const reads = await db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.eventType, 'AGENCY_COLLECTION_RESPONSE_READ'));
      expect(reads.length).toBeGreaterThan(0);
      for (const row of reads) {
        const { organizationId, ...counts } = (row.metadata ?? {}) as Record<string, unknown>;
        expect(organizationId).toBe(orgId);
        for (const value of Object.values(counts)) {
          expect(['number', 'boolean']).toContain(typeof value);
        }
      }
      const everything = JSON.stringify(reads);
      for (const hidden of ['Synthetic Traveller', 'passport-scan.pdf', TRAVELLER_EMAIL]) {
        expect(everything).not.toContain(hidden);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'negative: a forwarded or wrong-email link is refused exactly like an unknown link',
    async () => {
      const forwarded = await openCollectionResponseDesk(
        db,
        await link(emailedToken),
        selfPrincipal(strangerId),
      );
      const unknown = await openCollectionResponseDesk(
        db,
        guestCollectionSessionProof(
          randomBytes(32).toString('base64url'),
        ) as GuestCollectionSessionProof,
        selfPrincipal(strangerId),
      );
      expect(forwarded.ok).toBe(false);
      expect(unknown.ok).toBe(false);
      if (!forwarded.ok && !unknown.ok) expect(forwarded.error).toEqual(unknown.error);
      const proposal = await proposeCollectionResponse(
        db,
        await link(emailedToken),
        await viewProof(strangerId, strangerPersonId),
      );
      expect(proposal.ok).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'negative: a revoked link and a closed request refuse answers, and nothing is stored',
    async () => {
      const before = await count(db, 'agency_collection_responses');
      const revoked = await issuedRequest();
      const held = await link(revoked.token);
      const open = await openCollectionResponseDesk(db, held, selfPrincipal(travellerId));
      if (!open.ok) throw new Error('desk');
      expect((await endCollectionRequest(db, await scope(), revoked.requestId, 'REVOKED')).ok).toBe(
        true,
      );
      const refusedRevoked = await submitCollectionResponse(
        db,
        held,
        await shareProof(travellerId, personId),
        {
          selections: {},
          consentVersion: RESPONSE_CONSENT_VERSION,
          linkId: open.value.linkId,
          revisionId: open.value.revisionId,
        },
      );
      expect(!refusedRevoked.ok && refusedRevoked.error.code).toBe('not_found');

      const closed = await issuedRequest();
      const closedSession = await link(closed.token);
      const closedDesk = await openCollectionResponseDesk(
        db,
        closedSession,
        selfPrincipal(travellerId),
      );
      if (!closedDesk.ok) throw new Error('desk');
      expect((await endCollectionRequest(db, await scope(), closed.requestId, 'CLOSED')).ok).toBe(
        true,
      );
      const refusedClosed = await submitCollectionResponse(
        db,
        closedSession,
        await shareProof(travellerId, personId),
        {
          selections: {},
          consentVersion: RESPONSE_CONSENT_VERSION,
          linkId: closedDesk.value.linkId,
          revisionId: closedDesk.value.revisionId,
        },
      );
      expect(!refusedClosed.ok && refusedClosed.error.code).toBe('not_found');
      expect(await count(db, 'agency_collection_responses')).toBe(before);
      expect(await count(db, 'grants')).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'negative: another agency cannot read the response, and the denial looks exactly like a missing one',
    async () => {
      const otherScope = await scope(otherAdminId, otherOrgId);
      expect(await collectionResponseAccesses(db, otherScope, requestId)).toEqual([]);
      const [current] = await collectionResponseAccesses(db, await scope(), requestId);
      if (!current) throw new Error('current answer');
      const denied = await collectionResponseAccess(db, otherScope, current.responseId);
      const missing = await collectionResponseAccess(db, otherScope, randomUUID());
      expect(denied.ok).toBe(false);
      expect(missing.ok).toBe(false);
      if (!denied.ok && !missing.ok) expect(denied.error).toEqual(missing.error);
      expect((await listCollectionReviews(db, otherScope, requestId)).size).toBe(0);
      const foreignReview = await recordCollectionReview(db, otherScope, {
        source: 'account',
        answerId: current.responseId,
        decision: 'ACCEPTED',
      });
      expect(!foreignReview.ok && foreignReview.error.code).toBe('not_found');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'negative: a requester-only member cannot read answers or reviews (G3)',
    async () => {
      const workerId = await account('worker@agency-j4.example.test');
      const membership = await addMembership(db, {
        actorAccountId: adminId,
        organizationId: orgId,
        accountId: workerId,
        role: 'CASE_MANAGER',
      });
      if (!isOk(membership)) throw new Error('member');
      const allowed = await setMemberMayRequestDocuments(db, await scope(), {
        membershipId: membership.value.id,
        allowed: true,
      });
      if (!allowed.ok) throw new Error(allowed.error.message);
      const worker = await scope(workerId);
      expect(worker.authority).toBe('REQUESTER');
      const [current] = await collectionResponseAccesses(db, await scope(), requestId);
      if (!current) throw new Error('current answer');
      const denied = await collectionResponseAccess(db, worker, current.responseId);
      const missing = await collectionResponseAccess(db, worker, randomUUID());
      expect(denied.ok).toBe(false);
      if (!denied.ok && !missing.ok) expect(denied.error).toEqual(missing.error);
      expect(await collectionResponseAccesses(db, worker, requestId)).toEqual([]);
      expect((await listCollectionReviews(db, worker, requestId)).size).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'A02: the existing account-based client invitation still works beside agency requests',
    async () => {
      const caseOwner = await account('case-owner@agency-j4.example.test');
      const membership = await addMembership(db, {
        actorAccountId: adminId,
        organizationId: orgId,
        accountId: caseOwner,
        role: 'CASE_MANAGER',
      });
      if (!isOk(membership)) throw new Error('member');
      const invited = await account('j4-invited@people.example.test');
      await setConsent(db, {
        actorAccountId: invited,
        accountId: invited,
        type: 'SHARING',
        granted: true,
      });
      const created = await createClientInvitation(db, {
        actorAccountId: adminId,
        organizationId: orgId,
        caseOwnerAccountId: caseOwner,
        displayName: 'Synthetic Invited Client',
        contactDestination: 'j4-invited@people.example.test',
        requestedRoute: 'Synthetic visit visa',
      });
      if (!isOk(created)) throw new Error(created.error.message);
      expect(isOk(await previewClientInvitation(db, created.value.rawToken, invited))).toBe(true);
      const accepted = await acceptClientInvitation(db, {
        actorAccountId: invited,
        rawToken: created.value.rawToken,
        applicantChoice: { kind: 'new' },
      });
      if (!isOk(accepted)) throw new Error(accepted.error.message);
      expect(accepted.value.organizationId).toBe(orgId);
      const people = await listApplicants(db, invited);
      expect(people.map((p) => p.displayName)).toEqual(['Synthetic Invited Client']);
    },
    TEST_TIMEOUT_MS,
  );
});
