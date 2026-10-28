import { type Result, err, ok } from '@visastack/core';
import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  type AiCaseMode,
  type AiConnectionChoices,
  type AiConnectionDuration,
  aiConnectionExpiry,
  scopesFromChoices,
} from '../ai-connection-scopes';
import { appendAuditEvent } from '../audit';
import { type Db, first, schema } from '../db';
import { isMissingRelationError } from '../missing-relation';
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
 * - Audit: `AI_CONNECTION_REVOKED` and `AI_CONNECTION_CHANGED`, with ids and kinds only.
 * - Before the migration has run, the list is empty and marked unavailable; changes refuse.
 */

/** How far back "Recently Turned Off" looks. */
export const AI_RECENTLY_ENDED_MS = 30 * 24 * 60 * 60 * 1000;
const RECENTLY_ENDED_LIMIT = 10;
/** A record has a handful of connections at most; the list is bounded all the same. */
const LIST_LIMIT = 100;

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
  readonly active: readonly AiConnectionSummary[];
  /** Turned off or run out in the last 30 days, newest first, at most ten. */
  readonly recentlyEnded: readonly AiConnectionSummary[];
}

export type AiConnectionManageError =
  | { readonly code: 'not_owner' }
  | { readonly code: 'not_found' }
  | { readonly code: 'ended' }
  | { readonly code: 'case_not_on_record' }
  | { readonly code: 'step_up_required' }
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

async function ownedRows(owner: Owner, connectionId?: string) {
  return owner.tx
    .select({ connection: schema.aiConnections, caseTitle: schema.missions.title })
    .from(schema.aiConnections)
    .leftJoin(
      schema.missions,
      and(
        eq(schema.missions.id, schema.aiConnections.missionId),
        eq(schema.missions.applicantId, schema.aiConnections.applicantId),
      ),
    )
    .where(
      and(
        eq(schema.aiConnections.applicantId, owner.applicantId),
        eq(schema.aiConnections.accountId, owner.accountId),
        ...(connectionId ? [eq(schema.aiConnections.id, connectionId)] : []),
      ),
    )
    .orderBy(desc(schema.aiConnections.createdAt))
    .limit(LIST_LIMIT);
}

/**
 * Every connection of this record the owner can still act on (live and activated: a consent the
 * app never finished is not shown, it can never read anything), plus the recently ended ones.
 */
export async function listAiConnections(
  proof: AuthorizedApplicant<'VIEW_METADATA'>,
  options: { readonly now?: Date } = {},
): Promise<Result<AiConnectionList, AiConnectionManageError>> {
  const owner = ownerOf(proof);
  if (!owner) return err({ code: 'not_owner' });
  const now = options.now ?? new Date();
  try {
    const rows = await ownedRows(owner);
    const all = rows
      .filter((row) => row.connection.activatedAt !== null)
      .map((row) => summary(row.connection, row.caseTitle, now));
    const since = now.getTime() - AI_RECENTLY_ENDED_MS;
    return ok({
      available: true,
      active: all.filter((item) => item.endedAt === null),
      recentlyEnded: all
        .filter((item) => item.endedAt !== null && item.endedAt.getTime() >= since)
        .sort((a, b) => (b.endedAt?.getTime() ?? 0) - (a.endedAt?.getTime() ?? 0))
        .slice(0, RECENTLY_ENDED_LIMIT),
    });
  } catch (error) {
    if (isMissingRelationError(error))
      return ok({ available: false, active: [], recentlyEnded: [] });
    throw error;
  }
}

/** One live connection of this record, for the Change Access screen. */
export async function getAiConnection(
  proof: AuthorizedApplicant<'VIEW_METADATA'>,
  connectionId: string,
  options: { readonly now?: Date } = {},
): Promise<Result<AiConnectionSummary, AiConnectionManageError>> {
  const owner = ownerOf(proof);
  if (!owner) return err({ code: 'not_owner' });
  const now = options.now ?? new Date();
  try {
    const row = first(await ownedRows(owner, connectionId));
    if (!row || row.connection.activatedAt === null) return err({ code: 'not_found' });
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
 * off a connection that has already ended is a quiet success (`alreadyOff`), so a double click or
 * a second tab never shows an error; nothing is written or audited a second time.
 */
export async function turnOffAiConnection(
  proof: AuthorizedApplicant<'VIEW_METADATA'>,
  input: { readonly connectionId: string; readonly now?: Date },
): Promise<Result<{ readonly alreadyOff: boolean }, AiConnectionManageError>> {
  const owner = ownerOf(proof);
  if (!owner) return err({ code: 'not_owner' });
  const now = input.now ?? new Date();
  try {
    return await owner.tx.transaction(async (tx) => {
      const connection = await lockOwned(tx, owner, input.connectionId);
      if (!connection) return err({ code: 'not_found' } as const);
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

/** The Change Access choices: the consent choices, with "keep the current end" as a duration. */
export interface ChangeAiConnectionInput {
  readonly connectionId: string;
  readonly choices: Omit<AiConnectionChoices, 'duration'> & {
    readonly duration: AiConnectionDuration | 'keep';
  };
  /** Required only when Full Document Numbers goes from off to on. */
  readonly stepUp?: StepUpProof;
  readonly now?: Date;
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
  const now = input.now ?? new Date();
  try {
    return await owner.tx.transaction(async (tx) => {
      const connection = await lockOwned(tx, owner, input.connectionId);
      if (!connection || connection.activatedAt === null)
        return err({ code: 'not_found' } as const);
      if (endOf(connection, now).endedAt !== null) return err({ code: 'ended' } as const);
      if (
        choices.revealIdentifiers &&
        !connection.revealIdentifiers &&
        !StepUpProof.covers(input.stepUp, {
          accountId: owner.accountId,
          action: 'EXPORT_PROFILE',
          resourceId: owner.applicantId,
        })
      ) {
        return err({ code: 'step_up_required' } as const);
      }
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
      const scopes = scopesFromChoices(choices);
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
        },
      });
      return ok({ expiresAt });
    });
  } catch (error) {
    if (isMissingRelationError(error)) return err({ code: 'unavailable' });
    throw error;
  }
}
