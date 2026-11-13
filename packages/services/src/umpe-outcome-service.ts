/**
 * UMPE P12 (O01 to O04): application attempts and what the authority did with each one.
 *
 * - Every time a case goes to an authority is its own attempt, numbered per case. A reapplication
 *   or a resubmission after a refusal never shares a decision, a request or evidence with an earlier
 *   attempt, so nothing is collapsed or double counted.
 * - Each attempt keeps the exact package record known when it was sent: the P4 handoff confirmed by
 *   the end of the day it was sent (in the person's own time zone), else the snapshot the submission
 *   report named or the latest snapshot by then, else nothing. Only ids and checksums are copied;
 *   nothing is invented for an older case that has neither.
 * - A person's word stays Self-Reported; Document Supplied means they attached a document of their
 *   own. Nothing is ever called verified: no channel exists that could check an authority's action.
 * - "The Embassy Asked for More" is its own record with an authority source and catalogue document
 *   kinds. An agency's correction request is a different thing (P9 reviews) and never lands here.
 * - The first report on a case still goes through the existing submission report (the only path
 *   that moves a case to Submitted). It becomes attempt 1 through `trackSubmissionAsAttempt`; later
 *   attempts are recorded directly once the case has at least one report.
 *
 * Owner only: every function takes the case owner's gate proof. Audit records carry ids and kinds.
 */
import { type Result, err, ok } from '@visastack/core';
import { resolveDocumentType } from '@visastack/core/catalogue';
import { and, asc, desc, eq, inArray, lt, max, sql } from 'drizzle-orm';
import { AuthorizedApplicant } from './access';
import { snapshotRecordedVersions } from './application-memory';
import { appendAuditEvent } from './audit';
import { type Db, first, schema } from './db';
import { type ServiceError, keyedError, serviceError } from './errors';
import { lifecycleTablesPresent, presentDocumentCondition } from './lifecycle/foundation';
import {
  ATTEMPT_CHANNELS,
  ATTEMPT_DECISIONS,
  AUTHORITY_REQUEST_SOURCES,
  type AttemptBinding,
  type AttemptChannel,
  type AttemptDecision,
  type AttemptEventKind,
  type AuthorityRequestSource,
  type EvidenceBasis,
  MAX_REQUESTED_DOC_TYPES,
  outcomeTablesPresent,
} from './umpe-outcome-tables';
import type { PackageHandoffContent } from './umpe-package-service';
import { packageTablesPresent } from './umpe-package-tables';

type Mission = typeof schema.missions.$inferSelect;
type AttemptRow = typeof schema.umpeOutcomeAttempts.$inferSelect;
type EventRow = typeof schema.umpeOutcomeEvents.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function ownerMission<A extends 'VIEW_METADATA' | 'MANAGE'>(
  proof: AuthorizedApplicant<A>,
  action: A,
  missionId: string,
): Result<Mission, ServiceError> {
  if (!AuthorizedApplicant.isGenuine(proof, action) || proof.actor.kind !== 'applicant_owner') {
    return err(keyedError('forbidden', 'umpe_correction_service.only_the_traveller_who_owns_this'));
  }
  const resource = proof.resource;
  if (
    !UUID.test(missionId) ||
    resource.kind !== 'mission' ||
    resource.mission.id !== missionId ||
    resource.mission.applicantId !== proof.applicant.id
  ) {
    return err(keyedError('not_found', 'umpe_outcome_service.this_case_is_not_available'));
  }
  return ok(resource.mission);
}

/** The case row, locked for this transaction, scoped to the proof's person. */
async function lockedMission(tx: Db, applicantId: string, missionId: string) {
  return first(
    await tx
      .select()
      .from(schema.missions)
      .where(and(eq(schema.missions.id, missionId), eq(schema.missions.applicantId, applicantId)))
      .for('update'),
  );
}

