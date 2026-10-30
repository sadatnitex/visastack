import { type Result, err, ok } from '@visastack/core';
import { and, count, desc, eq, gt, gte, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { storeAiConnectionFiles } from '../ai-connection-files';
import {
  type AiCaseMode,
  type AiConnectionChoices,
  type AiConnectionDuration,
  aiConnectionExpiry,
  allowsSuggestions,
  scopesFromChoices,
} from '../ai-connection-scopes';
import { getAiFeatureState } from '../ai-feature-settings';
import { appendAuditEvent } from '../audit';
import { type Db, first, schema } from '../db';
import { isMissingRelationError } from '../missing-relation';
import { elapsedSeconds, recordProductEvent } from '../product-events';
import { AuthorizedApplicant } from './require-access';
import { StepUpProof } from './step-up-proof';

/**
 * The owner's own controls for AI connections (ADR 0021 sections 3 and 5, S15): see each live
 * connection on the Sharing page, turn one off, or change what it may read.
 *
 * - Only the record's owner, proven by the access gate (`AuthorizedApplicant` with the
 *   `applicant_owner` actor), as for `createAiConnection`. A share recipient or a forged proof is
 *   refused; a connection of another record or another account is "not found", never revealed.
 * - Turning off is immediate: `revoked_at` on the connection and on every one of its tokens, in
 *   one transaction. The AI gate looks the token and connection up on every call, so the very
 *   next call is refused.
 * - Changing access rewrites the stored choices, which are the authority; the next call uses
 *   them. Turning Full Document Numbers on needs the same fresh identity check as the consent
 *   screen (`EXPORT_PROFILE` on the record). Keeping it on, or turning it off, does not.
 * - How long: "keep" leaves the end as it is; any other choice counts from the moment of the
 *   change, so the owner may lengthen or shorten it. The owner is the authority over their own
 *   connection and could connect again for the same effect; the stored end still bounds every
 *   token at use time.
 * - Audit: `AI_CONNECTION_REVOKED` and `AI_CONNECTION_CHANGED`, with ids and kinds only. Turning
 *   off also records the `AI_CONNECTOR_REVOKED` product event (S16): no label, only how long the
 *   connection lived.
 * - Before the migration has run, the list is empty and marked unavailable; changes refuse.
 */

/** How far back "Recently Turned Off" looks. */
export const AI_RECENTLY_ENDED_MS = 30 * 24 * 60 * 60 * 1000;
const RECENTLY_ENDED_LIMIT = 10;
/**
 * A record has a handful of live connections; the live list is bounded all the same, and
 * `activeTotal` says how many there are, so the page can say "and N more" instead of dropping any.
 */
export const AI_ACTIVE_LIST_LIMIT = 50;

export const AI_CONNECTION_REVOKED_REASON = 'turned off by owner';

export interface AiConnectionSummary {
  readonly id: string;
  readonly clientName: string;
  readonly clientHost: string;
  /** When the person approved the connection. */
  readonly connectedAt: Date;
  /** The stored choices: layer keys, `document_list`, `document_text`. */
  readonly scopes: readonly string[];
  readonly caseMode: AiCaseMode;
  readonly missionId: string | null;
  /** The one case's title, when `caseMode` is `ONE` and the case still exists. */
  readonly caseTitle: string | null;
  readonly revealIdentifiers: boolean;
  /** `null`: until the person turns it off. */
  readonly expiresAt: Date | null;
  readonly lastUsedAt: Date | null;
  /** Set for an ended connection: when it was turned off, or when its time ran out. */
  readonly endedAt: Date | null;
  readonly endedBy: 'owner' | 'time' | 'other' | null;
}

export interface AiConnectionList {
  /** False while the tables do not exist yet: the list then says nothing either way. */
  readonly available: boolean;
  /** The newest live connections, at most `AI_ACTIVE_LIST_LIMIT`. */
  readonly active: readonly AiConnectionSummary[];
  /** How many live connections there are in all (more than `active` holds when capped). */
  readonly activeTotal: number;
  /** Turned off or run out in the last 30 days, newest first, at most ten. */
  readonly recentlyEnded: readonly AiConnectionSummary[];
}

export type AiConnectionManageError =
  | { readonly code: 'not_owner' }
  | { readonly code: 'not_found' }
  | { readonly code: 'ended' }
  | { readonly code: 'case_not_on_record' }
  | {
      readonly code: 'step_up_required';
      /** Which new choices need the fresh identity check (S20): one or both. */
      readonly needs?: readonly ('full_numbers' | 'original_files')[];
    }
  | { readonly code: 'invalid' }
  | { readonly code: 'unavailable' };

interface Owner {
  readonly tx: Db;
  readonly accountId: string;
  readonly applicantId: string;
}

/** The gate's proof that the signed-in person owns the record, or nothing. */
function ownerOf(proof: AuthorizedApplicant<'VIEW_METADATA'>): Owner | null {
  if (
    !AuthorizedApplicant.isGenuine(proof, 'VIEW_METADATA') ||
    proof.actor.kind !== 'applicant_owner' ||
    proof.resource.kind !== 'applicant' ||
    !proof.applicant.ownerAccountId
  ) {
    return null;
  }
  return {
    tx: proof.tx,
    accountId: proof.applicant.ownerAccountId,
    applicantId: proof.applicant.id,
  };
}

type ConnectionRow = typeof schema.aiConnections.$inferSelect;

function endOf(row: ConnectionRow, now: Date): Pick<AiConnectionSummary, 'endedAt' | 'endedBy'> {
  if (row.revokedAt) {
    return {
      endedAt: row.revokedAt,
      endedBy: row.revokedReason === AI_CONNECTION_REVOKED_REASON ? 'owner' : 'other',
    };
  }
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) {
    return { endedAt: row.expiresAt, endedBy: 'time' };
  }
  return { endedAt: null, endedBy: null };
}

