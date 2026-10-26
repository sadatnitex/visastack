import { createHash, randomUUID } from 'node:crypto';
import { type Result, err, ok } from '@visastack/core';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { type PlatformAuthInput, hasAnyPlatformRole, isPlatformOwner } from './platform-roles';
import type { KeyManagementPort } from './ports';
import { protectValue, revealValue } from './protected-fields';
import { RATE_LIMITS, checkRateLimit, refundRateLimit } from './rate-limit';
import {
  RECOVERY_CODE_COUNT,
  generateRecoveryCodes,
  generateTotpSecret,
  groupSecret,
  looksLikeRecoveryCode,
  matchTotp,
  normaliseRecoveryCode,
  otpauthUri,
} from './totp';

/**
 * Staff second factor (S3, M08): an authenticator-app code for every account that holds a
 * platform role, on top of the recent sign-in the step-up check already needs.
 *
 * - The secret is envelope encrypted with the key port (same mechanism as protected fields) and
 *   bound to this account and this enrolment, so a copied ciphertext cannot be opened.
 * - Recovery codes are stored only as hashes, are single use, and 80 random bits long, so a
 *   plain hash cannot be guessed offline.
 * - A code works once: the step it matched is stored and only a later step is accepted.
 * - "Verified" belongs to one sign-in (a hash of the session id) and lasts five minutes; a
 *   password used on another device does not inherit it.
 * - Wrong guesses are counted before they are checked and given back on success.
 * - Audit rows carry kinds and counts only, never a code, a secret or a session reference.
 */

export const STAFF_FACTOR_FRESH_MS = 5 * 60 * 1000;
export const STAFF_FACTOR_ISSUER = 'VisaStack';

export type StaffFactorRow = typeof schema.staffSecondFactors.$inferSelect;

function aadFor(accountId: string, enrolmentId: string): string {
  return `visastack:staff_second_factor:v1:${accountId}:${enrolmentId}`;
}

function hashRecoveryCode(accountId: string, code: string): string {
  return createHash('sha256')
    .update(`visastack:recovery:v1:${accountId}:${normaliseRecoveryCode(code)}`)
    .digest('hex');
}

/** What the database says when the table is not there yet (the gap between a deploy and its migration). */
function isMissingTable(error: unknown): boolean {
  const visit = (value: unknown, depth: number): boolean => {
    if (typeof value !== 'object' || value === null || depth > 3) return false;
    const { code, message, cause } = value as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (code === '42P01' || code === '42703') return true;
    if (typeof message === 'string' && /(relation|column) .* does not exist/i.test(message)) {
      return true;
    }
    return visit(cause, depth + 1);
  };
  return visit(error, 0);
}

const UNAVAILABLE = serviceError(
  'upstream_error',
  'Authenticator codes cannot be checked right now.',
);

export type StaffFactorStatus =
  | { readonly state: 'unavailable' }
  | { readonly state: 'none' }
  | { readonly state: 'pending' }
  | {
      readonly state: 'active';
      readonly verifiedAt: Date | null;
      readonly recoveryCodesLeft: number;
    };

export async function getStaffFactorStatus(db: Db, accountId: string): Promise<StaffFactorStatus> {
  let row: StaffFactorRow | undefined;
  try {
    row = first(
      await db
        .select()
        .from(schema.staffSecondFactors)
        .where(eq(schema.staffSecondFactors.accountId, accountId))
        .limit(1),
    );
  } catch (error) {
    if (isMissingTable(error)) return { state: 'unavailable' };
    throw error;
  }
  if (!row) return { state: 'none' };
  if (row.status !== 'ACTIVE') return { state: 'pending' };
  return {
    state: 'active',
    verifiedAt: row.verifiedAt,
    recoveryCodesLeft: row.recoveryCodeHashes.length,
  };
}

