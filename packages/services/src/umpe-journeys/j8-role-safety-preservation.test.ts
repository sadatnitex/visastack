/**
 * UMPE P14 journey J8: roles, safety and preservation across the new UMPE surfaces.
 *
 * Covered here with the real services on migrated in-memory databases:
 * 1. Cross-tenant and cross-person denial for collection requests, account responses, guest files,
 *    trips, case packages and outcome attempts; each denial looks exactly like a missing record.
 * 2. The AI-off and manual path: with the platform kill switch or without AI consent, no provider
 *    is called, and a manual profile edit and a manual document kind still work.
 * 3. The frozen golden manifest checksum still verifies, in memory and from stored rows.
 * 4. Deleting an account removes its trip, package handoff, outcome attempt and held family file
 *    (the held file is queued for verified erasure) through the existing deletion service.
 * 5. Scanner truth: a scanner-rejected or unscanned file is never served as clean, and a
 *    structural check is never reported as a virus scan.
 *
 * Not exercisable below the browser, so reported rather than faked: real Neon Auth sign-in, real
 * AI provider calls, the real malware scanner and its deployment configuration, real email, and
 * the live deployment. One setup fixture is written directly, as umpe-outcome.test.ts does: the
 * submission report row (the real recordSubmission needs a submission-ready, acknowledged case);
 * the attempt itself is tracked through the outcome service.
 *
 * Synthetic data only. Storage, keys, scanners and providers are deterministic stand-ins.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { accountPrincipal, requireAccess } from '../access';
import { collectionResponseAccess } from '../access/collection-response-access';
import {
  type AgencyCollectionScope,
  agencyCollectionPrincipal,
  collectionLinkProof,
} from '../access/collection-scope';
import {
  type GuestCollectionSessionProof,
  guestCollectionSessionProof,
} from '../access/guest-collection';
import { verifyStepUp } from '../access/step-up-proof';
import { provisionAccount } from '../accounts';
import {
  LETTER_TEXT,
  scope as aiScope,
  countingPorts,
  extractorFor,
  freshDb,
  jobsOf,
  runIntake,
  seedReader,
  switchAiOff,
} from '../ai-reading.test-support';
import { createApplicant } from '../applicants';
import { setConsent } from '../consent';
import type { Db } from '../db';
import { executeAccountDeletion, requestAccountDeletion } from '../deletion';
import {
  addDocumentVersion,
  previewDocument,
  registerDocument,
  setDocumentType,
} from '../documents';
import type { DocumentConverterPort, ExtractionOutcome } from '../extraction';
import { type ContentLimitsPort, type MalwareScannerPort, processIntake } from '../intake';
import { runAiReadingWorker } from '../jobs';
import { attachPackVersion, snapshotMission } from '../missions';
import { createOrganization, reviewOrganization } from '../organizations';
import {
  type PackRequirement,
  addPackVersion,
  addRequirement,
  approvePackVersion,
  buildManifest,
  createPack,
  publishPackVersion,
  verifyPackChecksum,
} from '../packs';
import type { KeyManagementPort } from '../ports';
import { editFact, registerFieldDefinition } from '../profile';
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
  getCollectionRequest,
  issueCollectionRequest,
} from '../umpe-collection-request-service';
import { AGENCY_COLLECTION_REQUESTS_SWITCH } from '../umpe-collection-request-switch';
import { RESPONSE_CONSENT_VERSION, documentKey } from '../umpe-collection-response-evidence';
import {
  proposeCollectionResponse,
  submitCollectionResponse,
} from '../umpe-collection-response-service';
import { holdFamilyFile } from '../umpe-document-holds';
import { downloadGuestSubmissionFile, listGuestSubmissions } from '../umpe-guest-agency';
import {
  readGuestDesk,
  saveGuestRetentionChoice,
  sendGuestCode,
  startGuestSession,
  verifyGuestCode,
} from '../umpe-guest-collection';
import { type GuestFileChecks, addGuestFile, submitGuestDocuments } from '../umpe-guest-uploads';
import { listOutcomeAttempts, trackSubmissionAsAttempt } from '../umpe-outcome-service';
import {
  confirmPackageHandoff,
  getCasePackage,
  recordPackageChoice,
} from '../umpe-package-service';
import { getTrip, listTripEvidence, startGroupTrip } from '../umpe-trip-service';

const TEST_TIMEOUT_MS = 120_000;
const STEP_UP_SECRET = 'j8-test-step-up-secret-0123456789abcdef';
const ACCESS_TOKEN_SECRET = 'j8-test-access-token-secret';
const NET = 'net:00000000000000000000000000000008';
const GUEST_EMAIL = 'j8-guest@example.test';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

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

class MemoryStore implements BlobStore {
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

const scanner = (safe: boolean): MalwareScannerPort => ({
  name: 'test-structural',
  version: '0.0.0',
  async scan() {
    return safe ? { safe: true } : { safe: false, detail: 'synthetic-eicar' };
  },
});
const withinLimits: ContentLimitsPort = {
  name: 'test-limits',
  version: '0.0.0',
  async check() {
    return { withinLimits: true };
  },
};
const guestChecks = (safe: boolean, virusScanner = false): GuestFileChecks => ({
  scanner: scanner(safe),
  contentLimits: withinLimits,
  virusScanner,
});
const noText: DocumentConverterPort = {
  async extract(): Promise<ExtractionOutcome> {
    return { ok: false, code: 'unsupported_format', message: 'synthetic: no text' };
  },
};
const PDF = new Uint8Array([37, 80, 68, 70, 45, 49]);

/** The frozen golden rows and checksum (copied from umpe-no-loss-golden.test.ts, never edited). */
const GOLDEN_ROWS = [
  {
    kind: 'DOCUMENT',
    fieldKey: null,
    docType: 'bank_statement',
    citation: 'Appendix V 4.2 (b)',
    optional: false,
  },
  {
    kind: 'FIELD',
    fieldKey: 'passport.number',
    docType: null,
    citation: 'Appendix V 4.2',
    optional: false,
  },
  {
    kind: 'DOCUMENT',
    fieldKey: null,
    docType: 'Employer_Letter',
    citation: 'Guidance p.7',
    optional: true,
  },
  {
    kind: 'FIELD',
    fieldKey: 'travel.purpose',
    docType: null,
    citation: `Annexe ${String.fromCodePoint(0xc9)} section 3`,
    optional: false,
  },
  {
    kind: 'DOCUMENT',
    fieldKey: null,
    docType: 'hotel_booking',
    citation: 'Guidance p.7',
    optional: true,
  },
] as const;
const GOLDEN_CHECKSUM = 'daf22ce5899e97e765cfa7a432e7ddd021e66a67c756c673d06677f281e05045';

