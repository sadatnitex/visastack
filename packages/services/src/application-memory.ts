import { type PermissionAction, type Result, err, ok } from '@visastack/core';
import { type SQL, and, asc, count, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { AuthorizedApplicant } from './access';
import {
  isLiveGrant,
  listCaseExclusionsForApplicant,
  recipientKeyOf,
  recipientReachesCase,
} from './access/grant-scope';
import { type DeclarationComparison, compareAuthorizedFactVersions } from './consistency';
import { type Db, first, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { lifecycleTablesPresent } from './lifecycle/foundation/presence';
import { listCaseEvidenceIds } from './missions';
import { clampLimit } from './paging';
import type { KeyManagementPort } from './ports';

/**
 * v1.2 B08 (U06) Application Memory and the E03 prior-versus-current view
 * (WP-V3 part 3), built on what already exists and adding no storage:
 *
 * - The timeline reads the case records as they were written: snapshots
 *   (prepared packets), acknowledgements (the applicant's confirmation),
 *   case shares (handoffs), reported submissions and recorded outcomes.
 *   Prepared, confirmed and reported-submitted stay three different things;
 *   nothing here infers a submission from a snapshot or a download.
 * - "What changed" compares a snapshot's exact recorded versions with the
 *   current ones by id. It names details, documents and case fields, never
 *   their values, so it is safe inside an alert.
 * - A detail comparison goes through `compareAuthorizedFactVersions` with the
 *   snapshot's creation time as the prior side's as-of date. Values of
 *   sensitive or protected details are never returned here: the page learns
 *   that they differ and what kind of difference it is, not what they are.
 * - Resolution uses the existing review mechanisms: a new version of the
 *   detail (its note is kept as the saver's statement) and a new snapshot
 *   confirmed through the existing acknowledgement. Nothing here clears a
 *   result because someone wrote a note.
 *
 * Every function is owner only and takes a gate proof, so the access ratchet
 * (access/enforcement.test.ts) covers it.
 */

const NOT_AVAILABLE = 'That snapshot is not available.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ownerProof<A extends PermissionAction>(
  proof: AuthorizedApplicant<A>,
  action: A,
): Result<AuthorizedApplicant<A>, ServiceError> {
  if (!AuthorizedApplicant.isGenuine(proof, action) || proof.actor.kind !== 'applicant_owner') {
    return err(serviceError('forbidden', 'Only the owner of this record can see its history.'));
  }
  return ok(proof);
}

// --- Snapshot content, read defensively ------------------------------------
// `content` is jsonb written by `snapshotMission` (missions.ts). Older
// snapshots wrote `facts` as a plain field-to-value map with no version ids
// (see snapshots/[snapshotId]/snapshot-facts.ts); those cannot be compared
// exactly and are reported as such, never guessed.

interface SnapshotFact {
  readonly fieldKey: string;
  readonly factId: string;
  readonly factVersionId: string;
  readonly repeatingRecordKey: string | null;
}

interface SnapshotDocument {
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly docType: string | null;
}

interface ParsedSnapshot {
  /** False for an older snapshot that did not record exact versions. */
  readonly exact: boolean;
  readonly facts: readonly SnapshotFact[];
  readonly documents: readonly SnapshotDocument[];
  readonly evidenceScope: 'case_selected' | 'all_applicant_evidence';
  readonly record: RawSnapshotContent;
}

/** The keys read from snapshot content. Any of them may be missing or malformed. */
interface RawSnapshotContent {
  readonly facts?: unknown;
  readonly documents?: unknown;
  readonly evidenceScope?: unknown;
  readonly packVersion?: unknown;
  readonly manualMode?: unknown;
  readonly jurisdiction?: unknown;
  readonly serviceCategory?: unknown;
  readonly travelStartDate?: unknown;
  readonly travelEndDate?: unknown;
  readonly targetDeadline?: unknown;
}

/** The keys read from one fact, document or pack entry of a snapshot. */
interface RawSnapshotEntry {
  readonly id?: unknown;
  readonly fieldKey?: unknown;
  readonly factId?: unknown;
  readonly factVersionId?: unknown;
  readonly repeatingRecordKey?: unknown;
  readonly documentId?: unknown;
  readonly documentVersionId?: unknown;
  readonly docType?: unknown;
}

function asObject<T extends object>(value: unknown): T | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as T)
    : undefined;
}
const stringOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function parseSnapshot(content: unknown): ParsedSnapshot {
  const record = asObject<RawSnapshotContent>(content) ?? {};
  const rawFacts = record.facts;
  const rawDocuments = record.documents;
  const exact = Array.isArray(rawFacts);
  const facts: SnapshotFact[] = [];
  if (Array.isArray(rawFacts)) {
    for (const raw of rawFacts) {
      const entry = asObject<RawSnapshotEntry>(raw);
      if (!entry) continue;
      const fieldKey = stringOrNull(entry.fieldKey);
      const factId = stringOrNull(entry.factId);
      const factVersionId = stringOrNull(entry.factVersionId);
      if (!fieldKey || !factId || !factVersionId) continue;
      facts.push({
        fieldKey,
        factId,
        factVersionId,
        repeatingRecordKey: stringOrNull(entry.repeatingRecordKey),
      });
    }
  }
  const documents: SnapshotDocument[] = [];
  if (Array.isArray(rawDocuments)) {
    for (const raw of rawDocuments) {
      const entry = asObject<RawSnapshotEntry>(raw);
      if (!entry) continue;
      const documentId = stringOrNull(entry.documentId);
      const documentVersionId = stringOrNull(entry.documentVersionId);
      if (!documentId || !documentVersionId) continue;
      documents.push({ documentId, documentVersionId, docType: stringOrNull(entry.docType) });
    }
  }
  return {
    exact,
    facts,
    documents,
    evidenceScope:
      record.evidenceScope === 'all_applicant_evidence'
        ? 'all_applicant_evidence'
        : 'case_selected',
    record,
  };
}

