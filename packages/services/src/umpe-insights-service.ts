/**
 * UMPE P12 (O03 to O07): Field Insights, a restricted internal quality and coverage report.
 *
 * What it is: counts of what happened in VisaStack cases over a period, each with its own unit and
 * denominator, for platform quality staff (the existing FEEDBACK_VIEW permission, no new grant).
 * What it is not: an approval rate, a prediction, a reason for any decision, or an official rule.
 *
 * - The funnel keeps every stage separate: prepared is not submitted, Submitted to Agency is not
 *   Submitted to Authority, agency acceptance is not a visa decision, a reported decision is not a
 *   document-supported one, and an attempt with no decision record stays Unknown.
 * - Only counts and closed-vocabulary keys leave this module: no names, ids, emails, free text,
 *   file names, wording or values. Each count is protected by umpe-insights-suppression.ts.
 * - Deleted data never counts: a purged case (its attempts are removed with it), a person in Recently
 *   Deleted or erased, a deleted evidence document (the record falls back to reported) and removed
 *   guest files are left out at read time; nothing is copied into a store of its own.
 * - Tables added by later migrations are probed first; a missing one reads as no records.
 */
import { type Result, err, ok } from '@visastack/core';
import { resolveDocumentType } from '@visastack/core/catalogue';
import { type SQL, and, eq, gte, inArray, isNotNull, isNull, min, sql } from 'drizzle-orm';
import type { StaffScope } from './access';
import { staffScopeProblem } from './access/principal';
import { type Db, schema } from './db';
import type { ServiceError } from './errors';
import {
  lifecycleTablesPresent,
  presentApplicantCondition,
  presentDocumentCondition,
} from './lifecycle/foundation';
import {
  type Cell,
  type CountedRecord,
  EMPTY_TALLY,
  type InsightThresholds,
  clampThresholds,
  protect,
  protectGroup,
  tally,
} from './umpe-insights-suppression';
import { attemptStanding } from './umpe-outcome-service';
import {
  AUTHORITY_REQUEST_SOURCES,
  type AttemptDecision,
  outcomeTablesPresent,
} from './umpe-outcome-tables';

export const INSIGHT_PERIODS = [3, 6, 12, 24] as const;
export type InsightPeriod = (typeof INSIGHT_PERIODS)[number];

/** Funnel stages in order, each with its own unit. */
export const FUNNEL_STAGES = [
  { key: 'INVITED', unit: 'INVITATIONS' },
  { key: 'UPLOAD_STARTED', unit: 'PEOPLE' },
  { key: 'CASES_STARTED', unit: 'CASES' },
  { key: 'PREPARED', unit: 'CASES' },
  { key: 'SHARED', unit: 'CASES' },
  { key: 'SUBMITTED_TO_AGENCY', unit: 'AGENCY_SUBMISSIONS' },
  { key: 'ACCEPTED_BY_AGENCY', unit: 'AGENCY_SUBMISSIONS' },
  { key: 'REPORTED_TO_AUTHORITY', unit: 'ATTEMPTS' },
  { key: 'RECEIPT_DOCUMENT_SUPPLIED', unit: 'ATTEMPTS' },
  { key: 'PENDING', unit: 'ATTEMPTS' },
  { key: 'APPROVAL_RECORDED', unit: 'ATTEMPTS' },
  { key: 'APPROVAL_DOCUMENT_SUPPLIED', unit: 'ATTEMPTS' },
  { key: 'REFUSAL_RECORDED', unit: 'ATTEMPTS' },
  { key: 'REFUSAL_DOCUMENT_SUPPLIED', unit: 'ATTEMPTS' },
  { key: 'WITHDRAWN', unit: 'ATTEMPTS' },
  { key: 'CANCELLED', unit: 'ATTEMPTS' },
  { key: 'OTHER_DECISION', unit: 'ATTEMPTS' },
  { key: 'UNKNOWN', unit: 'ATTEMPTS' },
] as const;
export type FunnelStageKey = (typeof FUNNEL_STAGES)[number]['key'];
export type FunnelUnit = (typeof FUNNEL_STAGES)[number]['unit'];

