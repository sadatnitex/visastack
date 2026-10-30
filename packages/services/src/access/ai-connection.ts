import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { type Result, err, ok } from '@visastack/core';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  AI_CONNECTION_LAYERS,
  type AiConnectionChoices,
  aiConnectionExpiry,
  oauthScopeNames,
  scopesFromChoices,
} from '../ai-connection-scopes';
import { getAiFeatureState } from '../ai-feature-settings';
import { appendAuditEvent } from '../audit';
import { type Db, first, required, schema } from '../db';
import { isMissingRelationError } from '../missing-relation';
import { recordProductEvent } from '../product-events';
import { AuthorizedApplicant } from './require-access';
import { StepUpProof } from './step-up-proof';

/**
 * The token store behind AI connections (ADR 0021 sections 2 and 3). It lives with the access gate
 * because it decides who an AI app's request speaks for; it never reads anything from the record.
 *
 * - Tokens are 256-bit random values with a short type prefix, stored only as SHA-256 hashes.
 * - A code works once, for 60 seconds, and only with the client, return address, PKCE verifier
 *   and resource it was issued for. Presenting a used code again cuts off everything it led to.
 * - Access tokens last 60 minutes. Refresh tokens rotate on every use; reusing an old one cuts off
 *   the whole sign-in (its token family). No token works after its connection ends: every use
 *   checks the stored connection, whose end the owner can move.
 * - Revoking is immediate: every request looks its token up again.
 * - Error codes follow RFC 6749 (`invalid_grant` for a dead code or refresh token).
 */

export const AI_CODE_TTL_MS = 60 * 1000;
export const AI_ACCESS_TTL_MS = 60 * 60 * 1000;
/** A refresh token's own life. Rotation renews it; the connection's end is checked on every use. */
export const AI_REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** `last_used_at` is written at most this often. */
const LAST_USED_WRITE_GAP_MS = 60 * 1000;

const PREFIX = { CODE: 'vsc_code_', ACCESS: 'vsa_', REFRESH: 'vsr_' } as const;

/** RFC 7636: 43 to 128 unreserved characters. */
const VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;
/** An S256 challenge is the base64url SHA-256 of the verifier: always 43 characters. */
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

export type AiOAuthErrorCode =
  | 'invalid_request'
  | 'access_denied'
  | 'invalid_grant'
  | 'invalid_client'
  | 'invalid_target'
  | 'temporarily_unavailable';

export interface AiOAuthError {
  readonly error: AiOAuthErrorCode;
  /** Plain, for the app's developer; never a token, value or internal detail. */
  readonly description: string;
}

export interface AiTokenSet {
  readonly access_token: string;
  readonly token_type: 'Bearer';
  readonly expires_in: number;
  readonly refresh_token: string;
  readonly scope: string;
}

function oauthError(error: AiOAuthErrorCode, description: string): AiOAuthError {
  return { error, description };
}

const UNAVAILABLE = oauthError(
  'temporarily_unavailable',
  'AI connections are not available yet. Try again later.',
);

export function hashAiToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

function newToken(kind: keyof typeof PREFIX): string {
  return `${PREFIX[kind]}${randomBytes(32).toString('base64url')}`;
}

/** Constant-time comparison of two strings of possibly different length. */
function sameText(a: string, b: string): boolean {
  const left = createHash('sha256').update(a, 'utf8').digest();
  const right = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(left, right) && a.length === b.length;
}

/** RFC 7636 S256: BASE64URL(SHA256(ASCII(verifier))) must equal the challenge. */
export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!VERIFIER_RE.test(verifier) || !CHALLENGE_RE.test(challenge)) return false;
  return sameText(createHash('sha256').update(verifier, 'ascii').digest('base64url'), challenge);
}

type ConnectionRow = typeof schema.aiConnections.$inferSelect;

