/**
 * UMPE P14 journey J6: official-source maintenance, from the Saturday check to a dual-approved
 * publication and its effect on live work.
 *
 * Covered here, on one migrated in-memory database with the real services and a fake network
 * (source-fetch.test-support.ts):
 * 1. The weekly job runs once per Dhaka week (Saturday in Asia/Dhaka) and is idempotent.
 * 2. It checks registered official addresses: changed HTML, a blocked page, a PDF and an unavailable
 *    page. Only a page actually read counts as checked; it creates a candidate difference.
 * 3. The real fetch time and the reviewer's action are kept apart from "last verified by a person".
 * 4. The check never creates, approves, publishes or edits a pack; no automatic path (AI included)
 *    calls a pack approval or publication; the author of a version cannot approve it.
 * 5. Publishing a dual-approved version flags affected live cases (P11 rule impact) without
 *    changing issued agency revisions or handoffs, and the older published manifest still
 *    verifies with the same checksum.
 *
 * Not exercisable below the browser, so reported rather than faked: the real outbound fetch of
 * government pages, the hosting scheduler actually firing (apps/web/vercel.json is read as a
 * file; the hosted schedule is daily 03:00 UTC and the service itself gates to the Dhaka week),
 * the admin screens, and the live deployment.
 *
 * Synthetic data only. Every run time is passed in.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PGlite } from '@electric-sql/pglite';
import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { accountPrincipal, requireAccess } from '../access';
import { type AgencyCollectionScope, agencyCollectionPrincipal } from '../access/collection-scope';
import { staffPrincipal } from '../access/principal';
import { systemScopeForTest } from '../access/system-scope.test-support';
import { provisionAccount } from '../accounts';
import { createApplicant } from '../applicants';
import { setConsent } from '../consent';
import type { Db } from '../db';
import { addDocumentVersion, registerDocument } from '../documents';
import { attachPackVersion, createMission } from '../missions';
import { createOrganization, reviewOrganization } from '../organizations';
import {
  type RequirementInput,
  addPackVersion,
  addRequirement,
  approvePackVersion,
  createPack,
  publishPackVersion,
  verifyPackChecksum,
} from '../packs';
import { grantPlatformRole } from '../platform-roles';
import { createSourceFetcher } from '../source-fetch';
import { PUBLIC_ADDRESS, fakeTransport } from '../source-fetch.test-support';
import {
  dhakaWeekKey,
  isSaturdayInDhaka,
  registerOfficialSource,
  reviewSourceChangeCandidate,
  runSourceCheck,
  sourceMonitorOverview,
} from '../source-monitor';
import {
  createCollectionRequest,
  getCollectionRequest,
  issueCollectionRequest,
} from '../umpe-collection-request-service';
import { AGENCY_COLLECTION_REQUESTS_SWITCH } from '../umpe-collection-request-switch';
import {
  confirmPackageHandoff,
  getCasePackage,
  recordPackageChoice,
} from '../umpe-package-service';
import { assessRuleImpact } from '../umpe-rule-impact-service';

const TEST_TIMEOUT_MS = 120_000;
const JOB = systemScopeForTest('process-source-check');
/** Thursday 5 Nov 2026 in Dhaka: not the check day. */
const THURSDAY = new Date('2026-11-05T03:00:00Z');
/** Saturday 7 Nov 2026, 03:00 UTC = 09:00 in Dhaka. */
const SAT_1 = new Date('2026-11-07T03:00:00Z');
const SAT_2 = new Date('2026-11-14T03:00:00Z');
const OBSERVED = new Date('2026-10-01T00:00:00Z');
const HOST = 'visas.j6-synthetic-gov.example';
const url = (p: string) => `https://${HOST}${p}`;

interface Page {
  status?: number;
  body?: string;
  type?: string;
}

