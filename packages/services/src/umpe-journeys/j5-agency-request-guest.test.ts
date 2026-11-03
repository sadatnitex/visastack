/**
 * UMPE P14 journey J5: an agency document request answered by a guest (no account).
 *
 * Covered here, on one migrated in-memory database with the real services:
 * 1. The agency issues a request; the guest proves the address with a six-digit one-time code
 *    (the code comes from the deterministic generator; the mail outbox row and a stand-in email
 *    port carry it).
 * 2. The guest uploads over two desk sessions; each file is proposed against the exact issued
 *    revision, and a mistaken mapping is corrected.
 * 3. Explicit submit with a chosen retention (3/7/15/30/60/90/180 days, nothing preselected).
 * 4. The agency sees the receipt and review history and asks for a correction; the guest sees it.
 * Negatives: a forwarded URL alone exposes no draft; another agency, another request and an expired
 * session are denied; a revoked link and a closed request refuse; no account or applicant row is
 * created; guest data is never adopted by an account with the same address; the frozen
 * submission rows refuse UPDATE.
 *
 * Not exercisable below the browser, so reported rather than faked: real email delivery and the
 * inbox, the real malware scanner (a structural stand-in that says virusScanned: false), the
 * /collect page and its cookie, and the live deployment.
 *
 * Synthetic data only. Every time is passed in as an offset from one captured instant.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { agencyCollectionPrincipal, collectionLinkProof } from '../access/collection-scope';
import {
  type GuestCollectionSessionProof,
  guestCollectionSessionProof,
} from '../access/guest-collection';
import { accountPrincipal } from '../access/principal';
import { requireAccess } from '../access/require-access';
import { verifyStepUp } from '../access/step-up-proof';
import { provisionAccount } from '../accounts';
import { createApplicant, listApplicants } from '../applicants';
import { setConsent } from '../consent';
import type { Db } from '../db';
import type { ContentLimitsPort, MalwareScannerPort } from '../intake';
import { runNotificationWorker } from '../notifications';
import { createOrganization, reviewOrganization } from '../organizations';
import type { KeyManagementPort, SendEmailInput } from '../ports';
import { issueStepUpAssurance } from '../step-up';
import type {
  BlobStore,
  ListObjectsPage,
  PutObjectInput,
  StorageBucket,
  StoredBytes,
} from '../storage';
import {
  createCollectionRequest,
  editCollectionDraft,
  endCollectionRequest,
  issueCollectionRequest,
} from '../umpe-collection-request-service';
import { AGENCY_COLLECTION_REQUESTS_SWITCH } from '../umpe-collection-request-switch';
import { listCollectionReviews, recordCollectionReview } from '../umpe-collection-response-review';
import { listOwnCollectionResponses } from '../umpe-collection-response-service';
import { downloadGuestSubmissionFile, listGuestSubmissions } from '../umpe-guest-agency';
import {
  GUEST_RETENTION_DAYS,
  GUEST_SESSION_IDLE_MS,
  GUEST_SESSION_MAX_MS,
  type GuestChecklistItem,
  readGuestDesk,
  saveGuestRetentionChoice,
  sendGuestCode,
  startGuestSession,
  verifyGuestCode,
} from '../umpe-guest-collection';
import {
  type GuestFileChecks,
  addGuestFile,
  readGuestUploadDesk,
  setGuestFileItem,
  submitGuestDocuments,
} from '../umpe-guest-uploads';

const TEST_TIMEOUT_MS = 120_000;
const GUEST_EMAIL = 'j5-guest@example.test';
const NET = 'net:00000000000000000000000000000005';
const STEP_UP_SECRET = 'j5-test-step-up-secret-0123456789abcdef';
const MINUTE = 60 * 1000;

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

class FakeBlobStore implements BlobStore {
  readonly objects = new Map<string, StoredBytes>();
  async putObject(input: PutObjectInput): Promise<void> {
    this.objects.set(input.objectKey, { contentType: input.contentType, bytes: input.bytes });
  }
  async getObject(objectKey: string): Promise<StoredBytes | undefined> {
    return this.objects.get(objectKey);
  }
  async deleteObject(_bucket: StorageBucket, objectKey: string): Promise<void> {
    this.objects.delete(objectKey);
  }
  async listObjectKeys(): Promise<ListObjectsPage> {
    return { objectKeys: [...this.objects.keys()], cursor: undefined };
  }
}

const structuralScanner: MalwareScannerPort = {
  name: 'test-structural',
  version: '0.0.0',
  async scan() {
    return { safe: true };
  },
};
const limits: ContentLimitsPort = {
  name: 'test-limits',
  version: '0.0.0',
  async check() {
    return { withinLimits: true };
  },
};
const checks: GuestFileChecks = {
  scanner: structuralScanner,
  contentLimits: limits,
  virusScanner: false,
};

const pdf = (text: string) => new TextEncoder().encode(`%PDF-1.4 synthetic ${text}`);

async function count(db: Db, table: string): Promise<number> {
  const rows = await db.execute(sql.raw(`select count(*)::int as n from ${table}`));
  return Number((rows as unknown as { rows: { n: number }[] }).rows[0]?.n ?? 0);
}

function proofOf(raw: string | null): GuestCollectionSessionProof {
  const proof = guestCollectionSessionProof(raw);
  if (!proof) throw new Error('session proof');
  return proof;
}

describe('J5 agency request answered by a guest', () => {
  let client: PGlite;
  let db: Db;
  let adminId: string;
  let orgId: string;
  let otherAdminId: string;
  let otherOrgId: string;
  let storage: FakeBlobStore;
  let t0: Date;
  const at = (ms: number) => new Date(t0.getTime() + ms);
  const sent: SendEmailInput[] = [];
  const emailPort = {
    async send(message: SendEmailInput) {
      sent.push(message);
      return { providerMessageId: randomUUID() };
    },
  };
  let codeCounter = 0;
  /** The deterministic six-digit code generator the service is handed. */
  const nextCode = () => String(135790 + codeCounter++).padStart(6, '0');

  // Journey state.
  let requestId = '';
  let rawToken = '';
  let peopleBefore: readonly number[] = [];
  let sessionA: GuestCollectionSessionProof;
  let sessionB: GuestCollectionSessionProof;
  let items: readonly GuestChecklistItem[] = [];
  let submissionId = '';
  let statementFileId = '';

  async function account(email: string): Promise<string> {
    const result = await provisionAccount(db, { email });
    if (!isOk(result)) throw new Error('account');
    return result.value.id;
  }

  async function agency(name: string, admin: string): Promise<string> {
    const org = await createOrganization(db, { actorAccountId: admin, name });
    if (!isOk(org)) throw new Error('org');
    const reviewer = await account(`reviewer-${randomUUID()}@platform.example.test`);
    const reviewed = await reviewOrganization(db, {
      reviewerAccountId: reviewer,
      organizationId: org.value.id,
      decision: 'ACTIVE',
      stepUpSatisfied: true,
    });
    if (!isOk(reviewed)) throw new Error('activate');
    return org.value.id;
  }

  async function scope(accountId = adminId, organizationId = orgId) {
    const minted = await agencyCollectionPrincipal(db, accountId, organizationId);
    if (!minted.ok) throw new Error('scope');
    return minted.value;
  }

  /** An issued request with the guest's address on it, and its copied link. */
  async function issuedRequest() {
    const s = await scope();
    const created = await createCollectionRequest(db, s, {
      destination: 'GB',
      purpose: 'Tourism',
      route: 'Synthetic Visitor Route',
      travelFrom: '2027-04-01',
      travelTo: null,
      dueAt: null,
      nationality: null,
      residence: null,
      applicationPlace: null,
      recipientNameHint: 'Synthetic Guest',
      recipientEmailHint: GUEST_EMAIL,
      packTerms: null,
    });
    if (!created.ok) throw new Error(created.error.message);
    for (const [label, necessity] of [
      ['Passport', 'MANDATORY'],
      ['Bank Statement', 'MANDATORY'],
      ['Hotel Booking', 'RECOMMENDED'],
    ] as const) {
      const added = await editCollectionDraft(db, s, created.value.id, {
        type: 'add',
        label,
        necessity,
      });
      if (!added.ok) throw new Error(added.error.message);
    }
    const issued = await issueCollectionRequest(db, s, created.value.id);
    if (!issued.ok) throw new Error(issued.error.message);
    return { requestId: created.value.id, rawToken: issued.value.link.rawToken };
  }

  async function open(token: string, now: Date) {
    const link = collectionLinkProof(token);
    if (!link) throw new Error('link proof');
    const started = await startGuestSession(db, link, null, now);
    if (!started?.rawSessionId) throw new Error('no session');
    return proofOf(started.rawSessionId);
  }

  /** Open a session and prove the address with the code the generator produced. */
  async function verified(token: string, now: Date): Promise<GuestCollectionSessionProof> {
    const session = await open(token, now);
    const code = nextCode();
    const sentCode = await sendGuestCode(
      db,
      session,
      { encryption, networkSubject: NET, generateCode: () => code },
      now,
    );
    if (!sentCode.ok) throw new Error(`send ${JSON.stringify(sentCode.error)}`);
    const result = await verifyGuestCode(db, session, { code, networkSubject: NET }, now);
    if (!result.ok) throw new Error('verify');
    return proofOf(result.value.rawSessionId);
  }

  async function add(proof: GuestCollectionSessionProof, name: string, now: Date) {
    return addGuestFile(
      db,
      storage,
      proof,
      {
        uploadId: randomUUID(),
        contentType: 'application/pdf',
        bytes: pdf(name),
        originalName: name,
        checks,
      },
      now,
    );
  }

  function adminStepUp(resourceId: string, accountId = adminId) {
    const request = { accountId, action: 'DOWNLOAD_ORIGINAL' as const, resourceId };
    const proof = verifyStepUp(
      STEP_UP_SECRET,
      issueStepUpAssurance(STEP_UP_SECRET, request),
      request,
    );
    if (!proof) throw new Error('step up');
    return proof;
  }

  const itemId = (label: string) => {
    const found = items.find((i) => i.label === label);
    if (!found) throw new Error(`no item ${label}`);
    return found.id;
  };

  beforeAll(async () => {
    vi.stubEnv(AGENCY_COLLECTION_REQUESTS_SWITCH, 'true');
    storage = new FakeBlobStore();
    client = await createMigratedPglite();
    db = drizzle(client, { schema }) as unknown as Db;
    adminId = await account('admin@agency-j5.example.test');
    orgId = await agency('Synthetic Agency J5', adminId);
    otherAdminId = await account('admin@agency-j5-other.example.test');
    otherOrgId = await agency('Synthetic Agency J5 Other', otherAdminId);
    t0 = new Date();
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    vi.unstubAllEnvs();
    await client.close();
  });

  it(
    'step 1: the guest proves the address with a six-digit one-time code sent through the mail outbox',
    async () => {
      ({ requestId, rawToken } = await issuedRequest());
      peopleBefore = await Promise.all(
        ['accounts', 'applicants', 'documents', 'document_versions'].map((t) => count(db, t)),
      );
      const session = await open(rawToken, t0);
      const landing = await readGuestDesk(db, session, t0);
      expect(landing).toMatchObject({ stage: 'landing', guestAvailable: true });
      expect(JSON.stringify(landing)).not.toContain('Passport');

      const code = nextCode();
      expect(code).toMatch(/^\d{6}$/);
      const queued = await sendGuestCode(
        db,
        session,
        { encryption, networkSubject: NET, generateCode: () => code },
        t0,
      );
      expect(queued.ok).toBe(true);
      await runNotificationWorker(db, emailPort, 'https://app.example.test', { encryption });
      expect(sent.map((m) => m.to)).toEqual([GUEST_EMAIL]);
      expect(sent[0]?.body).toContain(code);
      // The outbox row never stores the code itself.
      expect(JSON.stringify(await db.select().from(schema.notifications))).not.toContain(code);

      const wrong = await verifyGuestCode(
        db,
        session,
        { code: code === '000000' ? '111111' : '000000', networkSubject: NET },
        t0,
      );
      expect(wrong.ok).toBe(false);
      const right = await verifyGuestCode(db, session, { code, networkSubject: NET }, t0);
      if (!right.ok) throw new Error('verify');
      sessionA = proofOf(right.value.rawSessionId);
      const desk = await readGuestDesk(db, sessionA, t0);
      if (desk?.stage !== 'verified') throw new Error('not verified');
      expect(desk.revisionNo).toBe(1);
      expect(desk.intact).toBe(true);
      expect(desk.retentionDays).toBeNull();
      items = desk.items;
      expect(items.map((i) => i.label)).toEqual(['Passport', 'Bank Statement', 'Hotel Booking']);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'step 2: uploads over two sessions map against the exact issued revision, and a mistaken mapping is corrected',
    async () => {
      const passport = await add(sessionA, 'passport-page.pdf', at(MINUTE));
      if (!passport.ok || passport.value.kind !== 'stored') throw new Error('add passport');
      expect(passport.value.file).toMatchObject({
        status: 'ready',
        virusScanned: false,
        itemId: itemId('Passport'),
        mapping: 'proposed',
      });
      // The guest meant this file as the bank statement; its name made it look like a passport.
      const mistaken = await add(sessionA, 'passport-old-copy.pdf', at(2 * MINUTE));
      if (!mistaken.ok || mistaken.value.kind !== 'stored') throw new Error('add mistaken');
      statementFileId = mistaken.value.file.id;
      expect(mistaken.value.file.itemId).toBe(itemId('Passport'));

      // Session A goes idle; the guest comes back later on a new session and proves it again.
      expect(
        await readGuestDesk(db, sessionA, at(2 * MINUTE + GUEST_SESSION_IDLE_MS + 1)),
      ).toBeNull();
      sessionB = await verified(rawToken, at(45 * MINUTE));
      const resumed = await readGuestUploadDesk(db, sessionB, items, at(46 * MINUTE));
      expect(resumed?.files.map((f) => f.name).sort()).toEqual([
        'passport-old-copy.pdf',
        'passport-page.pdf',
      ]);
      const hotel = await add(sessionB, 'reservation.pdf', at(47 * MINUTE));
      if (!hotel.ok || hotel.value.kind !== 'stored') throw new Error('add hotel');
      expect(hotel.value.file.itemId).toBe(itemId('Hotel Booking'));

      // Only an item of the issued revision can be chosen.
      const invented = await setGuestFileItem(
        db,
        sessionB,
        { fileId: statementFileId, itemId: randomUUID() },
        at(48 * MINUTE),
      );
      expect(invented.ok).toBe(false);
      const corrected = await setGuestFileItem(
        db,
        sessionB,
        { fileId: statementFileId, itemId: itemId('Bank Statement') },
        at(48 * MINUTE),
      );
      expect(corrected.ok).toBe(true);
      const desk = await readGuestUploadDesk(db, sessionB, items, at(49 * MINUTE));
      const issuedIds = new Set(items.map((i) => i.id));
      expect(desk?.files.every((f) => f.itemId !== null && issuedIds.has(f.itemId))).toBe(true);
      expect(desk?.files.find((f) => f.id === statementFileId)).toMatchObject({
        itemId: itemId('Bank Statement'),
        mapping: 'chosen',
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'step 3: submit needs an explicit retention choice from the offered periods and explicit consent',
    async () => {
      expect([...GUEST_RETENTION_DAYS]).toEqual([3, 7, 15, 30, 60, 90, 180]);
      const now = at(50 * MINUTE);
      const noChoice = await submitGuestDocuments(db, sessionB, { consent: true }, now);
      expect(noChoice.ok).toBe(false);
      for (const bad of [0, 5, 14, 365, '30', null]) {
        expect((await saveGuestRetentionChoice(db, sessionB, bad, now)).ok).toBe(false);
      }
      expect((await saveGuestRetentionChoice(db, sessionB, 30, now)).ok).toBe(true);
      const desk = await readGuestDesk(db, sessionB, now);
      expect(desk?.stage === 'verified' && desk.retentionDays).toBe(30);
      expect((await submitGuestDocuments(db, sessionB, { consent: false }, now)).ok).toBe(false);
      const submitted = await submitGuestDocuments(db, sessionB, { consent: true }, now);
      if (!submitted.ok) throw new Error(submitted.error.message);
      expect(submitted.value).toMatchObject({ submissionNo: 1, files: 3, stillMissing: 0 });
      submissionId = submitted.value.submissionId;
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'step 4: the agency sees the receipt and review history and asks for a correction the guest then sees',
    async () => {
      const listed = await listGuestSubmissions(db, await scope(), requestId);
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({
        status: 'SUBMITTED_TO_AGENCY',
        submissionNo: 1,
        revisionNo: 1,
        retentionDays: 30,
        intact: true,
      });
      const statementLine = listed[0]?.lines.find((l) => l.itemId === itemId('Bank Statement'));
      expect(
        statementLine?.versions.map((v) => (v.kind === 'GUEST_FILE' ? v.title : null)),
      ).toEqual(['passport-old-copy.pdf']);
      const notices = await db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.resourceId, submissionId));
      expect(notices.length).toBeGreaterThan(0);
      expect(JSON.stringify(notices)).not.toContain('passport');

      const note = 'Synthetic note: the letter is not a bank statement. Please send the statement.';
      const review = await recordCollectionReview(db, await scope(), {
        source: 'guest',
        answerId: submissionId,
        decision: 'NEEDS_CORRECTION',
        itemNotes: { [itemId('Bank Statement')]: note },
      });
      if (!review.ok) throw new Error(review.error.message);
      const history = await listCollectionReviews(db, await scope(), requestId);
      expect(history.get(submissionId)?.map((r) => r.decision)).toEqual(['NEEDS_CORRECTION']);

      const guestSees = await readGuestUploadDesk(db, sessionB, items, at(52 * MINUTE));
      expect(guestSees?.submissions[0]?.decision).toBe('NEEDS_CORRECTION');
      expect(
        guestSees?.submissions[0]?.lines.find((l) => l.itemId === itemId('Bank Statement'))?.note,
      ).toBe(note);

      // The file opens for the agency only after a fresh identity check.
      const s = await scope();
      const noStepUp = await downloadGuestSubmissionFile(db, storage, s, {
        submissionId,
        fileId: statementFileId,
      });
      expect(!noStepUp.ok && noStepUp.error.code).toBe('step_up_required');
      const download = await downloadGuestSubmissionFile(db, storage, s, {
        submissionId,
        fileId: statementFileId,
        stepUp: adminStepUp(statementFileId),
      });
      expect(download.ok).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'negative: a forwarded URL alone (no code) exposes no draft and opens no file action',
    async () => {
      const forwarded = await open(rawToken, at(53 * MINUTE));
      const landing = await readGuestDesk(db, forwarded, at(53 * MINUTE));
      expect(landing?.stage).toBe('landing');
      const shown = JSON.stringify(landing);
      for (const hidden of ['passport', 'reservation', 'Bank Statement', GUEST_EMAIL]) {
        expect(shown).not.toContain(hidden);
      }
      expect(await readGuestUploadDesk(db, forwarded, [], at(53 * MINUTE))).toBeNull();
      const added = await add(forwarded, 'forwarded.pdf', at(53 * MINUTE));
      expect(!added.ok && added.error.code).toBe('not_found');
      expect((await saveGuestRetentionChoice(db, forwarded, 7, at(53 * MINUTE))).ok).toBe(false);
      const submitted = await submitGuestDocuments(
        db,
        forwarded,
        { consent: true },
        at(53 * MINUTE),
      );
      expect(!submitted.ok && submitted.error.code).toBe('not_found');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'negative: another agency, another request and an expired session are all denied',
    async () => {
      const other = await scope(otherAdminId, otherOrgId);
      expect(await listGuestSubmissions(db, other, requestId)).toEqual([]);
      const foreign = await downloadGuestSubmissionFile(db, storage, other, {
        submissionId,
        fileId: statementFileId,
        stepUp: adminStepUp(statementFileId, otherAdminId),
      });
      const missing = await downloadGuestSubmissionFile(db, storage, other, {
        submissionId: randomUUID(),
        fileId: randomUUID(),
        stepUp: adminStepUp(statementFileId, otherAdminId),
      });
      expect(!foreign.ok && foreign.error.code).toBe('not_found');
      if (!foreign.ok && !missing.ok) expect(foreign.error).toEqual(missing.error);
      const foreignReview = await recordCollectionReview(db, other, {
        source: 'guest',
        answerId: submissionId,
        decision: 'ACCEPTED',
      });
      expect(!foreignReview.ok && foreignReview.error.code).toBe('not_found');

      // A verified session of another request sees none of this guest's files.
      const second = await issuedRequest();
      const elsewhere = await verified(second.rawToken, at(55 * MINUTE));
      const elsewhereDesk = await readGuestDesk(db, elsewhere, at(55 * MINUTE));
      if (elsewhereDesk?.stage !== 'verified') throw new Error('not verified');
      const view = await readGuestUploadDesk(db, elsewhere, elsewhereDesk.items, at(55 * MINUTE));
      expect(view?.files).toEqual([]);
      expect(view?.submissions).toEqual([]);
      const crossed = await setGuestFileItem(
        db,
        elsewhere,
        { fileId: statementFileId, itemId: elsewhereDesk.items[0]?.id },
        at(55 * MINUTE),
      );
      expect(!crossed.ok && crossed.error.code).toBe('not_found');

      // The 12-hour cap ends a session even when it never sat idle: kept in use every 20 minutes
      // (inside the 30-minute idle window), it lives until the cap and is dead just after it.
      const capped = await issuedRequest();
      const start = 70 * MINUTE;
      const busy = await verified(capped.rawToken, at(start));
      let last = start;
      for (let t = start; t <= start + GUEST_SESSION_MAX_MS - 20 * MINUTE; t += 20 * MINUTE) {
        expect(await readGuestDesk(db, busy, at(t))).not.toBeNull();
        last = t;
      }
      const late = at(start + GUEST_SESSION_MAX_MS + 1);
      expect(late.getTime() - at(last).getTime()).toBeLessThan(GUEST_SESSION_IDLE_MS);
      expect(await readGuestDesk(db, busy, late)).toBeNull();
      const lateAdd = await add(busy, 'late.pdf', late);
      expect(!lateAdd.ok && lateAdd.error.code).toBe('not_found');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'negative: a revoked link and a closed request refuse the guest',
    async () => {
      const revoked = await issuedRequest();
      const revokedSession = await verified(revoked.rawToken, at(60 * MINUTE));
      expect((await endCollectionRequest(db, await scope(), revoked.requestId, 'REVOKED')).ok).toBe(
        true,
      );
      expect(await readGuestDesk(db, revokedSession, at(61 * MINUTE))).toBeNull();
      const revokedAdd = await add(revokedSession, 'passport.pdf', at(61 * MINUTE));
      expect(!revokedAdd.ok && revokedAdd.error.code).toBe('not_found');

      const closed = await issuedRequest();
      const closedSession = await verified(closed.rawToken, at(62 * MINUTE));
      const stored = await add(closedSession, 'passport.pdf', at(62 * MINUTE));
      expect(stored.ok).toBe(true);
      await saveGuestRetentionChoice(db, closedSession, 7, at(62 * MINUTE));
      expect((await endCollectionRequest(db, await scope(), closed.requestId, 'CLOSED')).ok).toBe(
        true,
      );
      const refused = await submitGuestDocuments(
        db,
        closedSession,
        { consent: true },
        at(63 * MINUTE),
      );
      expect(!refused.ok && refused.error.code).toBe('not_found');
      expect(await listGuestSubmissions(db, await scope(), closed.requestId)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'negative: the guest journey creates no account, applicant or document row',
    async () => {
      const after = await Promise.all(
        ['accounts', 'applicants', 'documents', 'document_versions'].map((t) => count(db, t)),
      );
      expect(after).toEqual(peopleBefore);
      expect(await count(db, 'grants')).toBe(0);
      expect(await count(db, 'agency_collection_responses')).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'negative: an account later made with the same address never adopts the guest data',
    async () => {
      const filesBefore = await db.select().from(schema.agencyCollectionGuestFiles);
      const submissionsBefore = await db.select().from(schema.agencyCollectionGuestSubmissions);
      const accountId = await account(GUEST_EMAIL);
      await setConsent(db, {
        actorAccountId: accountId,
        accountId,
        type: 'CORE_PROCESSING',
        granted: true,
      });
      expect(await listApplicants(db, accountId)).toEqual([]);
      const person = await createApplicant(db, {
        actorAccountId: accountId,
        ownerAccountId: accountId,
        displayName: 'Synthetic Same Address',
      });
      if (!isOk(person)) throw new Error('applicant');
      const view = await requireAccess(
        db,
        accountPrincipal(accountId),
        'VIEW_METADATA',
        { applicantId: person.value.id },
        { purpose: 'collection_response' },
      );
      if (!view.ok) throw new Error('view proof');
      const own = await listOwnCollectionResponses(db, view.value);
      expect(own.ok && own.value).toEqual([]);
      expect(
        await db
          .select()
          .from(schema.documents)
          .where(eq(schema.documents.applicantId, person.value.id)),
      ).toEqual([]);
      // The guest rows are byte-for-byte as they were.
      expect(await db.select().from(schema.agencyCollectionGuestFiles)).toEqual(filesBefore);
      expect(await db.select().from(schema.agencyCollectionGuestSubmissions)).toEqual(
        submissionsBefore,
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'negative: the frozen submission, its lines and the review decision refuse UPDATE',
    async () => {
      const before = await db.select().from(schema.agencyCollectionGuestSubmissions);
      for (const statement of [
        sql`update agency_collection_guest_submissions set retention_days = 180 where id = ${submissionId}`,
        sql`update agency_collection_guest_submission_items set title = 'Changed' where submission_id = ${submissionId}`,
        sql`update agency_collection_reviews set decision = 'ACCEPTED' where guest_submission_id = ${submissionId}`,
      ]) {
        await expect(db.execute(statement)).rejects.toThrow();
      }
      expect(await db.select().from(schema.agencyCollectionGuestSubmissions)).toEqual(before);
    },
    TEST_TIMEOUT_MS,
  );
});