function summary(row: ConnectionRow, caseTitle: string | null, now: Date): AiConnectionSummary {
  return {
    id: row.id,
    clientName: row.clientName,
    clientHost: row.clientHost,
    connectedAt: row.createdAt,
    scopes: [...row.scopes],
    caseMode: row.caseMode,
    missionId: row.missionId,
    caseTitle: row.caseMode === 'ONE' ? caseTitle : null,
    revealIdentifiers: row.revealIdentifiers,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    ...endOf(row, now),
  };
}

const missionJoin = () =>
  and(
    eq(schema.missions.id, schema.aiConnections.missionId),
    eq(schema.missions.applicantId, schema.aiConnections.applicantId),
  );

/** The owner's own finished connections of this record (a consent never finished reads nothing). */
const ownedFinished = (owner: Owner) =>
  and(
    eq(schema.aiConnections.applicantId, owner.applicantId),
    eq(schema.aiConnections.accountId, owner.accountId),
    isNotNull(schema.aiConnections.activatedAt),
  );

/** Live: not turned off and not past its end. */
const liveAt = (now: Date) =>
  and(
    isNull(schema.aiConnections.revokedAt),
    or(isNull(schema.aiConnections.expiresAt), gt(schema.aiConnections.expiresAt, now)),
  );

/** Ended since `since`: turned off then, or run out then without being turned off. */
const endedBetween = (since: Date, now: Date) =>
  or(
    gte(schema.aiConnections.revokedAt, since),
    and(
      isNull(schema.aiConnections.revokedAt),
      gte(schema.aiConnections.expiresAt, since),
      lte(schema.aiConnections.expiresAt, now),
    ),
  );

/**
 * Every live connection of this record (newest first, capped, with the full count), plus the
 * recently ended ones. Each list is filtered and limited in the database on its own, so old live
 * connections are never pushed out by newer ended ones.
 */
