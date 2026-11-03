/**
 * UMPE P4: trip package assembly over the existing case (R11, R14 to R17, R19, R23, S05).
 *
 * Nothing here is a second case or package engine. Readiness, evidence candidates and immutable
 * snapshots all come from missions.ts; this module adds only what was missing:
 *
 * - Case-local choices (`umpe_package_choices`): Use This Copy pins one exact document or fact
 *   version, Exclude drops an item that can never block (with a reason), Leave Missing keeps the
 *   gap. A choice never edits the checklist: excluding or leaving out a required item never
 *   clears the obligation. Use This Copy also narrows the existing selection, so readiness, the
 *   case page and snapshots agree on which document or answer the case uses.
 * - Prepared for Handoff (`umpe_package_handoffs`): the traveller's explicit confirmation freezes
 *   the exact package (pack version and checksum, every selection by version id, open caveats,
 *   the freshness check, the steps outside VisaStack) next to an ordinary immutable snapshot. A
 *   later upload or a newer rule never rewrites it; it only shows up as a proposal.
 * - The freshness check (S05) at final review and handoff: the checklist version is still
 *   published, official pages are reachable and not mid-change, the chosen evidence is not past
 *   its age rule. Plain caveats, never a silent block.
 * - Continuous matching (R19): one open "something changed" item per active case, never on a
 *   handed-off record, never sharing anything.
 *
 * Every exported function takes a gate proof (or a scheduled job's scope). Ids and kinds only go
 * into audit records, never a value, a file name or a reason the person typed.
 */