/**
 * Whether this sign-in has proved a code within the window. `maxAgeMs` null means "any time in
 * this sign-in" (used once per sign-in to open the platform area). Nothing readable, nothing
 * enrolled, a different session or an old proof all answer false: fail closed.
 */
export async function isStaffFactorFresh(
  db: Db,
  input: {
    readonly accountId: string;
    readonly sessionRef: string;
    readonly maxAgeMs: number | null;
    readonly now?: Date;
  },
): Promise<boolean> {
  let row: StaffFactorRow | undefined;
  try {
    row = first(
      await db
        .select()
        .from(schema.staffSecondFactors)
        .where(eq(schema.staffSecondFactors.accountId, input.accountId))
        .limit(1),
    );
  } catch (error) {
    if (isMissingTable(error)) return false;
    throw error;
  }
  if (!row || row.status !== 'ACTIVE' || !row.verifiedAt || !row.verifiedSessionRef) return false;
  if (row.verifiedSessionRef !== input.sessionRef) return false;
  if (input.maxAgeMs === null) return true;
  const age = (input.now ?? new Date()).getTime() - row.verifiedAt.getTime();
  return age >= 0 && age <= input.maxAgeMs;
}

export interface StaffFactorEnrolment {
  /** What an authenticator app reads from the QR code. */
  readonly otpauthUri: string;
  /** The same secret in groups of four, for typing in by hand. */
  readonly manualKey: string;
}

async function describeEnrolment(
  db: Db,
  port: KeyManagementPort,
  row: StaffFactorRow,
  email: string,
): Promise<StaffFactorEnrolment> {
  const encoded = await revealValue(db, port, {
    ciphertext: row.secretCiphertext,
    nonce: row.secretNonce,
    keyVersion: row.secretKeyVersion,
    aad: aadFor(row.accountId, row.enrolmentId),
  });
  return describeEnrolmentFromSecret(Buffer.from(encoded, 'base64'), email);
}

/**
 * Begin (or restart) setting up the app. Only while nothing is active: replacing an active
 * factor goes through a reset by the platform owner, so a phished password cannot swap a
 * working authenticator for the attacker's. Needs a recent sign-in (`stepUpSatisfied`).
 */
export async function startStaffFactorEnrolment(
  db: Db,
  port: KeyManagementPort,
  input: { readonly actor: PlatformAuthInput; readonly stepUpSatisfied: boolean },
): Promise<Result<StaffFactorEnrolment, ServiceError>> {
  if (!input.stepUpSatisfied) {
    return err(serviceError('step_up_required', 'Sign in again to set up an authenticator app.'));
  }
  if (!(await hasAnyPlatformRole(db, input.actor))) {
    return err(serviceError('forbidden', 'Only platform staff set up an authenticator app.'));
  }
  const accountId = input.actor.accountId;
  const secret = generateTotpSecret();
  const enrolmentId = randomUUID();
  let protectedSecret: Awaited<ReturnType<typeof protectValue>>;
  try {
    protectedSecret = await protectValue(
      db,
      port,
      Buffer.from(secret).toString('base64'),
      aadFor(accountId, enrolmentId),
    );
  } catch {
    return err(
      serviceError('encryption_unavailable', 'An authenticator app cannot be set up here yet.'),
    );
  }
  try {
    const written = await db
      .insert(schema.staffSecondFactors)
      .values({
        accountId,
        status: 'PENDING',
        enrolmentId,
        secretCiphertext: Buffer.from(protectedSecret.ciphertext),
        secretNonce: Buffer.from(protectedSecret.nonce),
        secretKeyVersion: protectedSecret.keyVersion,
      })
      .onConflictDoUpdate({
        target: schema.staffSecondFactors.accountId,
        set: {
          enrolmentId,
          secretCiphertext: Buffer.from(protectedSecret.ciphertext),
          secretNonce: Buffer.from(protectedSecret.nonce),
          secretKeyVersion: protectedSecret.keyVersion,
          lastUsedStep: null,
          updatedAt: sql`now()`,
        },
        // Never touch an active factor.
        setWhere: eq(schema.staffSecondFactors.status, 'PENDING'),
      })
      .returning();
    if (written.length === 0) {
      return err(serviceError('invalid', 'An authenticator app is already set up.'));
    }
  } catch (error) {
    if (isMissingTable(error)) return err(UNAVAILABLE);
    throw error;
  }
  return ok(await describeEnrolmentFromSecret(secret, input.actor.email));
}