/** Alive: activated or about to be, not turned off, not past its end. */
function connectionAlive(connection: ConnectionRow, now: Date): boolean {
  if (connection.revokedAt) return false;
  return connection.expiresAt === null || connection.expiresAt.getTime() > now.getTime();
}

/**
 * A token's own life. It is not cut to the connection's end: every use checks the stored
 * connection (`connectionAlive`) first, so a token stops the moment its connection ends, and an
 * end the owner moves later (Change Access) is honoured without reissuing anything.
 */
function refreshExpiry(now: Date): Date {
  return new Date(now.getTime() + AI_REFRESH_TTL_MS);
}

function accessExpiry(now: Date): Date {
  return new Date(now.getTime() + AI_ACCESS_TTL_MS);
}

async function insertToken(
  tx: Db,
  values: {
    readonly connectionId: string;
    readonly kind: keyof typeof PREFIX;
    readonly familyId: string;
    readonly resource: string;
    readonly expiresAt: Date;
    readonly codeChallenge?: string;
    readonly redirectUri?: string;
  },
): Promise<string> {
  const raw = newToken(values.kind);
  await tx.insert(schema.aiConnectionTokens).values({
    connectionId: values.connectionId,
    kind: values.kind,
    tokenHash: hashAiToken(raw),
    familyId: values.familyId,
    resource: values.resource,
    expiresAt: values.expiresAt,
    codeChallenge: values.codeChallenge ?? null,
    redirectUri: values.redirectUri ?? null,
  });
  return raw;
}

async function issueTokenPair(
  tx: Db,
  connection: ConnectionRow,
  familyId: string,
  resource: string,
  now: Date,
): Promise<AiTokenSet> {
  const accessExpires = accessExpiry(now);
  const access = await insertToken(tx, {
    connectionId: connection.id,
    kind: 'ACCESS',
    familyId,
    resource,
    expiresAt: accessExpires,
  });
  const refresh = await insertToken(tx, {
    connectionId: connection.id,
    kind: 'REFRESH',
    familyId,
    resource,
    expiresAt: refreshExpiry(now),
  });
  return {
    access_token: access,
    token_type: 'Bearer',
    expires_in: Math.max(1, Math.floor((accessExpires.getTime() - now.getTime()) / 1000)),
    refresh_token: refresh,
    scope: [...oauthScopeNames(connection.scopes), 'offline_access'].join(' '),
  };
}

/**
 * Serialises everything that issues or revokes tokens in one sign-in, so a revocation that
 * overlaps a refresh always sees, and revokes, the pair the refresh created.
 */
async function lockFamily(tx: Db, familyId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ai-family:${familyId}`}))`);
}

async function revokeFamily(tx: Db, familyId: string, now: Date): Promise<void> {
  await tx
    .update(schema.aiConnectionTokens)
    .set({ revokedAt: now })
    .where(
      and(
        eq(schema.aiConnectionTokens.familyId, familyId),
        isNull(schema.aiConnectionTokens.revokedAt),
      ),
    );
}

/** Runs `work`, reporting "not available yet" while the migration has not run. */
async function tolerateMissingTables<T>(
  work: () => Promise<Result<T, AiOAuthError>>,
): Promise<Result<T, AiOAuthError>> {
  try {
    return await work();
  } catch (error) {
    if (isMissingRelationError(error)) return err(UNAVAILABLE);
    throw error;
  }
}

export interface AiClientIdentity {
  readonly clientId: string;
  /** As the app names itself, already cleaned for display. */
  readonly clientName: string;
  /** The host the person was shown on the consent screen. */
  readonly clientHost: string;
}

export interface CreateAiConnectionInput {
  readonly client: AiClientIdentity;
  readonly choices: AiConnectionChoices;
  /** The code's binding: exactly what the app sent to the authorization endpoint. */
  readonly codeChallenge: string;
  readonly redirectUri: string;
  readonly resource: string;
  /**
   * Required when `choices.revealIdentifiers` is on: a fresh identity check for exporting this
   * record (`EXPORT_PROFILE` on the record), the same proof the composer asks for before it shows
   * a full number. Without it full numbers are refused, whatever the screen sent.
   */
  readonly stepUp?: StepUpProof;
  readonly now?: Date;
}