// --- Timeline ---------------------------------------------------------------

export type MemoryEvent =
  | {
      readonly kind: 'prepared';
      /** The id of the record this event comes from; unique within its kind. */
      readonly id: string;
      readonly at: string;
      readonly snapshotId: string;
      readonly snapshotVersion: number;
    }
  | {
      readonly kind: 'confirmed' | 'correction_requested' | 'not_accepted';
      readonly id: string;
      readonly at: string;
      readonly snapshotId: string;
      readonly snapshotVersion: number | null;
      /** When a later change set this confirmation aside. Null while it still stands. */
      readonly setAsideAt: string | null;
    }
  | {
      readonly kind: 'shared';
      readonly id: string;
      readonly at: string;
      readonly recipientName: string | null;
      readonly recipientKind: 'organization' | 'person';
      readonly status: (typeof schema.grantStatus.enumValues)[number];
    }
  | {
      /** The date the person reported. VisaStack did not observe or make the submission. */
      readonly kind: 'reported_submitted';
      readonly id: string;
      readonly at: string;
      readonly recordedAt: string;
      readonly snapshotId: string;
      readonly snapshotVersion: number | null;
      readonly channel: (typeof schema.missionSubmissionChannel.enumValues)[number];
    }
  | {
      readonly kind: 'outcome';
      readonly id: string;
      /** The decision date as recorded. */
      readonly at: string;
      readonly recordedAt: string;
      readonly decision: (typeof schema.missionOutcomeDecision.enumValues)[number];
    };

export type MemoryShare = Extract<MemoryEvent, { kind: 'shared' }>;

export interface MemoryCase {
  readonly missionId: string;
  readonly title: string;
  readonly destination: string | null;
  readonly purpose: string | null;
  readonly agencyName: string | null;
  readonly state: (typeof schema.missionState.enumValues)[number];
  readonly createdAt: string;
  /** The case's records were removed after its keep period; only the case row remains. */
  readonly removed: boolean;
  /**
   * Who holds access to every case except this one: each recipient whose live
   * all-cases grant the owner excluded from this case (per-case sharing
   * exceptions, ADR 0017) and who has no other live grant reaching it, oldest
   * first, once per recipient. Revoked and expired grants are left out: they
   * reach nothing anyway.
   */
  readonly notSharedWith: readonly MemoryCaseException[];
  /** Oldest first; records with the same time keep a fixed order. */
  readonly events: readonly MemoryEvent[];
}

/** One all-cases grant that does not cover a case. */
export interface MemoryCaseException {
  readonly grantId: string;
  readonly recipientName: string | null;
  readonly recipientKind: 'organization' | 'person';
}

export interface ApplicationMemory {
  /** Shares of the record that are not tied to one case, oldest first. */
  readonly recordShares: readonly MemoryShare[];
  /** Most recent activity first. */
  readonly cases: readonly MemoryCase[];
  /** Every case of this person, when the read was limited (`limit`); `cases` may hold fewer. */
  readonly totalCases?: number;
}

export interface ApplicationMemoryOptions {
  /**
   * At most this many cases, the most recently active first (clamped to 1 to 100). Only those
   * cases' records are read, so a person with many cases still gets a bounded read. Left out,
   * every case is returned, as before.
   */
  readonly limit?: number;
}

/**
 * The `limit` most recently active cases of one person, in that order, with their agency's name:
 * the latest of the case's start and every record the timeline shows. These are the same moments
 * the full read sorts by (`lastActivity` in `getApplicationMemory`); a new kind of record on the
 * timeline must be added to both. Ties are settled by the earlier start and then the id, as the
 * full read settles them.
 */