export async function listAiConnections(
  proof: AuthorizedApplicant<'VIEW_METADATA'>,
): Promise<Result<AiConnectionList, AiConnectionManageError>> {
  const owner = ownerOf(proof);
  if (!owner) return err({ code: 'not_owner' });
  const now = new Date();
  const since = new Date(now.getTime() - AI_RECENTLY_ENDED_MS);
  try {
    const select = () =>
      owner.tx
        .select({ connection: schema.aiConnections, caseTitle: schema.missions.title })
        .from(schema.aiConnections)
        .leftJoin(schema.missions, missionJoin());
    const [active, [total], ended] = await Promise.all([
      select()
        .where(and(ownedFinished(owner), liveAt(now)))
        .orderBy(desc(schema.aiConnections.createdAt))
        .limit(AI_ACTIVE_LIST_LIMIT),
      owner.tx
        .select({ value: count() })
        .from(schema.aiConnections)
        .where(and(ownedFinished(owner), liveAt(now))),
      select()
        .where(and(ownedFinished(owner), endedBetween(since, now)))
        .orderBy(
          desc(sql`coalesce(${schema.aiConnections.revokedAt}, ${schema.aiConnections.expiresAt})`),
        )
        .limit(RECENTLY_ENDED_LIMIT),
    ]);
    return ok({
      available: true,
      active: active.map((row) => summary(row.connection, row.caseTitle, now)),
      activeTotal: Number(total?.value ?? active.length),
      recentlyEnded: ended.map((row) => summary(row.connection, row.caseTitle, now)),
    });
  } catch (error) {
    if (isMissingRelationError(error)) {
      return ok({ available: false, active: [], activeTotal: 0, recentlyEnded: [] });
    }
    throw error;
  }
}

/** One live connection of this record. */
export async function getAiConnection(
  proof: AuthorizedApplicant<'VIEW_METADATA'>,
  connectionId: string,
): Promise<Result<AiConnectionSummary, AiConnectionManageError>> {
  const owner = ownerOf(proof);
  if (!owner) return err({ code: 'not_owner' });
  const now = new Date();
  try {
    const row = first(
      await owner.tx
        .select({ connection: schema.aiConnections, caseTitle: schema.missions.title })
        .from(schema.aiConnections)
        .leftJoin(schema.missions, missionJoin())
        .where(and(ownedFinished(owner), eq(schema.aiConnections.id, connectionId)))
        .limit(1),
    );
    if (!row) return err({ code: 'not_found' });
    const item = summary(row.connection, row.caseTitle, now);
    return item.endedAt === null ? ok(item) : err({ code: 'ended' });
  } catch (error) {
    if (isMissingRelationError(error)) return err({ code: 'unavailable' });
    throw error;
  }
}

/** Locks the owner's connection row for the rest of the transaction. */
async function lockOwned(tx: Db, owner: Owner, connectionId: string) {
  return first(
    await tx
      .select()
      .from(schema.aiConnections)
      .where(
        and(
          eq(schema.aiConnections.id, connectionId),
          eq(schema.aiConnections.applicantId, owner.applicantId),
          eq(schema.aiConnections.accountId, owner.accountId),
        ),
      )
      .limit(1)
      .for('update'),
  );
}

/**
 * Turn Off: ends the connection and every token it has, at once, in one transaction. Turning
 * off a connection that has already ended (turned off, or past its end) is a quiet success
 * (`alreadyOff`), so a double click or a second tab never shows an error; nothing is audited a
 * second time.
 */
