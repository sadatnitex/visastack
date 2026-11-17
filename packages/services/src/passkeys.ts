import { createHash } from 'node:crypto';
import {
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { type Result, err, ok } from '@visastack/core';
import { sql } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import type { Db } from './db';
import { type ServiceError, serviceError } from './errors';
import { isMissingRelationError } from './missing-relation';

/**
 * Passkeys that confirm sensitive actions (Q8, ADR 0028).
 *
 * A passkey here never signs anyone in and never creates or extends a sign-in. Using one only
 * records "this sign-in was confirmed with a passkey at this time", bound to a hash of the Neon
 * session id (the session ref), so the record dies with that sign-in: a new sign-in has a new ref
 * and finds nothing. The web app decides where that record may stand in for a recently typed
 * password (traveller step-up only).
 *
 * - The table may not exist yet (deployed before the owner's migration): every read reports
 *   "unavailable" and callers fall back to the password, never to "allowed".
 * - A challenge is used once per credential: its hash is stored with the use and the same one is
 *   refused afterwards, and a signature counter that goes backwards is refused.
 * - Audit rows carry kinds and counts only, never a credential id, a key, an email address or a
 *   session reference.
 */

export const PASSKEY_LIMIT = 10;
export const PASSKEY_LABEL_MAX = 60;
const CEREMONY_TIMEOUT_MS = 2 * 60 * 1000;

/** Where passkeys are made and checked: the production host and its exact origin. */
export interface PasskeyRelyingParty {
  readonly rpID: string;
  readonly origin: string;
  readonly rpName: string;
}

export interface PasskeySummary {
  readonly id: string;
  readonly label: string;
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
  /** True when the passkey is kept in a synced store (for example a phone's password manager). */
  readonly synced: boolean;
}

export type PasskeyList =
  | { readonly state: 'unavailable' }
  | { readonly state: 'ok'; readonly passkeys: readonly PasskeySummary[] };

const UNAVAILABLE = serviceError('upstream_error', 'Passkeys are not available right now.');
const NOT_ACCEPTED = serviceError(
  'invalid',
  'That passkey could not be checked. Try again, or use your password.',
);

function rowsOf<T>(result: unknown): T[] {
  const rows = Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows;
  return (rows ?? []) as T[];
}

function asDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

function asBytes(value: unknown): Uint8Array<ArrayBuffer> {
  let source: Uint8Array;
  if (value instanceof Uint8Array) source = value;
  else if (typeof value === 'string' && value.startsWith('\\x')) {
    source = Buffer.from(value.slice(2), 'hex');
  } else {
    throw new Error('unexpected public key encoding');
  }
  const bytes = new Uint8Array(new ArrayBuffer(source.length));
  bytes.set(source);
  return bytes;
}

/** Transport hints are short lowercase words ("internal", "hybrid", "usb"); anything else is dropped. */
function asTransports(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && /^[a-z-]{1,20}$/.test(item))
    .slice(0, 8);
}

/** A Postgres array literal of transport words, safe because each word is checked above. */
function transportsLiteral(value: unknown): string {
  return `{${asTransports(value).join(',')}}`;
}

/** A stable, non-identifying WebAuthn user handle: the same account always gets the same one. */
function userHandle(accountId: string): Uint8Array<ArrayBuffer> {
  const digest = createHash('sha256').update(`visastack:passkey-user:v1:${accountId}`).digest();
  const handle = new Uint8Array(new ArrayBuffer(digest.length));
  handle.set(digest);
  return handle;
}

export function passkeyChallengeHash(challenge: string): string {
  return createHash('sha256').update(`visastack:passkey-challenge:v1:${challenge}`).digest('hex');
}

/** A label people can read in their list, trimmed and bounded; empty becomes a plain default. */
export function normalisePasskeyLabel(label: string | null | undefined): string {
  const printable = Array.from(label ?? '')
    .map((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code < 32 || code === 127 ? ' ' : char;
    })
    .join('');
  const clean = printable.replace(/\s+/g, ' ').trim();
  const bounded = Array.from(clean).slice(0, PASSKEY_LABEL_MAX).join('').trim();
  return bounded.length > 0 ? bounded : 'Passkey';
}