/**
 * The person approved the consent screen: store the connection (inactive until the app exchanges
 * its code) and return a single-use code. Takes the gate's proof that the signed-in person owns
 * the record; a recipient of a share can never connect somebody else's record.
 */
export async function createAiConnection(
  proof: AuthorizedApplicant<'VIEW_METADATA'>,
  input: CreateAiConnectionInput,
): Promise<Result<{ readonly connectionId: string; readonly code: string }, AiOAuthError>> {
  if (
    !AuthorizedApplicant.isGenuine(proof, 'VIEW_METADATA') ||
    proof.actor.kind !== 'applicant_owner' ||
    proof.resource.kind !== 'applicant'
  ) {
    return err(oauthError('invalid_request', 'only the owner of a record can connect it'));
  }
  if (!CHALLENGE_RE.test(input.codeChallenge)) {
    return err(oauthError('invalid_request', 'a valid S256 code_challenge is required'));
  }
  const { choices } = input;
  if (
    choices.revealIdentifiers &&
    !StepUpProof.covers(input.stepUp, {
      accountId: proof.applicant.ownerAccountId ?? '',
      action: 'EXPORT_PROFILE',
      resourceId: proof.applicant.id,
    })
  ) {
    return err(oauthError('access_denied', 'full document numbers need a fresh identity check'));
  }
  if (choices.caseMode === 'ONE' && !choices.missionId) {
    return err(oauthError('invalid_request', 'choose the case to connect'));
  }
  const now = input.now ?? new Date();
  const tx = proof.tx;
  const ownerAccountId = proof.applicant.ownerAccountId;
  if (!ownerAccountId) {
    return err(oauthError('invalid_request', 'only the owner of a record can connect it'));
  }
  return tolerateMissingTables(async () => {
    if (choices.caseMode === 'ONE' && choices.missionId) {
      const mission = first(
        await tx
          .select({ id: schema.missions.id })
          .from(schema.missions)
          .where(
            and(
              eq(schema.missions.id, choices.missionId),
              eq(schema.missions.applicantId, proof.applicant.id),
            ),
          )
          .limit(1),
      );
      if (!mission) return err(oauthError('invalid_request', 'that case is not on this record'));
    }
    // "Suggest Changes" is stored only while AI App Suggestions works for this person (S21): a
    // crafted request can never add it while the feature is off.
    const suggestionsOn =
      choices.suggestChanges === true &&
      (await getAiFeatureState(tx, 'ai_app_suggestions', { proof })).available;
    const scopes = scopesFromChoices({ ...choices, suggestChanges: suggestionsOn });
    const expiresAt = aiConnectionExpiry(choices.duration, now);
    const connection = required(
      first(
        await tx
          .insert(schema.aiConnections)
          .values({
            accountId: ownerAccountId,
            applicantId: proof.applicant.id,
            clientId: input.client.clientId,
            clientName: input.client.clientName,
            clientHost: input.client.clientHost,
            scopes,
            caseMode: choices.caseMode,
            missionId: choices.caseMode === 'ONE' ? (choices.missionId ?? null) : null,
            revealIdentifiers: choices.revealIdentifiers,
            expiresAt,
            createdAt: now,
          })
          .returning(),
      ),
      'ai connection',
    );
    const code = await insertToken(tx, {
      connectionId: connection.id,
      kind: 'CODE',
      familyId: randomUUID(),
      resource: input.resource,
      expiresAt: new Date(now.getTime() + AI_CODE_TTL_MS),
      codeChallenge: input.codeChallenge,
      redirectUri: input.redirectUri,
    });
    await appendAuditEvent(tx, {
      eventType: 'AI_CONNECTION_CREATED',
      actorAccountId: ownerAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: proof.applicant.id,
      resourceType: 'ai_connection',
      resourceId: connection.id,
      ...(connection.missionId ? { missionId: connection.missionId } : {}),
      metadata: {
        clientHost: input.client.clientHost,
        layers: scopes,
        caseMode: choices.caseMode,
        revealIdentifiers: choices.revealIdentifiers,
        duration: choices.duration,
      },
    });
    return ok({ connectionId: connection.id, code });
  });
}

