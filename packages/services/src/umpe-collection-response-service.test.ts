import { randomBytes, randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type CollectionResponseAccess,
  collectionResponseAccess,
  collectionResponseAccesses,
  collectionResponseStillLive,
} from './access/collection-response-access';
import {
  type AgencyCollectionScope,
  CollectionLinkProof,
  agencyCollectionPrincipal,
  collectionLinkProof,
} from './access/collection-scope';
import {
  type GuestCollectionSessionProof,
  guestCollectionSessionProof,
} from './access/guest-collection';
import { accountPrincipal, selfPrincipal } from './access/principal';
import { type AuthorizedApplicant, requireAccess } from './access/require-access';
import { verifyStepUp } from './access/step-up-proof';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { readDocumentAccessToken } from './document-access-token';
import {
  addDocumentVersion,
  downloadCollectionResponseVersion,
  recheckDocumentAccess,
  registerDocument,
} from './documents';
import { createOrganization, reviewOrganization } from './organizations';
import type { KeyManagementPort } from './ports';
import { editFact, registerFieldDefinition } from './profile';
import { acceptGrant, createGrant } from './sharing';
import { issueStepUpAssurance } from './step-up';
import type { AccessRef, IssueReadRefInput, StoragePort } from './storage';
import {
  createCollectionLink,
  createCollectionRequest,
  endCollectionRequest,
  issueCollectionRequest,
} from './umpe-collection-request-service';
import { AGENCY_COLLECTION_REQUESTS_SWITCH } from './umpe-collection-request-switch';
import {
  type ItemProposal,
  RESPONSE_CONSENT_VERSION,
  documentKey,
  factKey,
} from './umpe-collection-response-evidence';
import {
  listOwnCollectionResponses,
  openCollectionResponseDesk,
  proposeCollectionResponse,
  protectedDetailsStepUp,
  readCollectionResponse,
  submitCollectionResponse,
  withdrawCollectionResponse,
} from './umpe-collection-response-service';
import { startGuestSession } from './umpe-guest-collection';

/** Synthetic data only. A signed-in traveller answers an agency request from their record (UMPE P7). */

const SECRET = 'p7-test-access-token-secret';
const STEP_UP_SECRET = 'p7-test-step-up-secret';
const DAY_MS = 24 * 60 * 60 * 1000;

type View = Awaited<ReturnType<typeof readCollectionResponse>>;
type Line = Extract<View, { ok: true }>['value']['lines'][number];
const docs = (l: Line) => l.versions.flatMap((v) => (v.kind === 'DOCUMENT' ? [v] : []));
const facts = (l: Line) => l.versions.flatMap((v) => (v.kind === 'FIELD' ? [v] : []));

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