export async function turnOffAiConnection(
  proof: AuthorizedApplicant<'VIEW_METADATA'>,
  input: { readonly connectionId: string },
): Promise<Result<{ readonly alreadyOff: boolean }, AiConnectionManageError>> {
  const owner = ownerOf(proof);
  if (!owner) return err({ code: 'not_owner' });
  // Always the real time, as in the access gate: a caller-chosen clock could decide liveness.
  const now = new Date();
  try {
    return await owner.tx.transaction(async (tx) => {
      const connection = await lockOwned(tx, owner, input.connectionId);
      if (!connection) return err({ code: 'not_found' } as const);
      // Already ended by time: it is off. Nothing is rewritten and nothing audited again.
      if (!connection.revokedAt && endOf(connection, now).endedAt !== null) {
        return ok({ alreadyOff: true });
      }
      // Tokens are cut off even when the connection already ended, so none is ever left live. A
      // refresh racing this one may still add a pair, but every use checks the connection's own
      // `revoked_at` first, so such a pair never works.
      await tx
        .update(schema.aiConnectionTokens)
        .set({ revokedAt: now })
        .where(
          and(
            eq(schema.aiConnectionTokens.connectionId, connection.id),
            isNull(schema.aiConnectionTokens.revokedAt),
          ),
        );
      if (connection.revokedAt) return ok({ alreadyOff: true });
      await tx
        .update(schema.aiConnections)
        .set({ revokedAt: now, revokedReason: AI_CONNECTION_REVOKED_REASON })
        .where(eq(schema.aiConnections.id, connection.id));
      // S16 telemetry, best effort (a savepoint that never throws): how long the connection lived.
      // Written before the audit record, so the audit lock is held only for the audit insert.
      await recordProductEvent(tx, {
        eventType: 'AI_CONNECTOR_REVOKED',
        accountId: owner.accountId,
        metricValue: elapsedSeconds(connection.createdAt, now),
        onceFor: connection.id,
      });
      await appendAuditEvent(tx, {
        eventType: 'AI_CONNECTION_REVOKED',
        actorAccountId: owner.accountId,
        method: 'MANUAL',
        result: 'ALLOWED',
        applicantId: owner.applicantId,
        resourceType: 'ai_connection',
        resourceId: connection.id,
        ...(connection.caseMode === 'ONE' && connection.missionId
          ? { missionId: connection.missionId }
          : {}),
        metadata: { reason: 'owner_turned_off' },
      });
      return ok({ alreadyOff: false });
    });
  } catch (error) {
    if (isMissingRelationError(error)) return err({ code: 'unavailable' });
    throw error;
  }
}

/** Carries the stored files' outcome out of a savepoint that is undone. */
class FilesUndone extends Error {
  constructor(readonly result: Awaited<ReturnType<typeof storeAiConnectionFiles>>) {
    super('ai connection files undone');
  }
}

/** The Change Access choices: the consent choices, with "keep the current end" as a duration. */
export interface ChangeAiConnectionInput {
  readonly connectionId: string;
  readonly choices: Omit<AiConnectionChoices, 'duration'> & {
    readonly duration: AiConnectionDuration | 'keep';
  };
  /** Required only when Full Document Numbers goes from off to on. */
  readonly stepUp?: StepUpProof;
}

/**
 * Change Access: stores the new choices on a live connection. They take effect on the app's next
 * call, because the AI gate reads the stored connection every time.
 */
