/**
 * The exact saved value a traveller sent in answer to a detail (FIELD) evidence request, and the
 * decision made on it (migration 0135).
 *
 * Before this, a detail request kept only the id of the detail. A later edit therefore changed what
 * an accepted answer appeared to say, and an agency decision could not be tied to what the agency
 * had actually reviewed. Documents never had the gap: a send pins the exact version. A detail now
 * pins the same way, to the canonical immutable `fact_versions` row (there is no second fact
 * model): one row per send in `evidence_request_fact_submissions`, and a link from each decision to
 * the send it judged in `evidence_request_decision_fact_submissions`.
 *
 * The write side is called from `submitEvidenceResponse` and `decideEvidenceResponse` inside their
 * own locked transaction, so a pin and the state it belongs to commit together. The read side
 * never shows a value that was not recorded: an answer sent before this change has no reliable
 * version identity and is shown as exactly that ("the exact value sent was not recorded"), never
 * as the detail's current value and never as a guess at an earlier one.
 *
 * Until migration 0135 runs the code finds the tables missing, keeps the older flow and says the
 * exact value is not kept. `to_regclass` never raises, so a surrounding transaction is never
 * aborted; only "present" is remembered per database handle.
 */
import { type Result, err, ok } from '@visastack/core';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { AuthorizedApplicant } from './access/require-access';
import { type Db, first, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { evidenceAudienceOf } from './evidence-submissions';

const FIELD_PIN_TABLES = [
  'evidence_request_fact_submissions',
  'evidence_request_decision_fact_submissions',
] as const;

const present = new WeakSet<object>();

/** Both detail-pin tables (migration 0135) exist on this database. */
export async function evidenceFieldPinsPresent(db: Db): Promise<boolean> {
  if (present.has(db)) return true;
  const checks = FIELD_PIN_TABLES.map((t) => sql`to_regclass(${t}::text) is not null`);
  const rows = await db
    .select({ present: sql<boolean>`(${sql.join(checks, sql` and `)})` })
    .from(sql`(select 1) as probe`);
  const found = rows[0]?.present === true;
  if (found) present.add(db);
  return found;
}

/** The plain label for an answer recorded before the exact value was kept. */
export const LEGACY_FIELD_ANSWER_LABEL = 'Sent before the exact value was kept';

export type FieldSubmissionRecord = typeof schema.evidenceRequestFactSubmissions.$inferSelect;

/** What a send pinned, for the caller that is writing it. */
export interface FieldPin {
  readonly factId: string;
  readonly factVersionId: string;
  readonly fieldKey: string;
}

/**
 * Pin the version a send will carry: the detail's current saved version at this moment. The fact
 * row is locked first, so an edit that lands at the same moment either finishes before (and is what
 * is pinned) or waits until this send has committed; the pin is never a version that was already
 * replaced. When the screen names the version the person saw (`expectedVersionId`) and the detail
 * has moved on since, nothing is sent and the person is told the page is out of date.
 */
export async function pinFieldVersion(
  tx: Db,
  input: {
    readonly factId: string;
    readonly fieldKey: string;
    readonly expectedVersionId?: string;
  },
): Promise<Result<FieldPin, ServiceError>> {
  const fact = first(
    await tx
      .select({ currentVersionId: schema.facts.currentVersionId })
      .from(schema.facts)
      .where(eq(schema.facts.id, input.factId))
      .for('update'),
  );
  const current = fact?.currentVersionId ?? null;
  if (current === null) {
    return err(serviceError('invalid', 'this detail has no saved value to send yet'));
  }
  if (input.expectedVersionId !== undefined && input.expectedVersionId !== current) {
    return err(
      serviceError(
        'stale',
        'This detail changed after you opened the page. Refresh to see the value now saved, then send it.',
      ),
    );
  }
  return ok({ factId: input.factId, factVersionId: current, fieldKey: input.fieldKey });
}

/** The send that carries this retry key on this request, if there is one. */
export async function findFieldSubmissionByKey(
  tx: Db,
  requestId: string,
  idempotencyKey: string,
): Promise<FieldSubmissionRecord | undefined> {
  return first(
    await tx
      .select()
      .from(schema.evidenceRequestFactSubmissions)
      .where(
        and(
          eq(schema.evidenceRequestFactSubmissions.evidenceRequestId, requestId),
          eq(schema.evidenceRequestFactSubmissions.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1),
  );
}

/** Write one send: the next round of the request, pinned to the version and carrying the retry key. */
export async function recordFieldSubmission(
  tx: Db,
  input: {
    readonly requestId: string;
    readonly pin: FieldPin;
    readonly sentByAccountId: string;
    readonly grantIdAtSend: string | null;
    readonly idempotencyKey?: string;
  },
): Promise<FieldSubmissionRecord> {
  const last = first(
    await tx
      .select({ roundNo: schema.evidenceRequestFactSubmissions.roundNo })
      .from(schema.evidenceRequestFactSubmissions)
      .where(eq(schema.evidenceRequestFactSubmissions.evidenceRequestId, input.requestId))
      .orderBy(desc(schema.evidenceRequestFactSubmissions.roundNo))
      .limit(1),
  );
  const roundNo = (last?.roundNo ?? 0) + 1;
  const [row] = await tx
    .insert(schema.evidenceRequestFactSubmissions)
    .values({
      evidenceRequestId: input.requestId,
      roundNo,
      factId: input.pin.factId,
      factVersionId: input.pin.factVersionId,
      fieldKeyAtSend: input.pin.fieldKey,
      sentByAccountId: input.sentByAccountId,
      grantIdAtSend: input.grantIdAtSend,
      idempotencyKey: input.idempotencyKey ?? `auto:round-${roundNo}`,
    })
    .returning();
  if (!row) throw new Error('evidence fact submission was not written');
  return row;
}

/**
 * The detail send a reviewer would decide on now: the newest one, only while nobody has decided it
 * and the request still waits for a decision. Anything else is an older, already judged send.
 */
export async function waitingFieldSubmission(
  tx: Db,
  request: { readonly id: string; readonly status: string },
): Promise<FieldSubmissionRecord | undefined> {
  if (request.status !== 'RECEIVED' && request.status !== 'UNDER_REVIEW') return undefined;
  const latest = first(
    await tx
      .select()
      .from(schema.evidenceRequestFactSubmissions)
      .where(eq(schema.evidenceRequestFactSubmissions.evidenceRequestId, request.id))
      .orderBy(desc(schema.evidenceRequestFactSubmissions.roundNo))
      .limit(1),
  );
  if (!latest) return undefined;
  const decided = first(
    await tx
      .select({ decisionId: schema.evidenceRequestDecisionFactSubmissions.decisionId })
      .from(schema.evidenceRequestDecisionFactSubmissions)
      .where(eq(schema.evidenceRequestDecisionFactSubmissions.submissionId, latest.id))
      .limit(1),
  );
  return decided ? undefined : latest;
}

/** Tie a decision to the send it judged. One decision per send is also enforced by the database. */
export async function linkFieldDecision(
  tx: Db,
  decisionId: string,
  submissionId: string,
): Promise<void> {
  await tx
    .insert(schema.evidenceRequestDecisionFactSubmissions)
    .values({ decisionId, submissionId });
}

// ---------------------------------------------------------------------------------------------
// Reading

export type FieldAnswerState =
  | 'AWAITING_DECISION'
  | 'ACCEPTED'
  | 'NEEDS_REPLACEMENT'
  | 'CONTRADICTION'
  | 'CORRECTION_PROPOSED'
  /** The agency withdrew the request while this answer was still waiting. */
  | 'WITHDRAWN';

/** The exact saved version a send carried. */
export interface FieldAnswerVersion {
  readonly id: string;
  /** Which saved version of this detail it was, counting from 1 in the order they were saved. */
  readonly number: number;
  readonly savedAt: Date;
  /** The detail is stored protected: its value is never shown in this list. */
  readonly protected: boolean;
  /**
   * The value that was sent. Only the owner of the record sees it, and never for a protected
   * detail; an agency member gets the version's identity without the text.
   */
  readonly value: string | null;
  /** This version is still the one the detail uses now. */
  readonly stillCurrent: boolean;
}

export interface FieldAnswerRound {
  /** Null for an answer recorded before the exact value was kept. */
  readonly submissionId: string | null;
  readonly roundNo: number | null;
  /** `pinned`: the exact version is known. `legacy`: it was never recorded and is not guessed. */
  readonly precision: 'pinned' | 'legacy';
  readonly sentAt: Date | null;
  readonly state: FieldAnswerState;
  readonly decidedAt: Date | null;
  /** What the reviewer said, or null when nothing was said. */
  readonly reason: string | null;
  /** Null exactly when `precision` is `legacy`. */
  readonly version: FieldAnswerVersion | null;
}

export interface FieldAnswerHistory {
  /** False until migration 0135 ran: every answer is then shown as recorded before the value was kept. */
  readonly available: boolean;
  /** Oldest first. */
  readonly rounds: readonly FieldAnswerRound[];
  /** Shown beside any `legacy` round. */
  readonly legacyLabel: typeof LEGACY_FIELD_ANSWER_LABEL;
}

/**
 * Every answer on one detail request, oldest first, each with the exact saved version that was sent
 * and the decision made on it. Readable by the request's own traveller (with the sent value) and by
 * an active owner or admin of the asking agency that still holds a current grant for it (identity
 * of the version only). Anyone else, and any request that does not exist, get the same "not found".
 */
export async function readEvidenceFieldAnswer(
  access: AuthorizedApplicant<'MANAGE'>,
  input: { readonly requestId: string },
): Promise<Result<FieldAnswerHistory, ServiceError>> {
  const audience = await evidenceAudienceOf(access, input.requestId);
  if (!audience.ok) return audience;
  const { request, agency } = audience.value;
  if (request.kind !== 'FIELD') {
    return err(serviceError('not_found', 'evidence request not found'));
  }
  const db = access.tx;
  const available = await evidenceFieldPinsPresent(db);

  const decisions = await db
    .select({
      id: schema.evidenceRequestDecisions.id,
      outcome: schema.evidenceRequestDecisions.outcome,
      reason: schema.evidenceRequestDecisions.reason,
      decidedAt: schema.evidenceRequestDecisions.createdAt,
    })
    .from(schema.evidenceRequestDecisions)
    .where(eq(schema.evidenceRequestDecisions.evidenceRequestId, request.id))
    .orderBy(asc(schema.evidenceRequestDecisions.createdAt));

  const rounds: FieldAnswerRound[] = [];
  const linked = new Set<string>();
  if (available) {
    const sends = await db
      .select()
      .from(schema.evidenceRequestFactSubmissions)
      .where(eq(schema.evidenceRequestFactSubmissions.evidenceRequestId, request.id))
      .orderBy(asc(schema.evidenceRequestFactSubmissions.roundNo));
    const links = await db
      .select({
        submissionId: schema.evidenceRequestDecisionFactSubmissions.submissionId,
        decisionId: schema.evidenceRequestDecisionFactSubmissions.decisionId,
      })
      .from(schema.evidenceRequestDecisionFactSubmissions)
      .innerJoin(
        schema.evidenceRequestDecisions,
        eq(
          schema.evidenceRequestDecisions.id,
          schema.evidenceRequestDecisionFactSubmissions.decisionId,
        ),
      )
      .where(eq(schema.evidenceRequestDecisions.evidenceRequestId, request.id));
    const decisionOf = new Map(
      links.map((l) => [l.submissionId, decisions.find((d) => d.id === l.decisionId)]),
    );
    for (const l of links) linked.add(l.decisionId);

    const versions = await versionsOf(
      db,
      [...new Set(sends.map((s) => s.factId))],
      sends.map((s) => s.factVersionId),
    );
    for (const send of sends) {
      const decision = decisionOf.get(send.id);
      const state: FieldAnswerState = decision
        ? decision.outcome === 'CANCELLED'
          ? 'WITHDRAWN'
          : (decision.outcome as Exclude<FieldAnswerState, 'AWAITING_DECISION' | 'WITHDRAWN'>)
        : request.status === 'CANCELLED'
          ? 'WITHDRAWN'
          : 'AWAITING_DECISION';
      const version = versions.get(send.factVersionId);
      rounds.push({
        submissionId: send.id,
        roundNo: send.roundNo,
        precision: 'pinned',
        sentAt: send.sentAt,
        state,
        decidedAt: decision?.decidedAt ?? null,
        reason: decision?.reason ?? null,
        version: version
          ? {
              id: version.id,
              number: version.number,
              savedAt: version.savedAt,
              protected: version.protected,
              // The value is the owner's to read; an agency member gets the identity only.
              value: agency || version.protected ? null : version.value,
              stillCurrent: version.stillCurrent,
            }
          : null,
      });
    }
  }

  // Decisions with no pinned send behind them (made before the exact value was kept), and an answer
  // still waiting that was never pinned. They are listed as what they are, with no value at all.
  for (const d of decisions) {
    if (d.outcome === 'CANCELLED' || linked.has(d.id)) continue;
    rounds.push({
      submissionId: null,
      roundNo: null,
      precision: 'legacy',
      sentAt: null,
      state: d.outcome as Exclude<FieldAnswerState, 'AWAITING_DECISION' | 'WITHDRAWN'>,
      decidedAt: d.decidedAt,
      reason: d.reason,
      version: null,
    });
  }
  const waitingPinned = rounds.some(
    (r) => r.precision === 'pinned' && r.state === 'AWAITING_DECISION',
  );
  if (
    (request.status === 'RECEIVED' || request.status === 'UNDER_REVIEW') &&
    request.respondingFactId !== null &&
    !waitingPinned
  ) {
    rounds.push({
      submissionId: null,
      roundNo: null,
      precision: 'legacy',
      sentAt: request.respondedAt,
      state: 'AWAITING_DECISION',
      decidedAt: null,
      reason: null,
      version: null,
    });
  }
  return ok({ available, rounds, legacyLabel: LEGACY_FIELD_ANSWER_LABEL });
}

interface VersionFacts {
  readonly id: string;
  readonly number: number;
  readonly savedAt: Date;
  readonly protected: boolean;
  readonly value: string | null;
  readonly stillCurrent: boolean;
}

/** The pinned versions with their order among all saved versions of their detail, and whether current. */
async function versionsOf(
  db: Db,
  factIds: readonly string[],
  wanted: readonly string[],
): Promise<Map<string, VersionFacts>> {
  const out = new Map<string, VersionFacts>();
  if (factIds.length === 0) return out;
  const rows = await db
    .select({
      id: schema.factVersions.id,
      factId: schema.factVersions.factId,
      value: schema.factVersions.value,
      protectedKeyVersion: schema.factVersions.protectedKeyVersion,
      createdAt: schema.factVersions.createdAt,
    })
    .from(schema.factVersions)
    .where(inArray(schema.factVersions.factId, [...factIds]))
    .orderBy(asc(schema.factVersions.createdAt), asc(schema.factVersions.id));
  const facts = await db
    .select({ id: schema.facts.id, currentVersionId: schema.facts.currentVersionId })
    .from(schema.facts)
    .where(inArray(schema.facts.id, [...factIds]));
  const currentOf = new Map(facts.map((f) => [f.id, f.currentVersionId]));
  const counter = new Map<string, number>();
  const wantedSet = new Set(wanted);
  for (const row of rows) {
    const number = (counter.get(row.factId) ?? 0) + 1;
    counter.set(row.factId, number);
    if (!wantedSet.has(row.id)) continue;
    out.set(row.id, {
      id: row.id,
      number,
      savedAt: row.createdAt,
      protected: row.protectedKeyVersion !== null,
      value: row.value,
      stillCurrent: currentOf.get(row.factId) === row.id,
    });
  }
  return out;
}