export interface FieldInsightsReport {
  readonly generatedAt: string;
  readonly periodMonths: InsightPeriod;
  readonly from: string;
  readonly thresholds: InsightThresholds;
  readonly funnel: readonly {
    readonly key: FunnelStageKey;
    readonly unit: FunnelUnit;
    readonly cell: Cell;
  }[];
  /** Attempts reported to an authority (including older reports that are not attempts) and how many have no decision. */
  readonly missingOutcome: {
    readonly reported: Cell;
    readonly unknown: Cell;
    readonly pending: Cell;
  };
  /**
   * Attempts only: one measure per row, so no hidden count can be worked out from its row
   * (decisions per route would let Attempts minus Decided reveal a small Unknown).
   */
  readonly byRouteAndPeriod: readonly {
    /** The checklist's route or key, or null when the attempt has no checklist record. */
    readonly route: string | null;
    /** YYYY-Qn of the day it was sent. */
    readonly period: string;
    readonly attempts: Cell;
  }[];
  readonly authorityRequests: {
    readonly total: Cell;
    readonly bySource: readonly { readonly source: string; readonly cell: Cell }[];
    /** Most requested catalogue document kinds first (shown counts only). */
    readonly byDocType: readonly { readonly docType: string; readonly cell: Cell }[];
  };
  readonly correctionCauses: {
    readonly checklistSuggestions: readonly { readonly category: string; readonly cell: Cell }[];
    readonly agencyCorrectionRequests: Cell;
  };
  /** Document kinds an authority asked for that were not on the checklist the attempt used. */
  readonly coverageGaps: {
    readonly requestsCompared: Cell;
    readonly requestsWithoutChecklist: Cell;
    readonly byDocType: readonly { readonly docType: string; readonly cell: Cell }[];
  };
  readonly dataQuality: {
    readonly olderReportsNotAttempts: Cell;
    readonly attemptsWithoutPackageRecord: Cell;
    readonly caseDecisionsNotTiedToAttempt: Cell;
  };
}

// --- Table presence ----------------------------------------------------------

const presentCache = new WeakMap<object, Set<string>>();

async function present(db: Db, table: string): Promise<boolean> {
  const seen = presentCache.get(db) ?? new Set<string>();
  if (seen.has(table)) return true;
  const rows = await db
    .select({ found: sql<boolean>`to_regclass(${table}::text) is not null` })
    .from(sql`(select 1) as probe`);
  const found = rows[0]?.found === true;
  if (found) {
    seen.add(table);
    presentCache.set(db, seen);
  }
  return found;
}

// --- Helpers -------------------------------------------------------------------

/** One agency, or the person managing their own case. Never leaves this module. Built on call. */
function caseContributor() {
  const m = schema.missions;
  return sql<string>`coalesce(${m.ownerOrganizationId}::text, 'p:' || ${m.applicantId}::text)`;
}

/** The decision stage an attempt's standing counts in. */
const STAGE_FOR_DECISION: Readonly<Record<AttemptDecision, FunnelStageKey>> = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVAL_RECORDED',
  REFUSED: 'REFUSAL_RECORDED',
  WITHDRAWN: 'WITHDRAWN',
  CANCELLED: 'CANCELLED',
  OTHER: 'OTHER_DECISION',
};

/** The start of the period: the same day `months` back, clamped to the end of a shorter month. */
export function periodStart(now: Date, months: number): Date {
  const y = now.getUTCFullYear();
  const target = now.getUTCMonth() - months;
  const lastDay = new Date(Date.UTC(y, target + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      y,
      target,
      Math.min(now.getUTCDate(), lastDay),
      now.getUTCHours(),
      now.getUTCMinutes(),
      now.getUTCSeconds(),
    ),
  );
}