async function mostRecentCases(db: Db, applicantId: string, limit: number) {
  const m = schema.missions;
  const latest = (column: SQL, table: SQL, missionColumn: SQL, extra?: SQL): SQL =>
    sql`(select max(${column}) from ${table} where ${missionColumn} = ${m.id}${extra ? sql` and ${extra}` : sql``})`;
  const lastActivity = sql`greatest(
    ${m.createdAt},
    ${latest(sql`${schema.missionSnapshots.createdAt}`, sql`${schema.missionSnapshots}`, sql`${schema.missionSnapshots.missionId}`)},
    ${latest(sql`${schema.acknowledgements.createdAt}`, sql`${schema.acknowledgements}`, sql`${schema.acknowledgements.missionId}`)},
    ${latest(sql`${schema.grants.createdAt}`, sql`${schema.grants}`, sql`${schema.grants.missionId}`, sql`${schema.grants.applicantId} = ${applicantId}`)},
    ${latest(sql`${schema.missionSubmissions.submittedAt}`, sql`${schema.missionSubmissions}`, sql`${schema.missionSubmissions.missionId}`)},
    ${latest(sql`${schema.missionOutcomes.decisionDate}`, sql`${schema.missionOutcomes}`, sql`${schema.missionOutcomes.missionId}`)}
  )`;
  const [rows, totals] = await Promise.all([
    db
      .select({ mission: m, agencyName: schema.organizations.name })
      .from(m)
      .leftJoin(schema.organizations, eq(schema.organizations.id, m.ownerOrganizationId))
      .where(eq(m.applicantId, applicantId))
      .orderBy(sql`${lastActivity} desc`, asc(m.createdAt), asc(m.id))
      .limit(limit),
    db.select({ total: count() }).from(m).where(eq(m.applicantId, applicantId)),
  ]);
  return { rows, total: Number(first(totals)?.total ?? 0) };
}

/** Within one moment, records keep the order a case lives through them. */
const EVENT_ORDER: Readonly<Record<MemoryEvent['kind'], number>> = {
  shared: 0,
  prepared: 1,
  confirmed: 2,
  correction_requested: 2,
  not_accepted: 2,
  reported_submitted: 3,
  outcome: 4,
};

interface Timed {
  readonly event: MemoryEvent;
  readonly sortAt: number;
}

function byTime(a: Timed, b: Timed): number {
  return (
    a.sortAt - b.sortAt ||
    EVENT_ORDER[a.event.kind] - EVENT_ORDER[b.event.kind] ||
    (a.event.id < b.event.id ? -1 : a.event.id > b.event.id ? 1 : 0)
  );
}

/**
 * Every case of one person with its prepared, confirmed, shared, reported and
 * decided records, plus the shares of the record that are not tied to a case.
 */