function describeEnrolmentFromSecret(secret: Uint8Array, email: string): StaffFactorEnrolment {
  return {
    otpauthUri: otpauthUri({ issuer: STAFF_FACTOR_ISSUER, account: email, secret }),
    manualKey: groupSecret(secret),
  };
}

/** Show the same setup details again while the app is still being set up (a page reload). */
export async function revealPendingStaffEnrolment(
  db: Db,
  port: KeyManagementPort,
  actor: PlatformAuthInput,
): Promise<Result<StaffFactorEnrolment, ServiceError>> {
  let row: StaffFactorRow | undefined;
  try {
    row = first(
      await db
        .select()
        .from(schema.staffSecondFactors)
        .where(eq(schema.staffSecondFactors.accountId, actor.accountId))
        .limit(1),
    );
  } catch (error) {
    if (isMissingTable(error)) return err(UNAVAILABLE);
    throw error;
  }
  if (!row || row.status !== 'PENDING') {
    return err(serviceError('not_found', 'No authenticator setup is waiting.'));
  }
  return ok(await describeEnrolment(db, port, row, actor.email));
}

/** Count one guess against both buckets. Refuses when either is full, whatever the code is. */
async function countAttempt(
  db: Db,
  accountId: string,
  now: Date,
): Promise<ServiceError | undefined> {
  for (const [action, config] of [
    ['staff_factor.attempt', RATE_LIMITS.STAFF_FACTOR_ATTEMPT],
    ['staff_factor.attempt_day', RATE_LIMITS.STAFF_FACTOR_ATTEMPT_DAY],
  ] as const) {
    const decision = await checkRateLimit(db, { subjectId: accountId, action }, config, now);
    if (!decision.allowed) {
      return serviceError(
        'rate_limited',
        'Too many tries. Wait a few minutes, or ask a platform owner to reset your authenticator.',
      );
    }
  }
  return undefined;
}

async function giveAttemptBack(db: Db, accountId: string, now: Date): Promise<void> {
  await refundRateLimit(
    db,
    { subjectId: accountId, action: 'staff_factor.attempt' },
    RATE_LIMITS.STAFF_FACTOR_ATTEMPT,
    now,
  );
  await refundRateLimit(
    db,
    { subjectId: accountId, action: 'staff_factor.attempt_day' },
    RATE_LIMITS.STAFF_FACTOR_ATTEMPT_DAY,
    now,
  );
}

const WRONG_CODE = serviceError('invalid', 'That code did not work. Check it and try again.');

async function auditFailure(db: Db, accountId: string, method: 'code' | 'recovery'): Promise<void> {
  await db.transaction(async (tx) => {
    await appendAuditEvent(tx, {
      eventType: 'STAFF_SECOND_FACTOR_CHECK_FAILED',
      actorAccountId: accountId,
      method: 'MANUAL',
      result: 'DENIED',
      resourceType: 'staff_second_factor',
      resourceId: accountId,
      metadata: { method },
    });
  });
}

/** Ten new recovery codes: the readable list to show once, and the hashes to store. */
function newRecoveryCodes(accountId: string): { shown: string[]; hashes: string[] } {
  const shown = generateRecoveryCodes(RECOVERY_CODE_COUNT);
  return { shown, hashes: shown.map((code) => hashRecoveryCode(accountId, code)) };
}

/**
 * Finish setting up: the first correct code turns the factor on, returns the ten recovery codes
 * (shown once, never stored in readable form) and counts this sign-in as verified.
 */
