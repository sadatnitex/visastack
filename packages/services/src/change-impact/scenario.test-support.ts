import type { PGlite } from '@electric-sql/pglite';
import type { Result } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { accountPrincipal, requireAccess } from '../access';
import type { AuthorizedApplicant } from '../access';
import { provisionAccount } from '../accounts';
import { decideAcknowledgement } from '../acknowledgements';
import { decideEvidenceResponse, requestEvidence, submitEvidenceResponse } from '../agency';
import { createApplicant } from '../applicants';
import { setConsent } from '../consent';
import type { Db } from '../db';
import { addDocumentVersion, registerDocument } from '../documents';
import { replaceDocument } from '../lifecycle/replace';
import {
  attachPackVersion,
  createMission,
  selectEvidence,
  snapshotMission,
  transitionMission,
} from '../missions';
import { createOrganization, reviewOrganization } from '../organizations';
import {
  addPackVersion,
  addRequirement,
  approvePackVersion,
  createPack,
  publishPackVersion,
} from '../packs';
import { editFact, registerFieldDefinition } from '../profile';
import { acceptGrant, createGrant } from '../sharing';
import { recordSubmission } from '../submissions';
import type { ChangeImpact, ImpactItem } from './contract';
import { assessDetailChangeImpact } from './detail';
import { assessDocumentChangeImpact } from './document';

/**
 * The shared scenario for "What This Change Affects": one made-up traveller whose older passport
 * and employment detail are used by a live case, a finished case, one agency's accepted answers
 * and another agency's separately scoped share. Everything is built through the real services on
 * a migrated in-memory database; every name is clearly made up.
 *
 * The baseline test (`baseline.test.ts`) records what the existing services say about the two
 * changes below. The service tests read the same world through the new read.
 */

export const TRAVELLER_NAME = 'Test Traveller Rahim';
export const AGENCY_A_NAME = 'Sample Agency A';
export const AGENCY_B_NAME = 'Sample Agency B';
export const LIVE_CASE_TITLE = 'Sample Live Case';
export const FINISHED_CASE_TITLE = 'Sample Finished Case';
export const EMPLOYMENT_FIELD = 'current_employer';
export const CONTROL_FIELD = 'occupation';
export const PASSPORT_TYPE = 'passport';
export const CONTROL_TYPE = 'utility_bill';
export const E_VALUE_1 = 'Sample Employer One';
export const E_VALUE_2 = 'Sample Employer Two';
export const E_VALUE_3 = 'Sample Employer Three';
export const MADE_UP_ID = '5b0c3f0e-7c1d-4e7a-9a53-6f6f2b1f0c11';

export const HEAVY = 120_000;

export interface LoggedDb {
  readonly db: Db;
  readonly client: PGlite;
  /** Every statement sent through `db`, in order. Empty it with `log.length = 0`. */
  readonly log: string[];
}

/** A migrated in-memory database whose handle records every statement it sends. */
export async function loggedDb(): Promise<LoggedDb> {
  const client = await createMigratedPglite();
  const log: string[] = [];
  const db = drizzle(client, {
    schema,
    logger: { logQuery: (sql: string) => log.push(sql) },
  }) as unknown as Db;
  return { db, client, log };
}

export function must<T, E>(result: Result<T, E>, what: string): T {
  if (!result.ok) throw new Error(`${what}: ${JSON.stringify(result.error)}`);
  return result.value;
}

export interface Person {
  readonly accountId: string;
  readonly applicantId: string;
}

export interface AgencyHandle {
  readonly accountId: string;
  readonly organizationId: string;
  readonly name: string;
}

export interface StoredDocument {
  readonly documentId: string;
  readonly versionId: string;
}