export interface ExchangeCodeInput {
  readonly code: string;
  readonly codeVerifier: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly resource: string;
  readonly now?: Date;
}

/**
 * `grant_type=authorization_code`. Every presentation uses the code up, right or wrong; a code
 * presented again after it was used cuts off the tokens it led to (RFC 6749 section 4.1.2).
 */
export async function exchangeAiAuthorizationCode(
  db: Db,
  input: ExchangeCodeInput,
): Promise<Result<AiTokenSet, AiOAuthError>> {
  const now = input.now ?? new Date();
  const dead = oauthError('invalid_grant', 'the code is invalid, used or expired');
  if (!input.code.startsWith(PREFIX.CODE)) return err(dead);
  return tolerateMissingTables(() =>
    db.transaction(async (tx) => {
      const token = first(
        await tx
          .select()
          .from(schema.aiConnectionTokens)
          .where(
            and(
              eq(schema.aiConnectionTokens.tokenHash, hashAiToken(input.code)),
              eq(schema.aiConnectionTokens.kind, 'CODE'),
            ),
          )
          .limit(1)
          .for('update'),
      );
      if (!token) return err(dead);
      await lockFamily(tx, token.familyId);
      if (token.consumedAt) {
        // Replay of a used code: whatever it led to stops working now.
        await revokeFamily(tx, token.familyId, now);
        return err(dead);
      }
      await tx
        .update(schema.aiConnectionTokens)
        .set({ consumedAt: now })
        .where(eq(schema.aiConnectionTokens.id, token.id));
      if (token.revokedAt || token.expiresAt.getTime() <= now.getTime()) return err(dead);

      const connection = first(
        await tx
          .select()
          .from(schema.aiConnections)
          .where(eq(schema.aiConnections.id, token.connectionId))
          .limit(1)
          .for('update'),
      );
      if (!connection || !connectionAlive(connection, now)) return err(dead);
      if (!sameText(connection.clientId, input.clientId)) {
        return err(oauthError('invalid_grant', 'the code was issued to another app'));
      }
      if (token.redirectUri === null || !sameText(token.redirectUri, input.redirectUri)) {
        return err(oauthError('invalid_grant', 'redirect_uri does not match the authorization'));
      }
      if (!sameText(token.resource, input.resource)) {
        return err(oauthError('invalid_target', 'resource does not match the authorization'));
      }
      if (token.codeChallenge === null || !pkceMatches(input.codeVerifier, token.codeChallenge)) {
        return err(oauthError('invalid_grant', 'code_verifier does not match'));
      }
      const tokens = await issueTokenPair(tx, connection, token.familyId, token.resource, now);
      if (!connection.activatedAt) {
        await tx
          .update(schema.aiConnections)
          .set({ activatedAt: now })
          .where(eq(schema.aiConnections.id, connection.id));
        // S16 telemetry: the app finished connecting (a consent it never finishes reads nothing
        // and records nothing). Best effort, a savepoint that never throws; once per connection.
        // Only the case mode and how many sections were granted.
        await recordProductEvent(tx, {
          eventType: 'AI_CONNECTOR_CONNECTED',
          accountId: connection.accountId,
          dimension: connection.caseMode,
          metricValue: AI_CONNECTION_LAYERS.filter((layer) => connection.scopes.includes(layer))
            .length,
          onceFor: connection.id,
        });
      }
      return ok(tokens);
    }),
  );
}