export async function confirmStaffFactorEnrolment(
  db: Db,
  port: KeyManagementPort,
  input: {
    readonly actor: PlatformAuthInput;
    readonly code: string;
    readonly sessionRef: string;
    readonly now?: Date;
  },
): Promise<Result<{ readonly recoveryCodes: readonly string[] }, ServiceError>> {
  const now = input.now ?? new Date();
  const accountId = input.actor.accountId;
  const refusal = await countAttempt(db, accountId, now);
  if (refusal) return err(refusal);
  let row: StaffFactorRow | undefined;
  try {
    row = first(
      await db
        .select()
        .from(schema.staffSecondFactors)
        .where(eq(schema.staffSecondFactors.accountId, accountId))
        .limit(1),
    );
  } catch (error) {
    if (isMissingTable(error)) return err(UNAVAILABLE);
    throw error;
  }
  if (!row || row.status !== 'PENDING') {
    return err(serviceError('not_found', 'No authenticator setup is waiting.'));
  }
  const encoded = await revealValue(db, port, {
    ciphertext: row.secretCiphertext,
    nonce: row.secretNonce,
    keyVersion: row.secretKeyVersion,
    aad: aadFor(row.accountId, row.enrolmentId),
  });
  const step = matchTotp(Buffer.from(encoded, 'base64'), input.code, now.getTime());
  if (step === null) {
    await auditFailure(db, accountId, 'code');
    return err(WRONG_CODE);
  }
  const codes = newRecoveryCodes(accountId);
  const activated = await db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.staffSecondFactors)
      .set({
        status: 'ACTIVE',
        lastUsedStep: step,
        verifiedAt: now,
        verifiedSessionRef: input.sessionRef,
        recoveryCodeHashes: codes.hashes,
        confirmedAt: now,
        updatedAt: now,
      })
      // The enrolment id guards against a restart racing this confirmation.
      .where(
        and(
          eq(schema.staffSecondFactors.accountId, accountId),
          eq(schema.staffSecondFactors.status, 'PENDING'),
          eq(schema.staffSecondFactors.enrolmentId, row.enrolmentId),
        ),
      )
      .returning({ accountId: schema.staffSecondFactors.accountId });
    if (updated.length === 0) return false;
    await appendAuditEvent(tx, {
      eventType: 'STAFF_SECOND_FACTOR_ENROLLED',
      actorAccountId: accountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'staff_second_factor',
      resourceId: accountId,
      metadata: { recoveryCodes: codes.hashes.length },
    });
    return true;
  });
  if (!activated) return err(serviceError('stale', 'Setup changed. Start again.'));
  await giveAttemptBack(db, accountId, now);
  return ok({ recoveryCodes: codes.shown });
}

export interface VerifyStaffFactorSuccess {
  readonly method: 'code' | 'recovery';
  /** Set when a recovery code was used: how many are left. */
  readonly recoveryCodesLeft?: number;
}

/**
 * Check a typed code, or a recovery code, for an enrolled account and remember the proof for
 * this sign-in. A code that was already used, an old one, a wrong one, and any code while the
 * account is locked all read the same to the caller.
 */