export async function getApplicationMemory(
  proof: AuthorizedApplicant<'VIEW_METADATA'>,
  options: ApplicationMemoryOptions = {},
): Promise<Result<ApplicationMemory, ServiceError>> {
  const owner = ownerProof(proof, 'VIEW_METADATA');
  if (!owner.ok) return owner;
  const db = proof.tx;
  const applicantId = proof.applicant.id;

  // A limited read picks its cases and reads only their records; the full read takes every case.
  const limit = options.limit === undefined ? null : clampLimit(options.limit, 10);
  const [ranked, everyCase, grants] = await Promise.all([
    limit === null ? Promise.resolve(null) : mostRecentCases(db, applicantId, limit),
    limit !== null
      ? Promise.resolve(null)
      : db
          .select({ mission: schema.missions, agencyName: schema.organizations.name })
          .from(schema.missions)
          .leftJoin(
            schema.organizations,
            eq(schema.organizations.id, schema.missions.ownerOrganizationId),
          )
          .where(eq(schema.missions.applicantId, applicantId))
          .orderBy(asc(schema.missions.createdAt), asc(schema.missions.id)),
    db
      .select({
        id: schema.grants.id,
        missionId: schema.grants.missionId,
        status: schema.grants.status,
        createdAt: schema.grants.createdAt,
        expiryAt: schema.grants.expiryAt,
        organizationName: schema.organizations.name,
        recipientOrganizationId: schema.grants.recipientOrganizationId,
        recipientAccountId: schema.grants.recipientAccountId,
        recipientEmail: schema.accounts.email,
      })
      .from(schema.grants)
      .leftJoin(
        schema.organizations,
        eq(schema.organizations.id, schema.grants.recipientOrganizationId),
      )
      .leftJoin(schema.accounts, eq(schema.accounts.id, schema.grants.recipientAccountId))
      .where(eq(schema.grants.applicantId, applicantId))
      .orderBy(asc(schema.grants.createdAt), asc(schema.grants.id)),
  ]);

  const missions = ranked ? ranked.rows : (everyCase ?? []);
  const counted = ranked ? { totalCases: ranked.total } : {};

  const shareOf = (g: (typeof grants)[number]): MemoryShare => {
    const isOrganization = g.recipientOrganizationId !== null;
    return {
      kind: 'shared',
      id: g.id,
      at: g.createdAt.toISOString(),
      recipientName: isOrganization ? (g.organizationName ?? null) : (g.recipientEmail ?? null),
      recipientKind: isOrganization ? 'organization' : 'person',
      status: g.status,
    };
  };
  const recordShares = grants.filter((g) => g.missionId === null).map(shareOf);

  // Per-case sharing exceptions, per RECIPIENT (ADR 0017 amendment): a case
  // is "not shared" with someone only when an exception on one of their live
  // all-cases grants hides it and none of their live grants reaches it.
  // Revoked and expired grants reach nothing, so they are never named.
  const now = new Date();
  const notSharedByMission = new Map<string, MemoryCaseException[]>();
  if (grants.some((g) => g.missionId === null && isLiveGrant(g, now))) {
    const exclusions = await listCaseExclusionsForApplicant(db, applicantId);
    const named = new Set<string>();
    for (const exclusion of exclusions) {
      const grant = grants.find((g) => g.id === exclusion.grantId);
      if (!grant || grant.missionId !== null || !isLiveGrant(grant, now)) continue;
      if (recipientReachesCase(grants, exclusions, grant, exclusion.missionId, now)) continue;
      const key = `${exclusion.missionId}:${recipientKeyOf(grant)}`;
      if (named.has(key)) continue;
      named.add(key);
      const share = shareOf(grant);
      const list = notSharedByMission.get(exclusion.missionId) ?? [];
      list.push({
        grantId: grant.id,
        recipientName: share.recipientName,
        recipientKind: share.recipientKind,
      });
      notSharedByMission.set(exclusion.missionId, list);
    }
  }

  const missionIds = missions.map((m) => m.mission.id);
  if (missionIds.length === 0) return ok({ recordShares, cases: [], ...counted });

  const [snapshots, acknowledgements, submissions, outcomes] = await Promise.all([
    db
      .select({
        id: schema.missionSnapshots.id,
        missionId: schema.missionSnapshots.missionId,
        version: schema.missionSnapshots.version,
        createdAt: schema.missionSnapshots.createdAt,
      })
      .from(schema.missionSnapshots)
      .where(inArray(schema.missionSnapshots.missionId, missionIds))
      .orderBy(asc(schema.missionSnapshots.createdAt), asc(schema.missionSnapshots.id)),
    db
      .select({
        id: schema.acknowledgements.id,
        missionId: schema.acknowledgements.missionId,
        snapshotId: schema.acknowledgements.snapshotId,
        decision: schema.acknowledgements.decision,
        invalidatedAt: schema.acknowledgements.invalidatedAt,
        createdAt: schema.acknowledgements.createdAt,
      })
      .from(schema.acknowledgements)
      .where(inArray(schema.acknowledgements.missionId, missionIds))
      .orderBy(asc(schema.acknowledgements.createdAt), asc(schema.acknowledgements.id)),
    db
      .select({
        id: schema.missionSubmissions.id,
        missionId: schema.missionSubmissions.missionId,
        snapshotId: schema.missionSubmissions.snapshotId,
        channel: schema.missionSubmissions.channel,
        submittedAt: schema.missionSubmissions.submittedAt,
        createdAt: schema.missionSubmissions.createdAt,
      })
      .from(schema.missionSubmissions)
      .where(inArray(schema.missionSubmissions.missionId, missionIds))
      .orderBy(asc(schema.missionSubmissions.submittedAt), asc(schema.missionSubmissions.id)),
    db
      .select({
        id: schema.missionOutcomes.id,
        missionId: schema.missionOutcomes.missionId,
        decision: schema.missionOutcomes.decision,
        decisionDate: schema.missionOutcomes.decisionDate,
        createdAt: schema.missionOutcomes.createdAt,
      })
      .from(schema.missionOutcomes)
      .where(inArray(schema.missionOutcomes.missionId, missionIds))
      .orderBy(asc(schema.missionOutcomes.decisionDate), asc(schema.missionOutcomes.id)),
  ]);

  const snapshotVersion = new Map(snapshots.map((s) => [s.id, s.version] as const));
  const eventsByMission = new Map<string, Timed[]>();
  const push = (missionId: string, event: MemoryEvent, sortAt: Date): void => {
    const list = eventsByMission.get(missionId) ?? [];
    list.push({ event, sortAt: sortAt.getTime() });
    eventsByMission.set(missionId, list);
  };

  for (const s of snapshots) {
    push(
      s.missionId,
      {
        kind: 'prepared',
        id: s.id,
        at: s.createdAt.toISOString(),
        snapshotId: s.id,
        snapshotVersion: s.version,
      },
      s.createdAt,
    );
  }
  for (const a of acknowledgements) {
    push(
      a.missionId,
      {
        kind:
          a.decision === 'ACKNOWLEDGED'
            ? 'confirmed'
            : a.decision === 'CORRECTION_REQUESTED'
              ? 'correction_requested'
              : 'not_accepted',
        id: a.id,
        at: a.createdAt.toISOString(),
        snapshotId: a.snapshotId,
        snapshotVersion: snapshotVersion.get(a.snapshotId) ?? null,
        setAsideAt: a.invalidatedAt?.toISOString() ?? null,
      },
      a.createdAt,
    );
  }
  for (const g of grants) {
    if (g.missionId !== null) push(g.missionId, shareOf(g), g.createdAt);
  }
  for (const s of submissions) {
    push(
      s.missionId,
      {
        kind: 'reported_submitted',
        id: s.id,
        at: s.submittedAt.toISOString(),
        recordedAt: s.createdAt.toISOString(),
        snapshotId: s.snapshotId,
        snapshotVersion: snapshotVersion.get(s.snapshotId) ?? null,
        channel: s.channel,
      },
      s.submittedAt,
    );
  }
  for (const o of outcomes) {
    push(
      o.missionId,
      {
        kind: 'outcome',
        id: o.id,
        at: o.decisionDate.toISOString(),
        recordedAt: o.createdAt.toISOString(),
        decision: o.decision,
      },
      o.decisionDate,
    );
  }

  const cases = missions.map(({ mission, agencyName }) => {
    const events = [...(eventsByMission.get(mission.id) ?? [])].sort(byTime);
    // The same moments `mostRecentCases` ranks by in SQL; keep the two in step.
    const lastActivity = Math.max(mission.createdAt.getTime(), ...events.map((e) => e.sortAt));
    return {
      lastActivity,
      value: {
        missionId: mission.id,
        title: mission.title,
        destination: mission.destination,
        purpose: mission.purpose,
        agencyName: agencyName ?? null,
        state: mission.state,
        createdAt: mission.createdAt.toISOString(),
        removed: mission.purgedAt !== null,
        notSharedWith: notSharedByMission.get(mission.id) ?? [],
        events: events.map((e) => e.event),
      } satisfies MemoryCase,
    };
  });
  if (ranked) {
    // A limited read keeps the order the cases were ranked in.
    const rank = new Map(ranked.rows.map((row, index) => [row.mission.id, index] as const));
    cases.sort(
      (a, b) =>
        (rank.get(a.value.missionId) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(b.value.missionId) ?? Number.MAX_SAFE_INTEGER),
    );
  } else {
    // Most recent first; the earlier (stable) order by creation settles a tie.
    cases.sort((a, b) => b.lastActivity - a.lastActivity);
  }
  return ok({ recordShares, cases: cases.map((c) => c.value), ...counted });
}