async function audit(
  db: Db,
  accountId: string,
  eventType: string,
  result: 'ALLOWED' | 'DENIED',
  metadata: Record<string, unknown>,
): Promise<void> {
  await db.transaction(async (tx) => {
    await appendAuditEvent(tx, {
      eventType,
      actorAccountId: accountId,
      method: 'MANUAL',
      result,
      resourceType: 'passkey',
      resourceId: accountId,
      metadata,
    });
  });
}

interface CredentialRow {
  readonly id: string;
  readonly credential_id: string;
  readonly public_key: unknown;
  readonly sign_count: unknown;
  readonly transports: unknown;
}

async function credentialsFor(db: Db, accountId: string): Promise<CredentialRow[]> {
  return rowsOf<CredentialRow>(
    await db.execute(sql`
      select id, credential_id, public_key, sign_count, transports
      from passkey_credentials
      where account_id = ${accountId}
      order by created_at`),
  );
}

/** The account's passkeys for its own list. Never includes keys or credential ids. */
export async function listPasskeys(db: Db, accountId: string): Promise<PasskeyList> {
  try {
    const rows = rowsOf<{
      id: string;
      label: string;
      created_at: unknown;
      last_used_at: unknown;
      backed_up: unknown;
    }>(
      await db.execute(sql`
        select id, label, created_at, last_used_at, backed_up
        from passkey_credentials
        where account_id = ${accountId}
        order by created_at`),
    );
    return {
      state: 'ok',
      passkeys: rows.map((row) => ({
        id: row.id,
        label: row.label,
        createdAt: asDate(row.created_at) ?? new Date(0),
        lastUsedAt: asDate(row.last_used_at),
        synced: row.backed_up === true,
      })),
    };
  } catch (error) {
    if (isMissingRelationError(error)) return { state: 'unavailable' };
    throw error;
  }
}

async function countPasskeys(db: Db, accountId: string): Promise<number> {
  const rows = rowsOf<{ n: unknown }>(
    await db.execute(
      sql`select count(*)::int as n from passkey_credentials where account_id = ${accountId}`,
    ),
  );
  return Number(rows[0]?.n ?? 0);
}

/** Whether the account has at least one passkey; null when that cannot be read (no table yet). */
export async function hasPasskey(db: Db, accountId: string): Promise<boolean | null> {
  try {
    const rows = rowsOf<{ present: unknown }>(
      await db.execute(sql`
        select exists(select 1 from passkey_credentials where account_id = ${accountId}) as present`),
    );
    return rows[0]?.present === true;
  } catch (error) {
    if (isMissingRelationError(error)) return null;
    throw error;
  }
}