describe('a signed-in traveller answers an agency request from their own record (UMPE P7)', () => {
  let client: PGlite;
  let db: Db;
  let adminId: string;
  let orgId: string;
  let travellerId: string;
  let personId: string;
  let strangerId: string;
  let strangerPersonId: string;
  let packVersionId: string;
  const storage = new FakeStorage();

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

  async function scope(): Promise<AgencyCollectionScope> {
    const minted = await agencyCollectionPrincipal(db, adminId, orgId);
    if (!minted.ok) throw new Error('scope refused');
    return minted.value;
  }

  /** A clean, servable document of this type with one version. */
  async function document(
    applicantId: string,
    ownerId: string,
    docType: string,
    name: string,
  ): Promise<{ documentId: string; versionId: string }> {
    const doc = await registerDocument(db, {
      actorAccountId: ownerId,
      applicantId,
      originalName: name,
      docType,
    });
    if (!isOk(doc)) throw new Error('document');
    const version = await newVersion(doc.value.id, ownerId);
    return { documentId: doc.value.id, versionId: version };
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
        fieldKey: 'passport.number',
        citation: 'Synthetic rule 3',
        optional: false,
      },
    ]);
    const { buildManifest, listRequirements } = await import('./packs');
    const { checksum } = buildManifest(await listRequirements(db, version.id));
    await db
      .update(schema.packVersions)
      .set({ checksum })
      .where(eq(schema.packVersions.id, version.id));
    return version.id;
  }

  /** An issued request (to this address when given) and its raw link token. */
  async function issuedRequest(emailHint: string | null = null) {
    const created = await createCollectionRequest(db, await scope(), {
      destination: 'GB',
      purpose: 'Tourism',
      route: null,
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
    const issued = await issueCollectionRequest(db, await scope(), created.value.id);
    if (!issued.ok) throw new Error(issued.error.message);
    return { requestId: created.value.id, token: issued.value.link.rawToken };
  }

  /** A desk session for this link, the way the request page opens one (P8). */
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

  async function manageProof(ownerId: string, applicantId: string) {
    const proof = await requireAccess(
      db,
      accountPrincipal(ownerId),
      'MANAGE',
      { applicantId },
      { purpose: 'collection_response' },
    );
    if (!proof.ok) throw new Error('manage proof');
    return proof.value;
  }

  function item(proposals: readonly ItemProposal[], docTypeOrField: string): ItemProposal {
    const found = proposals.find(
      (p) => p.item.docType === docTypeOrField || p.item.fieldKey === docTypeOrField,
    );
    if (!found) throw new Error(`no item ${docTypeOrField}`);
    return found;
  }

  async function onlyAccess(requestId: string): Promise<CollectionResponseAccess> {
    const accesses = await collectionResponseAccesses(db, await scope(), requestId);
    expect(accesses).toHaveLength(1);
    const [first] = accesses;
    if (!first) throw new Error('no access');
    return first;
  }

  function adminStepUp(action: 'DOWNLOAD_ORIGINAL' | 'VIEW_METADATA', resourceId: string) {
    const request = { accountId: adminId, action, resourceId };
    const proof = verifyStepUp(
      STEP_UP_SECRET,
      issueStepUpAssurance(STEP_UP_SECRET, request),
      request,
    );
    if (!proof) throw new Error('admin step up');
    return proof;
  }

  /** A file link for one version through the agency's own path, with a fresh identity check. */
  async function agencyLink(access: CollectionResponseAccess, documentVersionId: string) {
    return downloadCollectionResponseVersion(db, storage, access, {
      documentVersionId,
      accessTokenSecret: SECRET,
      stepUp: adminStepUp('DOWNLOAD_ORIGINAL', documentVersionId),
    });
  }

  /** The two tokens of a link, as the serving route reads them. */
  function linkParts(url: string) {
    const parsed = new URL(url);
    const fields = readDocumentAccessToken(parsed.searchParams);
    if (!fields) throw new Error('no access token on the link');
    const { sig: _sig, exp: _exp, ...rest } = fields;
    return { fields: rest, objectKey: decodeURIComponent(parsed.pathname.slice(1)) };
  }

  /** The agency's own read path for one file version, through to the serving route's recheck. */
  async function agencyOpens(
    access: CollectionResponseAccess,
    documentVersionId: string,
  ): Promise<'served' | 'not_found' | 'refused_at_redemption' | 'forbidden'> {
    const ref = await agencyLink(access, documentVersionId);
    if (!ref.ok) return ref.error.code === 'not_found' ? 'not_found' : 'forbidden';
    const { fields, objectKey } = linkParts(ref.value.url);
    const recheck = await recheckDocumentAccess(db, fields, new Date(), objectKey);
    return recheck.allowed ? 'served' : 'refused_at_redemption';
  }

  let passport: { documentId: string; versionId: string };
  let statement: { documentId: string; versionId: string };
  let privateLetter: { documentId: string; versionId: string };

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
    const reviewer = await account('reviewer@platform.example.test');
    const reviewed = await reviewOrganization(db, {
      reviewerAccountId: reviewer,
      organizationId: orgId,
      decision: 'ACTIVE',
      stepUpSatisfied: true,
    });
    if (!isOk(reviewed)) throw new Error('activate');
    packVersionId = await publishedPack();
    expect(packVersionId).toBeTruthy();

    travellerId = await account('traveller@people.example.test');
    personId = await person(travellerId, 'Synthetic Traveller');
    strangerId = await account('stranger@people.example.test');
    strangerPersonId = await person(strangerId, 'Synthetic Stranger');

    passport = await document(personId, travellerId, 'passport', 'passport.pdf');
    statement = await document(personId, travellerId, 'bank_statement', 'statement.pdf');
    privateLetter = await document(personId, travellerId, 'medical_report', 'private.pdf');
    await registerFieldDefinition(db, {
      key: 'passport.number',
      dataType: 'string',
      sensitivity: 'SENSITIVE',
    });
    const fact = await editFact(db, {
      actorAccountId: travellerId,
      applicantId: personId,
      fieldKey: 'passport.number',
      value: 'SYN12345',
      encryption,
    });
    if (!isOk(fact)) throw new Error(`fact: ${fact.error.message}`);
  }, 60_000);

  afterEach(async () => {
    vi.unstubAllEnvs();
    await client.close();
  });

  async function submitPassportOnly(token: string) {
    const proposal = await proposeCollectionResponse(
      db,
      await link(token),
      await viewProof(travellerId, personId),
      { encryption },
    );
    if (!proposal.ok) throw new Error(`proposal: ${proposal.error.code}`);
    const passportItem = item(proposal.value.proposals, 'passport');
    expect(passportItem.proposedKey).toBe(documentKey(passport.versionId));
    const submitted = await submitCollectionResponse(
      db,
      await link(token),
      await shareProof(travellerId, personId),
      {
        selections: { [passportItem.item.id]: [documentKey(passport.versionId)] },
        consentVersion: RESPONSE_CONSENT_VERSION,
        linkId: proposal.value.desk.linkId,
        revisionId: proposal.value.desk.revisionId,
      },
    );
    if (!submitted.ok) throw new Error(`submit: ${submitted.error.message}`);
    return { proposal: proposal.value, submitted: submitted.value };
  }

  it('opening the link grants nothing, and the checklist proposes the matching current copies and details', async () => {
    const { token, requestId } = await issuedRequest();
    const desk = await openCollectionResponseDesk(
      db,
      await link(token),
      selfPrincipal(travellerId),
    );
    expect(desk.ok).toBe(true);
    expect(await count(db, 'agency_collection_responses')).toBe(0);
    expect(await count(db, 'grants')).toBe(0);
    expect(await collectionResponseAccesses(db, await scope(), requestId)).toEqual([]);

    const proposal = await proposeCollectionResponse(
      db,
      await link(token),
      await viewProof(travellerId, personId),
      { encryption },
    );
    if (!proposal.ok) throw new Error('proposal');
    const passportItem = item(proposal.value.proposals, 'passport');
    expect(passportItem.proposedKey).toBe(documentKey(passport.versionId));
    expect(passportItem.candidates[0]).toMatchObject({ label: 'Current Copy', matches: true });
    expect(item(proposal.value.proposals, 'bank_statement').proposedKey).toBe(
      documentKey(statement.versionId),
    );
    const detail = item(proposal.value.proposals, 'passport.number');
    expect(detail.candidates).toHaveLength(1);
    expect(detail.candidates[0]).toMatchObject({ kind: 'FIELD', display: 'SYN12345' });
  });

  it('only the approved exact versions reach the agency, through its own read path; every other document stays invisible', async () => {
    const { token, requestId } = await issuedRequest();
    const { proposal, submitted } = await submitPassportOnly(token);
    expect(submitted).toMatchObject({ documents: 1, details: 0, missing: 2, replaced: 0 });

    const access = await onlyAccess(requestId);
    const view = await readCollectionResponse(db, access, { encryption });
    if (!view.ok) throw new Error('view');
    expect(view.value.status).toBe('SUBMITTED_TO_AGENCY');
    expect(view.value.intact).toBe(true);
    const shown = view.value.lines.flatMap((l) => docs(l).map((d) => d.documentVersionId));
    expect(shown).toEqual([passport.versionId]);
    expect(view.value.lines.filter((l) => l.missing)).toHaveLength(2);

    expect(await agencyOpens(access, passport.versionId)).toBe('served');
    // Proposed but not approved, and never offered for this item: both invisible.
    expect(await agencyOpens(access, statement.versionId)).toBe('not_found');
    expect(await agencyOpens(access, privateLetter.versionId)).toBe('not_found');
    // The detail was proposed but left out: its value is never shown.
    expect(item(proposal.proposals, 'passport.number').proposedKey).not.toBeNull();
    expect(JSON.stringify(view.value)).not.toContain('SYN12345');

    // No grant and no case: nothing broader than the selection exists anywhere.
    expect(await count(db, 'grants')).toBe(0);
    expect(await count(db, 'missions')).toBe(0);
    expect(await count(db, 'agency_collection_response_items')).toBe(3);
  });

  it('a later new version of a shared document is not shared; the submitted version stays exactly as it was', async () => {
    const { token, requestId } = await issuedRequest();
    await submitPassportOnly(token);
    const later = await newVersion(passport.documentId, travellerId);

    const access = await onlyAccess(requestId);
    expect(await agencyOpens(access, later)).toBe('not_found');
    expect(await agencyOpens(access, passport.versionId)).toBe('served');
    const view = await readCollectionResponse(db, access);
    if (!view.ok) throw new Error('view');
    const shown = view.value.lines.flatMap(docs);
    expect(shown).toEqual([
      expect.objectContaining({ documentVersionId: passport.versionId, versionNumber: 1 }),
    ]);
  });

  it('a chosen detail is shown from its exact version, never a later edit', async () => {
    const { token, requestId } = await issuedRequest();
    const proposal = await proposeCollectionResponse(
      db,
      await link(token),
      await viewProof(travellerId, personId),
      { encryption },
    );
    if (!proposal.ok) throw new Error('proposal');
    const detail = item(proposal.value.proposals, 'passport.number');
    const chosen = detail.candidates[0];
    if (!chosen || chosen.kind !== 'FIELD') throw new Error('no detail');
    const submitted = await submitCollectionResponse(
      db,
      await link(token),
      await shareProof(travellerId, personId),
      {
        selections: { [detail.item.id]: [factKey(chosen.factVersionId)] },
        consentVersion: RESPONSE_CONSENT_VERSION,
        linkId: proposal.value.desk.linkId,
        revisionId: proposal.value.desk.revisionId,
      },
    );
    expect(submitted.ok).toBe(true);
    const edited = await editFact(db, {
      actorAccountId: travellerId,
      applicantId: personId,
      fieldKey: 'passport.number',
      value: 'SYN99999',
      encryption,
    });
    expect(isOk(edited)).toBe(true);
    const access = await onlyAccess(requestId);
    // A protected detail stays closed until the admin confirms it is them.
    const closedView = await readCollectionResponse(db, access, { encryption });
    if (!closedView.ok) throw new Error('view');
    expect(closedView.value.hasProtectedDetails).toBe(true);
    expect(closedView.value.lines.flatMap(facts)).toEqual([
      { kind: 'FIELD', value: null, protected: true },
    ]);
    const step = protectedDetailsStepUp(access);
    const view = await readCollectionResponse(db, access, {
      encryption,
      stepUp: adminStepUp(step.action, step.resourceId),
    });
    if (!view.ok) throw new Error('view');
    const values = view.value.lines.flatMap((l) => facts(l).map((d) => d.value));
    expect(values).toEqual(['SYN12345']);
    const reads = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'AGENCY_COLLECTION_RESPONSE_READ'));
    // Every agency read is audited; only the second opened a protected detail.
    expect(reads.map((r) => (r.metadata as { protectedOpened?: number }).protectedOpened)).toEqual([
      0, 1,
    ]);
    expect(JSON.stringify(reads[0]?.metadata)).not.toContain('SYN');
  });

  it('a wrong account gets the same neutral refusal as a closed link, recorded once', async () => {
    const { requestId } = await issuedRequest('traveller@people.example.test');
    const emailed = await createCollectionLink(db, await scope(), requestId, {
      email: { address: 'traveller@people.example.test', encryption },
    });
    if (!emailed.ok) throw new Error('emailed link');
    const token = emailed.value.link.rawToken;
    const wrong = await openCollectionResponseDesk(
      db,
      await link(token),
      selfPrincipal(strangerId),
    );
    const unknown = await openCollectionResponseDesk(
      db,
      guestCollectionSessionProof(
        randomBytes(32).toString('base64url'),
      ) as GuestCollectionSessionProof,
      selfPrincipal(strangerId),
    );
    expect(wrong.ok).toBe(false);
    expect(unknown.ok).toBe(false);
    if (!wrong.ok && !unknown.ok) expect(wrong.error).toEqual(unknown.error);
    await openCollectionResponseDesk(db, await link(token), selfPrincipal(strangerId));
    const proposal = await proposeCollectionResponse(
      db,
      await link(token),
      await viewProof(strangerId, strangerPersonId),
    );
    expect(proposal.ok).toBe(false);
    const audits = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'AGENCY_COLLECTION_RESPONSE_WRONG_ACCOUNT'));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actorAccountId).toBe(strangerId);

    const right = await openCollectionResponseDesk(
      db,
      await link(token),
      selfPrincipal(travellerId),
    );
    expect(right.ok).toBe(true);
  });

  it("another traveller's person cannot be chosen, and nobody answers through a grant", async () => {
    const { token } = await issuedRequest();
    // The gate never issues a proof for someone else's person.
    const foreign = await requireAccess(
      db,
      accountPrincipal(travellerId),
      'VIEW_METADATA',
      { applicantId: strangerPersonId },
      { purpose: 'collection_response' },
    );
    expect(foreign.ok).toBe(false);

    // A person shared with the traveller is still not theirs to answer for.
    await setConsent(db, {
      actorAccountId: strangerId,
      accountId: strangerId,
      type: 'SHARING',
      granted: true,
    });
    const grant = await createGrant(db, {
      actorAccountId: strangerId,
      applicantId: strangerPersonId,
      recipientAccountId: travellerId,
      actions: ['VIEW_METADATA'],
      purpose: 'collection_response',
    });
    if (!isOk(grant)) throw new Error(`grant: ${grant.error.message}`);
    await acceptGrant(db, { actorAccountId: travellerId, grantId: grant.value.id });
    const shared = await requireAccess(
      db,
      accountPrincipal(travellerId),
      'VIEW_METADATA',
      { applicantId: strangerPersonId },
      { purpose: 'collection_response' },
    );
    if (!shared.ok) throw new Error('shared view');
    expect(shared.value.actor.kind).toBe('individual_recipient');
    const refused = await proposeCollectionResponse(db, await link(token), shared.value);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe('not_found');
  });

  it('a revoked or expired request blocks submission', async () => {
    const first = await issuedRequest();
    const proposal = await proposeCollectionResponse(
      db,
      await link(first.token),
      await viewProof(travellerId, personId),
    );
    if (!proposal.ok) throw new Error('proposal');
    const passportItem = item(proposal.value.proposals, 'passport');
    // The desk session was opened before the agency revoked the request.
    const heldSession = await link(first.token);
    const ended = await endCollectionRequest(db, await scope(), first.requestId, 'REVOKED');
    expect(ended.ok).toBe(true);
    const revoked = await submitCollectionResponse(
      db,
      heldSession,
      await shareProof(travellerId, personId),
      {
        selections: { [passportItem.item.id]: [documentKey(passport.versionId)] },
        consentVersion: RESPONSE_CONSENT_VERSION,
        linkId: proposal.value.desk.linkId,
        revisionId: proposal.value.desk.revisionId,
      },
    );
    expect(revoked.ok).toBe(false);
    if (!revoked.ok) expect(revoked.error.code).toBe('not_found');

    const second = await issuedRequest();
    const open = await openCollectionResponseDesk(
      db,
      await link(second.token),
      selfPrincipal(travellerId),
    );
    if (!open.ok) throw new Error('desk');
    const expired = await submitCollectionResponse(
      db,
      await link(second.token),
      await shareProof(travellerId, personId),
      {
        selections: {},
        consentVersion: RESPONSE_CONSENT_VERSION,
        linkId: open.value.linkId,
        revisionId: open.value.revisionId,
        now: new Date(Date.now() + 30 * DAY_MS),
      },
    );
    expect(expired.ok).toBe(false);
    if (!expired.ok) expect(expired.error.code).toBe('not_found');
    expect(await count(db, 'agency_collection_responses')).toBe(0);
  });

  it('refuses a choice that was never offered, and a submission without the current consent', async () => {
    const { token } = await issuedRequest();
    const proposal = await proposeCollectionResponse(
      db,
      await link(token),
      await viewProof(travellerId, personId),
    );
    if (!proposal.ok) throw new Error('proposal');
    const passportItem = item(proposal.value.proposals, 'passport');
    const foreignDocument = await document(strangerPersonId, strangerId, 'passport', 'theirs.pdf');
    const smuggled = await submitCollectionResponse(
      db,
      await link(token),
      await shareProof(travellerId, personId),
      {
        selections: { [passportItem.item.id]: [documentKey(foreignDocument.versionId)] },
        consentVersion: RESPONSE_CONSENT_VERSION,
        linkId: proposal.value.desk.linkId,
        revisionId: proposal.value.desk.revisionId,
      },
    );
    expect(smuggled.ok).toBe(false);
    const noConsent = await submitCollectionResponse(
      db,
      await link(token),
      await shareProof(travellerId, personId),
      {
        selections: {},
        consentVersion: 'old-wording',
        linkId: proposal.value.desk.linkId,
        revisionId: proposal.value.desk.revisionId,
      },
    );
    expect(noConsent.ok).toBe(false);
    expect(await count(db, 'agency_collection_responses')).toBe(0);
  });

  it('with the switch off every step is not found, including an already issued file link', async () => {
    const { token, requestId } = await issuedRequest();
    await submitPassportOnly(token);
    const access = await onlyAccess(requestId);
    const ref = await agencyLink(access, passport.versionId);
    if (!ref.ok) throw new Error('ref');
    const { fields, objectKey } = linkParts(ref.value.url);

    vi.stubEnv(AGENCY_COLLECTION_REQUESTS_SWITCH, '');
    expect(collectionLinkProof(token)).toBeNull();
    expect((await readCollectionResponse(db, access)).ok).toBe(false);
    const again = await agencyLink(access, passport.versionId);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe('not_found');
    expect((await recheckDocumentAccess(db, fields, new Date(), objectKey)).allowed).toBe(false);
  });

  it('withdrawing ends the agency access at once, including a file link already handed out', async () => {
    const { token, requestId } = await issuedRequest();
    const { submitted } = await submitPassportOnly(token);
    const access = await onlyAccess(requestId);
    const ref = await agencyLink(access, passport.versionId);
    if (!ref.ok) throw new Error('ref');
    const { fields: rest, objectKey } = linkParts(ref.value.url);
    expect((await recheckDocumentAccess(db, rest, new Date(), objectKey)).allowed).toBe(true);

    const own = await listOwnCollectionResponses(db, await viewProof(travellerId, personId));
    if (!own.ok) throw new Error('own');
    expect(own.value).toEqual([
      expect.objectContaining({
        id: submitted.responseId,
        agencyName: 'Synthetic Agency One',
        documents: 1,
        missing: 2,
        withdrawnAt: null,
      }),
    ]);
    const withdrawn = await withdrawCollectionResponse(
      db,
      await manageProof(travellerId, personId),
      submitted.responseId,
    );
    expect(withdrawn.ok).toBe(true);
    expect((await recheckDocumentAccess(db, rest, new Date(), objectKey)).allowed).toBe(false);
    expect((await readCollectionResponse(db, access)).ok).toBe(false);
    expect(await collectionResponseAccesses(db, await scope(), requestId)).toEqual([]);
    const twice = await withdrawCollectionResponse(
      db,
      await manageProof(travellerId, personId),
      submitted.responseId,
    );
    expect(twice.ok).toBe(false);
  });

  it('answering again replaces the earlier answer, so the agency sees one current answer', async () => {
    const { token, requestId } = await issuedRequest();
    const first = await submitPassportOnly(token);
    const second = await submitPassportOnly(token);
    expect(second.submitted.replaced).toBe(1);
    const replaced = await db
      .select()
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.eventType, 'AGENCY_COLLECTION_RESPONSE_WITHDRAWN'),
          eq(schema.auditEvents.resourceId, first.submitted.responseId),
        ),
      );
    expect(replaced.map((r) => r.reason)).toEqual(['replaced_by_new_answer']);
    const access = await onlyAccess(requestId);
    expect(access.responseId).toBe(second.submitted.responseId);
    const old = await collectionResponseAccess(db, await scope(), first.submitted.responseId);
    expect(old.ok).toBe(false);
  });

  it("another agency never reaches this agency's responses", async () => {
    const { token, requestId } = await issuedRequest();
    const { submitted } = await submitPassportOnly(token);
    const otherAdmin = await account('admin@agency-two.example.test');
    const other = await createOrganization(db, {
      actorAccountId: otherAdmin,
      name: 'Synthetic Agency Two',
    });
    if (!isOk(other)) throw new Error('org two');
    const otherScope = await agencyCollectionPrincipal(db, otherAdmin, other.value.id);
    if (!otherScope.ok) throw new Error('other scope');
    expect(await collectionResponseAccesses(db, otherScope.value, requestId)).toEqual([]);
    const direct = await collectionResponseAccess(db, otherScope.value, submitted.responseId);
    expect(direct.ok).toBe(false);
  });

  it('the database keeps a response append-only, and removing the person removes it', async () => {
    const { token } = await issuedRequest();
    const { submitted } = await submitPassportOnly(token);
    await expect(
      db.execute(sql`delete from agency_collection_responses where id = ${submitted.responseId}`),
    ).rejects.toThrow();
    await expect(
      db.execute(
        sql`update agency_collection_responses set consent_version = 'x' where id = ${submitted.responseId}`,
      ),
    ).rejects.toThrow();
    // A withdrawal is its own record, written once and never changed.
    const withdrawn = await withdrawCollectionResponse(
      db,
      await manageProof(travellerId, personId),
      submitted.responseId,
    );
    expect(withdrawn.ok).toBe(true);
    await expect(
      db.execute(
        sql`update agency_collection_response_withdrawals set reason = 'REPLACED' where response_id = ${submitted.responseId}`,
      ),
    ).rejects.toThrow();
    await expect(
      db.execute(
        sql`delete from agency_collection_response_withdrawals where response_id = ${submitted.responseId}`,
      ),
    ).rejects.toThrow();
    await expect(
      db.execute(
        sql`delete from agency_collection_response_items where response_id = ${submitted.responseId}`,
      ),
    ).rejects.toThrow();
    // Removing a shared document removes its line with it (the person's own choice).
    await db.delete(schema.documents).where(eq(schema.documents.id, passport.documentId));
    expect(
      await db
        .select()
        .from(schema.agencyCollectionResponseItems)
        .where(
          and(
            eq(schema.agencyCollectionResponseItems.responseId, submitted.responseId),
            eq(schema.agencyCollectionResponseItems.kind, 'DOCUMENT'),
          ),
        ),
    ).toEqual([]);
    await db.delete(schema.applicants).where(eq(schema.applicants.id, personId));
    expect(await count(db, 'agency_collection_responses')).toBe(0);
  });

  it('a copied or cast object is never a response access', async () => {
    const { token, requestId } = await issuedRequest();
    await submitPassportOnly(token);
    const access = await onlyAccess(requestId);
    const copy = { ...access } as unknown as CollectionResponseAccess;
    expect((await readCollectionResponse(db, copy)).ok).toBe(false);
    const cast = Object.create(
      CollectionLinkProof.prototype,
    ) as unknown as CollectionResponseAccess;
    expect(
      (
        await downloadCollectionResponseVersion(db, storage, cast, {
          documentVersionId: passport.versionId,
          accessTokenSecret: SECRET,
        })
      ).ok,
    ).toBe(false);
  });

  it('a copied link binds to nobody: whoever holds it and signs in may answer, even when the request names an address', async () => {
    const { token } = await issuedRequest('traveller@people.example.test');
    const desk = await openCollectionResponseDesk(db, await link(token), selfPrincipal(strangerId));
    expect(desk.ok).toBe(true);
  });

  it('an answer reviewed on one request can never land on another request whose link replaced the cookie', async () => {
    const first = await issuedRequest();
    const second = await issuedRequest();
    const proposal = await proposeCollectionResponse(
      db,
      await link(first.token),
      await viewProof(travellerId, personId),
    );
    if (!proposal.ok) throw new Error('proposal');
    const passportItem = item(proposal.value.proposals, 'passport');
    // Same pack, so the item ids match; the browser now holds the second request's link.
    const crossed = await submitCollectionResponse(
      db,
      await link(second.token),
      await shareProof(travellerId, personId),
      {
        selections: { [passportItem.item.id]: [documentKey(passport.versionId)] },
        consentVersion: RESPONSE_CONSENT_VERSION,
        linkId: proposal.value.desk.linkId,
        revisionId: proposal.value.desk.revisionId,
      },
    );
    expect(crossed.ok).toBe(false);
    if (!crossed.ok) expect(crossed.error.code).toBe('invalid');
    expect(await count(db, 'agency_collection_responses')).toBe(0);
  });

  it('an agency VisaStack has not reviewed receives nothing: the desk says so and submitting is refused', async () => {
    const pendingAdmin = await account('admin@agency-pending.example.test');
    const pending = await createOrganization(db, {
      actorAccountId: pendingAdmin,
      name: 'Synthetic Pending Agency',
    });
    if (!isOk(pending)) throw new Error('pending org');
    const pendingScope = await agencyCollectionPrincipal(db, pendingAdmin, pending.value.id);
    if (!pendingScope.ok) throw new Error('pending scope');
    const created = await createCollectionRequest(db, pendingScope.value, {
      destination: 'GB',
      purpose: 'Tourism',
      route: null,
      travelFrom: null,
      travelTo: null,
      dueAt: null,
      nationality: null,
      residence: null,
      applicationPlace: null,
      recipientNameHint: null,
      recipientEmailHint: null,
      packTerms: {
        country: ['GB', 'United Kingdom'],
        purpose: ['tourism', 'Tourism'],
        traveller: {
          nationality: { terms: [], known: false },
          residence: { terms: [], known: false },
        },
      },
    });
    if (!created.ok) throw new Error('pending request');
    const issued = await issueCollectionRequest(db, pendingScope.value, created.value.id);
    if (!issued.ok) throw new Error(`pending issue: ${issued.error.message}`);
    const token = issued.value.link.rawToken;
    const desk = await openCollectionResponseDesk(
      db,
      await link(token),
      selfPrincipal(travellerId),
    );
    if (!desk.ok) throw new Error('desk');
    expect(desk.value.agencyReviewed).toBe(false);
    expect(desk.value.agency).toBeNull();
    const refused = await submitCollectionResponse(
      db,
      await link(token),
      await shareProof(travellerId, personId),
      {
        selections: {},
        consentVersion: RESPONSE_CONSENT_VERSION,
        linkId: desk.value.linkId,
        revisionId: desk.value.revisionId,
      },
    );
    expect(refused.ok).toBe(false);
    expect(await count(db, 'agency_collection_responses')).toBe(0);
  });

  it('every original download needs a fresh identity check of the agency admin, and a refusal is audited', async () => {
    const { token, requestId } = await issuedRequest();
    await submitPassportOnly(token);
    const access = await onlyAccess(requestId);
    const bare = await downloadCollectionResponseVersion(db, storage, access, {
      documentVersionId: passport.versionId,
      accessTokenSecret: SECRET,
    });
    expect(bare.ok).toBe(false);
    if (!bare.ok) expect(bare.error.code).toBe('step_up_required');
    // A check made for another version does not count.
    const other = await downloadCollectionResponseVersion(db, storage, access, {
      documentVersionId: passport.versionId,
      accessTokenSecret: SECRET,
      stepUp: adminStepUp('DOWNLOAD_ORIGINAL', statement.versionId),
    });
    expect(other.ok).toBe(false);
    const denied = await db
      .select()
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.eventType, 'DOCUMENT_ACCESS'),
          eq(schema.auditEvents.reason, 'step_up_required'),
        ),
      );
    expect(denied).toHaveLength(2);
  });

  it('the serving route refuses a link whose storage key is not the listed version', async () => {
    const { token, requestId } = await issuedRequest();
    await submitPassportOnly(token);
    const access = await onlyAccess(requestId);
    const ref = await agencyLink(access, passport.versionId);
    if (!ref.ok) throw new Error('ref');
    const { fields } = linkParts(ref.value.url);
    const mixed = await recheckDocumentAccess(db, fields, new Date(), 'synthetic/someone-else');
    expect(mixed).toEqual({ allowed: false, reason: 'object_key_mismatch' });
  });

  it('an answer that changed since it was sent releases nothing, including links already handed out', async () => {
    const { token, requestId } = await issuedRequest();
    const proposal = await proposeCollectionResponse(
      db,
      await link(token),
      await viewProof(travellerId, personId),
    );
    if (!proposal.ok) throw new Error('proposal');
    const passportItem = item(proposal.value.proposals, 'passport');
    const statementItem = item(proposal.value.proposals, 'bank_statement');
    const submitted = await submitCollectionResponse(
      db,
      await link(token),
      await shareProof(travellerId, personId),
      {
        selections: {
          [passportItem.item.id]: [documentKey(passport.versionId)],
          [statementItem.item.id]: [documentKey(statement.versionId)],
        },
        consentVersion: RESPONSE_CONSENT_VERSION,
        linkId: proposal.value.desk.linkId,
        revisionId: proposal.value.desk.revisionId,
      },
    );
    expect(submitted.ok).toBe(true);
    const access = await onlyAccess(requestId);
    const issuedLink = await agencyLink(access, passport.versionId);
    if (!issuedLink.ok) throw new Error('link');
    const { fields, objectKey } = linkParts(issuedLink.value.url);
    // The person removes the statement: its line goes, and the answer no longer matches.
    await db.delete(schema.documents).where(eq(schema.documents.id, statement.documentId));
    expect(await agencyOpens(access, passport.versionId)).toBe('not_found');
    expect((await recheckDocumentAccess(db, fields, new Date(), objectKey)).allowed).toBe(false);
    const view = await readCollectionResponse(db, access);
    if (!view.ok) throw new Error('view');
    expect(view.value).toMatchObject({ intact: false, lines: [] });
  });

  it('the agency sees the names as they were when sent, never a later rename', async () => {
    const { token, requestId } = await issuedRequest();
    await submitPassportOnly(token);
    await db
      .update(schema.applicants)
      .set({ displayName: 'Renamed Later' })
      .where(eq(schema.applicants.id, personId));
    await db
      .update(schema.documents)
      .set({ approvedName: 'Renamed File' })
      .where(eq(schema.documents.id, passport.documentId));
    const view = await readCollectionResponse(db, await onlyAccess(requestId));
    if (!view.ok) throw new Error('view');
    expect(view.value.personName).toBe('Synthetic Traveller');
    expect(JSON.stringify(view.value)).not.toContain('Renamed');
  });

  it('revoking the request ends the agency access to its answers; closing it keeps them', async () => {
    const revokedOne = await issuedRequest();
    await submitPassportOnly(revokedOne.token);
    const access = await onlyAccess(revokedOne.requestId);
    const ref = await agencyLink(access, passport.versionId);
    if (!ref.ok) throw new Error('ref');
    const { fields, objectKey } = linkParts(ref.value.url);
    expect(
      (await endCollectionRequest(db, await scope(), revokedOne.requestId, 'REVOKED')).ok,
    ).toBe(true);
    expect(await collectionResponseAccesses(db, await scope(), revokedOne.requestId)).toEqual([]);
    expect((await readCollectionResponse(db, access)).ok).toBe(false);
    expect((await recheckDocumentAccess(db, fields, new Date(), objectKey)).allowed).toBe(false);

    const closedOne = await issuedRequest();
    await submitPassportOnly(closedOne.token);
    expect((await endCollectionRequest(db, await scope(), closedOne.requestId, 'CLOSED')).ok).toBe(
      true,
    );
    expect(await agencyOpens(await onlyAccess(closedOne.requestId), passport.versionId)).toBe(
      'served',
    );
  });

  it('queues "Submitted to Agency" for the agency owners and admins only, naming the agency and never the person', async () => {
    const { token } = await issuedRequest();
    const { submitted } = await submitPassportOnly(token);
    const notices = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.eventType, 'AGENCY_COLLECTION_RESPONSE_SUBMITTED'));
    expect(notices.map((n) => n.channel).sort()).toEqual(['EMAIL', 'IN_APP']);
    expect(new Set(notices.map((n) => n.recipientAccountId))).toEqual(new Set([adminId]));
    expect(
      notices.every((n) => n.applicantId === null && n.resourceId === submitted.responseId),
    ).toBe(true);
    const text = JSON.stringify(notices.map((n) => n.payload));
    expect(text).toContain('Synthetic Agency One');
    expect(text).not.toContain('Synthetic Traveller');
    expect(text).not.toContain('passport');
    // The worker sends it only while the answer is still live.
    expect(await collectionResponseStillLive(db, submitted.responseId, orgId)).toBe(true);
    await withdrawCollectionResponse(
      db,
      await manageProof(travellerId, personId),
      submitted.responseId,
    );
    expect(await collectionResponseStillLive(db, submitted.responseId, orgId)).toBe(false);
  });

  it('one account may send only so many answers in an hour', async () => {
    const { token } = await issuedRequest();
    for (let i = 0; i < 10; i++) await submitPassportOnly(token);
    const desk = await openCollectionResponseDesk(
      db,
      await link(token),
      selfPrincipal(travellerId),
    );
    if (!desk.ok) throw new Error('desk');
    const refused = await submitCollectionResponse(
      db,
      await link(token),
      await shareProof(travellerId, personId),
      {
        selections: {},
        consentVersion: RESPONSE_CONSENT_VERSION,
        linkId: desk.value.linkId,
        revisionId: desk.value.revisionId,
      },
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe('rate_limited');
  }, 60_000);

  it('a refused attempt never counts against the limit, and the in-app notice also waits for a live answer', async () => {
    const { token } = await issuedRequest();
    const desk = await openCollectionResponseDesk(
      db,
      await link(token),
      selfPrincipal(travellerId),
    );
    if (!desk.ok) throw new Error('desk');
    for (let i = 0; i < 12; i++) {
      const stale = await submitCollectionResponse(
        db,
        await link(token),
        await shareProof(travellerId, personId),
        {
          selections: {},
          consentVersion: RESPONSE_CONSENT_VERSION,
          linkId: desk.value.linkId,
          revisionId: '00000000-0000-4000-8000-000000000000',
        },
      );
      expect(stale.ok).toBe(false);
    }
    const { submitted } = await submitPassportOnly(token);
    await withdrawCollectionResponse(
      db,
      await manageProof(travellerId, personId),
      submitted.responseId,
    );
    const { runNotificationWorker: run } = await import('./notifications');
    await run(
      db,
      { send: async () => ({ ok: true, messageId: 'synthetic' }) } as never,
      'https://app.example.test',
      { encryption },
    );
    const inApp = await db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.eventType, 'AGENCY_COLLECTION_RESPONSE_SUBMITTED'),
          eq(schema.notifications.channel, 'IN_APP'),
        ),
      );
    expect(inApp.map((n) => n.status)).toEqual(['FAILED']);
  }, 60_000);
});