/** A present version of a kept document, as a SQL condition on `versionColumn`. */
function evidencePresentSql(versionColumn: SQL | ReturnType<typeof sql>, lifecycle: boolean) {
  const v = schema.documentVersions;
  const d = schema.documents;
  return sql<boolean>`exists (select 1 from ${v} inner join ${d} on ${d.id} = ${v.documentId} where ${v.id} = ${versionColumn}${lifecycle ? sql` and ${presentDocumentCondition()}` : sql``})`;
}

function quarterOf(day: string): string {
  const month = Number(day.slice(5, 7));
  return `${day.slice(0, 4)}-Q${Math.floor((month - 1) / 3) + 1}`;
}

function cellsByKey(
  records: readonly CountedRecord[],
  keys: readonly string[],
  t: InsightThresholds,
) {
  const tallies = tally(records);
  return protectGroup(
    keys.map((k) => tallies.get(k) ?? EMPTY_TALLY),
    t,
  );
}

/**
 * The most frequent shown counts, largest first. Hidden counts are left out entirely: listing them
 * in their true rank would place a hidden count between two shown ones.
 */
function rankedCells(records: readonly CountedRecord[], t: InsightThresholds, limit: number) {
  const shown: { key: string; cell: Cell; value: number }[] = [];
  for (const [key, value] of tally(records)) {
    const cell = protect(value, t);
    if (cell.shown && cell.value > 0) shown.push({ key, cell, value: cell.value });
  }
  shown.sort((a, b) => b.value - a.value || (a.key < b.key ? -1 : 1));
  return shown.slice(0, limit).map(({ key, cell }) => ({ key, cell }));
}

/**
 * The internal Field Insights report. Staff with FEEDBACK_VIEW only; a refusal looks the same
 * whatever the reason.
 */