/** Options for adding a passkey. The caller keeps `options.challenge` and checks a fresh step-up first. */
export async function startPasskeyRegistration(
  db: Db,
  input: { readonly accountId: string; readonly email: string; readonly rp: PasskeyRelyingParty },
): Promise<Result<PublicKeyCredentialCreationOptionsJSON, ServiceError>> {
  let existing: CredentialRow[];
  try {
    existing = await credentialsFor(db, input.accountId);
  } catch (error) {
    if (isMissingRelationError(error)) return err(UNAVAILABLE);
    throw error;
  }
  if (existing.length >= PASSKEY_LIMIT) {
    return err(
      serviceError('invalid', `You can keep up to ${PASSKEY_LIMIT} passkeys. Remove one first.`),
    );
  }
  const options = await generateRegistrationOptions({
    rpName: input.rp.rpName,
    rpID: input.rp.rpID,
    userName: input.email,
    userDisplayName: input.email,
    userID: userHandle(input.accountId),
    timeout: CEREMONY_TIMEOUT_MS,
    attestationType: 'none',
    excludeCredentials: existing.map((row) => ({
      id: row.credential_id,
      transports: asTransports(row.transports),
    })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
    supportedAlgorithmIDs: [-7, -257],
  });
  return ok(options);
}

/** Check the new passkey against the challenge this browser was given, then keep it. */
export async function finishPasskeyRegistration(
  db: Db,
  input: {
    readonly accountId: string;
    readonly rp: PasskeyRelyingParty;
    readonly expectedChallenge: string;
    readonly response: RegistrationResponseJSON;
    readonly label: string | null | undefined;
  },
): Promise<Result<{ readonly id: string }, ServiceError>> {
  let verified: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    verified = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: input.expectedChallenge,
      expectedOrigin: input.rp.origin,
      expectedRPID: input.rp.rpID,
      requireUserVerification: true,
      supportedAlgorithmIDs: [-7, -257],
    });
  } catch {
    return err(NOT_ACCEPTED);
  }
  if (!verified.verified) return err(NOT_ACCEPTED);
  const info = verified.registrationInfo;
  const label = normalisePasskeyLabel(input.label);
  let inserted: { id: string }[];
  try {
    // One account's saves run one at a time, so two tabs cannot both pass the limit check.
    inserted = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`visastack:passkeys:${input.accountId}`}))`,
      );
      return rowsOf<{ id: string }>(
        await tx.execute(sql`
          insert into passkey_credentials
            (account_id, credential_id, public_key, sign_count, transports, aaguid, device_type,
             backed_up, label)
          select ${input.accountId}, ${info.credential.id},
            ${Buffer.from(info.credential.publicKey)}, ${info.credential.counter},
            ${transportsLiteral(info.credential.transports)}::text[], ${info.aaguid},
            ${info.credentialDeviceType}, ${info.credentialBackedUp}, ${label}
          where (select count(*) from passkey_credentials where account_id = ${input.accountId})
            < ${PASSKEY_LIMIT}
          on conflict (credential_id) do nothing
          returning id`),
      );
    });
  } catch (error) {
    if (isMissingRelationError(error)) return err(UNAVAILABLE);
    throw error;
  }
  const row = inserted[0];
  if (!row) {
    return err(
      serviceError(
        'invalid',
        'That passkey is already saved, or you have reached the limit. Check your list.',
      ),
    );
  }
  const count = await countPasskeys(db, input.accountId);
  await audit(db, input.accountId, 'PASSKEY_ADDED', 'ALLOWED', { count });
  return ok({ id: row.id });
}

/** Options for confirming with one of the account's passkeys; not_found when it has none. */
export async function startPasskeyConfirmation(
  db: Db,
  input: { readonly accountId: string; readonly rp: PasskeyRelyingParty },
): Promise<Result<PublicKeyCredentialRequestOptionsJSON, ServiceError>> {
  let existing: CredentialRow[];
  try {
    existing = await credentialsFor(db, input.accountId);
  } catch (error) {
    if (isMissingRelationError(error)) return err(UNAVAILABLE);
    throw error;
  }
  if (existing.length === 0) {
    return err(serviceError('not_found', 'There is no passkey on this account yet.'));
  }
  const options = await generateAuthenticationOptions({
    rpID: input.rp.rpID,
    timeout: CEREMONY_TIMEOUT_MS,
    userVerification: 'required',
    allowCredentials: existing.map((row) => ({
      id: row.credential_id,
      transports: asTransports(row.transports),
    })),
  });
  return ok(options);
}

/**
 * Check a passkey answer for THIS account and THIS sign-in, then record the use. Only the
 * account's own passkeys are considered; the challenge must be the one this browser was given;
 * the same challenge is refused a second time, and so is any challenge given out before the
 * passkey's last use (an older answer kept back cannot be played later, even by a passkey whose
 * counter never moves); a counter that goes backwards is refused.
 */
export async function finishPasskeyConfirmation(
  db: Db,
  input: {
    readonly accountId: string;
    readonly rp: PasskeyRelyingParty;
    readonly expectedChallenge: string;
    /** When the challenge was given out; a challenge older than the credential's last use is refused. */
    readonly challengeIssuedAt: Date;
    readonly response: AuthenticationResponseJSON;
    readonly sessionRef: string;
    readonly now?: Date;
  },
): Promise<Result<{ readonly confirmedAt: Date }, ServiceError>> {
  let existing: CredentialRow[];
  try {
    existing = await credentialsFor(db, input.accountId);
  } catch (error) {
    if (isMissingRelationError(error)) return err(UNAVAILABLE);
    throw error;
  }
  const row = existing.find((candidate) => candidate.credential_id === input.response.id);
  if (!row) {
    await audit(db, input.accountId, 'PASSKEY_CHECK_FAILED', 'DENIED', { reason: 'unknown' });
    return err(NOT_ACCEPTED);
  }
  const storedCount = Number(row.sign_count ?? 0);
  let newCounter: number;
  try {
    const verified = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: input.expectedChallenge,
      expectedOrigin: input.rp.origin,
      expectedRPID: input.rp.rpID,
      requireUserVerification: true,
      credential: {
        id: row.credential_id,
        publicKey: asBytes(row.public_key),
        counter: storedCount,
        transports: asTransports(row.transports),
      },
    });
    if (!verified.verified || !verified.authenticationInfo.userVerified) {
      throw new Error('not verified');
    }
    newCounter = verified.authenticationInfo.newCounter;
  } catch {
    await audit(db, input.accountId, 'PASSKEY_CHECK_FAILED', 'DENIED', { reason: 'signature' });
    return err(NOT_ACCEPTED);
  }
  const now = input.now ?? new Date();
  const challengeHash = passkeyChallengeHash(input.expectedChallenge);
  // One statement decides, so two answers racing with the same challenge cannot both pass, and a
  // counter that moved backwards in the meantime is refused here too.
  const updated = rowsOf<{ id: string }>(
    await db.execute(sql`
      update passkey_credentials
      set sign_count = ${newCounter},
          last_used_at = ${now.toISOString()}::timestamptz,
          last_used_session_ref = ${input.sessionRef},
          last_challenge_hash = ${challengeHash}
      where id = ${row.id}
        and account_id = ${input.accountId}
        and last_challenge_hash is distinct from ${challengeHash}
        and (last_used_at is null or last_used_at <= ${input.challengeIssuedAt.toISOString()}::timestamptz)
        and ((sign_count = 0 and ${newCounter} = 0) or ${newCounter} > sign_count)
      returning id`),
  );
  if (!updated[0]) {
    await audit(db, input.accountId, 'PASSKEY_CHECK_FAILED', 'DENIED', { reason: 'replay' });
    return err(NOT_ACCEPTED);
  }
  await audit(db, input.accountId, 'PASSKEY_CONFIRMED', 'ALLOWED', {});
  return ok({ confirmedAt: now });
}

/**
 * When this sign-in was last confirmed with a passkey, or null. Bound to the session ref, so a
 * confirmation made in another sign-in (including an earlier one in this browser) never counts.
 * Null when the table is missing: callers then ask for the password.
 */
export async function passkeyConfirmedAt(
  db: Db,
  input: { readonly accountId: string; readonly sessionRef: string },
): Promise<Date | null> {
  try {
    const rows = rowsOf<{ at: unknown }>(
      await db.execute(sql`
        select max(last_used_at) as at
        from passkey_credentials
        where account_id = ${input.accountId} and last_used_session_ref = ${input.sessionRef}`),
    );
    return asDate(rows[0]?.at);
  } catch (error) {
    if (isMissingRelationError(error)) return null;
    throw error;
  }
}

export async function renamePasskey(
  db: Db,
  input: { readonly accountId: string; readonly id: string; readonly label: string },
): Promise<Result<true, ServiceError>> {
  try {
    const rows = rowsOf<{ id: string }>(
      await db.execute(sql`
        update passkey_credentials set label = ${normalisePasskeyLabel(input.label)}
        where id = ${input.id} and account_id = ${input.accountId}
        returning id`),
    );
    if (!rows[0]) return err(serviceError('not_found', 'That passkey is no longer on your list.'));
    return ok(true);
  } catch (error) {
    if (isMissingRelationError(error)) return err(UNAVAILABLE);
    throw error;
  }
}

export async function removePasskey(
  db: Db,
  input: { readonly accountId: string; readonly id: string },
): Promise<Result<true, ServiceError>> {
  let removed: { id: string }[];
  try {
    removed = rowsOf<{ id: string }>(
      await db.execute(sql`
        delete from passkey_credentials
        where id = ${input.id} and account_id = ${input.accountId}
        returning id`),
    );
  } catch (error) {
    if (isMissingRelationError(error)) return err(UNAVAILABLE);
    throw error;
  }
  if (!removed[0]) return err(serviceError('not_found', 'That passkey is no longer on your list.'));
  const count = await countPasskeys(db, input.accountId);
  await audit(db, input.accountId, 'PASSKEY_REMOVED', 'ALLOWED', { count });
  return ok(true);
}

export type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
};