// --- What changed since a snapshot ------------------------------------------

/** Case fields a snapshot records and a later edit can change. */
export const CASE_DETAIL_FIELDS = [
  'requirementPack',
  'manualMode',
  'jurisdiction',
  'serviceCategory',
  'travelStartDate',
  'travelEndDate',
  'targetDeadline',
] as const;
export type CaseDetailField = (typeof CASE_DETAIL_FIELDS)[number];

export type MemoryChange =
  | {
      readonly kind: 'detail';
      /** `not_used`: still in the record, but this case no longer uses it. */
      readonly change: 'changed' | 'removed' | 'added' | 'not_used';
      readonly fieldKey: string;
      readonly repeatingRecordKey: string | null;
      readonly factId: string;
      /** The exact version the snapshot recorded. Null for a detail added since. */
      readonly priorFactVersionId: string | null;
      /** The version in use now. Null for a detail removed since. */
      readonly currentFactVersionId: string | null;
    }
  | {
      readonly kind: 'document';
      /**
       * `deleted`: taken out of the record, so the screen says Removed and nothing else about it:
       * in Recently Deleted, being removed securely, or gone for good. Only once the lifecycle
       * tables exist (migration 0113); before, a document gone for good reads `removed`.
       * `removed`: gone (before migration 0113), or its latest version failed, was refused or is
       * not safe.
       */
      readonly change: 'new_version' | 'replaced' | 'deleted' | 'removed' | 'added' | 'not_used';
      readonly documentId: string;
      readonly docType: string | null;
    }
  | { readonly kind: 'case'; readonly change: 'changed'; readonly caseField: CaseDetailField };

export interface SnapshotReview {
  /** The latest confirmation of this snapshot, if any. */
  readonly confirmedAt: string | null;
  /** When a later change set that confirmation aside. */
  readonly setAsideAt: string | null;
  /** A confirmation of a later snapshot of the same case that still stands. */
  readonly laterConfirmation: { readonly at: string; readonly snapshotVersion: number } | null;
}

export interface SnapshotChanges {
  readonly snapshot: {
    readonly id: string;
    readonly missionId: string;
    readonly missionTitle: string;
    readonly version: number;
    readonly takenAt: string;
    /** False for an older snapshot that did not record exact versions: no list can be given. */
    readonly exact: boolean;
  };
  readonly review: SnapshotReview;
  readonly changes: readonly MemoryChange[];
  /** Details in the snapshot whose version is still the one in use. */
  readonly unchangedDetailCount: number;
}

type SnapshotRow = typeof schema.missionSnapshots.$inferSelect;
type MissionRow = typeof schema.missions.$inferSelect;

/** A snapshot of one of this person's cases, or nothing: a foreign or unknown id gets the same answer. */
async function loadOwnedSnapshot(
  db: Db,
  applicantId: string,
  snapshotId: string,
  missionId?: string,
): Promise<{ snapshot: SnapshotRow; mission: MissionRow } | undefined> {
  if (!UUID.test(snapshotId)) return undefined;
  const row = first(
    await db
      .select({ snapshot: schema.missionSnapshots, mission: schema.missions })
      .from(schema.missionSnapshots)
      .innerJoin(schema.missions, eq(schema.missions.id, schema.missionSnapshots.missionId))
      .where(
        and(
          eq(schema.missionSnapshots.id, snapshotId),
          eq(schema.missions.applicantId, applicantId),
          ...(missionId ? [eq(schema.missions.id, missionId)] : []),
        ),
      )
      .limit(1),
  );
  return row;
}