export async function verifyStaffFactor(
  db: Db,
  port: KeyManagementPort,
  input: {
    readonly accountId: string;
    readonly code: string;
    readonly sessionRef: string;
    readonly now?: Date;
  },
): Promise<Result<VerifyStaffFactorSuccess, ServiceError>> {
  const now = input.now ?? new Date();
  const refusal = await countAttempt(db, input.accountId, now);
  if (refusal) {
    await db.transaction(async (tx) => {
      await appendAuditEvent(tx, {
        eventType: 'STAFF_SECOND_FACTOR_LOCKED',
        actorAccountId: input.accountId,
        method: 'MANUAL',
        result: 'DENIED',
        resourceType: 'staff_second_factor',
        resourceId: input.accountId,
      });
    });
    return err(refusal);
  }
  let row: StaffFactorRow | undefined;
  try {
    row = first(
      await db
        .select()
        .from(schema.staffSecondFactors)
        .where(eq(schema.staffSecondFactors.accountId, input.accountId))
        .limit(1),
    );
  } catch (error) {
    if (isMissingTable(error)) return err(UNAVAILABLE);
    throw error;
  }
  if (!row || row.status !== 'ACTIVE') return err(WRONG_CODE);

  if (looksLikeRecoveryCode(input.code)) {
    const hash = hashRecoveryCode(input.accountId, input.code);
    const used = await db.transaction(async (tx) => {
      const updated = await tx
        .update(schema.staffSecondFactors)
        .set({
          recoveryCodeHashes: sql`array_remove(${schema.staffSecondFactors.recoveryCodeHashes}, ${hash})`,
          verifiedAt: now,
          verifiedSessionRef: input.sessionRef,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.staffSecondFactors.accountId, input.accountId),
            eq(schema.staffSecondFactors.status, 'ACTIVE'),
            sql`${hash} = any(${schema.staffSecondFactors.recoveryCodeHashes})`,
          ),
        )
        .returning({ left: schema.staffSecondFactors.recoveryCodeHashes });
      const left = updated[0]?.left.length;
      if (left === undefined) return null;
      await appendAuditEvent(tx, {
        eventType: 'STAFF_RECOVERY_CODE_USED',
        actorAccountId: input.accountId,
        method: 'MANUAL',
        result: 'ALLOWED',
        resourceType: 'staff_second_factor',
        resourceId: input.accountId,
        metadata: { remaining: left },
      });
      return left;
    });
    if (used === null) {
      await auditFailure(db, input.accountId, 'recovery');
      return err(WRONG_CODE);
    }
    await giveAttemptBack(db, input.accountId, now);
    return ok({ method: 'recovery', recoveryCodesLeft: used });
  }

  const encoded = await revealValue(db, port, {
    ciphertext: row.secretCiphertext,
    nonce: row.secretNonce,
    keyVersion: row.secretKeyVersion,
    aad: aadFor(row.accountId, row.enrolmentId),
  });
  const step = matchTotp(Buffer.from(encoded, 'base64'), input.code, now.getTime());
  if (step === null) {
    await auditFailure(db, input.accountId, 'code');
    return err(WRONG_CODE);
  }
  // One use per step: only a strictly later step than the last accepted one updates a row.
  const accepted = await db
    .update(schema.staffSecondFactors)
    .set({
      lastUsedStep: step,
      verifiedAt: now,
      verifiedSessionRef: input.sessionRef,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.staffSecondFactors.accountId, input.accountId),
        eq(schema.staffSecondFactors.status, 'ACTIVE'),
        eq(schema.staffSecondFactors.enrolmentId, row.enrolmentId),
        sql`(${schema.staffSecondFactors.lastUsedStep} is null or ${schema.staffSecondFactors.lastUsedStep} < ${step})`,
      ),
    )
    .returning({ accountId: schema.staffSecondFactors.accountId });
  if (accepted.length === 0) {
    await auditFailure(db, input.accountId, 'code');
    return err(WRONG_CODE);
  }
  await giveAttemptBack(db, input.accountId, now);
  return ok({ method: 'code' });
}