export async function changeAiConnection(
  proof: AuthorizedApplicant<'VIEW_METADATA'>,
  input: ChangeAiConnectionInput,
): Promise<Result<{ readonly expiresAt: Date | null }, AiConnectionManageError>> {
  const owner = ownerOf(proof);
  if (!owner) return err({ code: 'not_owner' });
  const { choices } = input;
  if (choices.caseMode === 'ONE' && !choices.missionId) return err({ code: 'invalid' });
  // Always the real time: the new end counts from now, and liveness is never caller-chosen.
  const now = new Date();
  try {
    return await owner.tx.transaction(async (tx) => {
      const connection = await lockOwned(tx, owner, input.connectionId);
      if (!connection || connection.activatedAt === null)
        return err({ code: 'not_found' } as const);
      if (endOf(connection, now).endedAt !== null) return err({ code: 'ended' } as const);
      const recordStepUp = StepUpProof.covers(input.stepUp, {
        accountId: owner.accountId,
        action: 'EXPORT_PROFILE',
        resourceId: owner.applicantId,
      });
      const needsFullNumbers =
        choices.revealIdentifiers && !connection.revealIdentifiers && !recordStepUp;
      const missionId = choices.caseMode === 'ONE' ? (choices.missionId ?? null) : null;
      if (missionId) {
        const mission = first(
          await tx
            .select({ id: schema.missions.id })
            .from(schema.missions)
            .where(
              and(
                eq(schema.missions.id, missionId),
                eq(schema.missions.applicantId, owner.applicantId),
              ),
            )
            .limit(1),
        );
        if (!mission) return err({ code: 'case_not_on_record' } as const);
      }
      // While AI App Suggestions is off, "Suggest Changes" can be kept or removed, never added (S21).
      const hadSuggestions = allowsSuggestions(connection.scopes);
      const suggestChanges =
        choices.suggestChanges === true &&
        (hadSuggestions ||
          (await getAiFeatureState(tx, 'ai_app_suggestions', { proof })).available);
      const scopes = scopesFromChoices({ ...choices, suggestChanges });
      // "Original Files" (S20): a new Original needs the same fresh identity check as Full
      // Document Numbers. While AI App Original Files is off, ticked documents can be kept or
      // unticked, never added. Stored in a savepoint, undone when a check is still needed, so the
      // answer can name every choice that needs one and nothing is changed.
      const filesFeature = (await getAiFeatureState(tx, 'ai_app_original_files', { proof }))
        .available;
      let files: Awaited<ReturnType<typeof storeAiConnectionFiles>>;
      try {
        files = await tx.transaction(async (savepoint) => {
          const stored = await storeAiConnectionFiles(proof, savepoint, {
            connectionId: connection.id,
            files: choices.files,
            documentList: choices.documentList,
            featureAvailable: filesFeature,
            stepUpSatisfied: recordStepUp,
          });
          if (needsFullNumbers || !stored.ok) throw new FilesUndone(stored);
          return stored;
        });
      } catch (error) {
        if (!(error instanceof FilesUndone)) throw error;
        files = error.result;
      }
      const checks = [
        ...(needsFullNumbers ? (['full_numbers'] as const) : []),
        ...(!files.ok && files.error === 'step_up_required' ? (['original_files'] as const) : []),
      ];
      if (checks.length > 0) return err({ code: 'step_up_required', needs: checks } as const);
      if (!files.ok) return err({ code: 'not_owner' } as const);
      const expiresAt =
        choices.duration === 'keep'
          ? connection.expiresAt
          : aiConnectionExpiry(choices.duration, now);
      await tx
        .update(schema.aiConnections)
        .set({
          scopes,
          caseMode: choices.caseMode,
          missionId,
          revealIdentifiers: choices.revealIdentifiers,
          expiresAt,
        })
        .where(eq(schema.aiConnections.id, connection.id));
      await appendAuditEvent(tx, {
        eventType: 'AI_CONNECTION_CHANGED',
        actorAccountId: owner.accountId,
        method: 'MANUAL',
        result: 'ALLOWED',
        applicantId: owner.applicantId,
        resourceType: 'ai_connection',
        resourceId: connection.id,
        ...(missionId ? { missionId } : {}),
        metadata: {
          layers: scopes,
          caseMode: choices.caseMode,
          revealIdentifiers: choices.revealIdentifiers,
          duration: choices.duration,
          // Counts only, never which documents (S20).
          ...(files.value.files > 0
            ? { files: files.value.files, originalFiles: files.value.originals }
            : {}),
        },
      });
      return ok({ expiresAt });
    });
  } catch (error) {
    if (isMissingRelationError(error)) return err({ code: 'unavailable' });
    throw error;
  }
}