async function reviewOf(db: Db, snapshot: SnapshotRow): Promise<SnapshotReview> {
  const rows = await db
    .select({
      snapshotId: schema.acknowledgements.snapshotId,
      invalidatedAt: schema.acknowledgements.invalidatedAt,
      createdAt: schema.acknowledgements.createdAt,
      snapshotVersion: schema.missionSnapshots.version,
    })
    .from(schema.acknowledgements)
    .innerJoin(
      schema.missionSnapshots,
      eq(schema.missionSnapshots.id, schema.acknowledgements.snapshotId),
    )
    .where(
      and(
        eq(schema.acknowledgements.missionId, snapshot.missionId),
        eq(schema.acknowledgements.decision, 'ACKNOWLEDGED'),
      ),
    )
    .orderBy(desc(schema.acknowledgements.createdAt));
  const own = rows.find((r) => r.snapshotId === snapshot.id);
  const later = rows.find(
    (r) =>
      r.snapshotId !== snapshot.id &&
      r.invalidatedAt === null &&
      r.snapshotVersion > snapshot.version,
  );
  return {
    confirmedAt: own?.createdAt.toISOString() ?? null,
    setAsideAt: own?.invalidatedAt?.toISOString() ?? null,
    laterConfirmation: later
      ? { at: later.createdAt.toISOString(), snapshotVersion: later.snapshotVersion }
      : null,
  };
}

const iso = (value: Date | null): string | null => value?.toISOString() ?? null;

/** The case fields as they are now, in the snapshot's own representation. */
function currentCaseFields(mission: MissionRow): Readonly<Record<CaseDetailField, unknown>> {
  return {
    requirementPack: mission.packVersionId,
    manualMode: mission.manualMode,
    jurisdiction: mission.jurisdiction,
    serviceCategory: mission.serviceCategory,
    travelStartDate: iso(mission.travelStartDate),
    travelEndDate: iso(mission.travelEndDate),
    targetDeadline: iso(mission.targetDeadline),
  };
}

/** The same fields as the snapshot recorded them. Undefined means the snapshot did not record it. */
function snapshotCaseFields(
  record: RawSnapshotContent,
): Readonly<Record<CaseDetailField, unknown>> {
  const pack = record.packVersion;
  return {
    requirementPack:
      pack === undefined ? undefined : stringOrNull(asObject<RawSnapshotEntry>(pack)?.id),
    manualMode: record.manualMode,
    jurisdiction: record.jurisdiction,
    serviceCategory: record.serviceCategory,
    travelStartDate: record.travelStartDate,
    travelEndDate: record.travelEndDate,
    targetDeadline: record.targetDeadline,
  };
}

/** A document version that can no longer be used: failed, refused or not safe. */
const UNUSABLE_PROCESSING: ReadonlySet<string> = new Set(['FAILED', 'REJECTED']);
const UNUSABLE_SAFETY: ReadonlySet<string> = new Set(['FAILED', 'QUARANTINED']);

/**
 * The snapshot against today's case. Today's case evidence comes from
 * `listCaseEvidenceIds`, the same rule the snapshot writer uses, and the two
 * sets are compared both ways: something in the case now that the snapshot
 * did not hold is added; something the snapshot held that the case no longer
 * uses is reported as such, so the list never undercounts.
 */