/** A calendar date that is real and not after today in the person's own time zone. */
function validDate(value: string, timeZone: string, now: Date): string | null {
  if (!ISO_DATE.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return null;
  if (value > localDate(now, timeZone)) return null;
  return value;
}

/** Today's date (YYYY-MM-DD) where the person lives. */
export function localDate(at: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** The end of `day` in the person's time zone, as a SQL instant (the start of the next day there). */
function endOfDaySql(day: string, timeZone: string) {
  return sql`((${day}::date + 1)::timestamp at time zone ${timeZone})`;
}

/**
 * A present version of one of this person's own documents, or null. Used for every piece of
 * evidence: a receipt, a request letter or a decision letter.
 */
async function ownEvidenceVersion(
  tx: Db,
  applicantId: string,
  versionId: string,
): Promise<string | null> {
  if (!UUID.test(versionId)) return null;
  const lifecycle = await lifecycleTablesPresent(tx);
  const row = first(
    await tx
      .select({ id: schema.documentVersions.id })
      .from(schema.documentVersions)
      .innerJoin(schema.documents, eq(schema.documents.id, schema.documentVersions.documentId))
      .where(
        and(
          eq(schema.documentVersions.id, versionId),
          eq(schema.documents.applicantId, applicantId),
          lifecycle ? presentDocumentCondition() : undefined,
        ),
      )
      .limit(1),
  );
  return row?.id ?? null;
}

interface Binding {
  readonly binding: AttemptBinding;
  readonly handoffId: string | null;
  readonly handoffChecksum: string | null;
  readonly missionSnapshotId: string | null;
  readonly packVersionId: string | null;
  readonly packChecksum: string | null;
  readonly manifestFormat: number | null;
  readonly materialRevision: number | null;
  readonly selectedVersions: {
    readonly documentVersionIds: readonly string[];
    readonly factVersionIds: readonly string[];
  };
  readonly routeKey: string | null;
}

const NO_BINDING: Binding = {
  binding: 'NONE',
  handoffId: null,
  handoffChecksum: null,
  missionSnapshotId: null,
  packVersionId: null,
  packChecksum: null,
  manifestFormat: null,
  materialRevision: null,
  selectedVersions: { documentVersionIds: [], factVersionIds: [] },
  routeKey: null,
};

async function routeKeyOf(tx: Db, packVersionId: string | null): Promise<string | null> {
  if (!packVersionId) return null;
  const row = first(
    await tx
      .select({ key: schema.packs.key, route: schema.packs.route })
      .from(schema.packVersions)
      .innerJoin(schema.packs, eq(schema.packs.id, schema.packVersions.packId))
      .where(eq(schema.packVersions.id, packVersionId))
      .limit(1),
  );
  return row ? (row.route ?? row.key).slice(0, 200) : null;
}

function handoffSelections(content: unknown): Binding['selectedVersions'] {
  const selections = (content as Partial<PackageHandoffContent> | null)?.selections;
  if (!Array.isArray(selections)) return NO_BINDING.selectedVersions;
  const documentVersionIds: string[] = [];
  const factVersionIds: string[] = [];
  for (const s of selections) {
    if (typeof s?.documentVersionId === 'string') documentVersionIds.push(s.documentVersionId);
    if (typeof s?.factVersionId === 'string') factVersionIds.push(s.factVersionId);
  }
  return { documentVersionIds, factVersionIds };
}

/**
 * The package record known when an attempt was sent (by the end of the sent day). A submission
 * report names its own snapshot: a handoff of that very snapshot wins, else the snapshot itself. A
 * directly recorded attempt takes the latest handoff by then, else the latest snapshot by then.
 * Otherwise nothing.
 */
async function bindingFor(
  tx: Db,
  missionId: string,
  sentOn: string,
  timeZone: string,
  reportedSnapshotId: string | null,
): Promise<Binding> {
  const endOfDay = endOfDaySql(sentOn, timeZone);
  if (await packageTablesPresent(tx)) {
    const h = schema.umpePackageHandoffs;
    const byReport = reportedSnapshotId
      ? first(
          await tx
            .select()
            .from(h)
            .where(
              and(
                eq(h.missionId, missionId),
                eq(h.missionSnapshotId, reportedSnapshotId),
                lt(h.confirmedAt, endOfDay),
              ),
            )
            .orderBy(desc(h.confirmedAt), desc(h.id))
            .limit(1),
        )
      : undefined;
    const handoff =
      byReport ??
      (reportedSnapshotId
        ? undefined
        : first(
            await tx
              .select()
              .from(h)
              .where(and(eq(h.missionId, missionId), lt(h.confirmedAt, endOfDay)))
              .orderBy(desc(h.confirmedAt), desc(h.id))
              .limit(1),
          ));
    if (handoff) {
      return {
        binding: 'PACKAGE_HANDOFF',
        handoffId: handoff.id,
        handoffChecksum: handoff.contentChecksum,
        missionSnapshotId: handoff.missionSnapshotId,
        packVersionId: handoff.packVersionId,
        packChecksum: handoff.packChecksum,
        manifestFormat: handoff.manifestFormat,
        materialRevision: handoff.materialRevisionAtCapture,
        selectedVersions: handoffSelections(handoff.content),
        routeKey: await routeKeyOf(tx, handoff.packVersionId),
      };
    }
  }
  const s = schema.missionSnapshots;
  const snapshot = first(
    await tx
      .select()
      .from(s)
      .where(
        reportedSnapshotId
          ? and(eq(s.missionId, missionId), eq(s.id, reportedSnapshotId))
          : and(eq(s.missionId, missionId), lt(s.createdAt, endOfDay)),
      )
      .orderBy(desc(s.createdAt), desc(s.version))
      .limit(1),
  );
  if (!snapshot) return NO_BINDING;
  const recorded = snapshotRecordedVersions(snapshot.content);
  const packVersion = recorded.packVersionId
    ? first(
        await tx
          .select({ id: schema.packVersions.id })
          .from(schema.packVersions)
          .where(eq(schema.packVersions.id, recorded.packVersionId))
          .limit(1),
      )
    : undefined;
  return {
    binding: 'SNAPSHOT_ONLY',
    handoffId: null,
    handoffChecksum: null,
    missionSnapshotId: snapshot.id,
    packVersionId: packVersion?.id ?? null,
    packChecksum: packVersion ? recorded.packChecksum : null,
    manifestFormat: packVersion ? recorded.manifestFormat : null,
    materialRevision: snapshot.materialRevisionAtCapture,
    selectedVersions: {
      documentVersionIds: recorded.documentVersionIds,
      factVersionIds: recorded.factVersionIds,
    },
    routeKey: await routeKeyOf(tx, packVersion?.id ?? null),
  };
}

async function nextAttemptNo(tx: Db, missionId: string): Promise<number> {
  const row = first(
    await tx
      .select({ top: max(schema.umpeOutcomeAttempts.attemptNo) })
      .from(schema.umpeOutcomeAttempts)
      .where(eq(schema.umpeOutcomeAttempts.missionId, missionId)),
  );
  return (row?.top ?? 0) + 1;
}

async function insertAttempt(
  tx: Db,
  mission: Mission,
  accountId: string,
  fields: {
    readonly missionSubmissionId: string | null;
    readonly channel: AttemptChannel;
    readonly submittedOn: string;
    readonly evidenceVersionId: string | null;
    readonly binding: Binding;
  },
): Promise<AttemptRow> {
  const attemptNo = await nextAttemptNo(tx, mission.id);
  const basis: EvidenceBasis = fields.evidenceVersionId ? 'DOCUMENT_SUPPLIED' : 'SELF_REPORTED';
  const cap = (value: string | null) => (value === null ? null : value.slice(0, 500));
  const [row] = await tx
    .insert(schema.umpeOutcomeAttempts)
    .values({
      missionId: mission.id,
      applicantId: mission.applicantId,
      attemptNo,
      missionSubmissionId: fields.missionSubmissionId,
      binding: fields.binding.binding,
      handoffId: fields.binding.handoffId,
      handoffChecksum: fields.binding.handoffChecksum,
      missionSnapshotId: fields.binding.missionSnapshotId,
      packVersionId: fields.binding.packVersionId,
      packChecksum: fields.binding.packChecksum,
      manifestFormat: fields.binding.manifestFormat,
      materialRevision: fields.binding.materialRevision,
      selectedVersions: fields.binding.selectedVersions,
      routeKey: fields.binding.routeKey,
      purpose: cap(mission.purpose),
      jurisdiction: cap(mission.jurisdiction),
      destination: cap(mission.destination),
      travelStartDate: mission.travelStartDate,
      travelEndDate: mission.travelEndDate,
      channel: fields.channel,
      submittedOn: fields.submittedOn,
      evidenceBasis: basis,
      evidenceDocumentVersionId: fields.evidenceVersionId,
      recordedByAccountId: accountId,
    })
    .returning();
  if (!row) throw new Error('attempt insert returned nothing');
  await appendAuditEvent(tx, {
    eventType: 'UMPE_OUTCOME_ATTEMPT_RECORDED',
    actorAccountId: accountId,
    method: 'MANUAL',
    result: 'ALLOWED',
    applicantId: mission.applicantId,
    missionId: mission.id,
    resourceType: 'umpe_outcome_attempt',
    resourceId: row.id,
    metadata: {
      attemptNo,
      binding: row.binding,
      channel: row.channel,
      evidenceBasis: basis,
      fromSubmissionReport: fields.missionSubmissionId !== null,
      selectedDocuments: fields.binding.selectedVersions.documentVersionIds.length,
      selectedDetails: fields.binding.selectedVersions.factVersionIds.length,
    },
  });
  return row;
}

export interface RecordAttemptInput {
  readonly missionId: string;
  readonly channel: string;
  /** The day it was sent, YYYY-MM-DD, never after today where the person lives. */
  readonly submittedOn: string;
  /** A receipt or confirmation the person attaches, one of their own document versions. */
  readonly evidenceDocumentVersionId?: string;
}

/**
 * A later attempt on a case that already has a submission report: a resubmission, a reapplication
 * after a refusal or a submission to a second authority. The first report always comes through the
 * existing submission report, which is what moves a case to Submitted.
 */
export async function recordOutcomeAttempt(
  proof: AuthorizedApplicant<'MANAGE'>,
  input: RecordAttemptInput,
  now: Date = new Date(),
): Promise<Result<{ readonly attemptId: string; readonly attemptNo: number }, ServiceError>> {
  const owned = ownerMission(proof, 'MANAGE', input.missionId);
  if (!owned.ok) return owned;
  const db = proof.tx;
  if (!(await outcomeTablesPresent(db)))
    return err(
      keyedError('invalid', 'umpe_outcome_service.recording_attempts_is_not_available_yet'),
    );
  if (!(ATTEMPT_CHANNELS as readonly string[]).includes(input.channel)) {
    return err(keyedError('invalid', 'umpe_outcome_service.choose_how_it_was_sent'));
  }
  const timeZone = proof.applicant.timezone;
  const submittedOn = validDate(input.submittedOn, timeZone, now);
  if (!submittedOn)
    return err(keyedError('invalid', 'umpe_outcome_service.enter_the_day_it_was_sent'));
  return db.transaction(async (tx) => {
    const mission = await lockedMission(tx, proof.applicant.id, input.missionId);
    if (!mission || mission.purgedAt)
      return err(keyedError('not_found', 'umpe_outcome_service.this_case_is_not_available'));
    const reports = await tx
      .select({ id: schema.missionSubmissions.id, tracked: schema.umpeOutcomeAttempts.id })
      .from(schema.missionSubmissions)
      .leftJoin(
        schema.umpeOutcomeAttempts,
        eq(schema.umpeOutcomeAttempts.missionSubmissionId, schema.missionSubmissions.id),
      )
      .where(eq(schema.missionSubmissions.missionId, mission.id));
    if (reports.some((r) => r.tracked === null)) {
      // Earlier reports first, so attempts are numbered in the order they happened and a
      // submission is never counted twice.
      return err(
        keyedError('invalid', 'umpe_outcome_service.track_the_earlier_submission_report_as'),
      );
    }
    if (reports.length === 0) {
      return err(keyedError('invalid', 'umpe_outcome_service.report_the_first_submission_of_this'));
    }
    let evidenceVersionId: string | null = null;
    if (input.evidenceDocumentVersionId) {
      evidenceVersionId = await ownEvidenceVersion(
        tx,
        proof.applicant.id,
        input.evidenceDocumentVersionId,
      );
      if (!evidenceVersionId)
        return err(
          keyedError('not_found', 'umpe_outcome_service.that_document_is_not_available_for'),
        );
    }
    const binding = await bindingFor(tx, mission.id, submittedOn, timeZone, null);
    const row = await insertAttempt(tx, mission, proof.applicant.ownerAccountId, {
      missionSubmissionId: null,
      channel: input.channel as AttemptChannel,
      submittedOn,
      evidenceVersionId,
      binding,
    });
    return ok({ attemptId: row.id, attemptNo: row.attemptNo });
  });
}

/**
 * Turns one existing submission report of this case into an attempt (once). The report's own
 * channel, day and snapshot are used; nothing is added that the report did not say.
 */
export async function trackSubmissionAsAttempt(
  proof: AuthorizedApplicant<'MANAGE'>,
  input: { readonly missionId: string; readonly missionSubmissionId: string },
): Promise<Result<{ readonly attemptId: string; readonly attemptNo: number }, ServiceError>> {
  const owned = ownerMission(proof, 'MANAGE', input.missionId);
  if (!owned.ok) return owned;
  const db = proof.tx;
  if (!(await outcomeTablesPresent(db)))
    return err(
      keyedError('invalid', 'umpe_outcome_service.recording_attempts_is_not_available_yet'),
    );
  if (!UUID.test(input.missionSubmissionId)) {
    return err(
      keyedError('not_found', 'umpe_outcome_service.that_submission_report_is_not_available'),
    );
  }
  return db.transaction(async (tx) => {
    const mission = await lockedMission(tx, proof.applicant.id, input.missionId);
    if (!mission || mission.purgedAt)
      return err(keyedError('not_found', 'umpe_outcome_service.this_case_is_not_available'));
    const report = first(
      await tx
        .select()
        .from(schema.missionSubmissions)
        .where(
          and(
            eq(schema.missionSubmissions.id, input.missionSubmissionId),
            eq(schema.missionSubmissions.missionId, mission.id),
          ),
        )
        .limit(1),
    );
    if (!report)
      return err(
        keyedError('not_found', 'umpe_outcome_service.that_submission_report_is_not_available'),
      );
    const already = first(
      await tx
        .select({
          id: schema.umpeOutcomeAttempts.id,
          attemptNo: schema.umpeOutcomeAttempts.attemptNo,
        })
        .from(schema.umpeOutcomeAttempts)
        .where(eq(schema.umpeOutcomeAttempts.missionSubmissionId, report.id))
        .limit(1),
    );
    if (already) return ok({ attemptId: already.id, attemptNo: already.attemptNo });
    const timeZone = proof.applicant.timezone;
    // The report form keeps the day and time as the person typed them (read as UTC), so the day
    // is that day, not shifted into their time zone.
    const submittedOn = report.submittedAt.toISOString().slice(0, 10);
    const binding = await bindingFor(tx, mission.id, submittedOn, timeZone, report.snapshotId);
    const channel = (ATTEMPT_CHANNELS as readonly string[]).includes(report.channel)
      ? (report.channel as AttemptChannel)
      : 'OTHER';
    const row = await insertAttempt(tx, mission, proof.applicant.ownerAccountId, {
      missionSubmissionId: report.id,
      channel,
      submittedOn,
      evidenceVersionId: null,
      binding,
    });
    return ok({ attemptId: row.id, attemptNo: row.attemptNo });
  });
}

export interface RecordAttemptEventInput {
  readonly missionId: string;
  readonly attemptId: string;
  readonly kind: string;
  /** DECISION only. */
  readonly decision?: string;
  /** AUTHORITY_REQUEST only. */
  readonly requestSource?: string;
  /** AUTHORITY_REQUEST only: catalogue document kinds (keys or known names). */
  readonly requestedDocTypes?: readonly string[];
  readonly occurredOn: string;
  readonly evidenceDocumentVersionId?: string;
}

/** Records what followed one attempt: a receipt, a request for more, or a decision. */
export async function recordAttemptEvent(
  proof: AuthorizedApplicant<'MANAGE'>,
  input: RecordAttemptEventInput,
  now: Date = new Date(),
): Promise<Result<{ readonly eventId: string }, ServiceError>> {
  const owned = ownerMission(proof, 'MANAGE', input.missionId);
  if (!owned.ok) return owned;
  const db = proof.tx;
  if (!(await outcomeTablesPresent(db)))
    return err(
      keyedError('invalid', 'umpe_outcome_service.recording_attempts_is_not_available_yet'),
    );
  const kind = input.kind as AttemptEventKind;
  let decision: AttemptDecision | null = null;
  let requestSource: AuthorityRequestSource | null = null;
  let requestedDocTypes: string[] = [];
  if (kind === 'DECISION') {
    if (!(ATTEMPT_DECISIONS as readonly string[]).includes(input.decision ?? '')) {
      return err(keyedError('invalid', 'umpe_outcome_service.choose_the_decision'));
    }
    decision = input.decision as AttemptDecision;
  } else if (kind === 'AUTHORITY_REQUEST') {
    if (!(AUTHORITY_REQUEST_SOURCES as readonly string[]).includes(input.requestSource ?? '')) {
      return err(keyedError('invalid', 'umpe_outcome_service.choose_who_asked_for_more'));
    }
    requestSource = input.requestSource as AuthorityRequestSource;
    const keys = new Set<string>();
    for (const name of input.requestedDocTypes ?? []) {
      const known = resolveDocumentType(name);
      if (!known)
        return err(
          keyedError('invalid', 'umpe_outcome_service.choose_the_documents_from_the_list'),
        );
      keys.add(known.key);
    }
    if (keys.size === 0)
      return err(keyedError('invalid', 'umpe_outcome_service.choose_at_least_one_document'));
    if (keys.size > MAX_REQUESTED_DOC_TYPES) {
      return err(serviceError('invalid', `Choose at most ${MAX_REQUESTED_DOC_TYPES} documents.`));
    }
    requestedDocTypes = [...keys].sort();
  } else if (kind !== 'AUTHORITY_RECEIPT') {
    return err(keyedError('invalid', 'umpe_outcome_service.choose_what_happened'));
  }
  const occurredOn = validDate(input.occurredOn, proof.applicant.timezone, now);
  if (!occurredOn)
    return err(keyedError('invalid', 'umpe_outcome_service.enter_the_day_it_happened_not'));
  return db.transaction(async (tx) => {
    const mission = await lockedMission(tx, proof.applicant.id, input.missionId);
    if (!mission || mission.purgedAt)
      return err(keyedError('not_found', 'umpe_outcome_service.this_case_is_not_available'));
    const attempt = UUID.test(input.attemptId)
      ? first(
          await tx
            .select()
            .from(schema.umpeOutcomeAttempts)
            .where(
              and(
                eq(schema.umpeOutcomeAttempts.id, input.attemptId),
                eq(schema.umpeOutcomeAttempts.missionId, mission.id),
              ),
            )
            .limit(1),
        )
      : undefined;
    if (!attempt)
      return err(keyedError('not_found', 'umpe_outcome_service.that_attempt_is_not_available'));
    if (occurredOn < attempt.submittedOn) {
      return err(keyedError('invalid', 'umpe_outcome_service.this_cannot_be_earlier_than_the'));
    }
    let evidenceVersionId: string | null = null;
    if (input.evidenceDocumentVersionId) {
      evidenceVersionId = await ownEvidenceVersion(
        tx,
        proof.applicant.id,
        input.evidenceDocumentVersionId,
      );
      if (!evidenceVersionId)
        return err(
          keyedError('not_found', 'umpe_outcome_service.that_document_is_not_available_for'),
        );
    }
    const basis: EvidenceBasis = evidenceVersionId ? 'DOCUMENT_SUPPLIED' : 'SELF_REPORTED';
    const [row] = await tx
      .insert(schema.umpeOutcomeEvents)
      .values({
        attemptId: attempt.id,
        missionId: mission.id,
        applicantId: mission.applicantId,
        kind,
        decision,
        requestSource,
        requestedDocTypes,
        occurredOn,
        evidenceBasis: basis,
        evidenceDocumentVersionId: evidenceVersionId,
        recordedByAccountId: proof.applicant.ownerAccountId,
      })
      .returning({ id: schema.umpeOutcomeEvents.id });
    if (!row) throw new Error('attempt event insert returned nothing');
    await appendAuditEvent(tx, {
      eventType: 'UMPE_OUTCOME_EVENT_RECORDED',
      actorAccountId: proof.applicant.ownerAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: mission.applicantId,
      missionId: mission.id,
      resourceType: 'umpe_outcome_event',
      resourceId: row.id,
      metadata: {
        kind,
        decision,
        requestSource,
        requestedKinds: requestedDocTypes.length,
        evidenceBasis: basis,
        attemptNo: attempt.attemptNo,
      },
    });
    return ok({ eventId: row.id });
  });
}

// --- Reading ------------------------------------------------------------------

/** Where an attempt stands with the authority, from its own records only. */
export type AttemptStanding =
  | { readonly kind: 'UNKNOWN' }
  | {
      readonly kind: 'DECIDED';
      readonly decision: AttemptDecision;
      readonly occurredOn: string;
      /** True only while the attached document is still there. Never "verified". */
      readonly documentSupplied: boolean;
    };

export interface AttemptEventView {
  readonly id: string;
  readonly kind: AttemptEventKind;
  readonly decision: AttemptDecision | null;
  readonly requestSource: AuthorityRequestSource | null;
  readonly requestedDocTypes: readonly string[];
  readonly occurredOn: string;
  readonly documentSupplied: boolean;
}

export interface AttemptView {
  readonly id: string;
  readonly attemptNo: number;
  readonly binding: AttemptBinding;
  readonly packName: string | null;
  readonly packVersion: number | null;
  readonly packChecksum: string | null;
  readonly selectedDocuments: number;
  readonly selectedDetails: number;
  readonly channel: AttemptChannel;
  readonly submittedOn: string;
  readonly fromSubmissionReport: boolean;
  /** The attempt itself rests on an attached document (still present). */
  readonly documentSupplied: boolean;
  /** Receipt: none recorded, reported, or reported with a document still present. */
  readonly receipt: 'NONE' | 'REPORTED' | 'DOCUMENT_SUPPLIED';
  readonly standing: AttemptStanding;
  /** Oldest first. */
  readonly events: readonly AttemptEventView[];
}

export interface OutcomeAttemptsView {
  /** False until the tables exist (the migration has not run yet). */
  readonly available: boolean;
  /** Oldest first. */
  readonly attempts: readonly AttemptView[];
  /** The person's own kept documents (latest version each, newest first) to attach as evidence. */
  readonly evidenceChoices: readonly { readonly versionId: string; readonly label: string }[];
  /** Submission reports of this case that are not attempts yet, oldest first. */
  readonly untrackedReports: readonly {
    readonly id: string;
    /** The day as the person entered it on the report (YYYY-MM-DD). */
    readonly submittedOn: string;
    readonly channel: string;
  }[];
}

function byOccurrence(a: EventRow, b: EventRow): number {
  return (
    (a.occurredOn < b.occurredOn ? -1 : a.occurredOn > b.occurredOn ? 1 : 0) ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/**
 * The standing of one attempt: its latest decision record, or Unknown when none exists. A reported
 * Pending is a decision record of its own. Nothing is inferred from the case's state.
 */
export function attemptStanding(
  events: readonly Pick<EventRow, 'kind' | 'decision' | 'occurredOn' | 'createdAt' | 'id'>[],
  presentEvidence: (event: (typeof events)[number]) => boolean,
): AttemptStanding {
  const decisions = events
    .filter((e) => e.kind === 'DECISION' && e.decision !== null)
    .sort((a, b) => byOccurrence(a as EventRow, b as EventRow));
  const latest = decisions.at(-1);
  if (!latest || latest.decision === null) return { kind: 'UNKNOWN' };
  return {
    kind: 'DECIDED',
    decision: latest.decision as AttemptDecision,
    occurredOn: latest.occurredOn,
    documentSupplied: presentEvidence(latest),
  };
}

/** Every attempt of one case with what followed it, for the case owner. */
export async function listOutcomeAttempts(
  proof: AuthorizedApplicant<'VIEW_METADATA'>,
  missionId: string,
): Promise<Result<OutcomeAttemptsView, ServiceError>> {
  const owned = ownerMission(proof, 'VIEW_METADATA', missionId);
  if (!owned.ok) return owned;
  const tx = proof.tx;
  const reports = await tx
    .select({
      id: schema.missionSubmissions.id,
      submittedAt: schema.missionSubmissions.submittedAt,
      channel: schema.missionSubmissions.channel,
    })
    .from(schema.missionSubmissions)
    .where(eq(schema.missionSubmissions.missionId, missionId))
    .orderBy(asc(schema.missionSubmissions.submittedAt), asc(schema.missionSubmissions.id));
  if (!(await outcomeTablesPresent(tx))) {
    return ok({
      available: false,
      attempts: [],
      evidenceChoices: [],
      untrackedReports: reports.map((r) => ({
        id: r.id,
        submittedOn: r.submittedAt.toISOString().slice(0, 10),
        channel: r.channel,
      })),
    });
  }
  const a = schema.umpeOutcomeAttempts;
  const attempts = await tx
    .select({
      attempt: a,
      packName: schema.packs.name,
      packVersion: schema.packVersions.version,
    })
    .from(a)
    .leftJoin(schema.packVersions, eq(schema.packVersions.id, a.packVersionId))
    .leftJoin(schema.packs, eq(schema.packs.id, schema.packVersions.packId))
    .where(and(eq(a.missionId, missionId), eq(a.applicantId, proof.applicant.id)))
    .orderBy(asc(a.attemptNo));
  const ids = attempts.map((r) => r.attempt.id);
  const events =
    ids.length === 0
      ? []
      : await tx
          .select()
          .from(schema.umpeOutcomeEvents)
          .where(
            and(
              inArray(schema.umpeOutcomeEvents.attemptId, ids),
              eq(schema.umpeOutcomeEvents.missionId, missionId),
            ),
          );
  const evidenceIds = [
    ...attempts.map((r) => r.attempt.evidenceDocumentVersionId),
    ...events.map((e) => e.evidenceDocumentVersionId),
  ].filter((id): id is string => id !== null);
  const present = await presentEvidenceVersions(tx, proof.applicant.id, evidenceIds);
  const supplied = (basis: string, id: string | null) =>
    basis === 'DOCUMENT_SUPPLIED' && id !== null && present.has(id);
  const tracked = new Set(attempts.map((r) => r.attempt.missionSubmissionId));
  const evidenceChoices = await latestOwnVersions(tx, proof.applicant.id);
  return ok({
    available: true,
    evidenceChoices,
    attempts: attempts.map(({ attempt, packName, packVersion }) => {
      const own = events.filter((e) => e.attemptId === attempt.id).sort(byOccurrence);
      const receipts = own.filter((e) => e.kind === 'AUTHORITY_RECEIPT');
      const attemptSupplied = supplied(attempt.evidenceBasis, attempt.evidenceDocumentVersionId);
      const receiptSupplied =
        attemptSupplied ||
        receipts.some((e) => supplied(e.evidenceBasis, e.evidenceDocumentVersionId));
      const selected = attempt.selectedVersions as {
        documentVersionIds?: unknown;
        factVersionIds?: unknown;
      } | null;
      return {
        id: attempt.id,
        attemptNo: attempt.attemptNo,
        binding: attempt.binding as AttemptBinding,
        packName: packName ?? null,
        packVersion: packVersion ?? null,
        packChecksum: attempt.packChecksum,
        selectedDocuments: Array.isArray(selected?.documentVersionIds)
          ? selected.documentVersionIds.length
          : 0,
        selectedDetails: Array.isArray(selected?.factVersionIds)
          ? selected.factVersionIds.length
          : 0,
        channel: attempt.channel as AttemptChannel,
        submittedOn: attempt.submittedOn,
        fromSubmissionReport: attempt.missionSubmissionId !== null,
        documentSupplied: attemptSupplied,
        receipt: receiptSupplied ? 'DOCUMENT_SUPPLIED' : receipts.length > 0 ? 'REPORTED' : 'NONE',
        standing: attemptStanding(own, (e) =>
          supplied((e as EventRow).evidenceBasis, (e as EventRow).evidenceDocumentVersionId),
        ),
        events: own.map((e) => ({
          id: e.id,
          kind: e.kind as AttemptEventKind,
          decision: (e.decision as AttemptDecision | null) ?? null,
          requestSource: (e.requestSource as AuthorityRequestSource | null) ?? null,
          requestedDocTypes: e.requestedDocTypes,
          occurredOn: e.occurredOn,
          documentSupplied: supplied(e.evidenceBasis, e.evidenceDocumentVersionId),
        })),
      } satisfies AttemptView;
    }),
    untrackedReports: reports
      .filter((r) => !tracked.has(r.id))
      .map((r) => ({
        id: r.id,
        submittedOn: r.submittedAt.toISOString().slice(0, 10),
        channel: r.channel,
      })),
  });
}

/** Which of these document versions still belong to this person and are not deleted. */
async function presentEvidenceVersions(
  tx: Db,
  applicantId: string,
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const lifecycle = await lifecycleTablesPresent(tx);
  const rows = await tx
    .select({ id: schema.documentVersions.id })
    .from(schema.documentVersions)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.documentVersions.documentId))
    .where(
      and(
        inArray(schema.documentVersions.id, [...new Set(ids)]),
        eq(schema.documents.applicantId, applicantId),
        lifecycle ? presentDocumentCondition() : undefined,
      ),
    );
  return new Set(rows.map((r) => r.id));
}

/** At most this many documents are offered as evidence. */
const EVIDENCE_CHOICE_LIMIT = 50;

/** The latest version of each of this person's kept documents, newest first. */
async function latestOwnVersions(
  tx: Db,
  applicantId: string,
): Promise<{ readonly versionId: string; readonly label: string }[]> {
  const lifecycle = await lifecycleTablesPresent(tx);
  const d = schema.documents;
  const v = schema.documentVersions;
  const rows = await tx
    .select({
      versionId: v.id,
      documentId: d.id,
      versionNumber: v.versionNumber,
      approvedName: d.approvedName,
      originalName: d.originalName,
      createdAt: d.createdAt,
    })
    .from(v)
    .innerJoin(d, eq(d.id, v.documentId))
    .where(
      and(
        eq(d.applicantId, applicantId),
        sql`${v.versionNumber} = (select max(${sql.raw('"dv2"."version_number"')}) from ${schema.documentVersions} as "dv2" where ${sql.raw('"dv2"."document_id"')} = ${d.id})`,
        lifecycle ? presentDocumentCondition() : undefined,
      ),
    )
    .orderBy(desc(d.createdAt), desc(d.id))
    .limit(EVIDENCE_CHOICE_LIMIT);
  return rows.map((r) => ({
    versionId: r.versionId,
    label: (r.approvedName ?? r.originalName).slice(0, 120),
  }));
}