async function count(db: Db, query: ReturnType<typeof sql>): Promise<number> {
  const rows = await db.execute(query);
  return Number((rows as unknown as { rows: { n: number }[] }).rows[0]?.n ?? 0);
}

describe('J8 role, safety and preservation', () => {
  let db: Db;
  const store = new MemoryStore();

  async function person(email: string, displayName: string) {
    const made = await provisionAccount(db, { email });
    if (!isOk(made)) throw new Error('provision');
    await setConsent(db, {
      actorAccountId: made.value.id,
      accountId: made.value.id,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    const applicant = await createApplicant(db, {
      actorAccountId: made.value.id,
      ownerAccountId: made.value.id,
      displayName,
    });
    if (!isOk(applicant)) throw new Error('applicant');
    return { accountId: made.value.id, applicantId: applicant.value.id };
  }

  async function proof<A extends 'MANAGE' | 'VIEW_METADATA' | 'SHARE'>(
    accountId: string,
    action: A,
    ref: { applicantId: string } | { missionId: string },
    purpose = 'self',
  ) {
    let stepUp: ReturnType<typeof verifyStepUp> | undefined;
    if (action === 'SHARE' && 'applicantId' in ref) {
      const request = { accountId, action: 'SHARE' as const, resourceId: ref.applicantId };
      stepUp = verifyStepUp(STEP_UP_SECRET, issueStepUpAssurance(STEP_UP_SECRET, request), request);
    }
    const granted = await requireAccess(db, accountPrincipal(accountId), action, ref, {
      purpose,
      ...(stepUp ? { stepUp } : {}),
    });
    if (!granted.ok) throw new Error(`access ${action}: ${granted.error.code}`);
    return granted.value;
  }

  async function document(accountId: string, applicantId: string, docType: string) {
    const doc = await registerDocument(db, {
      actorAccountId: accountId,
      applicantId,
      originalName: `${docType}.pdf`,
      docType,
    });
    if (!isOk(doc)) throw new Error('doc');
    const version = await addDocumentVersion(db, {
      actorAccountId: accountId,
      documentId: doc.value.id,
      bucket: 'CLEAN',
      objectKey: `j8/${randomUUID()}`,
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    });
    if (!isOk(version)) throw new Error('version');
    return { documentId: doc.value.id, versionId: version.value.version.id };
  }

  async function agency(name: string) {
    const admin = await provisionAccount(db, {
      email: `admin-${randomUUID()}@agency.example.test`,
    });
    if (!isOk(admin)) throw new Error('admin');
    const org = await createOrganization(db, { actorAccountId: admin.value.id, name });
    if (!isOk(org)) throw new Error('org');
    const reviewer = await provisionAccount(db, {
      email: `reviewer-${randomUUID()}@platform.example.test`,
    });
    if (!isOk(reviewer)) throw new Error('reviewer');
    const reviewed = await reviewOrganization(db, {
      reviewerAccountId: reviewer.value.id,
      organizationId: org.value.id,
      decision: 'ACTIVE',
      stepUpSatisfied: true,
    });
    if (!isOk(reviewed)) throw new Error('activate');
    const minted = await agencyCollectionPrincipal(db, admin.value.id, org.value.id);
    if (!minted.ok) throw new Error('scope');
    return { adminId: admin.value.id, orgId: org.value.id, scope: minted.value };
  }

  async function freshScope(a: { adminId: string; orgId: string }): Promise<AgencyCollectionScope> {
    const minted = await agencyCollectionPrincipal(db, a.adminId, a.orgId);
    if (!minted.ok) throw new Error('scope');
    return minted.value;
  }

  async function publishedPack(actor: string): Promise<string> {
    const pack = await createPack(db, {
      actorAccountId: actor,
      key: `j8.${randomUUID()}`,
      name: 'J8 Synthetic',
    });
    if (!isOk(pack)) throw new Error('pack');
    const version = await addPackVersion(db, { actorAccountId: actor, packId: pack.value.id });
    if (!isOk(version)) throw new Error('version');
    const added = await addRequirement(db, {
      actorAccountId: actor,
      packVersionId: version.value.id,
      kind: 'DOCUMENT',
      docType: 'passport',
      citation: 'Synthetic rule 1',
    });
    if (!isOk(added)) throw new Error('requirement');
    if (
      !isOk(
        await approvePackVersion(db, { actorAccountId: actor, packVersionId: version.value.id }),
      )
    )
      throw new Error('approve');
    if (
      !isOk(
        await publishPackVersion(db, { actorAccountId: actor, packVersionId: version.value.id }),
      )
    )
      throw new Error('publish');
    return version.value.id;
  }

  /** A trip whose first traveller's case has a pack, a confirmed handoff and a tracked attempt. */
  async function tripWithCaseWork(who: { accountId: string; applicantId: string }) {
    const started = await startGroupTrip(
      await proof(who.accountId, 'MANAGE', { applicantId: who.applicantId }, 'owner_trip'),
      {
        destination: 'Japan',
        purpose: 'Tourism',
      },
    );
    if (!isOk(started)) throw new Error(`trip: ${started.error.message}`);
    const missionId = started.value.missionId;
    const versionId = await publishedPack(who.accountId);
    expect(
      isOk(
        await attachPackVersion(db, {
          actorAccountId: who.accountId,
          missionId,
          packVersionId: versionId,
        }),
      ),
    ).toBe(true);
    const passport = await document(who.accountId, who.applicantId, 'passport');
    const pkg = await getCasePackage(
      await proof(who.accountId, 'VIEW_METADATA', { missionId }),
      missionId,
    );
    if (!isOk(pkg)) throw new Error('package');
    const chose = await recordPackageChoice(await proof(who.accountId, 'MANAGE', { missionId }), {
      missionId,
      packRequirementId: pkg.value.items[0]?.packRequirementId ?? '',
      choice: 'USE_COPY',
      documentVersionId: passport.versionId,
    });
    if (!isOk(chose)) throw new Error('choice');
    const handoff = await confirmPackageHandoff(
      await proof(who.accountId, 'MANAGE', { missionId }),
      {
        missionId,
        outsideStepsSeen: true,
      },
    );
    if (!isOk(handoff)) throw new Error(handoff.error.message);
    const snap = await snapshotMission(db, { actorAccountId: who.accountId, missionId });
    if (!isOk(snap)) throw new Error(`snapshot: ${snap.error.message}`);
    // Setup fixture only (see header): the submission report the attempt tracks.
    const [report] = await db
      .insert(schema.missionSubmissions)
      .values({
        missionId,
        snapshotId: snap.value.id,
        actorAccountId: who.accountId,
        channel: 'VISA_APPLICATION_CENTER',
        externalReportDescription: 'Synthetic report',
        submittedAt: new Date('2026-11-02T08:00:00Z'),
        authAssuranceContext: { method: 'test' },
      })
      .returning();
    if (!report) throw new Error('report');
    const tracked = await trackSubmissionAsAttempt(
      await proof(who.accountId, 'MANAGE', { missionId }),
      {
        missionId,
        missionSubmissionId: report.id,
      },
    );
    if (!tracked.ok) throw new Error(tracked.error.message);
    return { tripId: started.value.tripId, missionId, attemptId: tracked.value.attemptId };
  }

  async function guestSession(rawToken: string): Promise<GuestCollectionSessionProof> {
    const link = collectionLinkProof(rawToken);
    if (!link) throw new Error('link');
    const started = await startGuestSession(db, link, null);
    const raw = guestCollectionSessionProof(started?.rawSessionId ?? null);
    if (!raw) throw new Error('session');
    const code = '864209';
    const sent = await sendGuestCode(db, raw, {
      encryption,
      networkSubject: NET,
      generateCode: () => code,
    });
    if (!sent.ok) throw new Error('code');
    const verified = await verifyGuestCode(db, raw, { code, networkSubject: NET });
    if (!verified.ok) throw new Error('verify');
    const proofed = guestCollectionSessionProof(verified.value.rawSessionId);
    if (!proofed) throw new Error('verified session');
    return proofed;
  }

  beforeAll(async () => {
    vi.stubEnv(AGENCY_COLLECTION_REQUESTS_SWITCH, 'true');
    db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
  }, TEST_TIMEOUT_MS);

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it(
    'cross-tenant: another agency reaches no collection request, account response or guest file, and each denial looks missing',
    async () => {
      const mine = await agency('Synthetic Agency J8 One');
      const theirs = await agency('Synthetic Agency J8 Two');
      const created = await createCollectionRequest(db, mine.scope, {
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
        recipientEmailHint: GUEST_EMAIL,
        packTerms: null,
      });
      if (!created.ok) throw new Error(created.error.message);
      const requestId = created.value.id;
      const drafted = await editCollectionDraft(db, await freshScope(mine), requestId, {
        type: 'add',
        label: 'Passport',
        necessity: 'MANDATORY',
      });
      if (!drafted.ok) throw new Error(drafted.error.message);
      const issued = await issueCollectionRequest(db, await freshScope(mine), requestId);
      if (!issued.ok) throw new Error(issued.error.message);

      const foreignRequest = await getCollectionRequest(db, await freshScope(theirs), requestId);
      const missingRequest = await getCollectionRequest(db, await freshScope(theirs), MISSING_ID);
      expect(isErr(foreignRequest) && foreignRequest.error).toEqual(
        isErr(missingRequest) && missingRequest.error,
      );

      // An account answer to the request.
      const traveller = await person('j8-traveller@people.example.test', 'Synthetic Traveller');
      const passport = await document(traveller.accountId, traveller.applicantId, 'passport');
      const session = guestCollectionSessionProof(
        (
          await startGuestSession(
            db,
            collectionLinkProof(issued.value.link.rawToken) as never,
            null,
          )
        )?.rawSessionId ?? null,
      );
      if (!session) throw new Error('desk session');
      const proposal = await proposeCollectionResponse(
        db,
        session,
        await proof(
          traveller.accountId,
          'VIEW_METADATA',
          { applicantId: traveller.applicantId },
          'collection_response',
        ),
      );
      if (!proposal.ok) throw new Error(`proposal: ${proposal.error.code}`);
      const firstItem = proposal.value.proposals[0];
      if (!firstItem) throw new Error('item');
      const submitted = await submitCollectionResponse(
        db,
        session,
        await proof(
          traveller.accountId,
          'SHARE',
          { applicantId: traveller.applicantId },
          'collection_response',
        ),
        {
          selections: { [firstItem.item.id]: [documentKey(passport.versionId)] },
          consentVersion: RESPONSE_CONSENT_VERSION,
          linkId: proposal.value.desk.linkId,
          revisionId: proposal.value.desk.revisionId,
        },
      );
      if (!submitted.ok) throw new Error(`submit: ${submitted.error.message}`);
      expect(
        (await collectionResponseAccess(db, await freshScope(mine), submitted.value.responseId)).ok,
      ).toBe(true);
      const foreignResponse = await collectionResponseAccess(
        db,
        await freshScope(theirs),
        submitted.value.responseId,
      );
      const missingResponse = await collectionResponseAccess(
        db,
        await freshScope(theirs),
        MISSING_ID,
      );
      expect(foreignResponse.ok).toBe(false);
      if (!foreignResponse.ok && !missingResponse.ok) {
        expect(foreignResponse.error).toEqual(missingResponse.error);
      }

      // A guest answer to the same request.
      const guest = await guestSession(issued.value.link.rawToken);
      const file = await addGuestFile(db, store, guest, {
        uploadId: randomUUID(),
        contentType: 'application/pdf',
        bytes: new TextEncoder().encode('%PDF-1.4 synthetic passport'),
        originalName: 'passport.pdf',
        checks: guestChecks(true),
      });
      if (!file.ok || file.value.kind !== 'stored') throw new Error('guest file');
      await saveGuestRetentionChoice(db, guest, 15);
      const guestSubmitted = await submitGuestDocuments(db, guest, { consent: true });
      if (!guestSubmitted.ok) throw new Error(guestSubmitted.error.message);
      expect(await listGuestSubmissions(db, await freshScope(theirs), requestId)).toEqual([]);
      const stepUp = (accountId: string) => {
        const request = {
          accountId,
          action: 'DOWNLOAD_ORIGINAL' as const,
          resourceId: file.value.file.id,
        };
        const verified = verifyStepUp(
          STEP_UP_SECRET,
          issueStepUpAssurance(STEP_UP_SECRET, request),
          request,
        );
        if (!verified) throw new Error('step up');
        return verified;
      };
      const foreignFile = await downloadGuestSubmissionFile(db, store, await freshScope(theirs), {
        submissionId: guestSubmitted.value.submissionId,
        fileId: file.value.file.id,
        stepUp: stepUp(theirs.adminId),
      });
      const missingFile = await downloadGuestSubmissionFile(db, store, await freshScope(theirs), {
        submissionId: MISSING_ID,
        fileId: MISSING_ID,
        stepUp: stepUp(theirs.adminId),
      });
      expect(isErr(foreignFile) && foreignFile.error).toEqual(
        isErr(missingFile) && missingFile.error,
      );
      const ownFile = await downloadGuestSubmissionFile(db, store, await freshScope(mine), {
        submissionId: guestSubmitted.value.submissionId,
        fileId: file.value.file.id,
        stepUp: stepUp(mine.adminId),
      });
      expect(ownFile.ok).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'cross-person: another account reaches no trip, case package or outcome attempt, and each denial looks missing',
    async () => {
      const owner = await person('j8-owner@people.example.test', 'Synthetic Owner');
      const other = await person('j8-other@people.example.test', 'Synthetic Other');
      const work = await tripWithCaseWork(owner);
      const otherView = await proof(
        other.accountId,
        'VIEW_METADATA',
        { applicantId: other.applicantId },
        'owner_trip',
      );

      const foreignTrip = await getTrip(otherView, work.tripId);
      const missingTrip = await getTrip(otherView, MISSING_ID);
      expect(isErr(foreignTrip) && foreignTrip.error).toEqual(
        isErr(missingTrip) && missingTrip.error,
      );
      const evidence = await listTripEvidence(otherView, work.tripId);
      expect(isErr(evidence) && evidence.error.code).toBe('not_found');

      // The gate refuses a case proof for someone else's case outright.
      const denied = await requireAccess(
        db,
        accountPrincipal(other.accountId),
        'VIEW_METADATA',
        { missionId: work.missionId },
        { purpose: 'self' },
      );
      expect(isErr(denied)).toBe(true);
      // A proof for one's own case never opens another case.
      const otherWork = await tripWithCaseWork(other);
      const otherCase = await proof(other.accountId, 'VIEW_METADATA', {
        missionId: otherWork.missionId,
      });
      const crossedPackage = await getCasePackage(otherCase, work.missionId);
      const missingPackage = await getCasePackage(otherCase, MISSING_ID);
      expect(isErr(crossedPackage) && crossedPackage.error).toEqual(
        isErr(missingPackage) && missingPackage.error,
      );
      const crossedAttempts = await listOutcomeAttempts(otherCase, work.missionId);
      const missingAttempts = await listOutcomeAttempts(otherCase, MISSING_ID);
      expect(isErr(crossedAttempts)).toBe(true);
      expect(isErr(crossedAttempts) && crossedAttempts.error).toEqual(
        isErr(missingAttempts) && missingAttempts.error,
      );
      const own = await listOutcomeAttempts(
        await proof(owner.accountId, 'VIEW_METADATA', { missionId: work.missionId }),
        work.missionId,
      );
      expect(isOk(own)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'the frozen golden manifest checksum still verifies, in memory and from stored rows',
    async () => {
      const rows = GOLDEN_ROWS.map((r) => ({ ...r }) as unknown as PackRequirement);
      expect(buildManifest(rows).checksum).toBe(GOLDEN_CHECKSUM);
      expect(createHash('sha256').update('').digest('hex')).not.toBe(GOLDEN_CHECKSUM);
      const author = await provisionAccount(db, { email: 'j8-golden@platform.example.test' });
      if (!isOk(author)) throw new Error('author');
      const pack = await createPack(db, {
        actorAccountId: author.value.id,
        key: `j8.golden.${randomUUID()}`,
        name: 'J8 Golden',
      });
      if (!isOk(pack)) throw new Error('pack');
      const version = await addPackVersion(db, {
        actorAccountId: author.value.id,
        packId: pack.value.id,
      });
      if (!isOk(version)) throw new Error('version');
      for (const row of GOLDEN_ROWS) {
        const added = await addRequirement(db, {
          actorAccountId: author.value.id,
          packVersionId: version.value.id,
          kind: row.kind,
          ...(row.fieldKey ? { fieldKey: row.fieldKey } : {}),
          ...(row.docType ? { docType: row.docType } : {}),
          citation: row.citation,
          optional: row.optional,
        });
        if (!isOk(added)) throw new Error(`requirement ${row.citation}`);
      }
      const approved = await approvePackVersion(db, {
        actorAccountId: author.value.id,
        packVersionId: version.value.id,
      });
      if (!isOk(approved)) throw new Error('approve');
      expect(approved.value.checksum).toBe(GOLDEN_CHECKSUM);
      expect(await verifyPackChecksum(db, version.value.id)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'deleting an account removes its trip, handoff, outcome attempt and held file, through the deletion service',
    async () => {
      const owner = await person('j8-leaving@people.example.test', 'Synthetic Leaving');
      const work = await tripWithCaseWork(owner);
      const held = await holdFamilyFile(
        await proof(owner.accountId, 'MANAGE', { applicantId: owner.applicantId }, 'test'),
        { storage: store, checks: guestChecks(true), converter: noText },
        {
          uploadId: randomUUID(),
          originalFileName: 'family scan.pdf',
          bytes: new Uint8Array([...PDF, 7]),
          contentType: 'application/pdf',
          storedFileName: 'document.pdf',
        },
      );
      if (held.kind !== 'held') throw new Error(`hold: ${held.kind}`);
      const [heldRow] = await db
        .select()
        .from(schema.documentPersonHolds)
        .where(eq(schema.documentPersonHolds.id, held.holdId));
      const owned = async () => ({
        trips: await count(
          db,
          sql`select count(*)::int as n from umpe_trips where owner_account_id = ${owner.accountId}`,
        ),
        travellers: await count(
          db,
          sql`select count(*)::int as n from umpe_trip_travellers where trip_id = ${work.tripId}`,
        ),
        handoffs: await count(
          db,
          sql`select count(*)::int as n from umpe_package_handoffs where mission_id = ${work.missionId}`,
        ),
        attempts: await count(
          db,
          sql`select count(*)::int as n from umpe_outcome_attempts where mission_id = ${work.missionId}`,
        ),
        holds: await count(
          db,
          sql`select count(*)::int as n from document_person_holds where id = ${held.holdId}`,
        ),
      });
      expect(await owned()).toEqual({
        trips: 1,
        travellers: 1,
        handoffs: 1,
        attempts: 1,
        holds: 1,
      });

      const now = new Date();
      const requested = await requestAccountDeletion(db, {
        actorAccountId: owner.accountId,
        accountId: owner.accountId,
        gracePeriodMs: 0,
        now,
      });
      expect(requested.ok).toBe(true);
      const executed = await executeAccountDeletion(db, {
        accountId: owner.accountId,
        now: new Date(now.getTime() + 1000),
      });
      if (!executed.ok) throw new Error(executed.error.message);
      expect(await owned()).toEqual({
        trips: 0,
        travellers: 0,
        handoffs: 0,
        attempts: 0,
        holds: 0,
      });
      const jobs = await db
        .select()
        .from(schema.erasureJobs)
        .where(eq(schema.erasureJobs.objectKey, heldRow?.objectKey ?? ''));
      expect(jobs).toEqual([expect.objectContaining({ reason: 'ACCOUNT_DELETION' })]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'scanner truth: a rejected or unscanned file is never served as clean, and a structural check never claims a virus scan',
    async () => {
      const who = await person('j8-scan@people.example.test', 'Synthetic Scan');
      const doc = await registerDocument(db, {
        actorAccountId: who.accountId,
        applicantId: who.applicantId,
        originalName: 'infected.pdf',
      });
      if (!isOk(doc)) throw new Error('doc');
      const rejected = await addDocumentVersion(db, {
        actorAccountId: who.accountId,
        documentId: doc.value.id,
        bucket: 'QUARANTINE',
        objectKey: `j8-q/${randomUUID()}`,
      });
      if (!isOk(rejected)) throw new Error('version');
      expect(rejected.value.version.safetyStatus).toBe('PENDING');
      const actor = { kind: 'applicant_owner', applicantId: who.applicantId as never } as const;
      const open = () =>
        previewDocument(
          db,
          {
            async issueReadRef() {
              throw new Error('storage must not be reached');
            },
          },
          {
            actor,
            documentId: doc.value.id,
            purpose: 'self_review',
            accessTokenSecret: ACCESS_TOKEN_SECRET,
          },
        );
      // Unscanned: refused.
      expect(isErr(await open())).toBe(true);
      const scanned = await processIntake(db, scanner(false), noText, withinLimits, {
        documentVersionId: rejected.value.version.id,
      });
      if (!isOk(scanned)) throw new Error('intake');
      expect(scanned.value.safetyStatus).toBe('QUARANTINED');
      // Rejected by the scanner: still refused, and storage is never asked for a link.
      expect(isErr(await open())).toBe(true);

      // A guest file the scanner rejects keeps no bytes; a passed structural check says so honestly.
      const agencyA = await agency('Synthetic Agency J8 Scan');
      const created = await createCollectionRequest(db, agencyA.scope, {
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
        recipientEmailHint: 'j8-scan-guest@example.test',
        packTerms: null,
      });
      if (!created.ok) throw new Error(created.error.message);
      await editCollectionDraft(db, await freshScope(agencyA), created.value.id, {
        type: 'add',
        label: 'Passport',
        necessity: 'MANDATORY',
      });
      const issued = await issueCollectionRequest(db, await freshScope(agencyA), created.value.id);
      if (!issued.ok) throw new Error(issued.error.message);
      const guest = await guestSession(issued.value.link.rawToken);
      const before = store.objects.size;
      const refused = await addGuestFile(db, store, guest, {
        uploadId: randomUUID(),
        contentType: 'application/pdf',
        bytes: new TextEncoder().encode('%PDF-1.4 synthetic infected'),
        originalName: 'passport.pdf',
        checks: guestChecks(false),
      });
      expect(refused.ok && refused.value.kind).toBe('refused');
      expect(store.objects.size).toBe(before);
      const passed = await addGuestFile(db, store, guest, {
        uploadId: randomUUID(),
        contentType: 'application/pdf',
        bytes: new TextEncoder().encode('%PDF-1.4 synthetic clean'),
        originalName: 'passport-clean.pdf',
        checks: guestChecks(true),
      });
      if (!passed.ok || passed.value.kind !== 'stored') throw new Error('stored');
      expect(passed.value.file.virusScanned).toBe(false);
      // Only a real virus scanner's pass is recorded as virus scanned.
      const realScan = await addGuestFile(db, store, guest, {
        uploadId: randomUUID(),
        contentType: 'application/pdf',
        bytes: new TextEncoder().encode('%PDF-1.4 synthetic scanned'),
        originalName: 'passport-scanned.pdf',
        checks: guestChecks(true, true),
      });
      if (!realScan.ok || realScan.value.kind !== 'stored') throw new Error('stored');
      expect(realScan.value.file.virusScanned).toBe(true);
      expect(await readGuestDesk(db, guest)).not.toBeNull();

      // A held family file the scanner rejects is refused and leaves no hold.
      const holdsBefore = await count(
        db,
        sql`select count(*)::int as n from document_person_holds`,
      );
      const unsafe = await holdFamilyFile(
        await proof(who.accountId, 'MANAGE', { applicantId: who.applicantId }, 'test'),
        { storage: store, checks: guestChecks(false), converter: noText },
        {
          uploadId: randomUUID(),
          originalFileName: 'family scan.pdf',
          bytes: new Uint8Array([...PDF, 9]),
          contentType: 'application/pdf',
          storedFileName: 'document.pdf',
        },
      );
      expect(unsafe).toMatchObject({ kind: 'refused', reason: 'unsafe' });
      expect(await count(db, sql`select count(*)::int as n from document_person_holds`)).toBe(
        holdsBefore,
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'AI off (kill switch) and AI consent off: no provider call, while manual profile edits and document kinds still work',
    async () => {
      const aiDb = await freshDb();
      // Consent off: nothing is queued and nothing is called.
      const noConsent = await seedReader(aiDb, 'j8-noconsent@example.test', {
        consents: ['CORE_PROCESSING'],
        docType: 'HOTEL_BOOKING',
      });
      const first = countingPorts();
      await runIntake(aiDb, noConsent.versionId, extractorFor(LETTER_TEXT));
      expect(await jobsOf(aiDb, noConsent.versionId)).toHaveLength(0);
      await runAiReadingWorker(aiDb, aiScope(), first.ports);
      expect(first.calls).toMatchObject({ extract: 0, ocr: 0, render: 0, prepare: 0 });

      // Kill switch thrown after a job was queued: it stops before any provider work.
      const consented = await seedReader(aiDb, 'j8-kill@example.test', {
        docType: 'HOTEL_BOOKING',
      });
      const second = countingPorts();
      await runIntake(aiDb, consented.versionId, extractorFor(LETTER_TEXT));
      expect(await jobsOf(aiDb, consented.versionId)).toHaveLength(1);
      await switchAiOff(aiDb);
      const result = await runAiReadingWorker(aiDb, aiScope(), second.ports);
      expect(result).toMatchObject({ processed: 0, failed: 0 });
      expect(second.calls).toMatchObject({ extract: 0, ocr: 0, render: 0, prepare: 0 });
      expect((await jobsOf(aiDb, consented.versionId))[0]?.errorCode).toBe('SWITCHED_OFF');

      // The manual path still works for both people.
      await registerFieldDefinition(aiDb, { key: 'passport.number', dataType: 'string' });
      for (const reader of [noConsent, consented]) {
        const fact = await editFact(aiDb, {
          actorAccountId: reader.accountId,
          applicantId: reader.applicantId,
          fieldKey: 'passport.number',
          value: 'SYN0000001',
        });
        expect(isOk(fact)).toBe(true);
        const kind = await setDocumentType(aiDb, {
          actorAccountId: reader.accountId,
          documentId: reader.documentId,
          docType: 'passport',
        });
        if (!isOk(kind)) throw new Error(kind.error.message);
        // The catalogue stores its one standard key for the alias typed.
        expect(kind.value.docType).toBe('PASSPORT');
      }
      expect(second.calls.extract + first.calls.extract).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );
});