let counter = 0;
function next(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

export async function makeTraveller(db: Db, email: string, displayName: string): Promise<Person> {
  const account = must(await provisionAccount(db, { email }), 'provision');
  for (const type of ['CORE_PROCESSING', 'SHARING'] as const) {
    await setConsent(db, {
      actorAccountId: account.id,
      accountId: account.id,
      type,
      granted: true,
    });
  }
  const applicant = must(
    await createApplicant(db, {
      actorAccountId: account.id,
      ownerAccountId: account.id,
      displayName,
    }),
    'applicant',
  );
  return { accountId: account.id, applicantId: applicant.id };
}

/** An agency with one owner, reviewed by an unrelated account so it can be given a share. */
export async function makeAgency(db: Db, email: string, name: string): Promise<AgencyHandle> {
  const member = must(await provisionAccount(db, { email }), 'agency account');
  const org = must(await createOrganization(db, { actorAccountId: member.id, name }), 'agency');
  const reviewer = must(
    await provisionAccount(db, { email: `reviewer-${org.id}@platform.example.test` }),
    'reviewer',
  );
  must(
    await reviewOrganization(db, {
      reviewerAccountId: reviewer.id,
      organizationId: org.id,
      decision: 'ACTIVE',
      stepUpSatisfied: true,
    }),
    'review',
  );
  return { accountId: member.id, organizationId: org.id, name };
}

/** A document with one clean, readable version. */
export async function makeDocument(
  db: Db,
  owner: Person,
  docType: string,
  originalName: string,
): Promise<StoredDocument> {
  const doc = must(
    await registerDocument(db, {
      actorAccountId: owner.accountId,
      applicantId: owner.applicantId,
      originalName,
      docType,
    }),
    'document',
  );
  const added = must(
    await addDocumentVersion(db, {
      actorAccountId: owner.accountId,
      documentId: doc.id,
      bucket: 'CLEAN',
      objectKey: next('impact-object'),
      sizeBytes: 1234,
      sha256: 'a'.repeat(64),
      safetyStatus: 'CLEAN',
      processingStatus: 'AWAITING_REVIEW',
    }),
    'version',
  );
  return { documentId: doc.id, versionId: added.version.id };
}

/** Save a detail (a new saved value each time). Returns the detail and the saved version. */
export async function saveDetail(db: Db, owner: Person, fieldKey: string, value: string) {
  const saved = must(
    await editFact(db, {
      actorAccountId: owner.accountId,
      applicantId: owner.applicantId,
      fieldKey,
      value,
    }),
    `save ${fieldKey}`,
  );
  return { factId: saved.fact.id, versionId: saved.version.id };
}

export interface ShareInput {
  readonly actions?: readonly ('MANAGE' | 'VIEW_METADATA' | 'PREVIEW')[];
  readonly documentIds?: readonly string[];
  readonly categories?: readonly string[];
  readonly missionId?: string;
  readonly expiryAt?: Date;
  readonly recipientAccountId?: string;
}

/** The traveller shares with an agency (or one person) and the recipient accepts. */
export async function shareWith(
  db: Db,
  owner: Person,
  recipient: AgencyHandle | { readonly accountId: string },
  input: ShareInput = {},
): Promise<string> {
  const grant = must(
    await createGrant(db, {
      actorAccountId: owner.accountId,
      applicantId: owner.applicantId,
      ...('organizationId' in recipient
        ? { recipientOrganizationId: recipient.organizationId }
        : { recipientAccountId: recipient.accountId }),
      actions: [...(input.actions ?? ['MANAGE'])],
      purpose: 'collaboration',
      ...(input.documentIds ? { documentIds: input.documentIds } : {}),
      ...(input.categories ? { categories: input.categories } : {}),
      ...(input.missionId ? { missionId: input.missionId } : {}),
      ...(input.expiryAt ? { expiryAt: input.expiryAt } : {}),
    }),
    'share',
  );
  must(
    await acceptGrant(db, { actorAccountId: recipient.accountId, grantId: grant.id }),
    'accept share',
  );
  return grant.id;
}

export interface Checklist {
  readonly packId: string;
  readonly packVersionId: string;
  readonly documentRequirementId: string;
  readonly detailRequirementId: string;
}

/** A published checklist asking for a passport and the employment detail. */
export async function makeChecklist(db: Db, owner: Person): Promise<Checklist> {
  const actor = owner.accountId;
  const pack = must(
    await createPack(db, { actorAccountId: actor, key: next('impact.pack'), name: 'Sample Pack' }),
    'pack',
  );
  const version = must(
    await addPackVersion(db, { actorAccountId: actor, packId: pack.id }),
    'pack version',
  );
  const documentRequirement = must(
    await addRequirement(db, {
      actorAccountId: actor,
      packVersionId: version.id,
      kind: 'DOCUMENT',
      docType: PASSPORT_TYPE,
      citation: 'sample rule 1',
    }),
    'document requirement',
  );
  const detailRequirement = must(
    await addRequirement(db, {
      actorAccountId: actor,
      packVersionId: version.id,
      kind: 'FIELD',
      fieldKey: EMPLOYMENT_FIELD,
      citation: 'sample rule 2',
    }),
    'detail requirement',
  );
  must(
    await approvePackVersion(db, { actorAccountId: actor, packVersionId: version.id }),
    'approve',
  );
  must(
    await publishPackVersion(db, { actorAccountId: actor, packVersionId: version.id }),
    'publish',
  );
  return {
    packId: pack.id,
    packVersionId: version.id,
    documentRequirementId: documentRequirement.id,
    detailRequirementId: detailRequirement.id,
  };
}

export interface CaseInput {
  readonly title: string;
  readonly documentId?: string;
  readonly factId?: string;
  /** Take a copy and confirm it. Default true. */
  readonly confirm?: boolean;
}

/** A case on the checklist that selects the given document and detail, confirmed unless told not to. */
export async function makeCase(
  db: Db,
  owner: Person,
  checklist: Checklist,
  input: CaseInput,
): Promise<string> {
  const actor = owner.accountId;
  const mission = must(
    await createMission(db, {
      actorAccountId: actor,
      applicantId: owner.applicantId,
      title: input.title,
    }),
    'case',
  );
  must(
    await attachPackVersion(db, {
      actorAccountId: actor,
      missionId: mission.id,
      packVersionId: checklist.packVersionId,
    }),
    'attach checklist',
  );
  if (input.documentId) {
    must(
      await selectEvidence(db, {
        actorAccountId: actor,
        missionId: mission.id,
        packRequirementId: checklist.documentRequirementId,
        documentId: input.documentId,
      }),
      'select document',
    );
  }
  if (input.factId) {
    must(
      await selectEvidence(db, {
        actorAccountId: actor,
        missionId: mission.id,
        packRequirementId: checklist.detailRequirementId,
        factId: input.factId,
      }),
      'select detail',
    );
  }
  if (input.confirm !== false) await confirmCase(db, owner, mission.id);
  return mission.id;
}

/** Take a copy of the case as it is now and confirm it. */
export async function confirmCase(db: Db, owner: Person, missionId: string): Promise<string> {
  const snapshot = must(
    await snapshotMission(db, { actorAccountId: owner.accountId, missionId }),
    'copy',
  );
  must(
    await decideAcknowledgement(db, {
      actorAccountId: owner.accountId,
      missionId,
      snapshotId: snapshot.id,
      expectedSnapshotChecksum: snapshot.checksum,
      decision: 'ACKNOWLEDGED',
      stepUpSatisfied: true,
    }),
    'confirm',
  );
  return snapshot.id;
}

/** Take a confirmed case through the real steps to Submitted. */
export async function submitCase(db: Db, owner: Person, missionId: string): Promise<void> {
  for (const to of ['INTAKE', 'IN_REVIEW', 'AWAITING_APPLICANT', 'SUBMISSION_READY'] as const) {
    must(
      await transitionMission(db, { actorAccountId: owner.accountId, missionId, to }),
      `move to ${to}`,
    );
  }
  must(
    await recordSubmission(db, {
      actorAccountId: owner.accountId,
      missionId,
      channel: 'EMAIL',
      externalReportDescription: 'Sent by email (made-up)',
      stepUpSatisfied: true,
    }),
    'submit',
  );
}

/** Cancel a case that was never submitted: it finishes with whatever copy it has, or none. */
export async function cancelCase(db: Db, owner: Person, missionId: string): Promise<void> {
  must(
    await transitionMission(db, {
      actorAccountId: owner.accountId,
      missionId,
      to: 'CANCELLED',
    }),
    'cancel',
  );
}

export async function askForDocument(
  db: Db,
  agency: AgencyHandle,
  owner: Person,
  missionId?: string,
  docType: string = PASSPORT_TYPE,
): Promise<string> {
  const request = must(
    await requestEvidence(db, {
      actorAccountId: agency.accountId,
      organizationId: agency.organizationId,
      applicantId: owner.applicantId,
      kind: 'DOCUMENT',
      docType,
      message: 'please send (made-up)',
      ...(missionId ? { missionId } : {}),
    }),
    'document request',
  );
  return request.id;
}

export async function askForDetail(
  db: Db,
  agency: AgencyHandle,
  owner: Person,
  missionId?: string,
  fieldKey: string = EMPLOYMENT_FIELD,
): Promise<string> {
  const request = must(
    await requestEvidence(db, {
      actorAccountId: agency.accountId,
      organizationId: agency.organizationId,
      applicantId: owner.applicantId,
      kind: 'FIELD',
      fieldKey,
      ...(missionId ? { missionId } : {}),
    }),
    'detail request',
  );
  return request.id;
}

export async function sendDocument(db: Db, owner: Person, requestId: string, documentId: string) {
  return must(
    await submitEvidenceResponse(db, { actorAccountId: owner.accountId, requestId, documentId }),
    'send document',
  );
}

export async function sendDetail(db: Db, owner: Person, requestId: string, factId: string) {
  return must(
    await submitEvidenceResponse(db, { actorAccountId: owner.accountId, requestId, factId }),
    'send detail',
  );
}

export async function decide(
  db: Db,
  agency: AgencyHandle,
  requestId: string,
  outcome: 'ACCEPTED' | 'NEEDS_REPLACEMENT' | 'CONTRADICTION' | 'CORRECTION_PROPOSED',
) {
  return must(
    await decideEvidenceResponse(db, {
      actorAccountId: agency.accountId,
      requestId,
      outcome,
      ...(outcome === 'ACCEPTED' ? {} : { reason: 'made-up reason' }),
    }),
    `decide ${outcome}`,
  );
}

/** The traveller's own MANAGE proof for their record: what the two reads take. */
export async function ownerManage(db: Db, owner: Person): Promise<AuthorizedApplicant<'MANAGE'>> {
  return must(
    await requireAccess(
      db,
      accountPrincipal(owner.accountId),
      'MANAGE',
      { applicantId: owner.applicantId },
      { purpose: 'change_impact' },
    ),
    'owner proof',
  );
}

export async function ownerView(
  db: Db,
  owner: Person,
  ref: { applicantId: string } | { missionId: string } = { applicantId: owner.applicantId },
): Promise<AuthorizedApplicant<'VIEW_METADATA'>> {
  return must(
    await requireAccess(db, accountPrincipal(owner.accountId), 'VIEW_METADATA', ref, {
      purpose: 'change_impact',
    }),
    'owner view proof',
  );
}

export interface ImpactWorldRecords {
  readonly rahim: Person;
  /** A second traveller with their own document and detail: the "real foreign id". */
  readonly stranger: Person;
  readonly strangerDocumentId: string;
  readonly strangerFactId: string;
  readonly agencyA: AgencyHandle;
  readonly agencyB: AgencyHandle;
  readonly unrelatedAgency: AgencyHandle;
  readonly checklist: Checklist;
  /** The older passport. */
  readonly p1: StoredDocument;
  /** The employment detail and its first saved value. */
  readonly e: { readonly factId: string; readonly v1: string };
  readonly controlDocument: StoredDocument;
  readonly controlDetail: { readonly factId: string; readonly v1: string };
  readonly liveCaseId: string;
  readonly liveCaseSnapshotId: string;
  readonly finishedCaseId: string;
  readonly agencyAShareId: string;
  readonly agencyBShareId: string;
  readonly documentRequestId: string;
  readonly detailRequestId: string;
}

export interface ImpactWorld extends LoggedDb, ImpactWorldRecords {}

/** The records with any database handle: what the change and read helpers need. */
export type WorldOn = ImpactWorldRecords & { readonly db: Db };

/**
 * The world before either change:
 * - Rahim has an older passport P1 and a confirmed employment detail E (first value);
 * - a live case selects P1 and E and is confirmed;
 * - a finished (submitted) case holds P1 and E's first value in its saved copy;
 * - Agency A holds a whole-record share, asked for a passport and for the employment detail on
 *   the live case, got P1 and E's first value, and accepted both;
 * - Agency B holds a share that lists P1 by name and reaches no detail;
 * - a utility bill and an occupation detail are used by nothing.
 */
export async function buildImpactWorld(): Promise<ImpactWorld> {
  const logged = await loggedDb();
  const records = await buildImpactRecords(logged.db);
  logged.log.length = 0;
  return { ...logged, ...records };
}

/** The same world on a database the caller brings (a real Postgres database in the race tests). */
export async function buildImpactRecords(db: Db): Promise<ImpactWorldRecords> {
  const rahim = await makeTraveller(db, 'test-rahim-impact@example.test', TRAVELLER_NAME);
  const stranger = await makeTraveller(db, 'test-stranger-impact@example.test', 'Test Stranger');
  const agencyA = await makeAgency(db, 'owner@sample-agency-a.example.test', AGENCY_A_NAME);
  const agencyB = await makeAgency(db, 'owner@sample-agency-b.example.test', AGENCY_B_NAME);
  const unrelatedAgency = await makeAgency(
    db,
    'owner@sample-agency-unrelated.example.test',
    'Sample Agency Unrelated',
  );

  for (const key of [EMPLOYMENT_FIELD, CONTROL_FIELD]) {
    await registerFieldDefinition(db, { key, dataType: 'text' });
  }
  const p1 = await makeDocument(db, rahim, PASSPORT_TYPE, 'sample-passport-older.pdf');
  const controlDocument = await makeDocument(db, rahim, CONTROL_TYPE, 'sample-utility-bill.pdf');
  const e = await saveDetail(db, rahim, EMPLOYMENT_FIELD, E_VALUE_1);
  const controlDetail = await saveDetail(db, rahim, CONTROL_FIELD, 'Sample Occupation');
  const strangerDocument = await makeDocument(db, stranger, PASSPORT_TYPE, 'stranger-passport.pdf');
  const strangerDetail = await saveDetail(db, stranger, EMPLOYMENT_FIELD, 'Stranger Employer');

  const checklist = await makeChecklist(db, rahim);
  const finishedCaseId = await makeCase(db, rahim, checklist, {
    title: FINISHED_CASE_TITLE,
    documentId: p1.documentId,
    factId: e.factId,
  });
  await submitCase(db, rahim, finishedCaseId);

  const liveCaseId = await makeCase(db, rahim, checklist, {
    title: LIVE_CASE_TITLE,
    documentId: p1.documentId,
    factId: e.factId,
    confirm: false,
  });

  const agencyAShareId = await shareWith(db, rahim, agencyA);
  const documentRequestId = await askForDocument(db, agencyA, rahim, liveCaseId);
  await sendDocument(db, rahim, documentRequestId, p1.documentId);
  await decide(db, agencyA, documentRequestId, 'ACCEPTED');
  const detailRequestId = await askForDetail(db, agencyA, rahim, liveCaseId);
  await sendDetail(db, rahim, detailRequestId, e.factId);
  await decide(db, agencyA, detailRequestId, 'ACCEPTED');

  const agencyBShareId = await shareWith(db, rahim, agencyB, {
    actions: ['VIEW_METADATA', 'PREVIEW'],
    documentIds: [p1.documentId],
  });

  // Confirmed last, so nothing in the set-up can have voided the confirmation.
  const liveCaseSnapshotId = await confirmCase(db, rahim, liveCaseId);

  return {
    rahim,
    stranger,
    strangerDocumentId: strangerDocument.documentId,
    strangerFactId: strangerDetail.factId,
    agencyA,
    agencyB,
    unrelatedAgency,
    checklist,
    p1,
    e: { factId: e.factId, v1: e.versionId },
    controlDocument,
    controlDetail: { factId: controlDetail.factId, v1: controlDetail.versionId },
    liveCaseId,
    liveCaseSnapshotId,
    finishedCaseId,
    agencyAShareId,
    agencyBShareId,
    documentRequestId,
    detailRequestId,
  };
}

/** Change 1: a newer passport is added and recorded as replacing `oldDocumentId` (default P1). */
export async function replaceWithNewerPassport(
  world: WorldOn,
  oldDocumentId: string = world.p1.documentId,
  originalName = 'sample-passport-newer.pdf',
) {
  const newer = await makeDocument(world.db, world.rahim, PASSPORT_TYPE, originalName);
  const outcome = must(
    await replaceDocument(await ownerManage(world.db, world.rahim), {
      oldDocumentId,
      newDocumentId: newer.documentId,
    }),
    'replace',
  );
  return { newer, outcome };
}

/** Change 2: the employment detail gets a new saved value. Returns what `editFact` returned. */
export async function changeEmploymentDetail(world: WorldOn, value: string = E_VALUE_2) {
  return must(
    await editFact(world.db, {
      actorAccountId: world.rahim.accountId,
      applicantId: world.rahim.applicantId,
      fieldKey: EMPLOYMENT_FIELD,
      value,
    }),
    'change detail',
  );
}

/** Every row of the tables that hold history, as text, for a byte-for-byte comparison. */
export async function historyFingerprint(db: Db): Promise<string> {
  const tables = [
    ['mission_snapshots', await db.select().from(schema.missionSnapshots)],
    ['mission_submissions', await db.select().from(schema.missionSubmissions)],
    ['evidence_request_submissions', await db.select().from(schema.evidenceRequestSubmissions)],
    [
      'evidence_request_fact_submissions',
      await db.select().from(schema.evidenceRequestFactSubmissions),
    ],
    ['evidence_request_decisions', await db.select().from(schema.evidenceRequestDecisions)],
    [
      'evidence_request_decision_submissions',
      await db.select().from(schema.evidenceRequestDecisionSubmissions),
    ],
    [
      'evidence_request_decision_fact_submissions',
      await db.select().from(schema.evidenceRequestDecisionFactSubmissions),
    ],
  ] as const;
  return JSON.stringify(
    tables.map(([name, rows]) => [
      name,
      rows.map((row) => JSON.stringify(row)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    ]),
  );
}

/** The tables a read must leave alone. */
export const UNTOUCHED_TABLES = [
  'audit_events',
  'mission_tasks',
  'notifications',
  'product_events',
  'selected_evidence',
  'acknowledgements',
  'grants',
  'fact_versions',
  'documents',
  'evidence_requests',
] as const;

/** Row counts of every table a read must leave alone. */
export async function writeCounts(db: Db): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of UNTOUCHED_TABLES) {
    const result = (await db.execute(
      sql.raw(`select count(*)::int as n from ${table}`),
    )) as unknown as { rows: { n: number }[] };
    counts[table] = Number(result.rows[0]?.n ?? -1);
  }
  return counts;
}