function page(rule: string): string {
  return `<!doctype html><html><head><title>Visit</title></head><body><nav>Home</nav><main><h1>Visit visa</h1><p>${rule}</p></main><footer>Footer</footer></body></html>`;
}

function sourced(
  row: Omit<RequirementInput, 'sourceUrl' | 'sourceTitle' | 'publisher' | 'observedDate'>,
  observed = OBSERVED,
): RequirementInput {
  return {
    ...row,
    sourceUrl: url('/visit-rules'),
    sourceTitle: 'Synthetic Visit Rules',
    publisher: 'Synthetic Authority',
    observedDate: observed,
  };
}

const V1_ROWS: readonly RequirementInput[] = [
  sourced({ kind: 'DOCUMENT', docType: 'passport', citation: 'Synthetic rule 1' }),
];
const V2_ROWS: readonly RequirementInput[] = [
  ...V1_ROWS,
  sourced(
    { kind: 'DOCUMENT', docType: 'hotel_booking', citation: 'Synthetic rule 2' },
    new Date('2026-10-20T00:00:00Z'),
  ),
];

describe('J6 official-source maintenance', () => {
  let client: PGlite;
  let db: Db;
  let author: string;
  let reviewer: string;
  let traveller: string;
  let applicantId: string;
  let agencyAdmin: string;
  let orgId: string;
  const emails = new Map<string, string>();
  const pages = new Map<string, Page>();
  const fake = fakeTransport((requested) => {
    const answer = pages.get(requested) ?? { status: 404 };
    return {
      status: answer.status ?? 200,
      body: answer.body ?? '',
      headers: { 'content-type': answer.type ?? 'text/html' },
    };
  });
  const fetcher = createSourceFetcher({
    transport: fake.transport,
    resolve: async () => [PUBLIC_ADDRESS],
    timeoutMs: 100,
  });

  // Journey state.
  let packId = '';
  let v1 = '';
  let v1Checksum = '';
  let missionId = '';
  let handoffId = '';
  let requestId = '';
  let linkedSourceId = '';

  async function account(email: string): Promise<string> {
    const made = await provisionAccount(db, { email });
    if (!isOk(made)) throw new Error('provision');
    emails.set(made.value.id, email);
    return made.value.id;
  }

  async function packScope(accountId: string) {
    const minted = await staffPrincipal(
      db,
      { accountId, email: emails.get(accountId) ?? '', bootstrapEmails: [] },
      'PACK_MANAGE',
    );
    if (!isOk(minted)) throw new Error('scope');
    return minted.value;
  }

  async function agencyScope(): Promise<AgencyCollectionScope> {
    const minted = await agencyCollectionPrincipal(db, agencyAdmin, orgId);
    if (!minted.ok) throw new Error('agency scope');
    return minted.value;
  }

  async function draftVersion(rows: readonly RequirementInput[]): Promise<string> {
    const made = await addPackVersion(db, { actorAccountId: author, packId });
    if (!isOk(made)) throw new Error('version');
    for (const row of rows) {
      const added = await addRequirement(db, {
        actorAccountId: author,
        packVersionId: made.value.id,
        ...row,
      });
      if (!isOk(added)) throw new Error(`requirement: ${added.error.message}`);
    }
    return made.value.id;
  }

  async function caseProof<A extends 'MANAGE' | 'VIEW_METADATA'>(action: A) {
    const proof = await requireAccess(
      db,
      accountPrincipal(traveller),
      action,
      { missionId },
      { purpose: 'self' },
    );
    if (!isOk(proof)) throw new Error('case proof');
    return proof.value;
  }

  async function register(p: string, withPack: boolean) {
    const created = await registerOfficialSource(db, await packScope(author), {
      jurisdiction: 'gb',
      route: 'visit',
      url: url(p),
      title: `Synthetic ${p}`,
      publisher: 'Synthetic Authority',
      authorityTier: 'GOVERNMENT',
      ...(withPack ? { packId } : {}),
    });
    if (!isOk(created)) throw new Error(created.error.message);
    return created.value.id;
  }

  /** Every pack row, so a run or a review can be proven to change none of them. */
  async function packSnapshot(): Promise<string> {
    return JSON.stringify({
      packs: await db.select().from(schema.packs).orderBy(asc(schema.packs.id)),
      versions: await db.select().from(schema.packVersions).orderBy(asc(schema.packVersions.id)),
      requirements: await db
        .select()
        .from(schema.packRequirements)
        .orderBy(asc(schema.packRequirements.id)),
    });
  }

  beforeAll(async () => {
    vi.stubEnv(AGENCY_COLLECTION_REQUESTS_SWITCH, 'true');
    client = await createMigratedPglite();
    db = drizzle(client, { schema }) as unknown as Db;
    const authorEmail = 'j6-author@platform.example.test';
    author = await account(authorEmail);
    const bootstrapped = await grantPlatformRole(db, {
      actor: { accountId: author, email: authorEmail, bootstrapEmails: [authorEmail] },
      targetAccountId: author,
      role: 'PLATFORM_OWNER',
      reason: 'synthetic seed',
      stepUpSatisfied: true,
    });
    if (!isOk(bootstrapped)) throw new Error('grant author');
    reviewer = await account('j6-reviewer@platform.example.test');
    const second = await grantPlatformRole(db, {
      actor: { accountId: author, email: authorEmail, bootstrapEmails: [] },
      targetAccountId: reviewer,
      role: 'PLATFORM_OWNER',
      reason: 'synthetic second reviewer',
      stepUpSatisfied: true,
    });
    if (!isOk(second)) throw new Error(`grant reviewer: ${second.error.message}`);

    traveller = await account('j6-traveller@people.example.test');
    await setConsent(db, {
      actorAccountId: traveller,
      accountId: traveller,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    const person = await createApplicant(db, {
      actorAccountId: traveller,
      ownerAccountId: traveller,
      displayName: 'Synthetic Traveller',
    });
    if (!isOk(person)) throw new Error('applicant');
    applicantId = person.value.id;

    agencyAdmin = await account('admin@agency-j6.example.test');
    const org = await createOrganization(db, {
      actorAccountId: agencyAdmin,
      name: 'Synthetic Agency J6',
    });
    if (!isOk(org)) throw new Error('org');
    orgId = org.value.id;
    const reviewed = await reviewOrganization(db, {
      reviewerAccountId: reviewer,
      organizationId: orgId,
      decision: 'ACTIVE',
      stepUpSatisfied: true,
    });
    if (!isOk(reviewed)) throw new Error('activate');
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    vi.unstubAllEnvs();
    await client.close();
  });

  it(
    'setup: a dual-approved official checklist with a live case, a handoff and an issued agency request on it',
    async () => {
      const pack = await createPack(db, {
        actorAccountId: author,
        key: `j6.${randomUUID()}`,
        name: 'Synthetic UK Visit',
        jurisdiction: 'United Kingdom',
        purpose: 'Tourism',
        authoritative: true,
      });
      if (!isOk(pack)) throw new Error('pack');
      packId = pack.value.id;
      v1 = await draftVersion(V1_ROWS);
      const self = await approvePackVersion(db, { actorAccountId: author, packVersionId: v1 });
      expect(isErr(self) && self.error.code).toBe('forbidden');
      const approved = await approvePackVersion(db, {
        actorAccountId: reviewer,
        packVersionId: v1,
      });
      if (!isOk(approved)) throw new Error(approved.error.message);
      v1Checksum = approved.value.checksum ?? '';
      expect(v1Checksum).toMatch(/^[0-9a-f]{64}$/);
      const published = await publishPackVersion(db, {
        actorAccountId: reviewer,
        packVersionId: v1,
      });
      if (!isOk(published)) throw new Error(published.error.message);

      // A live case on version 1, with an exact-version handoff.
      const mission = await createMission(db, {
        actorAccountId: traveller,
        applicantId,
        title: 'Synthetic Case',
      });
      if (!isOk(mission)) throw new Error('mission');
      missionId = mission.value.id;
      expect(
        isOk(
          await attachPackVersion(db, { actorAccountId: traveller, missionId, packVersionId: v1 }),
        ),
      ).toBe(true);
      const doc = await registerDocument(db, {
        actorAccountId: traveller,
        applicantId,
        originalName: 'passport.pdf',
        docType: 'passport',
      });
      if (!isOk(doc)) throw new Error('doc');
      const version = await addDocumentVersion(db, {
        actorAccountId: traveller,
        documentId: doc.value.id,
        bucket: 'CLEAN',
        objectKey: `j6/${randomBytes(8).toString('hex')}`,
        safetyStatus: 'CLEAN',
        processingStatus: 'AWAITING_REVIEW',
      });
      if (!isOk(version)) throw new Error('version');
      const pkg = await getCasePackage(await caseProof('VIEW_METADATA'), missionId);
      if (!isOk(pkg)) throw new Error('package');
      const item = pkg.value.items[0];
      const chose = await recordPackageChoice(await caseProof('MANAGE'), {
        missionId,
        packRequirementId: item?.packRequirementId ?? '',
        choice: 'USE_COPY',
        documentVersionId: version.value.version.id,
      });
      expect(isOk(chose)).toBe(true);
      const confirmed = await confirmPackageHandoff(await caseProof('MANAGE'), {
        missionId,
        outsideStepsSeen: true,
      });
      if (!isOk(confirmed)) throw new Error(confirmed.error.message);
      handoffId = confirmed.value.handoffId;

      // An agency request issued on version 1.
      const created = await createCollectionRequest(db, await agencyScope(), {
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
      if (!created.ok) throw new Error(created.error.message);
      requestId = created.value.id;
      const issued = await issueCollectionRequest(db, await agencyScope(), requestId);
      if (!issued.ok) throw new Error(issued.error.message);
      const detail = await getCollectionRequest(db, await agencyScope(), requestId);
      expect(detail.ok && detail.value.revisions[0]?.packChecksum).toBe(v1Checksum);

      linkedSourceId = await register('/visit-rules', true);
      await register('/blocked', false);
      await register('/guidance.pdf', false);
      await register('/gone', false);
      pages.set(url('/visit-rules'), { body: page('Apply at least 3 weeks before travel.') });
      pages.set(url('/blocked'), { status: 403, body: 'denied' });
      pages.set(url('/guidance.pdf'), { body: '%PDF-1.7 synthetic', type: 'application/pdf' });
      pages.set(url('/gone'), { status: 503 });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'step 1: the weekly job runs only in the Saturday Dhaka week and once per week',
    async () => {
      const vercel = JSON.parse(
        readFileSync(
          path.resolve(
            path.dirname(fileURLToPath(import.meta.url)),
            '../../../../apps/web/vercel.json',
          ),
          'utf8',
        ),
      ) as { crons: { path: string; schedule: string }[] };
      const cron = vercel.crons.find((c) => c.path === '/api/jobs/process-source-check');
      // Recorded as deployed: a daily call, which the service gates to the Dhaka week.
      expect(cron?.schedule).toBe('0 3 * * *');
      expect(isSaturdayInDhaka(SAT_1)).toBe(true);
      expect(isSaturdayInDhaka(THURSDAY)).toBe(false);
      expect(dhakaWeekKey(SAT_1)).toBe('2026-11-07');

      expect((await runSourceCheck(db, JOB, { fetcher, now: THURSDAY })).status).toBe('NOT_DUE');
      expect(fake.requests).toHaveLength(0);
      const first = await runSourceCheck(db, JOB, { fetcher, now: SAT_1 });
      expect(first).toMatchObject({ status: 'COMPLETED', sourcesDue: 4, checked: 1, changed: 0 });
      const seen = fake.requests.length;
      expect(
        (await runSourceCheck(db, JOB, { fetcher, now: new Date('2026-11-07T09:00:00Z') })).status,
      ).toBe('ALREADY_DONE');
      expect(fake.requests.length).toBe(seen);
      expect(await db.select().from(schema.sourceCheckRuns)).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'step 2: changed HTML makes a candidate; blocked, PDF and unavailable pages are never checked',
    async () => {
      const before = await packSnapshot();
      pages.set(url('/visit-rules'), { body: page('Apply at least 4 weeks before travel.') });
      const result = await runSourceCheck(db, JOB, { fetcher, now: SAT_2 });
      expect(result).toMatchObject({
        status: 'COMPLETED',
        sourcesDue: 4,
        checked: 1,
        changed: 1,
        blocked: 1,
        unsupported: 1,
        failed: 1,
      });
      const candidates = await db.select().from(schema.sourceChangeCandidates);
      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toMatchObject({ sourceId: linkedSourceId, status: 'NEW' });
      expect(candidates[0]?.oldExcerpt).toContain('3 weeks');
      expect(candidates[0]?.newExcerpt).toContain('4 weeks');
      const [observation] = await db
        .select()
        .from(schema.sourceObservations)
        .where(eq(schema.sourceObservations.id, candidates[0]?.observationId ?? ''));
      expect(observation?.fetchedAt.toISOString()).toBe(SAT_2.toISOString());

      const overview = await sourceMonitorOverview(db);
      for (const source of overview.sources) {
        if (source.id === linkedSourceId) {
          expect(source.lastFetchedAt?.toISOString()).toBe(SAT_2.toISOString());
          expect(source.lastVerifiedAt?.toISOString()).toBe(OBSERVED.toISOString());
        } else {
          expect(source.lastFetchedAt).toBeNull();
          expect(source.lastOutcome).not.toBe('FETCHED');
        }
      }
      // The check created, approved, published and edited nothing in any pack.
      expect(await packSnapshot()).toBe(before);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'step 3: the reviewer action is recorded apart from fetch time and from last verified by a person',
    async () => {
      const before = await packSnapshot();
      const [candidate] = await db.select().from(schema.sourceChangeCandidates);
      if (!candidate) throw new Error('candidate');
      const decided = await reviewSourceChangeCandidate(db, await packScope(reviewer), {
        candidateId: candidate.id,
        decision: 'ACCEPTED_FOR_DRAFT',
        note: 'Synthetic: wording changed, draft a new version.',
      });
      expect(isOk(decided)).toBe(true);
      const [after] = await db
        .select()
        .from(schema.sourceChangeCandidates)
        .where(eq(schema.sourceChangeCandidates.id, candidate.id));
      expect(after).toMatchObject({ status: 'ACCEPTED_FOR_DRAFT', reviewerAccountId: reviewer });
      expect(after?.reviewedAt).toBeInstanceOf(Date);
      expect(after?.reviewedAt?.toISOString()).not.toBe(SAT_2.toISOString());
      const linked = (await sourceMonitorOverview(db)).sources.find((s) => s.id === linkedSourceId);
      expect(linked?.lastFetchedAt?.toISOString()).toBe(SAT_2.toISOString());
      expect(linked?.lastVerifiedAt?.toISOString()).toBe(OBSERVED.toISOString());
      expect(await packSnapshot()).toBe(before);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'step 4: no automatic path can approve or publish a pack, and the author cannot approve their own version',
    async () => {
      const servicesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
      const sourceFiles = (dir: string): string[] =>
        readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) return sourceFiles(full);
          return entry.name.endsWith('.ts') &&
            !entry.name.endsWith('.test.ts') &&
            !entry.name.includes('test-support')
            ? [full]
            : [];
        });
      const mutating =
        /\b(createPack|addPackVersion|addRequirement|approvePackVersion|publishPackVersion)\(/;
      const callers = sourceFiles(servicesDir)
        .filter((file) => mutating.test(readFileSync(file, 'utf8')))
        .map((file) => path.relative(servicesDir, file));
      // Only the pack studio module itself; never the source check, AI or rule impact code.
      expect(callers).toEqual(['packs.ts']);

      const v2 = await draftVersion(V2_ROWS);
      const self = await approvePackVersion(db, { actorAccountId: author, packVersionId: v2 });
      expect(isErr(self) && self.error.code).toBe('forbidden');
      const early = await publishPackVersion(db, { actorAccountId: reviewer, packVersionId: v2 });
      expect(isErr(early)).toBe(true);
      const [stillDraft] = await db
        .select({ status: schema.packVersions.status })
        .from(schema.packVersions)
        .where(eq(schema.packVersions.id, v2));
      expect(stillDraft?.status).toBe('DRAFT');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'step 5: a dual-approved publication flags the live case, leaves revisions and handoffs alone, and v1 still verifies',
    async () => {
      const [draft] = await db
        .select()
        .from(schema.packVersions)
        .where(eq(schema.packVersions.status, 'DRAFT'));
      if (!draft) throw new Error('draft');
      const revisionsBefore = await db
        .select()
        .from(schema.agencyCollectionRequestRevisions)
        .orderBy(asc(schema.agencyCollectionRequestRevisions.id));
      const handoffsBefore = await db
        .select()
        .from(schema.umpePackageHandoffs)
        .orderBy(asc(schema.umpePackageHandoffs.id));
      const missionBefore = await db
        .select()
        .from(schema.missions)
        .where(eq(schema.missions.id, missionId));

      const approved = await approvePackVersion(db, {
        actorAccountId: reviewer,
        packVersionId: draft.id,
      });
      if (!isOk(approved)) throw new Error(approved.error.message);
      const published = await publishPackVersion(db, {
        actorAccountId: reviewer,
        packVersionId: draft.id,
      });
      if (!isOk(published)) throw new Error(published.error.message);

      const [old] = await db
        .select()
        .from(schema.packVersions)
        .where(eq(schema.packVersions.id, v1));
      expect(old?.status).toBe('DEPRECATED');
      expect(old?.checksum).toBe(v1Checksum);
      expect(await verifyPackChecksum(db, v1)).toBe(true);
      expect(await verifyPackChecksum(db, draft.id)).toBe(true);

      const assessed = await assessRuleImpact(db, await packScope(reviewer), {
        packVersionId: draft.id,
      });
      expect(assessed.ok && assessed.value.casesFlagged).toBe(1);
      const impacts = await db
        .select()
        .from(schema.umpeRuleImpacts)
        .where(eq(schema.umpeRuleImpacts.missionId, missionId));
      expect(impacts).toEqual([
        expect.objectContaining({
          previousPackVersionId: v1,
          packVersionId: draft.id,
          changeKind: 'ADDED',
          itemKey: 'hotel_booking',
        }),
      ]);

      expect(
        await db
          .select()
          .from(schema.agencyCollectionRequestRevisions)
          .orderBy(asc(schema.agencyCollectionRequestRevisions.id)),
      ).toEqual(revisionsBefore);
      expect(
        await db
          .select()
          .from(schema.umpePackageHandoffs)
          .orderBy(asc(schema.umpePackageHandoffs.id)),
      ).toEqual(handoffsBefore);
      expect(handoffsBefore.map((h) => h.id)).toEqual([handoffId]);
      expect(
        await db.select().from(schema.missions).where(eq(schema.missions.id, missionId)),
      ).toEqual(missionBefore);
      const detail = await getCollectionRequest(db, await agencyScope(), requestId);
      expect(detail.ok && detail.value.revisions[0]).toMatchObject({
        intact: true,
        packChecksum: v1Checksum,
      });
    },
    TEST_TIMEOUT_MS,
  );
});