/** New recovery codes, replacing all old ones. Needs a code proved in the last five minutes. */
export async function regenerateStaffRecoveryCodes(
  db: Db,
  input: {
    readonly accountId: string;
    readonly sessionRef: string;
    readonly now?: Date;
  },
): Promise<Result<{ readonly recoveryCodes: readonly string[] }, ServiceError>> {
  const now = input.now ?? new Date();
  if (
    !(await isStaffFactorFresh(db, {
      accountId: input.accountId,
      sessionRef: input.sessionRef,
      maxAgeMs: STAFF_FACTOR_FRESH_MS,
      now,
    }))
  ) {
    return err(serviceError('step_up_required', 'Enter your authenticator code first.'));
  }
  const codes = newRecoveryCodes(input.accountId);
  const written = await db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.staffSecondFactors)
      .set({ recoveryCodeHashes: codes.hashes, updatedAt: now })
      .where(
        and(
          eq(schema.staffSecondFactors.accountId, input.accountId),
          eq(schema.staffSecondFactors.status, 'ACTIVE'),
        ),
      )
      .returning({ accountId: schema.staffSecondFactors.accountId });
    if (updated.length === 0) return false;
    await appendAuditEvent(tx, {
      eventType: 'STAFF_RECOVERY_CODES_REGENERATED',
      actorAccountId: input.accountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'staff_second_factor',
      resourceId: input.accountId,
      metadata: { recoveryCodes: codes.hashes.length },
    });
    return true;
  });
  if (!written) return err(serviceError('not_found', 'No authenticator is set up.'));
  return ok({ recoveryCodes: codes.shown });
}

/**
 * The platform owner clears another staff member's authenticator (a lost phone with no backup
 * codes). Never your own: that is a documented manual procedure. Needs a recent sign-in and a
 * written reason, and is audited.
 */
export async function resetStaffSecondFactor(
  db: Db,
  input: {
    readonly actor: PlatformAuthInput;
    readonly targetAccountId: string;
    readonly reason: string;
    readonly stepUpSatisfied: boolean;
  },
): Promise<Result<void, ServiceError>> {
  if (!input.stepUpSatisfied) {
    return err(serviceError('step_up_required', 'Sign in again to reset an authenticator.'));
  }
  if (!(await isPlatformOwner(db, input.actor))) {
    return err(serviceError('forbidden', 'Only a platform owner can reset an authenticator.'));
  }
  if (input.targetAccountId === input.actor.accountId) {
    return err(
      serviceError('forbidden', 'You cannot reset your own authenticator. Ask another owner.'),
    );
  }
  const reason = input.reason.trim();
  if (reason.length === 0) return err(serviceError('invalid', 'Write a reason for the reset.'));
  try {
    return await db.transaction(async (tx) => {
      const deleted = await tx
        .delete(schema.staffSecondFactors)
        .where(eq(schema.staffSecondFactors.accountId, input.targetAccountId))
        .returning({ accountId: schema.staffSecondFactors.accountId });
      if (deleted.length === 0) {
        return err(serviceError('not_found', 'That person has no authenticator set up.'));
      }
      await appendAuditEvent(tx, {
        eventType: 'STAFF_SECOND_FACTOR_RESET',
        actorAccountId: input.actor.accountId,
        method: 'MANUAL',
        result: 'ALLOWED',
        resourceType: 'staff_second_factor',
        resourceId: input.targetAccountId,
        reason,
      });
      return ok(undefined);
    });
  } catch (error) {
    if (isMissingTable(error)) return err(UNAVAILABLE);
    throw error;
  }
}

export interface StaffFactorCoverage {
  readonly staff: number;
  readonly enrolled: number;
}

/** How many accounts hold an active platform role, and how many of them have an active authenticator. */
export async function staffFactorCoverage(db: Db): Promise<StaffFactorCoverage | null> {
  try {
    const staffRows = await db
      .selectDistinct({ accountId: schema.platformRoles.accountId })
      .from(schema.platformRoles)
      .where(isNull(schema.platformRoles.revokedAt));
    const accountIds = staffRows.flatMap((row) => (row.accountId ? [row.accountId] : []));
    const activeIds = await db
      .select({ accountId: schema.staffSecondFactors.accountId })
      .from(schema.staffSecondFactors)
      .where(eq(schema.staffSecondFactors.status, 'ACTIVE'));
    const enrolled = new Set(activeIds.map((row) => row.accountId));
    return {
      staff: accountIds.length,
      enrolled: accountIds.filter((id) => enrolled.has(id)).length,
    };
  } catch (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
}