export interface RefreshInput {
  readonly refreshToken: string;
  readonly clientId: string;
  /** Optional on refresh; when sent it must be the one the sign-in was for. */
  readonly resource?: string;
  readonly now?: Date;
}

/**
 * `grant_type=refresh_token`. Rotates: the old refresh token is used up and a new pair comes
 * back. Presenting a used refresh token again cuts off the whole sign-in.
 */
export async function refreshAiTokens(
  db: Db,
  input: RefreshInput,
): Promise<Result<AiTokenSet, AiOAuthError>> {
  const now = input.now ?? new Date();
  const dead = oauthError('invalid_grant', 'the refresh token is invalid, used or expired');
  if (!input.refreshToken.startsWith(PREFIX.REFRESH)) return err(dead);
  return tolerateMissingTables(() =>
    db.transaction(async (tx) => {
      const token = first(
        await tx
          .select()
          .from(schema.aiConnectionTokens)
          .where(
            and(
              eq(schema.aiConnectionTokens.tokenHash, hashAiToken(input.refreshToken)),
              eq(schema.aiConnectionTokens.kind, 'REFRESH'),
            ),
          )
          .limit(1)
          .for('update'),
      );
      if (!token) return err(dead);
      await lockFamily(tx, token.familyId);
      if (token.consumedAt) {
        // Reuse of a rotated refresh token: someone else may hold a copy. Cut off the sign-in.
        await revokeFamily(tx, token.familyId, now);
        return err(dead);
      }
      if (token.revokedAt || token.expiresAt.getTime() <= now.getTime()) return err(dead);
      const connection = first(
        await tx
          .select()
          .from(schema.aiConnections)
          .where(eq(schema.aiConnections.id, token.connectionId))
          .limit(1),
      );
      if (!connection || !connectionAlive(connection, now)) return err(dead);
      if (!sameText(connection.clientId, input.clientId)) {
        return err(oauthError('invalid_grant', 'the refresh token was issued to another app'));
      }
      if (input.resource !== undefined && !sameText(token.resource, input.resource)) {
        return err(oauthError('invalid_target', 'resource does not match the sign-in'));
      }
      await tx
        .update(schema.aiConnectionTokens)
        .set({ consumedAt: now })
        .where(eq(schema.aiConnectionTokens.id, token.id));
      return ok(await issueTokenPair(tx, connection, token.familyId, token.resource, now));
    }),
  );
}

/**
 * RFC 7009 revocation. An access or refresh token cuts off its whole sign-in. Unknown tokens are
 * ignored, so the answer never says whether a token existed.
 */
export async function revokeAiToken(
  db: Db,
  input: { readonly token: string; readonly clientId?: string; readonly now?: Date },
): Promise<Result<void, AiOAuthError>> {
  const now = input.now ?? new Date();
  if (!input.token.startsWith(PREFIX.ACCESS) && !input.token.startsWith(PREFIX.REFRESH)) {
    return ok(undefined);
  }
  return tolerateMissingTables(() =>
    db.transaction(async (tx) => {
      const token = first(
        await tx
          .select({
            familyId: schema.aiConnectionTokens.familyId,
            clientId: schema.aiConnections.clientId,
          })
          .from(schema.aiConnectionTokens)
          .innerJoin(
            schema.aiConnections,
            eq(schema.aiConnections.id, schema.aiConnectionTokens.connectionId),
          )
          .where(eq(schema.aiConnectionTokens.tokenHash, hashAiToken(input.token)))
          .limit(1),
      );
      // RFC 7009 2.1: a token issued to another client is not revoked, and the answer is the same.
      if (!token || (input.clientId !== undefined && !sameText(token.clientId, input.clientId))) {
        return ok(undefined);
      }
      await lockFamily(tx, token.familyId);
      await revokeFamily(tx, token.familyId, now);
      return ok(undefined);
    }),
  );
}

