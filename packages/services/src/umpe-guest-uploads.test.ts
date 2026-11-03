import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agencyCollectionPrincipal, collectionLinkProof } from './access/collection-scope';
import {
  type GuestCollectionSessionProof,
  guestCollectionSessionProof,
} from './access/guest-collection';
import { guestSubmissionStillLive } from './access/guest-submission-access';
import { verifyStepUp } from './access/step-up-proof';
import { systemScopeForTest } from './access/system-scope.test-support';
import { provisionAccount } from './accounts';
import type { Db } from './db';
import type { ContentLimitsPort, MalwareScannerPort } from './intake';
import { runNotificationWorker } from './notifications';
import { createOrganization, reviewOrganization } from './organizations';
import type { KeyManagementPort, SendEmailInput } from './ports';
import { issueStepUpAssurance } from './step-up';
import type {
  BlobStore,
  ListObjectsPage,
  PutObjectInput,
  StorageBucket,
  StoredBytes,
} from './storage';
import {
  createCollectionLink,
  createCollectionRequest,
  editCollectionDraft,
  endCollectionRequest,
  issueCollectionRequest,
} from './umpe-collection-request-service';
import { AGENCY_COLLECTION_REQUESTS_SWITCH } from './umpe-collection-request-switch';
import { listCollectionReviews, recordCollectionReview } from './umpe-collection-response-review';
import {
  downloadGuestSubmissionFile,
  listGuestSubmissions,
  placeGuestHold,
  releaseGuestHold,
} from './umpe-guest-agency';
import {
  GUEST_SESSION_IDLE_MS,
  SIGNED_IN_SESSION_IDLE_MS,
  guestSessionLink,
  readGuestDesk,
  saveGuestRetentionChoice,
  sendGuestCode,
  startGuestSession,
  verifyGuestCode,
} from './umpe-guest-collection';
import { purgeGuestCollectionData } from './umpe-guest-retention';
import {
  type GuestFileChecks,
  addGuestFile,
  proposeGuestItem,
  readGuestUploadDesk,
  removeGuestFile,
  setGuestFileItem,
  submitGuestDocuments,
} from './umpe-guest-uploads';

/**
 * Guest uploads, the exact guest submission, agency review and retention (UMPE P9). Synthetic data
 * only; every time is passed in and every outside service is a deterministic stand-in.
 */

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

const scanner = (safe: (key: string) => boolean): MalwareScannerPort => ({
  name: 'test-structural',
  version: '0.0.0',
  async scan(input) {
    return { safe: safe(input.objectKey) };
  },
});
const limits: ContentLimitsPort = {
  name: 'test-limits',
  version: '0.0.0',
  async check() {
    return { withinLimits: true };
  },
};
const checks: GuestFileChecks = {
  scanner: scanner(() => true),
  contentLimits: limits,
  virusScanner: false,
};

const GUEST_EMAIL = 'guest@example.test';
const OTHER_EMAIL = 'someone.else@example.test';
const NET = 'net:00000000000000000000000000000001';
const CODE = '246810';
const STEP_UP_SECRET = 'p9-test-step-up-secret-0123456789abcdef';
const DAY = 24 * 60 * 60 * 1000;

async function count(db: Db, table: string): Promise<number> {
  const rows = await db.execute(sql.raw(`select count(*)::int as n from ${table}`));
  return Number((rows as unknown as { rows: { n: number }[] }).rows[0]?.n ?? 0);
}

function proofOf(raw: string | null): GuestCollectionSessionProof {
  const proof = guestCollectionSessionProof(raw);
  if (!proof) throw new Error('session proof');
  return proof;
}

const pdf = (text: string) => new TextEncoder().encode(`%PDF-1.4 synthetic ${text}`);