import { createHash } from 'node:crypto';
import {
  type RequirementNecessity,
  type RequirementProvenance,
  type Result,
  err,
  necessityCanBlock,
  ok,
  requirementNecessity,
  requirementProvenance,
} from '@visastack/core';
import {
  type SQL,
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  ne,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import { AuthorizedApplicant, SystemScope } from './access';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { isDocumentVersionUsable } from './documents';
import { activeOrVerifiedErasureStorageObjectIds } from './erasure';
import { type ServiceError, serviceError } from './errors';
import { lifecycleTablesPresent, presentDocumentCondition } from './lifecycle/foundation';
import { incrementMaterialRevision } from './material-revision';
import {
  type EvidenceCandidateEntry,
  type Mission,
  type OverallReadinessState,
  type RequirementResultState,
  computeReadiness,
  getEvidenceCandidates,
  isFactStatusEligible,
  snapshotMission,
} from './missions';
import {
  PACKAGE_CHANGED_EVENT,
  cancelQueuedNotificationsForResource,
  enqueueNotificationBothChannels,
} from './notifications';
import { type PackRequirement, listRequirements } from './packs';
import { CASE_TRAVEL_END_KEY, CASE_TRAVEL_START_KEY } from './rule-conditions';
import { canonicalJson } from './umpe-collection-request-items';
import { ruleImpactTablesPresent } from './umpe-correction-tables';
import {
  type AttentionReason,
  type OutsideStep,
  PACKAGE_CHANGE_LABELS,
  type PackageChange,
  type PackageChangeKind,
  type PackageChangeSignal,
  type PackagePhrase,
  type PhraseInput,
  derivePackagePhrase,
  outsideSteps,
  pickPackageChange,
} from './umpe-package-phrases';
import {
  INACTIVE_CASE_STATES,
  packageTablesPresent,
  sourceTablesPresent,
} from './umpe-package-tables';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASON_MAX = 500;
const HANDOFF_LIST_LIMIT = 20;
const CANDIDATE_SCAN_LIMIT = 200;
export const PACKAGE_HANDOFF_FORMAT = 1;

const NOT_AVAILABLE = 'That case is not available.';

// --- Types ------------------------------------------------------------------------------------

/** One exact copy that could serve a requirement: a document version or a fact version. */
export interface PackageCopy {
  readonly kind: 'DOCUMENT' | 'FIELD';
  readonly documentId: string | null;
  readonly documentVersionId: string | null;
  readonly factId: string | null;
  readonly factVersionId: string | null;
  /** The document's approved or original name; for an answer, null (values are never shown here). */
  readonly displayName: string | null;
  /** The document's own date (`YYYY-MM-DD`), when known. */
  readonly documentDate: string | null;
  readonly usable: boolean;
  /** Past this requirement's age rule. */
  readonly tooOld: boolean;
  /** An answer with an unresolved conflict. */
  readonly conflicting: boolean;
}

export type PackageChoiceKind = 'USE_COPY' | 'EXCLUDE' | 'LEAVE_MISSING';

export interface PackageChoiceView {
  readonly choice: PackageChoiceKind;
  readonly copy: PackageCopy | null;
  readonly reason: string | null;
  readonly chosenAt: string;
}

export interface PackageItem {
  readonly packRequirementId: string;
  readonly kind: 'FIELD' | 'DOCUMENT';
  readonly key: string;
  readonly citation: string;
  readonly necessity: RequirementNecessity;
  readonly provenance: RequirementProvenance;
  readonly groupKey: string | null;
  /** The existing readiness result for this requirement. */
  readonly state: RequirementResultState;
  /** Whether a gap here can hold the case back (necessity, group cover and condition). */
  readonly blocking: boolean;
  /** The exact copy the case proposes when the traveller has not chosen one. */
  readonly proposed: PackageCopy | null;
  readonly chosen: PackageChoiceView | null;
  /** Every other usable copy the traveller could choose instead. */
  readonly alternatives: readonly PackageCopy[];
  /** A newer or better copy than the chosen one: a proposal only, never applied on its own. */
  readonly newerCopy: PackageCopy | null;
  readonly canExclude: boolean;
}

export type FreshnessCaveat =
  | 'CHECKLIST_WITHDRAWN'
  | 'CHECKLIST_REPLACED'
  | 'CHECKLIST_REVIEW_OVERDUE'
  | 'SOURCE_UNAVAILABLE'
  | 'SOURCE_CHANGING'
  | 'EVIDENCE_TOO_OLD'
  | 'SOURCES_NOT_CHECKED';

export interface FreshnessReport {
  readonly checkedAt: string;
  readonly packVersionId: string;
  readonly packVersionStatus: string;
  readonly packWithdrawn: boolean;
  readonly packReplaced: boolean;
  readonly reviewOverdue: boolean;
  /** Requirements whose official page is marked unreachable. */
  readonly sourceUnavailable: readonly string[];
  /** A detected change on an official page behind the whole checklist, waiting for a person. */
  readonly packSourceChanging: boolean;
  /** Requirements whose own official page has a detected change waiting for a person. */
  readonly sourceChanging: readonly string[];
  /** Requirements whose chosen or proposed evidence is past its age rule. */
  readonly evidenceTooOld: readonly string[];
  /** The source monitoring tables are not there yet, so official pages were not checked. */
  readonly sourcesNotChecked: boolean;
  readonly caveats: readonly FreshnessCaveat[];
}

export interface PackageQuestion {
  /** TRAVEL_DATES for the case's own dates; FACT for a saved answer the checklist needs. */
  readonly kind: 'TRAVEL_DATES' | 'FACT';
  readonly fieldKey: string | null;
}

export interface PackageHandoffSummary {
  readonly id: string;
  readonly confirmedAt: string;
  readonly packVersionId: string | null;
  /** Still matches the case exactly; false once anything material changed since. */
  readonly current: boolean;
  readonly caveatCount: number;
}

export interface PackageChangeView {
  readonly kind: PackageChangeKind;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly changeCount: number;
}

export interface CasePackage {
  readonly missionId: string;
  readonly phrase: PackagePhrase;
  readonly reasons: readonly AttentionReason[];
  readonly overallState: OverallReadinessState | null;
  readonly requiredCount: number;
  readonly satisfiedRequired: number;
  readonly items: readonly PackageItem[];
  readonly questions: readonly PackageQuestion[];
  readonly freshness: FreshnessReport | null;
  readonly outsideSteps: readonly OutsideStep[];
  readonly latestHandoff: PackageHandoffSummary | null;
  readonly change: PackageChangeView | null;
  /** False while the package tables are not there yet: choices and handoffs are then unavailable. */
  readonly available: boolean;
  /** Closed, cancelled or submitted: shown as it is, never changed. */
  readonly active: boolean;
}

// --- Proof checks -----------------------------------------------------------------------------

function ownerMissionOf<A extends 'VIEW_METADATA' | 'MANAGE'>(
  proof: AuthorizedApplicant<A>,
  action: A,
  missionId: string,
): Result<Mission, ServiceError> {
  if (!AuthorizedApplicant.isGenuine(proof, action) || proof.actor.kind !== 'applicant_owner') {
    return err(serviceError('forbidden', 'Only the traveller who owns this case can do this.'));
  }
  const resource = proof.resource;
  if (
    !UUID.test(missionId) ||
    resource.kind !== 'mission' ||
    resource.mission.id !== missionId ||
    resource.mission.applicantId !== proof.applicant.id
  ) {
    return err(serviceError('not_found', NOT_AVAILABLE));
  }
  return ok(resource.mission);
}

/** The case as it is now, inside the proof's own transaction, scoped to the proof's person. */
async function freshMission(
  tx: Db,
  applicantId: string,
  missionId: string,
): Promise<Mission | null> {
  return (
    first(
      await tx
        .select()
        .from(schema.missions)
        .where(and(eq(schema.missions.id, missionId), eq(schema.missions.applicantId, applicantId)))
        .limit(1),
    ) ?? null
  );
}

function isActive(mission: Mission): boolean {
  return (
    mission.purgedAt === null &&
    !(INACTIVE_CASE_STATES as readonly string[]).includes(mission.state)
  );
}

// --- Building the package ---------------------------------------------------------------------

type ChoiceRow = typeof schema.umpePackageChoices.$inferSelect;
type HandoffRow = typeof schema.umpePackageHandoffs.$inferSelect;

function documentCopy(d: EvidenceCandidateEntry['documentCandidates'][number]): PackageCopy {
  return {
    kind: 'DOCUMENT',
    documentId: d.documentId,
    documentVersionId: d.documentVersionId,
    factId: null,
    factVersionId: null,
    displayName: d.displayName,
    documentDate: d.documentDate,
    usable: d.eligible,
    tooOld: d.staleness.status === 'stale',
    conflicting: false,
  };
}

function factCopy(f: EvidenceCandidateEntry['factCandidates'][number]): PackageCopy {
  return {
    kind: 'FIELD',
    documentId: null,
    documentVersionId: null,
    factId: f.factId,
    factVersionId: f.factVersionId,
    displayName: null,
    documentDate: null,
    usable: f.factVersionId !== null && isFactStatusEligible(f.status),
    tooOld: false,
    conflicting: f.status === 'CONFLICTED',
  };
}

/** Later documents first; an undated one last. Ties keep the candidate order. */
function laterFirst(a: PackageCopy, b: PackageCopy): number {
  if (a.documentDate === b.documentDate) return 0;
  if (a.documentDate === null) return 1;
  if (b.documentDate === null) return -1;
  return a.documentDate < b.documentDate ? 1 : -1;
}

function bestCopy(copies: readonly PackageCopy[]): PackageCopy | null {
  const good = copies.filter((c) => c.usable && !c.tooOld && !c.conflicting).sort(laterFirst);
  return good[0] ?? null;
}

/** Whether a pinned version that is no longer the current one can still be used. */
async function olderVersionsUsable(
  tx: Db,
  applicantId: string,
  documentVersionIds: readonly string[],
  factVersionIds: readonly string[],
): Promise<{ documents: ReadonlySet<string>; facts: ReadonlySet<string> }> {
  const documents = new Set<string>();
  const facts = new Set<string>();
  if (documentVersionIds.length > 0) {
    const rows = await tx
      .select({
        id: schema.documentVersions.id,
        safetyStatus: schema.documentVersions.safetyStatus,
        processingStatus: schema.documentVersions.processingStatus,
        storageObjectId: schema.documentVersions.storageObjectId,
        expiresAt: schema.documents.expiresAt,
      })
      .from(schema.documentVersions)
      .innerJoin(schema.documents, eq(schema.documents.id, schema.documentVersions.documentId))
      .where(
        and(
          inArray(schema.documentVersions.id, [...documentVersionIds]),
          eq(schema.documents.applicantId, applicantId),
          // A document in Recently Deleted or being removed is never a usable pin.
          (await lifecycleTablesPresent(tx)) ? presentDocumentCondition() : undefined,
        ),
      );
    const erased = await activeOrVerifiedErasureStorageObjectIds(
      tx,
      rows.map((r) => r.storageObjectId),
    );
    const now = Date.now();
    for (const row of rows) {
      if (
        isDocumentVersionUsable({
          safetyStatus: row.safetyStatus,
          processingStatus: row.processingStatus,
          erased: erased.has(row.storageObjectId),
        }) &&
        (row.expiresAt === null || row.expiresAt.getTime() > now)
      ) {
        documents.add(row.id);
      }
    }
  }
  if (factVersionIds.length > 0) {
    const rows = await tx
      .select({ id: schema.factVersions.id, status: schema.factVersions.status })
      .from(schema.factVersions)
      .innerJoin(schema.facts, eq(schema.facts.id, schema.factVersions.factId))
      .where(
        and(
          inArray(schema.factVersions.id, [...factVersionIds]),
          eq(schema.facts.applicantId, applicantId),
        ),
      );
    for (const row of rows) if (isFactStatusEligible(row.status)) facts.add(row.id);
  }
  return { documents, facts };
}

/** Every field a requirement's condition reads (walks the stored rule; unknown shapes are skipped). */
function conditionFields(condition: unknown, into: Set<string>): void {
  if (condition === null || typeof condition !== 'object') return;
  if (Array.isArray(condition)) {
    for (const part of condition) conditionFields(part, into);
    return;
  }
  const node = condition as { readonly field?: unknown };
  if (typeof node.field === 'string') into.add(node.field);
  for (const value of Object.values(node)) {
    if (value !== null && typeof value === 'object') conditionFields(value, into);
  }
}

async function confirmedFieldKeys(tx: Db, applicantId: string): Promise<ReadonlySet<string>> {
  const rows = await tx
    .select({ key: schema.fieldDefinitions.key, status: schema.factVersions.status })
    .from(schema.facts)
    .innerJoin(
      schema.fieldDefinitions,
      eq(schema.fieldDefinitions.id, schema.facts.fieldDefinitionId),
    )
    .innerJoin(schema.factVersions, eq(schema.factVersions.id, schema.facts.currentVersionId))
    .where(eq(schema.facts.applicantId, applicantId));
  return new Set(rows.filter((r) => isFactStatusEligible(r.status)).map((r) => r.key));
}

/**
 * Only the questions this checklist really needs: a requirement whose condition reads the trip
 * dates while the case has none, or a saved answer the person has not confirmed yet, and only
 * for requirements whose result is still Unverified.
 */
async function questionsFor(
  tx: Db,
  mission: Mission,
  requirements: readonly PackRequirement[],
  unverified: ReadonlySet<string>,
): Promise<PackageQuestion[]> {
  const fields = new Set<string>();
  for (const req of requirements) {
    if (unverified.has(req.id)) conditionFields(req.condition, fields);
  }
  if (fields.size === 0) return [];
  const questions: PackageQuestion[] = [];
  const needsDates =
    (fields.has(CASE_TRAVEL_START_KEY) && mission.travelStartDate === null) ||
    (fields.has(CASE_TRAVEL_END_KEY) && mission.travelEndDate === null);
  if (needsDates) questions.push({ kind: 'TRAVEL_DATES', fieldKey: null });
  fields.delete(CASE_TRAVEL_START_KEY);
  fields.delete(CASE_TRAVEL_END_KEY);
  if (fields.size > 0) {
    const known = await confirmedFieldKeys(tx, mission.applicantId);
    for (const key of [...fields].sort()) {
      if (!known.has(key)) questions.push({ kind: 'FACT', fieldKey: key });
    }
  }
  return questions;
}

async function checkFreshness(
  tx: Db,
  mission: Mission,
  requirements: readonly PackRequirement[],
  items: readonly PackageItem[],
  now: Date,
): Promise<FreshnessReport | null> {
  if (!mission.packVersionId) return null;
  const version = first(
    await tx
      .select({
        id: schema.packVersions.id,
        packId: schema.packVersions.packId,
        version: schema.packVersions.version,
        status: schema.packVersions.status,
        withdrawnAt: schema.packVersions.withdrawnAt,
        supersededAt: schema.packVersions.supersededAt,
        nextReviewDate: schema.packVersions.nextReviewDate,
      })
      .from(schema.packVersions)
      .where(eq(schema.packVersions.id, mission.packVersionId))
      .limit(1),
  );
  if (!version) return null;
  const newer = first(
    await tx
      .select({ id: schema.packVersions.id })
      .from(schema.packVersions)
      .where(
        and(
          eq(schema.packVersions.packId, version.packId),
          eq(schema.packVersions.status, 'PUBLISHED'),
          gt(schema.packVersions.version, version.version),
        ),
      )
      .limit(1),
  );
  const packWithdrawn = version.status === 'WITHDRAWN' || version.withdrawnAt !== null;
  const packReplaced =
    !packWithdrawn &&
    (version.status !== 'PUBLISHED' || version.supersededAt !== null || newer !== undefined);
  const reviewOverdue =
    version.nextReviewDate !== null && version.nextReviewDate.getTime() < now.getTime();
  const sourceUnavailable = requirements
    .filter((r) => r.sourceInaccessibleAt !== null)
    .map((r) => r.id);

  let packSourceChanging = false;
  const sourceChanging: string[] = [];
  const sourcesChecked = await sourceTablesPresent(tx);
  if (sourcesChecked) {
    const urls = [...new Set(requirements.map((r) => r.sourceUrl).filter((u): u is string => !!u))];
    const pending = await tx
      .select({ packId: schema.officialSources.packId, url: schema.officialSources.url })
      .from(schema.sourceChangeCandidates)
      .innerJoin(
        schema.officialSources,
        eq(schema.officialSources.id, schema.sourceChangeCandidates.sourceId),
      )
      .where(
        and(
          inArray(schema.sourceChangeCandidates.status, ['NEW', 'IN_REVIEW']),
          urls.length > 0
            ? or(
                eq(schema.officialSources.packId, version.packId),
                inArray(schema.officialSources.url, urls),
              )
            : eq(schema.officialSources.packId, version.packId),
        ),
      )
      .limit(CANDIDATE_SCAN_LIMIT);
    const changingUrls = new Set(pending.map((p) => p.url));
    packSourceChanging = pending.some((p) => p.packId === version.packId);
    for (const req of requirements) {
      if (req.sourceUrl && changingUrls.has(req.sourceUrl)) sourceChanging.push(req.id);
    }
  }

  const evidenceTooOld = items
    .filter((item) => item.state !== 'NOT_APPLICABLE')
    .filter((item) => {
      const copy = item.chosen?.copy ?? (item.chosen ? null : item.proposed);
      return copy?.tooOld === true;
    })
    .map((item) => item.packRequirementId);

  const caveats: FreshnessCaveat[] = [];
  if (packWithdrawn) caveats.push('CHECKLIST_WITHDRAWN');
  if (packReplaced) caveats.push('CHECKLIST_REPLACED');
  if (reviewOverdue) caveats.push('CHECKLIST_REVIEW_OVERDUE');
  if (sourceUnavailable.length > 0) caveats.push('SOURCE_UNAVAILABLE');
  if (packSourceChanging || sourceChanging.length > 0) caveats.push('SOURCE_CHANGING');
  if (evidenceTooOld.length > 0) caveats.push('EVIDENCE_TOO_OLD');
  if (!sourcesChecked) caveats.push('SOURCES_NOT_CHECKED');
  return {
    checkedAt: now.toISOString(),
    packVersionId: version.id,
    packVersionStatus: version.status,
    packWithdrawn,
    packReplaced,
    reviewOverdue,
    sourceUnavailable,
    packSourceChanging,
    sourceChanging,
    evidenceTooOld,
    sourcesNotChecked: !sourcesChecked,
    caveats,
  };
}

interface BuiltPackage {
  readonly pkg: CasePackage;
  /** What the phrase was read from, so a change recorded afterwards is reflected cheaply. */
  readonly phraseInput: PhraseInput;
  readonly signals: readonly PackageChangeSignal[];
  readonly choices: readonly ChoiceRow[];
  readonly latestHandoff: HandoffRow | null;
}

async function loadChoices(tx: Db, missionId: string, available: boolean): Promise<ChoiceRow[]> {
  if (!available) return [];
  return tx
    .select()
    .from(schema.umpePackageChoices)
    .where(
      and(
        eq(schema.umpePackageChoices.missionId, missionId),
        isNull(schema.umpePackageChoices.supersededAt),
      ),
    );
}

async function loadLatestHandoff(
  tx: Db,
  missionId: string,
  available: boolean,
): Promise<HandoffRow | null> {
  if (!available) return null;
  return (
    first(
      await tx
        .select()
        .from(schema.umpePackageHandoffs)
        .where(eq(schema.umpePackageHandoffs.missionId, missionId))
        .orderBy(desc(schema.umpePackageHandoffs.confirmedAt), desc(schema.umpePackageHandoffs.id))
        .limit(1),
    ) ?? null
  );
}

async function loadOpenChange(
  tx: Db,
  missionId: string,
  available: boolean,
): Promise<typeof schema.umpePackageChanges.$inferSelect | null> {
  if (!available) return null;
  return (
    first(
      await tx
        .select()
        .from(schema.umpePackageChanges)
        .where(
          and(
            eq(schema.umpePackageChanges.missionId, missionId),
            isNull(schema.umpePackageChanges.resolvedAt),
          ),
        )
        .limit(1),
    ) ?? null
  );
}

function handoffIsCurrent(handoff: HandoffRow | null, mission: Mission): boolean {
  return (
    handoff !== null &&
    handoff.materialRevisionAtCapture === mission.materialRevision &&
    handoff.packVersionId === mission.packVersionId
  );
}

function handoffSummary(handoff: HandoffRow, mission: Mission): PackageHandoffSummary {
  const content = handoff.content as { caveats?: unknown };
  return {
    id: handoff.id,
    confirmedAt: handoff.confirmedAt.toISOString(),
    packVersionId: handoff.packVersionId,
    current: handoffIsCurrent(handoff, mission),
    caveatCount: Array.isArray(content.caveats) ? content.caveats.length : 0,
  };
}

/**
 * The whole package for one case, computed from the existing readiness and candidates plus the
 * case-local choices. `ownerAccountId` is the case owner's account (the readers in missions.ts
 * check it again).
 */
async function buildPackage(
  tx: Db,
  mission: Mission,
  ownerAccountId: string,
  now: Date,
): Promise<Result<BuiltPackage, ServiceError>> {
  const available = await packageTablesPresent(tx);
  const [choices, latestHandoff, openChange] = await Promise.all([
    loadChoices(tx, mission.id, available),
    loadLatestHandoff(tx, mission.id, available),
    loadOpenChange(tx, mission.id, available),
  ]);
  const active = isActive(mission);

  if (!mission.packVersionId) {
    const phraseInput: PhraseInput = {
      overallState: null,
      requiredLeftMissing: false,
      pinnedCopyUnusable: false,
      pinnedCopyReplaced: false,
      packWithdrawn: false,
      packReplaced: false,
      openChange: openChange !== null,
      handoffCurrent: false,
    };
    const phrase = derivePackagePhrase(phraseInput);
    return ok({
      phraseInput,
      pkg: {
        missionId: mission.id,
        ...phrase,
        overallState: null,
        requiredCount: 0,
        satisfiedRequired: 0,
        items: [],
        questions: [],
        freshness: null,
        outsideSteps: outsideSteps([]),
        latestHandoff: latestHandoff ? handoffSummary(latestHandoff, mission) : null,
        change: openChange ? changeView(openChange) : null,
        available,
        active,
      },
      signals: [],
      choices,
      latestHandoff,
    });
  }

  const [readiness, candidates, requirements] = await Promise.all([
    computeReadiness(tx, mission.id, now),
    getEvidenceCandidates(tx, ownerAccountId, mission.id),
    listRequirements(tx, mission.packVersionId),
  ]);
  if (!readiness.ok) return readiness;
  if (!candidates.ok) return candidates;

  const results = new Map(readiness.value.requirementResults.map((r) => [r.packRequirementId, r]));
  const candidatesById = new Map(candidates.value.map((c) => [c.packRequirementId, c]));
  const choiceByRequirement = new Map(choices.map((c) => [c.packRequirementId, c]));

  // Pinned versions that are no longer a requirement's current candidate: check them on their own.
  const olderDocumentPins: string[] = [];
  const olderFactPins: string[] = [];
  for (const choice of choices) {
    const entry = candidatesById.get(choice.packRequirementId);
    if (choice.documentVersionId) {
      const current = entry?.documentCandidates.some(
        (d) => d.documentVersionId === choice.documentVersionId,
      );
      if (!current) olderDocumentPins.push(choice.documentVersionId);
    }
    if (choice.factVersionId) {
      const current = entry?.factCandidates.some((f) => f.factVersionId === choice.factVersionId);
      if (!current) olderFactPins.push(choice.factVersionId);
    }
  }
  const olderUsable = await olderVersionsUsable(
    tx,
    mission.applicantId,
    olderDocumentPins,
    olderFactPins,
  );

  const signals: PackageChangeSignal[] = [];
  let pinnedCopyUnusable = false;
  let pinnedCopyReplaced = false;
  let requiredLeftMissing = false;
  const items: PackageItem[] = requirements.map((req) => {
    const result = results.get(req.id);
    const entry = candidatesById.get(req.id);
    const necessity = requirementNecessity({ optional: req.optional, necessity: req.necessity });
    const provenance = requirementProvenance({
      optional: req.optional,
      necessity: req.necessity,
      provenance: req.provenance,
    });
    const state = result?.state ?? 'ATTENTION';
    const blocking =
      necessityCanBlock(necessity) &&
      result?.coveredByAlternative !== true &&
      state !== 'NOT_APPLICABLE';
    const copies: PackageCopy[] =
      req.kind === 'DOCUMENT'
        ? (entry?.documentCandidates ?? []).map(documentCopy)
        : (entry?.factCandidates ?? []).map(factCopy);
    const selected = new Set([
      ...(entry?.selectedDocumentIds ?? []),
      ...(entry?.selectedFactIds ?? []),
    ]);
    const selectedCopy =
      copies.find((c) => selected.has(c.documentId ?? c.factId ?? '') && c.usable) ?? null;
    const proposed = selectedCopy ?? bestCopy(copies);

    const choiceRow = choiceByRequirement.get(req.id);
    let chosen: PackageChoiceView | null = null;
    let newerCopy: PackageCopy | null = null;
    if (choiceRow) {
      let copy: PackageCopy | null = null;
      if (choiceRow.choice === 'USE_COPY') {
        const pinned = copies.find(
          (c) =>
            (choiceRow.documentVersionId !== null &&
              c.documentVersionId === choiceRow.documentVersionId) ||
            (choiceRow.factVersionId !== null && c.factVersionId === choiceRow.factVersionId),
        );
        if (pinned) {
          copy = pinned;
        } else {
          // The pinned version is no longer the current one: keep it exactly, check it on its own.
          const sameRecord = copies.find(
            (c) =>
              (choiceRow.documentId !== null && c.documentId === choiceRow.documentId) ||
              (choiceRow.factId !== null && c.factId === choiceRow.factId),
          );
          copy = {
            kind: req.kind,
            documentId: choiceRow.documentId,
            documentVersionId: choiceRow.documentVersionId,
            factId: choiceRow.factId,
            factVersionId: choiceRow.factVersionId,
            displayName: sameRecord?.displayName ?? null,
            documentDate: sameRecord?.documentDate ?? null,
            usable: choiceRow.documentVersionId
              ? olderUsable.documents.has(choiceRow.documentVersionId)
              : choiceRow.factVersionId !== null && olderUsable.facts.has(choiceRow.factVersionId),
            tooOld: sameRecord?.tooOld ?? false,
            conflicting: false,
          };
          if (sameRecord?.usable) {
            // The record has a newer version than the one chosen. The case's snapshot always
            // captures the current version, so the traveller decides again before a handoff:
            // the two must never disagree about which copy is handed over.
            if (state !== 'NOT_APPLICABLE') pinnedCopyReplaced = true;
            newerCopy = sameRecord;
            signals.push({
              kind: req.kind === 'DOCUMENT' ? 'NEWER_DOCUMENT' : 'FACT_CHANGED',
              packRequirementId: req.id,
              subjectId: (sameRecord.documentVersionId ?? sameRecord.factVersionId) as string,
            });
          }
        }
        // A different, later document of the same kind is a proposal too (never applied).
        if (!newerCopy && req.kind === 'DOCUMENT' && copy.documentDate !== null) {
          const later = bestCopy(
            copies.filter(
              (c) =>
                c.documentId !== copy?.documentId &&
                c.documentDate !== null &&
                (copy?.documentDate ?? '') < c.documentDate,
            ),
          );
          if (later) {
            newerCopy = later;
            signals.push({
              kind: 'NEWER_DOCUMENT',
              packRequirementId: req.id,
              subjectId: later.documentVersionId as string,
            });
          }
        }
        if (state !== 'NOT_APPLICABLE' && (!copy.usable || copy.tooOld)) {
          if (blocking) pinnedCopyUnusable = true;
          signals.push({
            kind: 'EVIDENCE_EXPIRED',
            packRequirementId: req.id,
            subjectId: (copy.documentVersionId ?? copy.factVersionId) as string,
          });
        }
      }
      if (choiceRow.choice === 'LEAVE_MISSING' && blocking) requiredLeftMissing = true;
      chosen = {
        choice: choiceRow.choice as PackageChoiceKind,
        copy,
        reason: choiceRow.reason,
        chosenAt: choiceRow.createdAt.toISOString(),
      };
    }

    const chosenKey = chosen?.copy?.documentVersionId ?? chosen?.copy?.factVersionId ?? null;
    const proposedKey = proposed?.documentVersionId ?? proposed?.factVersionId ?? null;
    return {
      packRequirementId: req.id,
      kind: req.kind,
      key: req.kind === 'FIELD' ? (req.fieldKey ?? '') : (req.docType ?? ''),
      citation: req.citation,
      necessity,
      provenance,
      groupKey: req.groupKey ?? null,
      state,
      blocking,
      proposed,
      chosen,
      alternatives: copies.filter((c) => {
        const k = c.documentVersionId ?? c.factVersionId;
        return c.usable && k !== chosenKey && k !== (chosen ? null : proposedKey);
      }),
      newerCopy,
      canExclude: !necessityCanBlock(necessity),
    };
  });

  const freshness = await checkFreshness(tx, mission, requirements, items, now);
  if (freshness?.packWithdrawn) {
    signals.push({
      kind: 'PACK_WITHDRAWN',
      packRequirementId: null,
      subjectId: freshness.packVersionId,
    });
  } else if (freshness?.packReplaced && !(await ruleImpactTablesPresent(tx))) {
    // Once the rule impact tables exist (UMPE P11), a newer published version is reported there,
    // one precise note per publication; this package sweep stays quiet about it so the traveller
    // never gets two notes for one publication. Before that migration this sweep still covers it.
    signals.push({
      kind: 'PACK_CHANGED',
      packRequirementId: null,
      subjectId: freshness.packVersionId,
    });
  }
  if (latestHandoff && latestHandoff.packVersionId !== mission.packVersionId) {
    signals.push({
      kind: 'PACK_CHANGED',
      packRequirementId: null,
      subjectId: mission.packVersionId,
    });
  }

  const unverified = new Set(
    readiness.value.requirementResults
      .filter((r) => r.state === 'UNVERIFIED')
      .map((r) => r.packRequirementId),
  );
  const questions = await questionsFor(tx, mission, requirements, unverified);
  const phraseInput: PhraseInput = {
    overallState: readiness.value.overallState,
    requiredLeftMissing,
    pinnedCopyUnusable,
    pinnedCopyReplaced,
    packWithdrawn: freshness?.packWithdrawn ?? false,
    packReplaced: freshness?.packReplaced ?? false,
    openChange: openChange !== null,
    handoffCurrent: handoffIsCurrent(latestHandoff, mission),
  };
  const phrase = derivePackagePhrase(phraseInput);

  return ok({
    phraseInput,
    pkg: {
      missionId: mission.id,
      ...phrase,
      overallState: readiness.value.overallState,
      requiredCount: readiness.value.requiredCount,
      satisfiedRequired: readiness.value.satisfiedRequired,
      items,
      questions,
      freshness,
      outsideSteps: outsideSteps(requirements.map((r) => r.notes)),
      latestHandoff: latestHandoff ? handoffSummary(latestHandoff, mission) : null,
      change: openChange ? changeView(openChange) : null,
      available,
      active,
    },
    signals,
    choices,
    latestHandoff,
  });
}

function changeView(row: typeof schema.umpePackageChanges.$inferSelect): PackageChangeView {
  return {
    kind: row.kind as PackageChangeKind,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    changeCount: row.changeCount,
  };
}

// --- Continuous matching: recording one change per case ---------------------------------------

type ChangeSource = 'CASE_OPENED' | 'SWEEP';

/**
 * Record (or clear) the one open "something changed" item of an active case. The same situation
 * is recorded once; a situation the person already marked as reviewed is not raised again; a
 * different change replaces the open item's details and counts up. Never touches a handoff, a
 * choice or a selection, and shares nothing. Returns whether anything was written.
 */
async function recordChange(
  tx: Db,
  mission: Mission,
  change: PackageChange | null,
  source: ChangeSource,
  actorAccountId: string | null,
  /** The case owner, for the note the sweep sends (null when the person opened the case). */
  notifyAccountId: string | null = null,
): Promise<boolean> {
  if (!isActive(mission)) return false;
  const latest = first(
    await tx
      .select()
      .from(schema.umpePackageChanges)
      .where(eq(schema.umpePackageChanges.missionId, mission.id))
      .orderBy(
        sql`${schema.umpePackageChanges.resolvedAt} is null desc`,
        desc(schema.umpePackageChanges.lastSeenAt),
      )
      .limit(1),
  );
  const open = latest && latest.resolvedAt === null ? latest : null;
  const now = new Date();
  if (!change) {
    if (!open) return false;
    await cancelQueuedNotificationsForResource(tx, open.id);
    await tx
      .update(schema.umpePackageChanges)
      .set({ resolvedAt: now, resolution: 'NO_LONGER_APPLIES', lastSeenAt: now })
      .where(
        and(
          eq(schema.umpePackageChanges.id, open.id),
          eq(schema.umpePackageChanges.missionId, mission.id),
        ),
      );
    await auditChange(
      tx,
      mission,
      'UMPE_PACKAGE_CHANGE_CLEARED',
      open.kind,
      actorAccountId,
      source,
    );
    return true;
  }
  if (open?.signature === change.signature) return false;
  // A situation the person already reviewed stays quiet, whatever came and went in between.
  const reviewed = first(
    await tx
      .select({ id: schema.umpePackageChanges.id })
      .from(schema.umpePackageChanges)
      .where(
        and(
          eq(schema.umpePackageChanges.missionId, mission.id),
          eq(schema.umpePackageChanges.signature, change.signature),
          eq(schema.umpePackageChanges.resolution, 'REVIEWED'),
        ),
      )
      .limit(1),
  );
  if (reviewed) {
    if (!open) return false;
    // The open item is about something that no longer applies.
    await cancelQueuedNotificationsForResource(tx, open.id);
    await tx
      .update(schema.umpePackageChanges)
      .set({ resolvedAt: now, resolution: 'NO_LONGER_APPLIES', lastSeenAt: now })
      .where(
        and(
          eq(schema.umpePackageChanges.id, open.id),
          eq(schema.umpePackageChanges.missionId, mission.id),
        ),
      );
    await auditChange(
      tx,
      mission,
      'UMPE_PACKAGE_CHANGE_CLEARED',
      open.kind,
      actorAccountId,
      source,
    );
    return true;
  }
  const detail = {
    signals: change.signals.map((s) => ({
      kind: s.kind,
      packRequirementId: s.packRequirementId,
      subjectId: s.subjectId,
    })),
  };
  let changeId: string;
  if (open) {
    changeId = open.id;
    // A note queued about what this item said before must never go out after it changed.
    await cancelQueuedNotificationsForResource(tx, open.id);
    await tx
      .update(schema.umpePackageChanges)
      .set({
        kind: change.kind,
        signature: change.signature,
        detail,
        changeCount: sql`${schema.umpePackageChanges.changeCount} + 1`,
        lastSeenAt: now,
        source,
      })
      .where(
        and(
          eq(schema.umpePackageChanges.id, open.id),
          eq(schema.umpePackageChanges.missionId, mission.id),
        ),
      );
  } else {
    const inserted = await tx
      .insert(schema.umpePackageChanges)
      .values({
        missionId: mission.id,
        applicantId: mission.applicantId,
        kind: change.kind,
        signature: change.signature,
        detail,
        source,
      })
      .onConflictDoNothing()
      .returning({ id: schema.umpePackageChanges.id });
    const row = inserted[0];
    if (!row) return false;
    changeId = row.id;
  }
  if (notifyAccountId) await notePackageChange(tx, mission, notifyAccountId, changeId, change);
  await auditChange(
    tx,
    mission,
    'UMPE_PACKAGE_CHANGE_RECORDED',
    change.kind,
    actorAccountId,
    source,
    change.signals.length,
  );
  return true;
}

/**
 * Tell the traveller, in the same transaction, that something changed for a case they are not
 * looking at (the sweep found it). One note per distinct change: the idempotency key carries a
 * hash of the change's signature, and the worker checks the change is still open before sending.
 * Plain words only; no document name, value or reason.
 */
async function notePackageChange(
  tx: Db,
  mission: Mission,
  ownerAccountId: string,
  changeId: string,
  change: PackageChange,
): Promise<void> {
  await enqueueNotificationBothChannels(tx, {
    eventType: PACKAGE_CHANGED_EVENT,
    resourceId: changeId,
    threshold: createHash('sha256').update(change.signature).digest('hex').slice(0, 16),
    recipientAccountId: ownerAccountId,
    applicantId: mission.applicantId,
    missionId: mission.id,
    payload: {
      subject: 'Something changed for one of your trips',
      summary: PACKAGE_CHANGE_LABELS[change.kind],
      deepLinkPath: `/app/mission/${mission.id}#trip-package`,
    },
  });
}

async function auditChange(
  tx: Db,
  mission: Mission,
  eventType: string,
  kind: string,
  actorAccountId: string | null,
  source: ChangeSource,
  signalCount?: number,
): Promise<void> {
  await appendAuditEvent(tx, {
    eventType,
    actorAccountId,
    method: source === 'SWEEP' ? 'SYSTEM' : 'MANUAL',
    result: 'ALLOWED',
    applicantId: mission.applicantId,
    missionId: mission.id,
    resourceType: 'mission',
    resourceId: mission.id,
    metadata: { kind, source, ...(signalCount !== undefined ? { signalCount } : {}) },
  });
}

// --- Public API -------------------------------------------------------------------------------

/**
 * The trip package of one case, for its owner: every requirement with its proposed exact copy,
 * the traveller's choice, alternatives and newer copies, the plain phrase, the questions the
 * checklist really needs, the freshness check and the steps outside VisaStack. Opening an active
 * case also records (or clears) its one "something changed" item; a closed, cancelled or
 * submitted case is shown as it is.
 */
export async function getCasePackage(
  proof: AuthorizedApplicant<'VIEW_METADATA'>,
  missionId: string,
  now: Date = new Date(),
): Promise<Result<CasePackage, ServiceError>> {
  const owned = ownerMissionOf(proof, 'VIEW_METADATA', missionId);
  if (!owned.ok) return owned;
  const mission = await freshMission(proof.tx, proof.applicant.id, missionId);
  if (!mission) return err(serviceError('not_found', NOT_AVAILABLE));
  const built = await buildPackage(proof.tx, mission, proof.applicant.ownerAccountId, now);
  if (!built.ok) return built;
  if (!built.value.pkg.available || !built.value.pkg.active) return ok(built.value.pkg);
  // The change row and its audit record are written in one transaction, under the audit lock.
  const open = await proof.tx.transaction(async (tx) => {
    const wrote = await recordChange(
      tx,
      mission,
      pickPackageChange(built.value.signals),
      'CASE_OPENED',
      proof.applicant.ownerAccountId,
    );
    return wrote ? { row: await loadOpenChange(tx, mission.id, true) } : null;
  });
  if (!open) return ok(built.value.pkg);
  const phrase = derivePackagePhrase({ ...built.value.phraseInput, openChange: open.row !== null });
  return ok({ ...built.value.pkg, ...phrase, change: open.row ? changeView(open.row) : null });
}

export type PackageChoiceInput =
  | {
      readonly missionId: string;
      readonly packRequirementId: string;
      readonly choice: 'USE_COPY';
      readonly documentVersionId?: string;
      readonly factVersionId?: string;
    }
  | {
      readonly missionId: string;
      readonly packRequirementId: string;
      readonly choice: 'EXCLUDE';
      readonly reason: string;
    }
  | {
      readonly missionId: string;
      readonly packRequirementId: string;
      readonly choice: 'LEAVE_MISSING' | 'CLEAR';
      readonly reason?: string;
    };

/**
 * Record the traveller's choice for one requirement of their case: Use This Copy (one exact
 * current document or answer version the case offers), Exclude (only an item that can never
 * block, with a reason), Leave Missing, or Clear (back to the proposal). The earlier choice is
 * kept as history, never edited. Excluding or leaving out an item never changes the checklist
 * or clears an obligation. A handoff already confirmed is never touched; any change here makes
 * the case need a fresh confirmation.
 */
export async function recordPackageChoice(
  proof: AuthorizedApplicant<'MANAGE'>,
  input: PackageChoiceInput,
): Promise<Result<{ readonly choiceId: string | null }, ServiceError>> {
  const owned = ownerMissionOf(proof, 'MANAGE', input.missionId);
  if (!owned.ok) return owned;
  const tx = proof.tx;
  if (!UUID.test(input.packRequirementId)) {
    return err(serviceError('not_found', 'That item is not on this checklist.'));
  }
  if (!(await packageTablesPresent(tx))) {
    return err(serviceError('invalid', 'Choosing copies is not available yet. Try again later.'));
  }
  const mission = await freshMission(tx, proof.applicant.id, input.missionId);
  if (!mission) return err(serviceError('not_found', NOT_AVAILABLE));
  if (!isActive(mission)) {
    return err(serviceError('invalid', 'This case is finished, so its package cannot change.'));
  }
  if (!mission.packVersionId) {
    return err(serviceError('invalid', 'This case has no checklist yet.'));
  }
  const requirement = (await listRequirements(tx, mission.packVersionId)).find(
    (r) => r.id === input.packRequirementId,
  );
  if (!requirement) return err(serviceError('not_found', 'That item is not on this checklist.'));
  const necessity = requirementNecessity({
    optional: requirement.optional,
    necessity: requirement.necessity,
  });

  const reason = 'reason' in input && input.reason !== undefined ? input.reason.trim() : '';
  if (reason.length > REASON_MAX) {
    return err(serviceError('invalid', `Keep the reason to ${REASON_MAX} characters or fewer.`));
  }
  let pin: {
    documentId: string | null;
    documentVersionId: string | null;
    factId: string | null;
    factVersionId: string | null;
  } = { documentId: null, documentVersionId: null, factId: null, factVersionId: null };

  if (input.choice === 'EXCLUDE') {
    if (necessityCanBlock(necessity)) {
      return err(
        serviceError(
          'invalid',
          'This item is required, so it cannot be left out. You can leave it missing for now.',
        ),
      );
    }
    if (reason.length === 0) {
      return err(serviceError('invalid', 'Say in a few words why you are leaving this out.'));
    }
  }
  if (input.choice === 'USE_COPY') {
    const candidates = await getEvidenceCandidates(tx, proof.applicant.ownerAccountId, mission.id);
    if (!candidates.ok) return candidates;
    const entry = candidates.value.find((c) => c.packRequirementId === requirement.id);
    const doc =
      input.documentVersionId !== undefined
        ? entry?.documentCandidates.find(
            (d) => d.documentVersionId === input.documentVersionId && d.eligible,
          )
        : undefined;
    const fact =
      input.factVersionId !== undefined
        ? entry?.factCandidates.find(
            (f) =>
              f.factVersionId !== null &&
              f.factVersionId === input.factVersionId &&
              isFactStatusEligible(f.status),
          )
        : undefined;
    if ((doc === undefined) === (fact === undefined)) {
      return err(serviceError('not_found', 'That copy is not available for this item.'));
    }
    pin = doc
      ? {
          documentId: doc.documentId,
          documentVersionId: doc.documentVersionId,
          factId: null,
          factVersionId: null,
        }
      : {
          documentId: null,
          documentVersionId: null,
          factId: fact?.factId ?? null,
          factVersionId: fact?.factVersionId ?? null,
        };
  }

  // Saving the same choice again changes nothing: no new row, no new revision, and a confirmed
  // handoff or a live acknowledgement stays as it is.
  const live = first(
    await tx
      .select()
      .from(schema.umpePackageChoices)
      .where(
        and(
          eq(schema.umpePackageChoices.missionId, mission.id),
          eq(schema.umpePackageChoices.packRequirementId, requirement.id),
          isNull(schema.umpePackageChoices.supersededAt),
        ),
      )
      .limit(1),
  );
  if (
    live &&
    live.choice === input.choice &&
    live.documentVersionId === pin.documentVersionId &&
    live.factVersionId === pin.factVersionId &&
    (live.reason ?? '') === reason
  ) {
    return ok({ choiceId: live.id });
  }

  return tx.transaction(async (inner) => {
    const now = new Date();
    const superseded = await inner
      .update(schema.umpePackageChoices)
      .set({ supersededAt: now })
      .where(
        and(
          eq(schema.umpePackageChoices.missionId, mission.id),
          eq(schema.umpePackageChoices.packRequirementId, requirement.id),
          isNull(schema.umpePackageChoices.supersededAt),
        ),
      )
      .returning({ id: schema.umpePackageChoices.id });
    if (input.choice === 'CLEAR' && superseded.length === 0) {
      return ok({ choiceId: null });
    }
    let choiceId: string | null = null;
    if (input.choice !== 'CLEAR') {
      const row = required(
        first(
          await inner
            .insert(schema.umpePackageChoices)
            .values({
              missionId: mission.id,
              applicantId: mission.applicantId,
              packRequirementId: requirement.id,
              choice: input.choice,
              ...pin,
              reason: reason.length > 0 ? reason : null,
              chosenByAccountId: proof.applicant.ownerAccountId,
            })
            .returning({ id: schema.umpePackageChoices.id }),
        ),
        'package choice',
      );
      choiceId = row.id;
    }
    if (input.choice === 'USE_COPY') {
      // The existing selection follows the choice, so readiness and snapshots use the same record.
      await inner
        .delete(schema.selectedEvidence)
        .where(
          and(
            eq(schema.selectedEvidence.missionId, mission.id),
            eq(schema.selectedEvidence.packRequirementId, requirement.id),
            keepOnly(pin),
          ),
        );
      await inner
        .insert(schema.selectedEvidence)
        .values({
          missionId: mission.id,
          packRequirementId: requirement.id,
          documentId: pin.documentId,
          factId: pin.factId,
          selectedByAccountId: proof.applicant.ownerAccountId,
        })
        .onConflictDoNothing();
    }
    await incrementMaterialRevision(inner, mission.id);
    await appendAuditEvent(inner, {
      eventType: 'UMPE_PACKAGE_CHOICE_RECORDED',
      actorAccountId: proof.applicant.ownerAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: mission.applicantId,
      missionId: mission.id,
      resourceType: 'pack_requirement',
      resourceId: requirement.id,
      metadata: { choice: input.choice, kind: requirement.kind, replaced: superseded.length },
    });
    return ok({ choiceId });
  });
}

/** Every other selection of the requirement, so only the chosen record stays selected. */
function keepOnly(pin: {
  readonly documentId: string | null;
  readonly factId: string | null;
}): SQL | undefined {
  if (pin.documentId) {
    return or(
      isNull(schema.selectedEvidence.documentId),
      ne(schema.selectedEvidence.documentId, pin.documentId),
    );
  }
  if (pin.factId) {
    return or(
      isNull(schema.selectedEvidence.factId),
      ne(schema.selectedEvidence.factId, pin.factId),
    );
  }
  return undefined;
}

/** What a confirmed handoff freezes, by ids and codes only. */
export interface PackageHandoffContent {
  readonly formatVersion: typeof PACKAGE_HANDOFF_FORMAT;
  readonly missionId: string;
  readonly missionSnapshotId: string;
  readonly missionSnapshotChecksum: string;
  readonly packVersionId: string;
  readonly packChecksum: string | null;
  readonly manifestFormat: number;
  readonly materialRevision: number;
  readonly selections: readonly {
    readonly packRequirementId: string;
    readonly kind: 'FIELD' | 'DOCUMENT';
    readonly key: string;
    readonly necessity: RequirementNecessity;
    readonly state: RequirementResultState;
    readonly choice: PackageChoiceKind | 'PROPOSED' | 'NONE';
    readonly documentId: string | null;
    readonly documentVersionId: string | null;
    readonly factId: string | null;
    readonly factVersionId: string | null;
    readonly excludedReasonGiven: boolean;
  }[];
  /** What is still open at the moment of confirmation, in codes the page words. */
  readonly caveats: readonly string[];
  readonly freshness: FreshnessReport | null;
  readonly outsideSteps: readonly string[];
  readonly confirmedAt: string;
}

/** Raised inside the handoff transaction so the snapshot it just took is rolled back too. */
class HandoffMismatch extends Error {}

export function handoffChecksum(content: PackageHandoffContent): string {
  return createHash('sha256').update(canonicalJson(content)).digest('hex');
}

/**
 * The traveller confirms the package as Prepared for Handoff. Allowed only while the case reads
 * Ready for Final Review (every required item covered, nothing material open, checklist still
 * published), and only after they say they have seen the steps outside VisaStack. Recommended
 * or optional gaps never stop it; they are recorded as caveats. Freezes an ordinary immutable
 * snapshot plus the exact selections, caveats and freshness result. This is not a submission
 * and shares nothing with anyone.
 */
export async function confirmPackageHandoff(
  proof: AuthorizedApplicant<'MANAGE'>,
  input: { readonly missionId: string; readonly outsideStepsSeen: boolean },
  now: Date = new Date(),
): Promise<
  Result<{ readonly handoffId: string; readonly content: PackageHandoffContent }, ServiceError>
> {
  const owned = ownerMissionOf(proof, 'MANAGE', input.missionId);
  if (!owned.ok) return owned;
  const tx = proof.tx;
  if (!input.outsideStepsSeen) {
    return err(serviceError('invalid', 'Confirm that you have read the steps outside VisaStack.'));
  }
  if (!(await packageTablesPresent(tx))) {
    return err(
      serviceError('invalid', 'Preparing a handoff is not available yet. Try again later.'),
    );
  }
  const mission = await freshMission(tx, proof.applicant.id, input.missionId);
  if (!mission) return err(serviceError('not_found', NOT_AVAILABLE));
  if (!isActive(mission)) {
    return err(serviceError('invalid', 'This case is finished, so it cannot be prepared again.'));
  }
  const ownerAccountId = proof.applicant.ownerAccountId;
  const built = await buildPackage(tx, mission, ownerAccountId, now);
  if (!built.ok) return built;
  const pkg = built.value.pkg;
  if (pkg.phrase === 'PREPARED_FOR_HANDOFF') {
    return err(serviceError('invalid', 'This package is already prepared for handoff.'));
  }
  if (pkg.phrase !== 'READY_FOR_FINAL_REVIEW' || !mission.packVersionId) {
    return err(
      serviceError(
        'invalid',
        'Some items still need attention before you can prepare the handoff.',
      ),
    );
  }
  const packVersionId = mission.packVersionId;
  const version = required(
    first(
      await tx
        .select({
          checksum: schema.packVersions.checksum,
          manifestFormat: schema.packVersions.manifestFormat,
        })
        .from(schema.packVersions)
        .where(eq(schema.packVersions.id, packVersionId))
        .limit(1),
    ),
    'pack version',
  );

  try {
    return await tx.transaction(async (inner) => {
      const snapshot = await snapshotMission(inner, {
        actorAccountId: ownerAccountId,
        missionId: mission.id,
      });
      if (!snapshot.ok) return snapshot;
      const caveats = new Set<string>(pkg.freshness?.caveats ?? []);
      for (const item of pkg.items) {
        if (item.state === 'NOT_APPLICABLE') continue;
        const copy = item.chosen ? item.chosen.copy : item.proposed;
        if (item.chosen?.choice === 'EXCLUDE') caveats.add('OPTIONAL_LEFT_OUT');
        else if (!copy && !item.blocking) caveats.add('OPTIONAL_MISSING');
        else if (copy && !copy.usable && !item.blocking) caveats.add('OPTIONAL_COPY_UNUSABLE');
        if (item.newerCopy) caveats.add('NEWER_COPY_AVAILABLE');
      }
      const content: PackageHandoffContent = {
        formatVersion: PACKAGE_HANDOFF_FORMAT,
        missionId: mission.id,
        missionSnapshotId: snapshot.value.id,
        missionSnapshotChecksum: snapshot.value.checksum,
        packVersionId,
        packChecksum: version.checksum,
        manifestFormat: version.manifestFormat ?? 1,
        materialRevision: mission.materialRevision,
        selections: pkg.items.map((item) => {
          const copy =
            item.chosen?.choice === 'USE_COPY'
              ? item.chosen.copy
              : item.chosen
                ? null
                : item.proposed;
          return {
            packRequirementId: item.packRequirementId,
            kind: item.kind,
            key: item.key,
            necessity: item.necessity,
            state: item.state,
            choice: item.chosen ? item.chosen.choice : copy ? 'PROPOSED' : 'NONE',
            documentId: copy?.documentId ?? null,
            documentVersionId: copy?.documentVersionId ?? null,
            factId: copy?.factId ?? null,
            factVersionId: copy?.factVersionId ?? null,
            excludedReasonGiven: item.chosen?.choice === 'EXCLUDE' && !!item.chosen.reason,
          };
        }),
        caveats: [...caveats].sort(),
        freshness: pkg.freshness,
        outsideSteps: pkg.outsideSteps.map((s) => s.kind),
        confirmedAt: now.toISOString(),
      };
      // The frozen selections and the snapshot must name the same copies, or nothing is frozen.
      const captured = snapshot.value.content as {
        readonly documents?: readonly { readonly documentVersionId?: string }[];
        readonly facts?: readonly { readonly factVersionId?: string | null }[];
      };
      const capturedVersions = new Set([
        ...(captured.documents ?? []).map((d) => d.documentVersionId),
        ...(captured.facts ?? []).map((f) => f.factVersionId),
      ]);
      const disagrees = content.selections.some(
        (sel) =>
          (sel.documentVersionId !== null && !capturedVersions.has(sel.documentVersionId)) ||
          (sel.factVersionId !== null && !capturedVersions.has(sel.factVersionId)),
      );
      if (disagrees) {
        throw new HandoffMismatch();
      }
      const checksum = handoffChecksum(content);
      const row = required(
        first(
          await inner
            .insert(schema.umpePackageHandoffs)
            .values({
              missionId: mission.id,
              applicantId: mission.applicantId,
              missionSnapshotId: snapshot.value.id,
              packVersionId,
              packChecksum: version.checksum,
              manifestFormat: version.manifestFormat ?? 1,
              materialRevisionAtCapture: mission.materialRevision,
              content,
              contentChecksum: checksum,
              confirmedByAccountId: ownerAccountId,
              confirmedAt: now,
            })
            .returning({ id: schema.umpePackageHandoffs.id }),
        ),
        'package handoff',
      );
      await appendAuditEvent(inner, {
        eventType: 'UMPE_PACKAGE_HANDOFF_CONFIRMED',
        actorAccountId: ownerAccountId,
        method: 'MANUAL',
        result: 'ALLOWED',
        applicantId: mission.applicantId,
        missionId: mission.id,
        resourceType: 'umpe_package_handoff',
        resourceId: row.id,
        metadata: {
          selections: content.selections.length,
          caveats: content.caveats.length,
          checksum,
        },
      });
      return ok({ handoffId: row.id, content });
    });
  } catch (error) {
    if (error instanceof HandoffMismatch) {
      return err(
        serviceError(
          'stale',
          'Something changed while preparing the handoff. Review the package and try again.',
        ),
      );
    }
    throw error;
  }
}

/** The case's confirmed handoffs, newest first (at most 20), each with whether it still matches. */
export async function listPackageHandoffs(
  proof: AuthorizedApplicant<'VIEW_METADATA'>,
  missionId: string,
): Promise<Result<readonly PackageHandoffSummary[], ServiceError>> {
  const owned = ownerMissionOf(proof, 'VIEW_METADATA', missionId);
  if (!owned.ok) return owned;
  const mission = await freshMission(proof.tx, proof.applicant.id, missionId);
  if (!mission) return err(serviceError('not_found', NOT_AVAILABLE));
  if (!(await packageTablesPresent(proof.tx))) return ok([]);
  const rows = await proof.tx
    .select()
    .from(schema.umpePackageHandoffs)
    .where(
      and(
        eq(schema.umpePackageHandoffs.missionId, mission.id),
        eq(schema.umpePackageHandoffs.applicantId, proof.applicant.id),
      ),
    )
    .orderBy(desc(schema.umpePackageHandoffs.confirmedAt), desc(schema.umpePackageHandoffs.id))
    .limit(HANDOFF_LIST_LIMIT);
  const newestId = rows[0]?.id;
  return ok(
    rows.map((row) => ({
      ...handoffSummary(row, mission),
      // Only the newest confirmation can still be the current one.
      current: row.id === newestId && handoffIsCurrent(row, mission),
    })),
  );
}

/** The traveller has looked at the open "something changed" item; the same situation stays quiet. */
export async function markPackageChangeReviewed(
  proof: AuthorizedApplicant<'MANAGE'>,
  missionId: string,
): Promise<Result<{ readonly reviewed: boolean }, ServiceError>> {
  const owned = ownerMissionOf(proof, 'MANAGE', missionId);
  if (!owned.ok) return owned;
  if (!(await packageTablesPresent(proof.tx))) return ok({ reviewed: false });
  const mission = await freshMission(proof.tx, proof.applicant.id, missionId);
  if (!mission) return err(serviceError('not_found', NOT_AVAILABLE));
  return proof.tx.transaction(async (tx) => {
    const now = new Date();
    const rows = await tx
      .update(schema.umpePackageChanges)
      .set({ resolvedAt: now, resolution: 'REVIEWED', lastSeenAt: now })
      .where(
        and(
          eq(schema.umpePackageChanges.missionId, mission.id),
          eq(schema.umpePackageChanges.applicantId, proof.applicant.id),
          isNull(schema.umpePackageChanges.resolvedAt),
        ),
      )
      .returning({ id: schema.umpePackageChanges.id, kind: schema.umpePackageChanges.kind });
    const reviewed = rows[0];
    for (const row of rows) await cancelQueuedNotificationsForResource(tx, row.id);
    if (reviewed) {
      await auditChange(
        tx,
        mission,
        'UMPE_PACKAGE_CHANGE_REVIEWED',
        reviewed.kind,
        proof.applicant.ownerAccountId,
        'CASE_OPENED',
      );
    }
    return ok({ reviewed: reviewed !== undefined });
  });
}

export const PACKAGE_SWEEP_DEFAULT_LIMIT = 50;
const PACKAGE_SWEEP_MAX_LIMIT = 200;

/**
 * Continuous matching for the scheduled sweep: re-evaluate one bounded page of ACTIVE cases that
 * have a package worth watching (a choice or a confirmed handoff), in id order from `after`, and
 * record each case's one change item. Closed, cancelled and submitted cases are never read, a
 * confirmed handoff is never rewritten and nothing is shared. Each newly recorded change queues one
 * note to the case owner (in-app and email), checked again before it is sent. Returns the cursor for the
 * next page (null when done).
 */
export async function sweepPackageChanges(
  scope: SystemScope<'process-notification-sweeps'>,
  db: Db,
  options: { readonly after?: string | null; readonly limit?: number; readonly now?: Date } = {},
): Promise<{ readonly checked: number; readonly recorded: number; readonly next: string | null }> {
  if (!SystemScope.isGenuine(scope) || scope.job !== 'process-notification-sweeps') {
    return { checked: 0, recorded: 0, next: null };
  }
  if (!(await packageTablesPresent(db))) return { checked: 0, recorded: 0, next: null };
  const limit = Math.min(
    Math.max(1, Math.floor(options.limit ?? PACKAGE_SWEEP_DEFAULT_LIMIT)),
    PACKAGE_SWEEP_MAX_LIMIT,
  );
  const after = options.after && UUID.test(options.after) ? options.after : null;
  const watched = sql`(exists (select 1 from ${schema.umpePackageChoices} c where c.mission_id = ${schema.missions.id} and c.superseded_at is null) or exists (select 1 from ${schema.umpePackageHandoffs} h where h.mission_id = ${schema.missions.id}))`;
  const missions = await db
    .select()
    .from(schema.missions)
    .where(
      and(
        notInArray(schema.missions.state, [...INACTIVE_CASE_STATES]),
        isNull(schema.missions.purgedAt),
        isNotNull(schema.missions.packVersionId),
        after ? gt(schema.missions.id, after) : undefined,
        watched,
      ),
    )
    .orderBy(asc(schema.missions.id))
    .limit(limit);
  let recorded = 0;
  for (const mission of missions) {
    const owner = first(
      await db
        .select({ ownerAccountId: schema.applicants.ownerAccountId })
        .from(schema.applicants)
        .where(eq(schema.applicants.id, mission.applicantId))
        .limit(1),
    );
    if (!owner) continue;
    const wrote = await db.transaction(async (tx) => {
      const fresh = await freshMission(tx, mission.applicantId, mission.id);
      if (!fresh || !isActive(fresh)) return false;
      const built = await buildPackage(tx, fresh, owner.ownerAccountId, options.now ?? new Date());
      if (!built.ok) return false;
      return recordChange(
        tx,
        fresh,
        pickPackageChange(built.value.signals),
        'SWEEP',
        null,
        owner.ownerAccountId,
      );
    });
    if (wrote) recorded++;
  }
  const last = missions[missions.length - 1];
  return {
    checked: missions.length,
    recorded,
    next: missions.length === limit && last ? last.id : null,
  };
}