export async function requestStatus(db: Db, requestId: string): Promise<string> {
  const [row] = await db
    .select({ status: schema.evidenceRequests.status })
    .from(schema.evidenceRequests)
    .where(eq(schema.evidenceRequests.id, requestId));
  if (!row) throw new Error('request missing');
  return row.status;
}

// ---------------------------------------------------------------------------------------------
// Reading the world through the two new reads

/** The owner's read of a document's impact (default: the older passport). */
export async function readDocumentImpact(
  world: WorldOn,
  documentId: string = world.p1.documentId,
  replacementDocumentId?: string,
): Promise<ChangeImpact> {
  return must(
    await assessDocumentChangeImpact(await ownerManage(world.db, world.rahim), {
      documentId,
      ...(replacementDocumentId ? { replacementDocumentId } : {}),
    }),
    'document impact',
  );
}

/** The owner's read of a detail's impact (default: the employment detail). */
export async function readDetailImpact(
  world: WorldOn,
  factId: string = world.e.factId,
): Promise<ChangeImpact> {
  return must(
    await assessDetailChangeImpact(await ownerManage(world.db, world.rahim), { factId }),
    'detail impact',
  );
}

/** `[id, reason]` for every item, in the order the read returned them. */
export function reasons(impact: ChangeImpact): [string, string][] {
  return impact.items.map((item) => [item.id, item.reason]);
}

export function itemOf(impact: ChangeImpact, id: string): ImpactItem {
  const item = impact.items.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`no item ${id} among ${JSON.stringify(reasons(impact))}`);
  return item;
}

/** The tables a list of logged statements read from or joined, sorted. */
export function tablesRead(statements: readonly string[]): string[] {
  const names = new Set<string>();
  for (const statement of statements) {
    for (const match of statement.matchAll(/(?:from|join)\s+"([a-z_]+)"/g)) {
      if (match[1]) names.add(match[1]);
    }
  }
  return [...names].sort();
}

/** Statements with every literal position kept as a placeholder: their shape, for comparison. */
export function shapes(statements: readonly string[]): string[] {
  return statements.map((statement) => statement.replace(/\s+/g, ' ').trim());
}