export async function getFieldInsights(
  db: Db,
  staff: StaffScope<'FEEDBACK_VIEW'>,
  options: {
    readonly periodMonths?: number;
    readonly thresholds?: Partial<InsightThresholds>;
  } = {},
  now: Date = new Date(),
): Promise<Result<FieldInsightsReport, ServiceError>> {
  const denied = staffScopeProblem(staff, 'FEEDBACK_VIEW');
  if (denied) return err(denied);
  const periodMonths: InsightPeriod = (INSIGHT_PERIODS as readonly number[]).includes(
    options.periodMonths ?? 12,
  )
    ? ((options.periodMonths ?? 12) as InsightPeriod)
    : 12;
  const t = clampThresholds(options.thresholds);
  const fromAt = periodStart(now, periodMonths);
  const fromDay = fromAt.toISOString().slice(0, 10);

  const lifecycle = await lifecycleTablesPresent(db);
  const m = schema.missions;
  const contributor = caseContributor();
  /** The case still counts: not purged, and its person is not deleted or being removed. */
  const liveCase: SQL | undefined = and(
    isNull(m.purgedAt),
    lifecycle ? presentApplicantCondition() : undefined,
  );

  const records = new Map<FunnelStageKey, CountedRecord[]>(FUNNEL_STAGES.map((s) => [s.key, []]));
  const push = (stage: FunnelStageKey, contributor: string, person: string | null) => {
    records.get(stage)?.push({ cell: stage, contributor, person });
  };

  // Invited: client invitations and agency document request links.
  for (const r of await db
    .select({ org: schema.clientInvitations.organizationId })
    .from(schema.clientInvitations)
    .where(gte(schema.clientInvitations.createdAt, fromAt))) {
    push('INVITED', r.org, null);
  }
  if (
    (await present(db, 'agency_collection_links')) &&
    (await present(db, 'agency_collection_requests'))
  ) {
    for (const r of await db
      .select({ org: schema.agencyCollectionRequests.organizationId })
      .from(schema.agencyCollectionLinks)
      .innerJoin(
        schema.agencyCollectionRequests,
        eq(schema.agencyCollectionRequests.id, schema.agencyCollectionLinks.requestId),
      )
      .where(gte(schema.agencyCollectionLinks.createdAt, fromAt))) {
      push('INVITED', r.org, null);
    }
  }

  // Upload started: people whose first kept document arrived in the period, and guests whose first
  // kept file arrived in the period.
  const firstUpload = min(schema.documents.createdAt);
  for (const r of await db
    .select({ applicantId: schema.documents.applicantId, first: firstUpload })
    .from(schema.documents)
    .innerJoin(schema.applicants, eq(schema.applicants.id, schema.documents.applicantId))
    .where(
      and(
        lifecycle ? presentDocumentCondition() : undefined,
        lifecycle ? presentApplicantCondition() : undefined,
      ),
    )
    .groupBy(schema.documents.applicantId)
    .having(gte(firstUpload, fromAt))) {
    push('UPLOAD_STARTED', `p:${r.applicantId}`, r.applicantId);
  }
  if (await present(db, 'agency_collection_guest_files')) {
    const g = schema.agencyCollectionGuestFiles;
    const firstFile = min(g.createdAt);
    for (const r of await db
      .select({
        org: g.organizationId,
        request: g.requestId,
        recipient: g.recipientKey,
        first: firstFile,
      })
      .from(g)
      .where(isNull(g.removedAt))
      .groupBy(g.organizationId, g.requestId, g.recipientKey)
      .having(gte(firstFile, fromAt))) {
      push('UPLOAD_STARTED', r.org, `g:${r.request}:${r.recipient}`);
    }
  }

  // Cases started, prepared (first snapshot) and shared (first case grant) in the period.
  for (const r of await db
    .select({ contributor, applicantId: m.applicantId })
    .from(m)
    .innerJoin(schema.applicants, eq(schema.applicants.id, m.applicantId))
    .where(and(liveCase, gte(m.createdAt, fromAt)))) {
    push('CASES_STARTED', r.contributor, r.applicantId);
  }
  const firstSnapshot = min(schema.missionSnapshots.createdAt);
  for (const r of await db
    .select({ contributor, applicantId: m.applicantId, first: firstSnapshot })
    .from(m)
    .innerJoin(schema.applicants, eq(schema.applicants.id, m.applicantId))
    .innerJoin(schema.missionSnapshots, eq(schema.missionSnapshots.missionId, m.id))
    .where(liveCase)
    .groupBy(m.id, m.ownerOrganizationId, m.applicantId)
    .having(gte(firstSnapshot, fromAt))) {
    push('PREPARED', r.contributor, r.applicantId);
  }
  const firstGrant = min(schema.grants.createdAt);
  for (const r of await db
    .select({ contributor, applicantId: m.applicantId, first: firstGrant })
    .from(m)
    .innerJoin(schema.applicants, eq(schema.applicants.id, m.applicantId))
    .innerJoin(schema.grants, eq(schema.grants.missionId, m.id))
    .where(liveCase)
    .groupBy(m.id, m.ownerOrganizationId, m.applicantId)
    .having(gte(firstGrant, fromAt))) {
    push('SHARED', r.contributor, r.applicantId);
  }

  // Submitted to Agency (an agency received it; no authority did) and Accepted by Agency.
  if (await present(db, 'agency_collection_responses')) {
    const resp = schema.agencyCollectionResponses;
    for (const r of await db
      .select({ org: resp.organizationId, applicantId: resp.applicantId })
      .from(resp)
      .innerJoin(schema.applicants, eq(schema.applicants.id, resp.applicantId))
      .where(
        and(gte(resp.submittedAt, fromAt), lifecycle ? presentApplicantCondition() : undefined),
      )) {
      push('SUBMITTED_TO_AGENCY', r.org, r.applicantId);
    }
  }
  if (await present(db, 'agency_collection_guest_submissions')) {
    const gs = schema.agencyCollectionGuestSubmissions;
    for (const r of await db
      .select({ org: gs.organizationId, request: gs.requestId, recipient: gs.recipientKey })
      .from(gs)
      .where(gte(gs.submittedAt, fromAt))) {
      push('SUBMITTED_TO_AGENCY', r.org, `g:${r.request}:${r.recipient}`);
    }
  }
  let agencyCorrectionRecords: CountedRecord[] = [];
  if (await present(db, 'agency_collection_reviews')) {
    const rv = schema.agencyCollectionReviews;
    const resp = schema.agencyCollectionResponses;
    const gs = schema.agencyCollectionGuestSubmissions;
    const guestReady = await present(db, 'agency_collection_guest_submissions');
    const responsesReady = await present(db, 'agency_collection_responses');
    // Whose answer was reviewed: the signed-in person (left out while deleted or being removed),
    // or the guest's proved address key. Never leaves this function.
    const person = sql<
      string | null
    >`coalesce(${responsesReady ? sql`${resp.applicantId}::text` : sql`null`}, ${guestReady ? sql`'g:' || ${gs.requestId}::text || ':' || ${gs.recipientKey}` : sql`null`})`;
    let query = db
      .select({
        org: rv.organizationId,
        decision: rv.decision,
        target: sql<string>`coalesce(${rv.responseId}::text, ${rv.guestSubmissionId}::text)`,
        person,
      })
      .from(rv)
      .$dynamic();
    if (responsesReady) {
      query = query
        .leftJoin(resp, eq(resp.id, rv.responseId))
        .leftJoin(schema.applicants, eq(schema.applicants.id, resp.applicantId));
    }
    if (guestReady) query = query.leftJoin(gs, eq(gs.id, rv.guestSubmissionId));
    const reviews = await query.where(
      and(
        gte(rv.decidedAt, fromAt),
        responsesReady && lifecycle
          ? sql`(${rv.responseId} is null or ${presentApplicantCondition()})`
          : undefined,
      ),
    );
    const accepted = new Map<string, { org: string; person: string | null }>();
    const corrections = new Map<string, { org: string; person: string | null }>();
    for (const r of reviews) {
      if (r.decision === 'ACCEPTED') accepted.set(r.target, { org: r.org, person: r.person });
      if (r.decision === 'NEEDS_CORRECTION') {
        corrections.set(r.target, { org: r.org, person: r.person });
      }
    }
    for (const r of accepted.values()) push('ACCEPTED_BY_AGENCY', r.org, r.person ?? 'unknown');
    agencyCorrectionRecords = [...corrections.values()].map((r) => ({
      cell: 'AGENCY_CORRECTION',
      contributor: r.org,
      person: r.person ?? 'unknown',
    }));
  }

  // Attempts reported to an authority in the period (by the day sent), with what followed.
  const attemptRecords: {
    readonly contributor: string;
    readonly person: string;
    readonly route: string | null;
    readonly period: string;
    readonly packVersionId: string | null;
    readonly bound: boolean;
    readonly receiptSupplied: boolean;
    readonly decision: AttemptDecision | null;
    readonly decisionSupplied: boolean;
  }[] = [];
  const requestRecords: {
    readonly contributor: string;
    readonly person: string;
    readonly source: string;
    readonly docTypes: readonly string[];
    readonly packVersionId: string | null;
  }[] = [];
  const outcomesReady = await outcomeTablesPresent(db);
  if (outcomesReady) {
    const a = schema.umpeOutcomeAttempts;
    const e = schema.umpeOutcomeEvents;
    const attempts = await db
      .select({
        id: a.id,
        contributor,
        applicantId: a.applicantId,
        route: a.routeKey,
        submittedOn: a.submittedOn,
        packVersionId: a.packVersionId,
        binding: a.binding,
        supplied: sql<boolean>`(${a.evidenceBasis} = 'DOCUMENT_SUPPLIED' and ${evidencePresentSql(sql`${a.evidenceDocumentVersionId}`, lifecycle)})`,
      })
      .from(a)
      .innerJoin(m, eq(m.id, a.missionId))
      .innerJoin(schema.applicants, eq(schema.applicants.id, a.applicantId))
      .where(and(liveCase, gte(a.submittedOn, fromDay)));
    // What followed each attempt in the window, read by the same conditions (no id lists).
    const events = await db
      .select({
        attemptId: e.attemptId,
        kind: e.kind,
        decision: e.decision,
        occurredOn: e.occurredOn,
        createdAt: e.createdAt,
        id: e.id,
        supplied: sql<boolean>`(${e.evidenceBasis} = 'DOCUMENT_SUPPLIED' and ${evidencePresentSql(sql`${e.evidenceDocumentVersionId}`, lifecycle)})`,
      })
      .from(e)
      .innerJoin(a, eq(a.id, e.attemptId))
      .innerJoin(m, eq(m.id, a.missionId))
      .innerJoin(schema.applicants, eq(schema.applicants.id, a.applicantId))
      .where(and(liveCase, gte(a.submittedOn, fromDay)));
    const byAttempt = new Map<string, typeof events>();
    for (const ev of events) {
      const list = byAttempt.get(ev.attemptId) ?? [];
      list.push(ev);
      byAttempt.set(ev.attemptId, list);
    }
    for (const r of attempts) {
      const own = byAttempt.get(r.id) ?? [];
      const standing = attemptStanding(own, (ev) => (ev as (typeof own)[number]).supplied === true);
      attemptRecords.push({
        contributor: r.contributor,
        person: r.applicantId,
        route: r.route,
        period: quarterOf(r.submittedOn),
        packVersionId: r.packVersionId,
        bound: r.binding === 'PACKAGE_HANDOFF',
        receiptSupplied:
          r.supplied === true ||
          own.some((ev) => ev.kind === 'AUTHORITY_RECEIPT' && ev.supplied === true),
        decision: standing.kind === 'DECIDED' ? standing.decision : null,
        decisionSupplied: standing.kind === 'DECIDED' && standing.documentSupplied,
      });
    }
    // Authority requests recorded in the period, wherever their attempt falls.
    for (const r of await db
      .select({
        contributor,
        applicantId: e.applicantId,
        source: e.requestSource,
        docTypes: e.requestedDocTypes,
        packVersionId: a.packVersionId,
      })
      .from(e)
      .innerJoin(a, eq(a.id, e.attemptId))
      .innerJoin(m, eq(m.id, e.missionId))
      .innerJoin(schema.applicants, eq(schema.applicants.id, e.applicantId))
      .where(and(liveCase, eq(e.kind, 'AUTHORITY_REQUEST'), gte(e.occurredOn, fromDay)))) {
      requestRecords.push({
        contributor: r.contributor,
        person: r.applicantId,
        source: r.source ?? 'OTHER_AUTHORITY',
        docTypes: r.docTypes,
        packVersionId: r.packVersionId,
      });
    }
  }

  // Older submission reports that are not attempts: reported, decision unknown at attempt level.
  const s = schema.missionSubmissions;
  const olderReports = await db
    .select({ contributor, applicantId: m.applicantId })
    .from(s)
    .innerJoin(m, eq(m.id, s.missionId))
    .innerJoin(schema.applicants, eq(schema.applicants.id, m.applicantId))
    .where(
      and(
        liveCase,
        gte(s.submittedAt, fromAt),
        outcomesReady
          ? sql`not exists (select 1 from ${schema.umpeOutcomeAttempts} where ${schema.umpeOutcomeAttempts.missionSubmissionId} = ${s.id})`
          : undefined,
      ),
    );
  const caseDecisions = await db
    .select({ contributor, applicantId: m.applicantId })
    .from(schema.missionOutcomes)
    .innerJoin(m, eq(m.id, schema.missionOutcomes.missionId))
    .innerJoin(schema.applicants, eq(schema.applicants.id, m.applicantId))
    .where(
      and(
        liveCase,
        gte(schema.missionOutcomes.decisionDate, fromAt),
        outcomesReady
          ? sql`not exists (select 1 from ${schema.umpeOutcomeAttempts} where ${schema.umpeOutcomeAttempts.missionId} = ${m.id})`
          : undefined,
      ),
    );

  for (const r of attemptRecords) {
    push('REPORTED_TO_AUTHORITY', r.contributor, r.person);
    if (r.receiptSupplied) push('RECEIPT_DOCUMENT_SUPPLIED', r.contributor, r.person);
    push(r.decision === null ? 'UNKNOWN' : STAGE_FOR_DECISION[r.decision], r.contributor, r.person);
    if (r.decision === 'APPROVED' && r.decisionSupplied) {
      push('APPROVAL_DOCUMENT_SUPPLIED', r.contributor, r.person);
    }
    if (r.decision === 'REFUSED' && r.decisionSupplied) {
      push('REFUSAL_DOCUMENT_SUPPLIED', r.contributor, r.person);
    }
  }
  for (const r of olderReports) {
    push('REPORTED_TO_AUTHORITY', r.contributor, r.applicantId);
    push('UNKNOWN', r.contributor, r.applicantId);
  }

  // The funnel: every stage on its own, with the decision stages protected as one group (they add
  // up to Reported to Authority).
  const funnelTallies = new Map(
    FUNNEL_STAGES.map((stage) => [
      stage.key,
      tally(records.get(stage.key) ?? []).get(stage.key) ?? EMPTY_TALLY,
    ]),
  );
  const decisionKeys: FunnelStageKey[] = [
    'PENDING',
    'APPROVAL_RECORDED',
    'REFUSAL_RECORDED',
    'WITHDRAWN',
    'CANCELLED',
    'OTHER_DECISION',
    'UNKNOWN',
  ];
  const decisionCells = protectGroup(
    decisionKeys.map((k) => funnelTallies.get(k) ?? EMPTY_TALLY),
    t,
  );
  const funnelCell = (key: FunnelStageKey): Cell => {
    const index = decisionKeys.indexOf(key);
    if (index >= 0) return decisionCells[index] ?? { shown: false, reason: 'SMALL' };
    return protect(funnelTallies.get(key) ?? EMPTY_TALLY, t);
  };
  const funnel = FUNNEL_STAGES.map((stage) => ({
    key: stage.key,
    unit: stage.unit,
    cell: funnelCell(stage.key),
  }));

  // By route and period: attempts only, and only rows whose count is shown, so neither a hidden
  // count nor the existence of a rare route can be read from the table. Older reports have no
  // route or attempt record; they count only in the funnel.
  const rowKey = (route: string | null, period: string) => `${route ?? ''}\u0000${period}`;
  const rowKeys = [...new Set(attemptRecords.map((r) => rowKey(r.route, r.period)))].sort();
  const attemptsColumn = cellsByKey(
    attemptRecords.map((r) => ({
      cell: rowKey(r.route, r.period),
      contributor: r.contributor,
      person: r.person,
    })),
    rowKeys,
    t,
  );
  const hidden: Cell = { shown: false, reason: 'SMALL' };
  const byRouteAndPeriod = rowKeys.flatMap((key, i) => {
    const cell = attemptsColumn[i] ?? hidden;
    if (!cell.shown) return [];
    const [route, period] = key.split('\u0000');
    return [{ route: route ? route : null, period: period ?? '', attempts: cell }];
  });

  // Authority requests.
  const requestTotal = protect(
    tally(
      requestRecords.map((r) => ({ cell: 'ALL', contributor: r.contributor, person: r.person })),
    ).get('ALL') ?? EMPTY_TALLY,
    t,
  );
  const sources: readonly string[] = AUTHORITY_REQUEST_SOURCES;
  const sourceCells = cellsByKey(
    requestRecords.map((r) => ({ cell: r.source, contributor: r.contributor, person: r.person })),
    sources,
    t,
  );
  const docTypeRecords: CountedRecord[] = requestRecords.flatMap((r) =>
    r.docTypes.map((d) => ({ cell: d, contributor: r.contributor, person: r.person })),
  );

  // Checklist coverage: requested kinds that the attempt's own checklist did not list.
  const versionIds = [
    ...new Set(requestRecords.map((r) => r.packVersionId).filter((v): v is string => v !== null)),
  ];
  const listed = new Map<string, Set<string>>();
  if (versionIds.length > 0) {
    for (const r of await db
      .select({
        version: schema.packRequirements.packVersionId,
        docType: schema.packRequirements.docType,
      })
      .from(schema.packRequirements)
      .where(
        and(
          inArray(schema.packRequirements.packVersionId, versionIds),
          isNotNull(schema.packRequirements.docType),
        ),
      )) {
      const key = r.docType ? (resolveDocumentType(r.docType)?.key ?? r.docType) : null;
      if (!key) continue;
      const set = listed.get(r.version) ?? new Set<string>();
      set.add(key);
      listed.set(r.version, set);
    }
  }
  const compared: CountedRecord[] = [];
  const withoutChecklist: CountedRecord[] = [];
  const gapRecords: CountedRecord[] = [];
  for (const r of requestRecords) {
    if (!r.packVersionId) {
      withoutChecklist.push({ cell: 'ALL', contributor: r.contributor, person: r.person });
      continue;
    }
    compared.push({ cell: 'ALL', contributor: r.contributor, person: r.person });
    const onList = listed.get(r.packVersionId) ?? new Set<string>();
    for (const d of r.docTypes) {
      if (!onList.has(d))
        gapRecords.push({ cell: d, contributor: r.contributor, person: r.person });
    }
  }

  // Correction causes: checklist correction suggestions (P11 categories) and agency correction
  // requests (counted only; their words are never read).
  let suggestionRecords: CountedRecord[] = [];
  let categories: readonly string[] = [];
  if (await present(db, 'umpe_checklist_corrections')) {
    const c = schema.umpeChecklistCorrections;
    suggestionRecords = (
      await db
        .select({ category: c.category, org: c.organizationId, account: c.submittedByAccountId })
        .from(c)
        .where(gte(c.createdAt, fromAt))
    ).map((r) => ({
      cell: r.category,
      contributor: r.org ?? `a:${r.account ?? 'removed'}`,
      person: r.account,
    }));
    categories = [...new Set(suggestionRecords.map((r) => r.cell))].sort();
  }
  const suggestionCells = cellsByKey(suggestionRecords, categories, t);

  const one = (list: readonly { contributor: string; person: string | null }[]) =>
    protect(
      tally(list.map((r) => ({ cell: 'ALL', contributor: r.contributor, person: r.person }))).get(
        'ALL',
      ) ?? EMPTY_TALLY,
      t,
    );

  return ok({
    generatedAt: now.toISOString(),
    periodMonths,
    from: fromDay,
    thresholds: t,
    funnel,
    missingOutcome: {
      reported: funnelCell('REPORTED_TO_AUTHORITY'),
      unknown: funnelCell('UNKNOWN'),
      pending: funnelCell('PENDING'),
    },
    byRouteAndPeriod,
    authorityRequests: {
      total: requestTotal,
      bySource: sources.map((source, i) => ({ source, cell: sourceCells[i] ?? hidden })),
      byDocType: rankedCells(docTypeRecords, t, 15).map((r) => ({ docType: r.key, cell: r.cell })),
    },
    correctionCauses: {
      checklistSuggestions: categories.map((category, i) => ({
        category,
        cell: suggestionCells[i] ?? hidden,
      })),
      agencyCorrectionRequests: one(agencyCorrectionRecords),
    },
    coverageGaps: {
      requestsCompared: one(compared),
      requestsWithoutChecklist: one(withoutChecklist),
      byDocType: rankedCells(gapRecords, t, 15).map((r) => ({ docType: r.key, cell: r.cell })),
    },
    dataQuality: {
      olderReportsNotAttempts: one(
        olderReports.map((r) => ({ contributor: r.contributor, person: r.applicantId })),
      ),
      attemptsWithoutPackageRecord: one(attemptRecords.filter((r) => !r.bound)),
      caseDecisionsNotTiedToAttempt: one(
        caseDecisions.map((r) => ({ contributor: r.contributor, person: r.applicantId })),
      ),
    },
  });
}