async function changesSince(
  proof: AuthorizedApplicant<'VIEW_METADATA'>,
  snapshot: SnapshotRow,
  mission: MissionRow,
): Promise<Result<SnapshotChanges, ServiceError>> {
  const db = proof.tx;
  const applicantId = proof.applicant.id;
  const parsed = parseSnapshot(snapshot.content);
  const review = await reviewOf(db, snapshot);
  const header = {
    id: snapshot.id,
    missionId: mission.id,
    missionTitle: mission.title,
    version: snapshot.version,
    takenAt: snapshot.createdAt.toISOString(),
    exact: parsed.exact,
  };
  if (!parsed.exact) return ok({ snapshot: header, review, changes: [], unchangedDetailCount: 0 });

  const today = await listCaseEvidenceIds(proof, mission.id);
  if (!today.ok) return today;
  const todayFacts = new Map(today.value.facts.map((f) => [f.factId, f]));
  const todayDocuments = new Map(today.value.documents.map((d) => [d.documentId, d]));

  const changes: MemoryChange[] = [];
  let unchangedDetailCount = 0;

  // Details the snapshot held.
  const snapshotFactIds = new Set(parsed.facts.map((f) => f.factId));
  const storedFacts =
    snapshotFactIds.size > 0
      ? await db
          .select({ id: schema.facts.id, currentVersionId: schema.facts.currentVersionId })
          .from(schema.facts)
          .where(
            and(
              eq(schema.facts.applicantId, applicantId),
              inArray(schema.facts.id, [...snapshotFactIds]),
            ),
          )
          .orderBy(asc(schema.facts.id))
      : [];
  const currentVersionByFact = new Map(storedFacts.map((f) => [f.id, f.currentVersionId]));
  for (const fact of parsed.facts) {
    const currentVersionId = currentVersionByFact.get(fact.factId) ?? null;
    const inCase = todayFacts.has(fact.factId);
    if (inCase && currentVersionId === fact.factVersionId) {
      unchangedDetailCount += 1;
      continue;
    }
    changes.push({
      kind: 'detail',
      change: currentVersionId === null ? 'removed' : inCase ? 'changed' : 'not_used',
      fieldKey: fact.fieldKey,
      repeatingRecordKey: fact.repeatingRecordKey,
      factId: fact.factId,
      priorFactVersionId: fact.factVersionId,
      currentFactVersionId: currentVersionId,
    });
  }
  // Details the case uses now that the snapshot did not hold.
  for (const fact of today.value.facts) {
    if (snapshotFactIds.has(fact.factId) || fact.factVersionId === null) continue;
    changes.push({
      kind: 'detail',
      change: 'added',
      fieldKey: fact.fieldKey,
      repeatingRecordKey: fact.repeatingRecordKey,
      factId: fact.factId,
      priorFactVersionId: null,
      currentFactVersionId: fact.factVersionId,
    });
  }

  // Documents the snapshot held.
  const snapshotDocumentIds = new Set(parsed.documents.map((d) => d.documentId));
  const storedDocuments =
    snapshotDocumentIds.size > 0
      ? await db
          .select({
            id: schema.documents.id,
            supersededByDocumentId: schema.documents.supersededByDocumentId,
          })
          .from(schema.documents)
          .where(
            and(
              eq(schema.documents.applicantId, applicantId),
              inArray(schema.documents.id, [...snapshotDocumentIds]),
            ),
          )
      : [];
  const versions =
    snapshotDocumentIds.size > 0
      ? await db
          .select({
            documentId: schema.documentVersions.documentId,
            id: schema.documentVersions.id,
            versionNumber: schema.documentVersions.versionNumber,
            processingStatus: schema.documentVersions.processingStatus,
            safetyStatus: schema.documentVersions.safetyStatus,
          })
          .from(schema.documentVersions)
          .where(inArray(schema.documentVersions.documentId, [...snapshotDocumentIds]))
      : [];
  const latestByDocument = new Map<string, (typeof versions)[number]>();
  for (const v of versions) {
    const existing = latestByDocument.get(v.documentId);
    if (!existing || v.versionNumber > existing.versionNumber)
      latestByDocument.set(v.documentId, v);
  }
  const storedById = new Map(storedDocuments.map((d) => [d.id, d]));
  // Deleted from the record (resource lifecycle): in Recently Deleted or being removed. Asked only
  // once the lifecycle tables exist; before that nothing can be deleted this way.
  const lifecycle = snapshotDocumentIds.size > 0 && (await lifecycleTablesPresent(db));
  const deletedIds = lifecycle
    ? new Set(
        (
          await db
            .select({ documentId: schema.documentLifecycle.documentId })
            .from(schema.documentLifecycle)
            .where(
              and(
                eq(schema.documentLifecycle.applicantId, applicantId),
                inArray(schema.documentLifecycle.documentId, [...snapshotDocumentIds]),
                isNotNull(schema.documentLifecycle.deletedAt),
              ),
            )
        ).map((row) => row.documentId),
      )
    : new Set<string>();
  const replacementIds = new Set<string>();
  for (const doc of parsed.documents) {
    const stored = storedById.get(doc.documentId);
    const latest = latestByDocument.get(doc.documentId);
    if (stored?.supersededByDocumentId) replacementIds.add(stored.supersededByDocumentId);
    const unusable =
      !stored ||
      !latest ||
      UNUSABLE_PROCESSING.has(latest.processingStatus) ||
      UNUSABLE_SAFETY.has(latest.safetyStatus);
    const inCase = todayDocuments.get(doc.documentId);
    const deleted = lifecycle && (!stored || deletedIds.has(doc.documentId));
    const change: Extract<MemoryChange, { kind: 'document' }>['change'] | null = deleted
      ? 'deleted'
      : unusable
        ? 'removed'
        : stored.supersededByDocumentId
          ? 'replaced'
          : !inCase
            ? 'not_used'
            : latest.id !== doc.documentVersionId
              ? 'new_version'
              : null;
    if (change) {
      changes.push({ kind: 'document', change, documentId: doc.documentId, docType: doc.docType });
    }
  }
  // Documents the case uses now that the snapshot did not hold (a replacement is already named).
  for (const doc of today.value.documents) {
    if (snapshotDocumentIds.has(doc.documentId) || replacementIds.has(doc.documentId)) continue;
    changes.push({
      kind: 'document',
      change: 'added',
      documentId: doc.documentId,
      docType: doc.docType,
    });
  }

  // Case fields the snapshot recorded. A field it did not record is not compared.
  const before = snapshotCaseFields(parsed.record);
  const now = currentCaseFields(mission);
  for (const field of CASE_DETAIL_FIELDS) {
    const recorded = before[field];
    if (recorded === undefined) continue;
    if ((recorded ?? null) !== (now[field] ?? null)) {
      changes.push({ kind: 'case', change: 'changed', caseField: field });
    }
  }

  return ok({ snapshot: header, review, changes, unchangedDetailCount });
}

/** What changed since one snapshot of this person's cases. Names only, never values. */
export async function listChangesSinceSnapshot(
  proof: AuthorizedApplicant<'VIEW_METADATA'>,
  snapshotId: string,
): Promise<Result<SnapshotChanges, ServiceError>> {
  const owner = ownerProof(proof, 'VIEW_METADATA');
  if (!owner.ok) return owner;
  const resource = proof.resource;
  const loaded = await loadOwnedSnapshot(
    proof.tx,
    proof.applicant.id,
    snapshotId,
    resource.kind === 'mission' ? resource.mission.id : undefined,
  );
  if (!loaded) return err(serviceError('not_found', NOT_AVAILABLE));
  return changesSince(proof, loaded.snapshot, loaded.mission);
}

export interface ChangesSinceConfirmed extends SnapshotChanges {
  readonly confirmedAt: string;
}