describe('guest uploads, exact submission and agency review (UMPE P9)', () => {
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
  const runWorker = () =>
    runNotificationWorker(db, emailPort, 'https://app.example.test', { encryption });

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

  async function scope(account = adminId, org = orgId) {
    const minted = await agencyCollectionPrincipal(db, account, org);
    if (!minted.ok) throw new Error('scope');
    return minted.value;
  }

  /** An issued request (address on the request only) and its copied link, never emailed. */
  async function copiedRequest(emailHint: string | null = GUEST_EMAIL) {
    const s = await scope();
    const created = await createCollectionRequest(db, s, {
      destination: 'GB',
      purpose: null,
      route: 'Synthetic Route',
      travelFrom: null,
      travelTo: null,
      dueAt: null,
      nationality: null,
      residence: null,
      applicationPlace: null,
      recipientNameHint: 'Synthetic Person',
      recipientEmailHint: emailHint,
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

  async function open(rawToken: string, now = t0) {
    const link = collectionLinkProof(rawToken);
    if (!link) throw new Error('link proof');
    const started = await startGuestSession(db, link, null, now);
    if (!started?.rawSessionId) throw new Error('no session');
    return started.rawSessionId;
  }

  async function verified(rawToken: string, now = t0): Promise<GuestCollectionSessionProof> {
    const raw = await open(rawToken, now);
    const code = await sendGuestCode(
      db,
      proofOf(raw),
      { encryption, networkSubject: NET, generateCode: () => CODE },
      now,
    );
    if (!code.ok) throw new Error(`send ${JSON.stringify(code.error)}`);
    const result = await verifyGuestCode(
      db,
      proofOf(raw),
      { code: CODE, networkSubject: NET },
      now,
    );
    if (!result.ok) throw new Error('verify');
    return proofOf(result.value.rawSessionId);
  }

  async function itemIds(proof: GuestCollectionSessionProof, now = t0) {
    const desk = await readGuestDesk(db, proof, now);
    if (desk?.stage !== 'verified') throw new Error('not verified');
    return desk.items;
  }

  async function add(
    proof: GuestCollectionSessionProof,
    name: string,
    options: { uploadId?: string; now?: Date; checks?: GuestFileChecks; bytes?: Uint8Array } = {},
  ) {
    return addGuestFile(
      db,
      storage,
      proof,
      {
        uploadId: options.uploadId ?? randomUUID(),
        contentType: 'application/pdf',
        bytes: options.bytes ?? pdf(name),
        originalName: name,
        checks: options.checks ?? checks,
      },
      options.now ?? t0,
    );
  }

  function adminStepUp(resourceId: string, account = adminId) {
    const request = { accountId: account, action: 'DOWNLOAD_ORIGINAL' as const, resourceId };
    const proof = verifyStepUp(
      STEP_UP_SECRET,
      issueStepUpAssurance(STEP_UP_SECRET, request),
      request,
    );
    if (!proof) throw new Error('step up');
    return proof;
  }

  beforeEach(async () => {
    vi.stubEnv(AGENCY_COLLECTION_REQUESTS_SWITCH, 'true');
    sent.length = 0;
    storage = new FakeBlobStore();
    client = await createMigratedPglite();
    db = drizzle(client, { schema }) as unknown as Db;
    adminId = await account('admin@agency-one.example.test');
    orgId = await agency('Synthetic Agency One', adminId);
    otherAdminId = await account('admin@agency-two.example.test');
    otherOrgId = await agency('Synthetic Agency Two', otherAdminId);
    t0 = new Date();
  }, 60_000);

  afterEach(async () => {
    vi.unstubAllEnvs();
    await client.close();
  });

  it('a copied link inherits the address on the request, so it has a guest path', async () => {
    const request = await copiedRequest();
    const raw = await open(request.rawToken);
    const landing = await readGuestDesk(db, proofOf(raw), t0);
    expect(landing?.stage === 'landing' && landing.guestAvailable).toBe(true);
    const code = await sendGuestCode(
      db,
      proofOf(raw),
      { encryption, networkSubject: NET, generateCode: () => CODE },
      t0,
    );
    expect(code.ok).toBe(true);
    await runWorker();
    expect(sent.map((m) => m.to)).toEqual([GUEST_EMAIL]);
    // The agency still sees it as a copied link: nothing was emailed by the agency.
    const links = await db.select().from(schema.agencyCollectionLinks);
    expect(links.every((l) => l.recipientEmailHint === null)).toBe(true);
  });

  it('a request with no address still has no guest path', async () => {
    const request = await copiedRequest(null);
    const raw = await open(request.rawToken);
    const landing = await readGuestDesk(db, proofOf(raw), t0);
    expect(landing?.stage === 'landing' && landing.guestAvailable).toBe(false);
  });

  it('stores, checks and proposes an item, with no account, applicant or document row', async () => {
    const request = await copiedRequest();
    const proof = await verified(request.rawToken);
    const before = await Promise.all(
      ['accounts', 'applicants', 'documents', 'document_versions', 'storage_objects'].map((t) =>
        count(db, t),
      ),
    );
    const added = await add(proof, 'my-passport-scan.pdf');
    if (!added.ok || added.value.kind !== 'stored') throw new Error('add');
    const items = await itemIds(proof);
    const passport = items.find((i) => i.label === 'Passport');
    expect(added.value.file).toMatchObject({
      status: 'ready',
      virusScanned: false,
      itemId: passport?.id,
      mapping: 'proposed',
      sent: false,
    });
    const after = await Promise.all(
      ['accounts', 'applicants', 'documents', 'document_versions', 'storage_objects'].map((t) =>
        count(db, t),
      ),
    );
    expect(after).toEqual(before);
    const [row] = await db.select().from(schema.agencyCollectionGuestFiles);
    expect(row?.objectKey).toMatch(/^guest-[0-9a-f-]{36}$/);
    expect(row?.sha256).toBe(
      createHash('sha256').update(pdf('my-passport-scan.pdf')).digest('hex'),
    );
    expect(storage.objects.has(row?.objectKey ?? '')).toBe(true);
  });

  it('a repeat of the same upload id answers with the stored file and stores nothing twice', async () => {
    const request = await copiedRequest();
    const proof = await verified(request.rawToken);
    const uploadId = randomUUID();
    const first = await add(proof, 'statement.pdf', { uploadId });
    const again = await add(proof, 'statement.pdf', { uploadId });
    if (!first.ok || !again.ok || again.value.kind !== 'stored') throw new Error('add');
    expect(again.value.replay).toBe(true);
    expect(again.value.file.id).toBe(first.value.file.id);
    expect(await count(db, 'agency_collection_guest_files')).toBe(1);
    expect(storage.objects.size).toBe(1);
  });

  it('a file that fails the safety check keeps no bytes and cannot be placed or sent', async () => {
    const request = await copiedRequest();
    const proof = await verified(request.rawToken);
    const refused = await add(proof, 'passport.pdf', {
      checks: { ...checks, scanner: scanner(() => false) },
    });
    if (!refused.ok || refused.value.kind !== 'refused') throw new Error('expected refusal');
    expect(storage.objects.size).toBe(0);
    const items = await itemIds(proof);
    const mapped = await setGuestFileItem(db, proof, {
      fileId: refused.value.file.id,
      itemId: items[0]?.id,
    });
    expect(mapped.ok).toBe(false);
    await saveGuestRetentionChoice(db, proof, 30, t0);
    const submitted = await submitGuestDocuments(db, proof, { consent: true }, t0);
    expect(!submitted.ok && submitted.error.message).toMatch(/at least one file/);
  });

  it('85 files in one go each settle, with none lost or doubled', async () => {
    const request = await copiedRequest();
    const proof = await verified(request.rawToken);
    const names = Array.from(
      { length: 85 },
      (_, i) => `file-${String(i + 1).padStart(3, '0')}.pdf`,
    );
    const results = [];
    // Two at a time, like the browser queue.
    for (let i = 0; i < names.length; i += 2) {
      results.push(...(await Promise.all(names.slice(i, i + 2).map((name) => add(proof, name)))));
    }
    expect(results.every((r) => r.ok && r.value.kind === 'stored')).toBe(true);
    const items = await itemIds(proof);
    const desk = await readGuestUploadDesk(db, proof, items, t0);
    expect(desk?.files.length).toBe(85);
    expect(new Set(desk?.files.map((f) => f.name)).size).toBe(85);
    expect(desk?.files.every((f) => f.status === 'ready')).toBe(true);
    expect(storage.objects.size).toBe(85);
  });

  it('a forwarded link alone shows only the neutral desk and opens no file action', async () => {
    const request = await copiedRequest();
    const guest = await verified(request.rawToken);
    await add(guest, 'passport.pdf');
    // Someone else opens the same link: an unverified session.
    const forwarded = proofOf(await open(request.rawToken));
    const landing = await readGuestDesk(db, forwarded, t0);
    expect(landing?.stage).toBe('landing');
    expect(JSON.stringify(landing)).not.toContain('passport');
    expect(await readGuestUploadDesk(db, forwarded, [], t0)).toBeNull();
    const added = await add(forwarded, 'evil.pdf');
    expect(!added.ok && added.error.code).toBe('not_found');
    const submitted = await submitGuestDocuments(db, forwarded, { consent: true }, t0);
    expect(!submitted.ok && submitted.error.code).toBe('not_found');
  });

  it('another guest of the same request cannot see, place or remove the first guest files', async () => {
    const request = await copiedRequest();
    const guest = await verified(request.rawToken);
    const added = await add(guest, 'passport.pdf');
    if (!added.ok) throw new Error('add');
    // The agency emails a second person a link of the same request.
    const other = await createCollectionLink(db, await scope(), request.requestId, {
      email: { address: OTHER_EMAIL, encryption },
    });
    if (!other.ok) throw new Error('link');
    const second = await verified(other.value.link.rawToken);
    const items = await itemIds(second);
    const desk = await readGuestUploadDesk(db, second, items, t0);
    expect(desk?.files).toEqual([]);
    const mapped = await setGuestFileItem(db, second, {
      fileId: added.value.file.id,
      itemId: items[0]?.id,
    });
    expect(!mapped.ok && mapped.error.code).toBe('not_found');
    const removed = await removeGuestFile(db, storage, second, added.value.file.id);
    expect(!removed.ok && removed.error.code).toBe('not_found');
    expect(await count(db, 'agency_collection_guest_files')).toBe(1);
  });

  it('submits exact files to the same review queue, and a correction appends a revision', async () => {
    const request = await copiedRequest();
    const proof = await verified(request.rawToken);
    const items = await itemIds(proof);
    const passport = items.find((i) => i.label === 'Passport');
    const statement = items.find((i) => i.label === 'Bank Statement');
    if (!passport || !statement) throw new Error('items');
    const first = await add(proof, 'passport.pdf');
    const blurry = await add(proof, 'bank-statement-blurry.pdf');
    if (!first.ok || !blurry.ok) throw new Error('add');

    // Retention and consent are required.
    expect((await submitGuestDocuments(db, proof, { consent: true }, t0)).ok).toBe(false);
    await saveGuestRetentionChoice(db, proof, 30, t0);
    expect((await submitGuestDocuments(db, proof, { consent: false }, t0)).ok).toBe(false);
    const one = await submitGuestDocuments(db, proof, { consent: true }, t0);
    if (!one.ok) throw new Error(one.error.message);
    expect(one.value).toMatchObject({ submissionNo: 1, files: 2, stillMissing: 1 });

    // The agency sees exactly those files, from the guest source, and is told once.
    const listed = await listGuestSubmissions(db, await scope(), request.requestId);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.intact).toBe(true);
    expect(listed[0]?.lines.every((l) => l.source === 'guest')).toBe(true);
    const statementLine = listed[0]?.lines.find((l) => l.itemId === statement.id);
    expect(statementLine?.versions).toEqual([
      expect.objectContaining({ kind: 'GUEST_FILE', title: 'bank-statement-blurry.pdf' }),
    ]);
    expect(listed[0]?.lines.find((l) => l.item.label === 'Hotel Booking')?.missing).toBe(true);
    expect(await guestSubmissionStillLive(db, one.value.submissionId, orgId)).toBe(true);
    const notices = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.resourceId, one.value.submissionId));
    expect(notices.length).toBeGreaterThan(0);
    expect(JSON.stringify(notices)).not.toContain('passport');

    // Another agency sees nothing and decides nothing.
    expect(
      await listGuestSubmissions(db, await scope(otherAdminId, otherOrgId), request.requestId),
    ).toEqual([]);
    const foreign = await recordCollectionReview(db, await scope(otherAdminId, otherOrgId), {
      source: 'guest',
      answerId: one.value.submissionId,
      decision: 'ACCEPTED',
    });
    expect(!foreign.ok && foreign.error.code).toBe('not_found');

    // Needs Correction needs a note; the guest sees it next to the item.
    const bare = await recordCollectionReview(db, await scope(), {
      source: 'guest',
      answerId: one.value.submissionId,
      decision: 'NEEDS_CORRECTION',
    });
    expect(bare.ok).toBe(false);
    const review = await recordCollectionReview(db, await scope(), {
      source: 'guest',
      answerId: one.value.submissionId,
      decision: 'NEEDS_CORRECTION',
      itemNotes: { [statement.id]: 'The pages are hard to read. Send a clearer copy.' },
    });
    expect(review.ok).toBe(true);
    const guestView = await readGuestUploadDesk(db, proof, items, t0);
    expect(guestView?.submissions[0]?.decision).toBe('NEEDS_CORRECTION');
    expect(guestView?.submissions[0]?.lines.find((l) => l.itemId === statement.id)?.note).toBe(
      'The pages are hard to read. Send a clearer copy.',
    );

    // The guest replaces the file: the sent copy stays (the agency keeps submission 1).
    const removed = await removeGuestFile(db, storage, proof, blurry.value.file.id, t0);
    expect(removed.ok && removed.value.kept).toBe(true);
    const clear = await add(proof, 'bank-statement-clear.pdf');
    if (!clear.ok) throw new Error('add');
    const two = await submitGuestDocuments(db, proof, { consent: true }, t0);
    if (!two.ok) throw new Error(two.error.message);
    expect(two.value.submissionNo).toBe(2);

    const both = await listGuestSubmissions(db, await scope(), request.requestId);
    expect(both.map((s) => s.submissionNo)).toEqual([2, 1]);
    const earlier = both.find((s) => s.submissionNo === 1);
    expect(
      earlier?.lines
        .find((l) => l.itemId === statement.id)
        ?.versions.map((v) => (v.kind === 'GUEST_FILE' ? v.title : null)),
    ).toEqual(['bank-statement-blurry.pdf']);
    expect(
      both[0]?.lines
        .find((l) => l.itemId === statement.id)
        ?.versions.map((v) => (v.kind === 'GUEST_FILE' ? v.title : null)),
    ).toEqual(['bank-statement-clear.pdf']);
    // The earlier, reviewed file still downloads as it was, after a fresh sign-in only.
    const s = await scope();
    const noStepUp = await downloadGuestSubmissionFile(db, storage, s, {
      submissionId: one.value.submissionId,
      fileId: blurry.value.file.id,
    });
    expect(!noStepUp.ok && noStepUp.error.code).toBe('step_up_required');
    const download = await downloadGuestSubmissionFile(db, storage, s, {
      submissionId: one.value.submissionId,
      fileId: blurry.value.file.id,
      stepUp: adminStepUp(blurry.value.file.id),
    });
    if (!download.ok) throw new Error('download');
    expect(Buffer.from(download.value.bytes).toString()).toContain('bank-statement-blurry.pdf');
    // A file of a different submission is not reachable through this one.
    const crossed = await downloadGuestSubmissionFile(db, storage, s, {
      submissionId: one.value.submissionId,
      fileId: clear.value.file.id,
      stepUp: adminStepUp(clear.value.file.id),
    });
    expect(!crossed.ok && crossed.error.code).toBe('not_found');
    // Another agency's admin, even with a fresh sign-in, reaches nothing.
    const other = await downloadGuestSubmissionFile(
      db,
      storage,
      await scope(otherAdminId, otherOrgId),
      {
        submissionId: one.value.submissionId,
        fileId: blurry.value.file.id,
        stepUp: adminStepUp(blurry.value.file.id, otherAdminId),
      },
    );
    expect(!other.ok && other.error.code).toBe('not_found');
    const audit = await db
      .select({ eventType: schema.auditEvents.eventType, result: schema.auditEvents.result })
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'AGENCY_COLLECTION_GUEST_FILE_READ'));
    expect(audit.map((a) => a.result).sort()).toEqual(['ALLOWED', 'DENIED', 'DENIED']);
    const reviews = await listCollectionReviews(db, await scope(), request.requestId);
    expect(reviews.get(one.value.submissionId)?.[0]?.decision).toBe('NEEDS_CORRECTION');
  });

  it('a submitted answer and its decisions are never edited or deleted directly', async () => {
    const request = await copiedRequest();
    const proof = await verified(request.rawToken);
    await add(proof, 'passport.pdf');
    await saveGuestRetentionChoice(db, proof, 7, t0);
    const one = await submitGuestDocuments(db, proof, { consent: true }, t0);
    if (!one.ok) throw new Error('submit');
    await recordCollectionReview(db, await scope(), {
      source: 'guest',
      answerId: one.value.submissionId,
      decision: 'RECEIVED',
    });
    for (const statement of [
      'update agency_collection_guest_submissions set retention_days = 180',
      'delete from agency_collection_guest_submissions',
      "update agency_collection_guest_submission_items set title = 'x'",
      'delete from agency_collection_reviews',
    ]) {
      await expect(db.execute(sql.raw(statement))).rejects.toThrow();
    }
  });

  it('purges files, bytes and rows when the chosen period ends, never during a legal hold', async () => {
    const request = await copiedRequest();
    const proof = await verified(request.rawToken);
    await add(proof, 'passport.pdf');
    await saveGuestRetentionChoice(db, proof, 7, t0);
    const one = await submitGuestDocuments(db, proof, { consent: true }, t0);
    if (!one.ok) throw new Error('submit');
    await recordCollectionReview(db, await scope(), {
      source: 'guest',
      answerId: one.value.submissionId,
      decision: 'ACCEPTED',
    });
    const job = systemScopeForTest('process-erasure');
    // Still open (its link runs 14 days): nothing goes.
    expect((await purgeGuestCollectionData(db, storage, job, at(10 * DAY))).guestsPurged).toBe(0);
    const ended = await endCollectionRequest(db, await scope(), request.requestId, 'CLOSED', t0);
    expect(ended.ok).toBe(true);
    const early = await purgeGuestCollectionData(db, storage, job, at(6 * DAY));
    expect(early.guestsPurged).toBe(0);
    // The closed request's desk sessions ended over a day ago: they go, with their codes.
    expect(early.sessionsPurged).toBeGreaterThan(0);
    expect(await count(db, 'agency_collection_guest_files')).toBe(1);

    const held = await placeGuestHold(db, await scope(), request.requestId, 'Synthetic dispute');
    expect(held.ok).toBe(true);
    const duringHold = await purgeGuestCollectionData(db, storage, job, at(8 * DAY));
    expect(duringHold).toMatchObject({ guestsPurged: 0, held: 1 });
    expect(storage.objects.size).toBe(1);
    expect(await count(db, 'agency_collection_guest_submissions')).toBe(1);

    expect((await releaseGuestHold(db, await scope(), request.requestId)).ok).toBe(true);
    const done = await purgeGuestCollectionData(db, storage, job, at(8 * DAY));
    expect(done).toMatchObject({ guestsPurged: 1, filesPurged: 1, submissionsPurged: 1 });
    expect(storage.objects.size).toBe(0);
    for (const table of [
      'agency_collection_guest_files',
      'agency_collection_guest_submissions',
      'agency_collection_guest_submission_items',
      'agency_collection_reviews',
      'agency_collection_guest_drafts',
    ]) {
      expect(await count(db, table), table).toBe(0);
    }
    // Sessions (and codes) of the closed request's links went a day after they ended.
    expect(await count(db, 'agency_collection_guest_sessions')).toBe(0);
    expect(await count(db, 'agency_collection_guest_codes')).toBe(0);
    // Only the erasure job may run it.
    const wrong = systemScopeForTest('process-deletions') as never;
    expect(await purgeGuestCollectionData(db, storage, wrong, at(9 * DAY))).toMatchObject({
      guestsPurged: 0,
    });
  });

  it('keeps the sessions of an open link, so its lifetime code limits keep counting', async () => {
    const request = await copiedRequest();
    await verified(request.rawToken);
    const job = systemScopeForTest('process-erasure');
    const result = await purgeGuestCollectionData(db, storage, job, at(3 * DAY));
    expect(result.sessionsPurged).toBe(0);
    expect(await count(db, 'agency_collection_guest_codes')).toBe(1);
  });

  it('a guest who never submitted has their files removed once the request closes', async () => {
    const request = await copiedRequest();
    const proof = await verified(request.rawToken);
    await add(proof, 'passport.pdf');
    await endCollectionRequest(db, await scope(), request.requestId, 'REVOKED', t0);
    const job = systemScopeForTest('process-erasure');
    const result = await purgeGuestCollectionData(db, storage, job, at(1000));
    expect(result.filesPurged).toBe(1);
    expect(storage.objects.size).toBe(0);
  });

  it('a signed-in use idles out after 2 hours, never lengthening the guest window', async () => {
    const request = await copiedRequest();
    const raw = await open(request.rawToken);
    const proof = proofOf(raw);
    // A signed-in person keeps the session in use (the account path).
    expect(
      await guestSessionLink(db, proof, at(20 * 60 * 1000), { signedIn: true }),
    ).not.toBeNull();
    const fortyFive = at(GUEST_SESSION_IDLE_MS + 15 * 60 * 1000);
    expect(await guestSessionLink(db, proof, fortyFive, { signedIn: true })).not.toBeNull();
    // The guest's own clock was never moved: as a guest it is idle.
    expect(await readGuestDesk(db, proof, fortyFive)).toBeNull();
    const past = at(GUEST_SESSION_IDLE_MS + 15 * 60 * 1000 + SIGNED_IN_SESSION_IDLE_MS + 1000);
    expect(await guestSessionLink(db, proof, past, { signedIn: true })).toBeNull();
  });

  it('proposes an item only when exactly one fits', () => {
    const items = [
      { id: 'a', label: 'Passport', docType: null },
      { id: 'b', label: 'Bank Statement', docType: null },
      { id: 'c', label: 'Hotel Booking', docType: null },
    ];
    expect(proposeGuestItem('PASSPORT_front.jpg', items)).toBe('a');
    expect(proposeGuestItem('dbbl-statement-june.pdf', items)).toBe('b');
    expect(proposeGuestItem('reservation.pdf', items)).toBe('c');
    expect(proposeGuestItem('IMG_0042.jpg', items)).toBeNull();
    expect(proposeGuestItem('passport and bank.pdf', items)).toBeNull();
  });
});