/** A live connection an access token speaks for, as the MCP route sees it. */
export interface ResolvedAiConnection {
  readonly connectionId: string;
  readonly accountId: string;
  readonly applicantId: string;
  readonly clientHost: string;
  readonly clientName: string;
  readonly scopes: readonly string[];
  readonly caseMode: 'NONE' | 'ONE' | 'ALL_CURRENT';
  readonly missionId: string | null;
  readonly revealIdentifiers: boolean;
  readonly depth: string;
}

/**
 * Looks an access token up for one request: live, unexpired, unrevoked, for this exact resource,
 * on a live connection. `null` means "answer 401". Writes `last_used_at` at most once a minute.
 * Called by the AI gate (`withAiConnection`), which then asks the central access gate again.
 */
export async function resolveAiAccessToken(
  db: Db,
  input: { readonly token: string; readonly resource: string; readonly now?: Date },
): Promise<ResolvedAiConnection | null> {
  const now = input.now ?? new Date();
  if (!input.token.startsWith(PREFIX.ACCESS)) return null;
  try {
    const row = first(
      await db
        .select({ token: schema.aiConnectionTokens, connection: schema.aiConnections })
        .from(schema.aiConnectionTokens)
        .innerJoin(
          schema.aiConnections,
          eq(schema.aiConnections.id, schema.aiConnectionTokens.connectionId),
        )
        .where(
          and(
            eq(schema.aiConnectionTokens.tokenHash, hashAiToken(input.token)),
            eq(schema.aiConnectionTokens.kind, 'ACCESS'),
          ),
        )
        .limit(1),
    );
    if (!row) return null;
    const { token, connection } = row;
    if (token.revokedAt || token.expiresAt.getTime() <= now.getTime()) return null;
    if (!sameText(token.resource, input.resource)) return null;
    if (!connection.activatedAt || !connectionAlive(connection, now)) return null;
    const stale =
      !connection.lastUsedAt ||
      now.getTime() - connection.lastUsedAt.getTime() >= LAST_USED_WRITE_GAP_MS;
    if (stale) {
      await db
        .update(schema.aiConnections)
        .set({ lastUsedAt: now })
        .where(
          and(
            eq(schema.aiConnections.id, connection.id),
            sql`(${schema.aiConnections.lastUsedAt} is null or ${schema.aiConnections.lastUsedAt} <= ${new Date(now.getTime() - LAST_USED_WRITE_GAP_MS).toISOString()}::timestamptz)`,
          ),
        );
    }
    return {
      connectionId: connection.id,
      accountId: connection.accountId,
      applicantId: connection.applicantId,
      clientHost: connection.clientHost,
      clientName: connection.clientName,
      scopes: connection.scopes,
      caseMode: connection.caseMode,
      missionId: connection.missionId,
      revealIdentifiers: connection.revealIdentifiers,
      depth: connection.depth,
    };
  } catch (error) {
    if (isMissingRelationError(error)) return null;
    throw error;
  }
}

/** Expired tokens are kept a day past their end (reuse of a used refresh token is still caught), then deleted. */
const TOKEN_KEEP_AFTER_EXPIRY_MS = 24 * 60 * 60 * 1000;

/**
 * Daily clean-up: deletes tokens a day after they expired. A used refresh token is kept until
 * then, so presenting it again still cuts off its sign-in for as long as it could have worked.
 * Returns how many were deleted; 0 while the table does not exist yet.
 */
export async function deleteExpiredAiTokens(db: Db, now: Date = new Date()): Promise<number> {
  try {
    const removed = await db
      .delete(schema.aiConnectionTokens)
      .where(
        sql`${schema.aiConnectionTokens.expiresAt} < ${new Date(now.getTime() - TOKEN_KEEP_AFTER_EXPIRY_MS).toISOString()}::timestamptz`,
      )
      .returning({ id: schema.aiConnectionTokens.id });
    return removed.length;
  } catch (error) {
    if (isMissingRelationError(error)) return 0;
    throw error;
  }
}