/**
 * What changed on one case since the applicant last confirmed it: the latest
 * confirmation's snapshot against now. Null when the case was never
 * confirmed. Needs a proof for the case itself.
 */
export async function listChangesSinceConfirmed(
  proof: AuthorizedApplicant<'VIEW_METADATA'>,
): Promise<Result<ChangesSinceConfirmed | null, ServiceError>> {
  const owner = ownerProof(proof, 'VIEW_METADATA');
  if (!owner.ok) return owner;
  const resource = proof.resource;
  if (resource.kind !== 'mission') {
    return err(serviceError('invalid', 'name the case to list its changes'));
  }
  const db = proof.tx;
  const latest = first(
    await db
      .select({
        snapshotId: schema.acknowledgements.snapshotId,
        createdAt: schema.acknowledgements.createdAt,
      })
      .from(schema.acknowledgements)
      .where(
        and(
          eq(schema.acknowledgements.missionId, resource.mission.id),
          eq(schema.acknowledgements.decision, 'ACKNOWLEDGED'),
        ),
      )
      .orderBy(desc(schema.acknowledgements.createdAt))
      .limit(1),
  );
  if (!latest) return ok(null);
  const loaded = await loadOwnedSnapshot(
    db,
    proof.applicant.id,
    latest.snapshotId,
    resource.mission.id,
  );
  if (!loaded) return ok(null);
  const changes = await changesSince(proof, loaded.snapshot, loaded.mission);
  if (!changes.ok) return changes;
  return ok({ ...changes.value, confirmedAt: latest.createdAt.toISOString() });
}

// --- One detail, then and now (E03) -----------------------------------------

export interface SnapshotDetailComparison {
  readonly snapshot: SnapshotChanges['snapshot'];
  readonly review: SnapshotReview;
  /** Values and saved notes are null on both sides when `valuesHidden` is true. */
  readonly comparison: DeclarationComparison;
  /**
   * A sensitive or protected detail: the kind of difference is shown, never the
   * values, and never the saved notes either (a note can repeat the value).
   */
  readonly valuesHidden: boolean;
  /** Whether a note was saved with each side, for when the note itself is hidden. */
  readonly notesSaved: { readonly prior: boolean; readonly current: boolean };
}

/**
 * Compare a detail exactly as one snapshot recorded it with the version in
 * use now. The version must be one the snapshot recorded; anything else gets
 * the same not-available answer.
 */
export async function compareSnapshotDetail(
  proof: AuthorizedApplicant<'MANAGE'>,
  input: {
    readonly snapshotId: string;
    readonly factVersionId: string;
    /** Needed to read a protected value for the comparison; the value itself is never returned. */
    readonly encryption?: KeyManagementPort;
  },
): Promise<Result<SnapshotDetailComparison, ServiceError>> {
  const owner = ownerProof(proof, 'MANAGE');
  if (!owner.ok) return owner;
  const db = proof.tx;
  const loaded = await loadOwnedSnapshot(db, proof.applicant.id, input.snapshotId);
  if (!loaded) return err(serviceError('not_found', NOT_AVAILABLE));
  const parsed = parseSnapshot(loaded.snapshot.content);
  const recorded = parsed.facts.find((f) => f.factVersionId === input.factVersionId);
  if (!recorded) return err(serviceError('not_found', 'That detail is not in this snapshot.'));

  const compared = await compareAuthorizedFactVersions(proof, {
    priorFactVersionId: recorded.factVersionId,
    // The declaration as of the moment the snapshot was taken.
    priorAsOf: loaded.snapshot.createdAt,
    ...(input.encryption ? { encryption: input.encryption } : {}),
  });
  if (!compared.ok) return compared;
  const comparison = compared.value;

  const [definition, versions] = await Promise.all([
    db
      .select({ sensitivity: schema.fieldDefinitions.sensitivity })
      .from(schema.fieldDefinitions)
      .where(eq(schema.fieldDefinitions.key, comparison.fieldKey))
      .limit(1),
    db
      .select({ protectedKeyVersion: schema.factVersions.protectedKeyVersion })
      .from(schema.factVersions)
      .where(
        inArray(schema.factVersions.id, [
          comparison.prior.factVersionId,
          comparison.current.factVersionId,
        ]),
      ),
  ]);
  const sensitivity = first(definition)?.sensitivity ?? 'STANDARD';
  const valuesHidden =
    sensitivity !== 'STANDARD' || versions.some((v) => v.protectedKeyVersion !== null);

  return ok({
    snapshot: {
      id: loaded.snapshot.id,
      missionId: loaded.mission.id,
      missionTitle: loaded.mission.title,
      version: loaded.snapshot.version,
      takenAt: loaded.snapshot.createdAt.toISOString(),
      exact: parsed.exact,
    },
    review: await reviewOf(db, loaded.snapshot),
    comparison: valuesHidden
      ? {
          ...comparison,
          prior: { ...comparison.prior, value: null, explanation: null },
          current: { ...comparison.current, value: null, explanation: null },
        }
      : comparison,
    valuesHidden,
    notesSaved: {
      prior: comparison.prior.explanation !== null && comparison.prior.explanation !== '',
      current: comparison.current.explanation !== null && comparison.current.explanation !== '',
    },
  });
}
