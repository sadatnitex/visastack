import { randomBytes } from 'node:crypto';
import { type Result, err, ok } from '@visastack/core';
import {
  type SQL,
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lte,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import { type SelfScope, type SystemScope, selfScopeProblem } from './access/principal';
import { appendAuditEvent } from './audit';
import { invoiceLedgerReader } from './billing';
import { type Db, first, required, schema } from './db';
import { type ServiceError, refusal, serviceError } from './errors';
import {
  REFUNDED_INVOICE_MESSAGE,
  applyInvoiceCollection,
  invoiceHasRefund,
  invoiceLedgerPresent,
  normalizeCurrency,
  outstandingMinorUnits,
} from './invoice-ledger';
import { isMissingRelationError } from './missing-relation';
import { isOrgAdmin } from './organizations';
import { providerShareDeadline } from './payment-resolver';
import { PERSON_SELLING_OFF, ownPersonInvoice, personAttemptWriter } from './person-billing';
import {
  type PaymentMode,
  attemptColumns,
  attemptModeColumn,
  entitlementsSchemaPresent,
  gatewayServesMode,
} from './plans-schema';
import { isPlatformOwner } from './platform-roles';
import type { PaymentPort, PaymentPortResolver, PaymentValidation } from './ports';
import { RATE_LIMITS, checkRateLimit, checkRateLimits } from './rate-limit';
import { personBillingPresent } from './traveller-billing';
import { travellerPlansEnabled } from './traveller-plan';

/**
 * Online invoice payments through a hosted gateway (Small Commercial V1 S11, ADR 0020).
 *
 * The one rule behind everything here: money is counted only when the gateway itself says so, in
 * a call VisaStack makes to it with its own credentials. A browser coming back from the payment
 * page, a callback posted to a public address, a signature that looks right: none of these is
 * evidence of money. They only tell VisaStack which payment to ask the gateway about. So:
 *
 * - `startOnlinePayment` creates an attempt (bound to exactly one invoice by a random, never
 *   reused transaction id) and sends the payer to the gateway.
 * - `settlePaymentAttempt` is the single place an attempt moves. The gateway callback, the
 *   browser return, the daily reconciliation and the invoice screen all call it, so a payment
 *   that arrives through three routes is still judged by the same checks and recorded once.
 * - Counting money goes through `applyInvoiceCollection` (the ledger's one recording function),
 *   in the same transaction as the attempt's own move to `RECORDED`. The ledger's unique keys
 *   (source = this attempt; provider + the gateway's payment id) make a second recording
 *   impossible even if every check above failed.
 *
 * What is never done: trusting an amount, currency, status or invoice named by a callback; acting
 * on a failure reported by a callback (it is confirmed with the gateway first, so a forged
 * "failed" cannot disturb a real payment); letting a payment for one invoice land on another; or
 * storing or logging a card detail, a store credential or the gateway's raw reply. Audit records
 * carry ids, kinds and plain codes only.
 *
 * Every function tolerates migration 0096 not having run: it reports "not available yet" and
 * writes nothing.
 */

export type PaymentAttempt = typeof schema.paymentAttempts.$inferSelect;
export type PaymentAttemptStatus = PaymentAttempt['status'];

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
/** A payment started this recently is offered for checking before another is started. */
export const RECENT_ATTEMPT_MS = 30 * MINUTE_MS;
/** Reconciliation leaves a payment alone for this long, to give the callback the first go. */
export const RECONCILE_MIN_AGE_MS = 15 * MINUTE_MS;
/** A payment still unconfirmed this long after the payer was sent away is closed as expired. */
export const EXPIRE_AFTER_MS = 24 * HOUR_MS;
/** A late success after expiry is still found and recorded for this long. */
export const LATE_SUCCESS_WINDOW_MS = 7 * 24 * HOUR_MS;
/** An attempt that never reached the gateway is closed after this long. */
const STALE_CREATED_MS = HOUR_MS;
const START_TIMEOUT_MS = 15_000;

const MERCHANT_TRAN_ID = /^VSP[0-9a-f]{26}$/;
const VAL_ID = /^[A-Za-z0-9]{6,64}$/;

/** A new transaction id: unguessable (104 random bits), fits the gateway's length limit, never reused. */
export function newMerchantTranId(): string {
  return `VSP${randomBytes(13).toString('hex')}`;
}

export function isMerchantTranId(value: string): boolean {
  return MERCHANT_TRAN_ID.test(value);
}

// --- Deciding what a gateway answer means (pure) -------------------------------------------

export type SettlementPath = 'validation' | 'query';

export type SettlementDecision =
  /** The answer does not describe this payment (or is not a real answer): change nothing. */
  | { readonly kind: 'reject'; readonly reason: 'provider_invalid' | 'transaction_mismatch' }
  /** Still in progress at the gateway: change nothing. */
  | { readonly kind: 'wait' }
  /** The payment ended without money: failed, cancelled or expired. */
  | { readonly kind: 'close'; readonly status: 'FAILED' | 'CANCELLED' | 'EXPIRED' }
  /** The gateway confirms money that VisaStack must not count yet. */
  | {
      readonly kind: 'hold';
      readonly reason: 'mismatch' | 'risky_payment' | 'risk_unknown';
      readonly checks: readonly string[];
    }
  /** Every check passed: count it. */
  | { readonly kind: 'record'; readonly valId: string };

export interface DecideSettlementInput {
  readonly attempt: Pick<
    PaymentAttempt,
    'merchantTranId' | 'amountMinorUnits' | 'currency' | 'status' | 'redirectedAt'
  >;
  readonly validation: PaymentValidation;
  readonly path: SettlementPath;
  /** The validation id the gateway was asked about (validation path only). */
  readonly requestedValId: string | null;
  /** The merchant this deployment is configured for. */
  readonly storeId: string | null;
  readonly now: Date;
  /** True for reconciliation and screen refreshes, which may close a payment that never finished. */
  readonly mayExpire: boolean;
}

/**
 * What a gateway answer means for an attempt. Pure, so every rule is testable without a
 * database. Checks run in a fixed order and each one that fails is named.
 */
export function decideSettlement(input: DecideSettlementInput): SettlementDecision {
  const { attempt, validation: v } = input;
  if (v.status === 'INVALID') return { kind: 'reject', reason: 'provider_invalid' };

  // The answer must be about this attempt. A query was made by this attempt's id, so the gateway
  // naming no id is acceptable there; a validation was made by a validation id, which proves
  // nothing about which payment it belongs to unless the gateway names this attempt.
  const named =
    input.path === 'query' ? (v.merchantTranId ?? attempt.merchantTranId) : v.merchantTranId;
  if (named !== attempt.merchantTranId) return { kind: 'reject', reason: 'transaction_mismatch' };

  switch (v.status) {
    case 'PENDING':
    case 'UNATTEMPTED': {
      const startedAt = attempt.redirectedAt;
      if (
        input.mayExpire &&
        attempt.status === 'REDIRECTED' &&
        startedAt !== null &&
        input.now.getTime() - startedAt.getTime() >= EXPIRE_AFTER_MS
      ) {
        return { kind: 'close', status: 'EXPIRED' };
      }
      return { kind: 'wait' };
    }
    case 'FAILED':
      return { kind: 'close', status: 'FAILED' };
    case 'CANCELLED':
      return { kind: 'close', status: 'CANCELLED' };
    case 'EXPIRED':
      return { kind: 'close', status: 'EXPIRED' };
    default:
      break;
  }

  // VALID or VALIDATED: the gateway says money was received. Every check must pass.
  const checks: string[] = [];
  const valId = v.valId ?? (input.path === 'validation' ? input.requestedValId : null);
  if (
    valId === null ||
    (input.path === 'validation' && input.requestedValId !== null && valId !== input.requestedValId)
  ) {
    checks.push('payment_id');
  }
  if (v.amountMinorUnits !== attempt.amountMinorUnits) checks.push('amount');
  if (
    v.currency === null ||
    normalizeCurrency(v.currency) !== normalizeCurrency(attempt.currency)
  ) {
    checks.push('currency');
  }
  if (v.storeId !== null && input.storeId !== null && v.storeId !== input.storeId) {
    checks.push('store');
  }
  if (checks.length > 0 || valId === null) return { kind: 'hold', reason: 'mismatch', checks };
  if (v.riskLevel === 1) return { kind: 'hold', reason: 'risky_payment', checks: [] };
  if (v.riskLevel !== 0) return { kind: 'hold', reason: 'risk_unknown', checks: [] };
  return { kind: 'record', valId };
}

// --- Outcomes -------------------------------------------------------------------------------

export type SettlementCode =
  | 'recorded'
  | 'already_recorded'
  | 'held'
  /** Held money that staff refunded (S18). Final: nothing a gateway says later changes it. */
  | 'refunded'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'pending'
  /** The gateway said this is not a real answer for this payment; nothing changed. */
  | 'rejected'
  | 'unknown_transaction'
  /** The gateway or the ledger could not be used now; nothing was decided. The caller retries. */
  | 'unavailable'
  | 'not_configured'
  | 'rate_limited';

export interface SettlementOutcome {
  readonly code: SettlementCode;
  readonly attemptStatus: PaymentAttemptStatus | null;
}

function outcome(
  code: SettlementCode,
  attemptStatus: PaymentAttemptStatus | null = null,
): SettlementOutcome {
  return { code, attemptStatus };
}

/** The four plain results a payer is shown after coming back from the gateway. */
export type PaymentResultState = 'received' | 'confirming' | 'not_completed' | 'needs_check';

export function paymentResultState(status: PaymentAttemptStatus | null): PaymentResultState {
  switch (status) {
    case 'RECORDED':
      return 'received';
    case 'FAILED':
    case 'CANCELLED':
    case 'EXPIRED':
      return 'not_completed';
    case 'HELD_FOR_REVIEW':
    // Held money that was refunded (S18): the payer is told to check with VisaStack, never that
    // the payment was received or that nothing was charged.
    case 'REFUNDED':
      return 'needs_check';
    default:
      // CREATED, REDIRECTED, VALIDATED, or no attempt found yet: still being confirmed.
      return 'confirming';
  }
}

export type SettlementSource = 'ipn' | 'return' | 'reconcile' | 'refresh';

export interface SettlePaymentAttemptInput {
  readonly merchantTranId: string;
  /** The gateway's validation id, when the callback carried one. Used only as the thing to ask about. */
  readonly valId?: string | null;
  readonly source: SettlementSource;
  readonly now?: Date;
}

async function loadAttempt(db: Db, merchantTranId: string): Promise<PaymentAttempt | undefined> {
  return first(
    await db
      .select(attemptColumns())
      .from(schema.paymentAttempts)
      .where(eq(schema.paymentAttempts.merchantTranId, merchantTranId))
      .limit(1),
  );
}

/**
 * Judges one payment against the gateway and moves its attempt accordingly. Safe to call from any
 * number of routes, in any order, any number of times: a payment is recorded at most once, and a
 * call that cannot reach the gateway decides nothing. Never throws for a gateway failure (the
 * outcome is `unavailable`); a database failure other than the table being missing is thrown.
 */
export async function settlePaymentAttempt(
  db: Db,
  port: PaymentPort,
  input: SettlePaymentAttemptInput,
): Promise<SettlementOutcome> {
  if (!port.configured) return outcome('not_configured');
  if (!isMerchantTranId(input.merchantTranId)) return outcome('unknown_transaction');
  const now = input.now ?? new Date();
  const requestedValId =
    typeof input.valId === 'string' && VAL_ID.test(input.valId.trim()) ? input.valId.trim() : null;

  try {
    const attempt = await loadAttempt(db, input.merchantTranId);
    if (!attempt || attempt.provider !== port.provider) return outcome('unknown_transaction');
    if (attempt.status === 'RECORDED') return outcome('already_recorded', attempt.status);
    if (attempt.status === 'HELD_FOR_REVIEW') return outcome('held', attempt.status);
    if (attempt.status === 'REFUNDED') return outcome('refunded', attempt.status);
    // S29: a payment started in the other mode (test or live) is never judged by this gateway: it
    // belongs to a different store (`gatewayServesMode`). A test payment still open when the
    // gateway went live is closed as expired (mode_changed). A live payment seen while the gateway
    // is in test mode is real money that may still arrive: it stays exactly as it is, unasked, so
    // the usual checks (including a late success) judge it once the live gateway is back.
    if (!gatewayServesMode(port, attempt.mode)) {
      return attempt.mode === 'TEST'
        ? expireForModeChange(db, attempt, input.source, now)
        : outcome('pending', attempt.status);
    }

    // Each payment may make VisaStack call the gateway only so often, so a stream of callbacks
    // for one real payment cannot be turned into a stream of calls to the gateway.
    if (input.source !== 'reconcile') {
      const allowed = await checkRateLimit(
        db,
        { subjectId: attempt.merchantTranId, action: 'payments.callback', label: 'payment' },
        RATE_LIMITS.PAYMENT_CALLBACK_TRAN,
        now,
      );
      if (!allowed.allowed) return outcome('rate_limited', attempt.status);
    }

    let validation: PaymentValidation;
    const path: SettlementPath = requestedValId === null ? 'query' : 'validation';
    try {
      validation =
        requestedValId === null
          ? await port.queryByMerchantTranId(attempt.merchantTranId)
          : await port.validatePayment({ valId: requestedValId });
    } catch {
      // Whatever went wrong, no decision may be made. The gateway retries its callback and the
      // reconciliation job asks again.
      return outcome('unavailable', attempt.status);
    }

    const decision = decideSettlement({
      attempt,
      validation,
      path,
      requestedValId,
      storeId: port.storeId,
      now,
      mayExpire: input.source === 'reconcile' || input.source === 'refresh',
    });
    return await applyDecision(db, port, attempt, validation, decision, input.source, now);
  } catch (error) {
    if (isMissingRelationError(error)) return outcome('unavailable');
    throw error;
  }
}

/** Closes an open payment that was started in the other gateway mode (S29). Idempotent. */
async function expireForModeChange(
  db: Db,
  seen: PaymentAttempt,
  source: SettlementSource,
  now: Date,
): Promise<SettlementOutcome> {
  return db.transaction(async (tx) => {
    const attempts = schema.paymentAttempts;
    const attempt = first(
      await tx
        .select(attemptColumns())
        .from(attempts)
        .where(eq(attempts.id, seen.id))
        .limit(1)
        .for('update'),
    );
    if (!attempt) return outcome('unknown_transaction');
    if (attempt.status !== 'CREATED' && attempt.status !== 'REDIRECTED') {
      return outcome(closeCode(attempt.status), attempt.status);
    }
    await tx
      .update(attempts)
      .set({ status: 'EXPIRED', reasonCode: MODE_CHANGED, lastCheckedAt: now, updatedAt: now })
      .where(eq(attempts.id, attempt.id));
    await auditAttemptMove(tx, attempt, 'EXPIRED', source, MODE_CHANGED);
    return outcome('expired', 'EXPIRED');
  });
}

/** The reason an open payment closes when the gateway mode changed under it (S29). */
export const MODE_CHANGED = 'mode_changed';

async function applyDecision(
  db: Db,
  port: PaymentPort,
  seen: PaymentAttempt,
  validation: PaymentValidation,
  decision: SettlementDecision,
  source: SettlementSource,
  now: Date,
): Promise<SettlementOutcome> {
  if (decision.kind === 'reject') {
    await recordRejectedPaymentCallback(db, {
      reason: decision.reason,
      source,
      attemptId: seen.id,
    });
    return outcome('rejected', seen.status);
  }

  const providerStatus = validation.status;
  return db.transaction(async (tx) => {
    const attempts = schema.paymentAttempts;
    // The attempt is locked for the whole decision, so two callbacks for one payment take turns.
    const attempt = first(
      await tx
        .select(attemptColumns())
        .from(attempts)
        .where(eq(attempts.id, seen.id))
        .limit(1)
        .for('update'),
    );
    if (!attempt) return outcome('unknown_transaction');
    if (attempt.status === 'RECORDED') return outcome('already_recorded', attempt.status);
    if (attempt.status === 'HELD_FOR_REVIEW') return outcome('held', attempt.status);
    if (attempt.status === 'REFUNDED') return outcome('refunded', attempt.status);

    const touch = {
      lastProviderStatus: providerStatus,
      lastCheckedAt: now,
      updatedAt: now,
    } as const;

    if (decision.kind === 'wait') {
      await tx.update(attempts).set(touch).where(eq(attempts.id, attempt.id));
      return outcome('pending', attempt.status);
    }

    if (decision.kind === 'close') {
      const open = attempt.status === 'CREATED' || attempt.status === 'REDIRECTED';
      if (!open) {
        // Already closed one way; a later report of another failure changes nothing.
        await tx.update(attempts).set(touch).where(eq(attempts.id, attempt.id));
        return outcome(closeCode(attempt.status), attempt.status);
      }
      await tx
        .update(attempts)
        .set({ ...touch, status: decision.status })
        .where(eq(attempts.id, attempt.id));
      await auditAttemptMove(tx, attempt, decision.status, source, null);
      return outcome(closeCode(decision.status), decision.status);
    }

    // The payment ids are stored when no other attempt already holds the same gateway payment id.
    const gatewayValId = decision.kind === 'record' ? decision.valId : validation.valId;
    let valIdTaken = false;
    if (gatewayValId) {
      const holder = first(
        await tx
          .select({ id: attempts.id })
          .from(attempts)
          .where(
            and(eq(attempts.provider, port.provider), eq(attempts.providerValId, gatewayValId)),
          )
          .limit(1),
      );
      valIdTaken = holder !== undefined && holder.id !== attempt.id;
    }
    const evidence = {
      ...touch,
      ...(gatewayValId && !valIdTaken && attempt.providerValId === null
        ? { providerValId: gatewayValId }
        : {}),
      ...(validation.bankTranId ? { bankTranId: validation.bankTranId.slice(0, 100) } : {}),
      ...(validation.riskLevel !== null ? { riskLevel: validation.riskLevel } : {}),
    };

    const hold = async (reason: string, checks: readonly string[]): Promise<SettlementOutcome> => {
      await tx
        .update(attempts)
        .set({ ...evidence, status: 'HELD_FOR_REVIEW', reasonCode: reason })
        .where(eq(attempts.id, attempt.id));
      await auditAttemptMove(tx, attempt, 'HELD_FOR_REVIEW', source, reason, checks);
      if (reason === 'mismatch') {
        await appendAuditEvent(tx, {
          eventType: 'PAYMENT_VALIDATION_MISMATCH',
          actorAccountId: null,
          method: 'API',
          result: 'DENIED',
          resourceType: 'payment_attempt',
          resourceId: attempt.id,
          metadata: {
            invoiceId: attempt.invoiceId,
            organizationId: attempt.organizationId,
            source,
            checks: [...checks],
          },
        });
      }
      return outcome('held', 'HELD_FOR_REVIEW');
    };

    if (decision.kind === 'hold') {
      return hold(decision.reason, decision.checks);
    }

    // decision.kind === 'record'
    if (valIdTaken) return hold('mismatch', ['payment_id']);
    const reference = (validation.bankTranId ?? decision.valId).slice(0, 100);
    const applied = await applyInvoiceCollection(tx, {
      invoiceId: attempt.invoiceId,
      amountMinorUnits: attempt.amountMinorUnits,
      currency: attempt.currency,
      kind: 'ONLINE',
      sourceId: attempt.id,
      provider: port.provider,
      providerTransactionId: decision.valId,
      reference,
      collectedDate: now,
      recordedByAccountId: null,
    });
    if (!applied.ok) {
      switch (applied.error.code) {
        case 'unavailable':
          // The cash ledger is not there yet: decide nothing, try again after it is.
          return outcome('unavailable', attempt.status);
        case 'exceeds_outstanding':
          // Cash received is never lost: the invoice was settled another way meanwhile.
          return hold('already_paid', []);
        case 'void_invoice':
          return hold('invoice_void', []);
        case 'refunded_invoice':
          // S18 (D2): the invoice was refunded meanwhile and is never owed again.
          return hold('invoice_refunded', []);
        case 'already_covered':
          // ADR 0025: a person paid for a period another paid invoice of theirs already covers
          // (two tabs, two payments). Kept for a refund or a credit, never counted twice.
          return hold('already_covered', []);
        case 'currency_mismatch':
          return hold('mismatch', ['currency']);
        case 'key_conflict':
          return hold('key_conflict', []);
        default:
          return hold('not_recordable', []);
      }
    }
    await tx
      .update(attempts)
      .set({
        ...evidence,
        status: 'RECORDED',
        recordedAt: now,
        providerValId: decision.valId,
      })
      .where(eq(attempts.id, attempt.id));
    await auditAttemptMove(tx, attempt, 'RECORDED', source, null);
    return outcome(applied.value.alreadyRecorded ? 'already_recorded' : 'recorded', 'RECORDED');
  });
}

function closeCode(status: PaymentAttemptStatus): SettlementCode {
  if (status === 'CANCELLED') return 'cancelled';
  if (status === 'EXPIRED') return 'expired';
  return 'failed';
}

async function auditAttemptMove(
  tx: Db,
  attempt: PaymentAttempt,
  to: PaymentAttemptStatus,
  source: SettlementSource | 'start',
  reasonCode: string | null,
  checks: readonly string[] = [],
): Promise<void> {
  await appendAuditEvent(tx, {
    eventType: 'PAYMENT_ATTEMPT_STATUS_CHANGED',
    actorAccountId: null,
    method: 'API',
    result: 'ALLOWED',
    resourceType: 'payment_attempt',
    resourceId: attempt.id,
    reason: reasonCode,
    metadata: {
      invoiceId: attempt.invoiceId,
      organizationId: attempt.organizationId,
      from: attempt.status,
      to,
      source,
      amountMinorUnits: attempt.amountMinorUnits,
      currency: attempt.currency,
      ...(checks.length > 0 ? { checks: [...checks] } : {}),
    },
  });
}

/**
 * Audits a payment callback that was refused outright (a signature that did not verify, an answer
 * that did not describe the payment). Counts and kinds only. Audited at most
 * `RATE_LIMITS.PAYMENT_REJECT_AUDIT` times an hour in total, so junk posted to a public address
 * cannot flood the audit chain. Best effort: a failure here never changes the response.
 */
export async function recordRejectedPaymentCallback(
  db: Db,
  input: {
    readonly reason:
      | 'bad_signature'
      | 'provider_invalid'
      | 'transaction_mismatch'
      | 'unknown_transaction';
    readonly source: SettlementSource;
    readonly attemptId?: string | null;
  },
): Promise<void> {
  try {
    const allowed = await checkRateLimit(
      db,
      { subjectId: 'all', action: 'payments.reject_audit', label: 'payment' },
      RATE_LIMITS.PAYMENT_REJECT_AUDIT,
    );
    if (!allowed.allowed) return;
    await db.transaction(async (tx) => {
      await appendAuditEvent(tx, {
        eventType: 'PAYMENT_CALLBACK_REJECTED',
        actorAccountId: null,
        method: 'API',
        result: 'DENIED',
        resourceType: 'payment_attempt',
        resourceId: input.attemptId ?? null,
        reason: input.reason,
        metadata: { source: input.source },
      });
    });
  } catch {
    // Auditing a refusal must never turn a refused callback into an error response.
  }
}

// --- Starting a payment ----------------------------------------------------------------------

export type StartedPayment =
  | { readonly kind: 'redirect'; readonly attemptId: string; readonly redirectUrl: string }
  /** A payment for this invoice was started recently: show it before starting another. */
  | { readonly kind: 'recent_attempt'; readonly attemptId: string; readonly startedAt: Date };

export type PaymentReturnKind = 'success' | 'fail' | 'cancel' | 'ipn';

export interface StartOnlinePaymentInput {
  readonly actorAccountId: string;
  readonly invoiceId: string;
  /**
   * The absolute address the gateway should send this payer or its server to. `provider` is the
   * stored name of the provider the payment starts on (S19 step 0), so each provider gets its own
   * callback addresses.
   */
  readonly urlFor: (kind: PaymentReturnKind, merchantTranId: string, provider: string) => string;
  /** True once the person has seen a recent unfinished payment and still wants a new one. */
  readonly startAnother?: boolean;
  /**
   * The person's sign-in email and the bootstrap owner list, to recognise the platform owner while
   * the gateway is in test mode (S29). Not needed in live mode.
   */
  readonly actorEmail?: string;
  readonly bootstrapEmails?: readonly string[];
  readonly now?: Date;
  /** How long the gateway may take to open a payment page. Defaults to 15 seconds; tests shorten it. */
  readonly timeoutMs?: number;
}

type PreparedStart =
  | { readonly kind: 'recent'; readonly attemptId: string; readonly startedAt: Date }
  | {
      readonly kind: 'created';
      readonly port: PaymentPort;
      readonly attempt: PaymentAttempt;
      readonly amount: number;
      readonly invoiceRef: string;
      readonly customer: { readonly name: string; readonly email: string };
    };

/** A payment still being opened (a minute) or sent to the gateway less than 30 minutes ago. */
const IN_FLIGHT_START_MS = MINUTE_MS;
export function isRecentAttempt(
  attempt: Pick<PaymentAttempt, 'status' | 'createdAt' | 'redirectedAt'>,
  now: Date,
): boolean {
  if (attempt.status === 'CREATED') {
    return now.getTime() - attempt.createdAt.getTime() < IN_FLIGHT_START_MS;
  }
  return (
    attempt.status === 'REDIRECTED' &&
    attempt.redirectedAt !== null &&
    now.getTime() - attempt.redirectedAt.getTime() < RECENT_ATTEMPT_MS
  );
}

const NOT_AVAILABLE = 'Online payment is not available yet. Please try again later.';

/**
 * Said to the payer while a payment of the invoice is stranded (`isStrandedAttempt`, S19 step 0
 * rounds 2 and 3): nobody can ask its gateway about it, so a new payment could charge twice.
 */
export const PAYMENT_METHOD_OFF =
  'Your earlier payment was started with a payment method that is switched off now. Contact us before paying again, so you are not charged twice.';

/**
 * A payment whose money is still uncertain (S19 step 0 round 5): sent to the payment page (still
 * REDIRECTED, or closed as EXPIRED, for whatever reason) no longer ago than the late-success
 * window. The daily check's late-success selection is this condition with EXPIRED (it keeps asking
 * the gateway about those, because they can still succeed late), and a stranded payment is this
 * condition for a LIVE payment whose provider is switched off. One condition, so the two never
 * drift apart: `stillUncertainSql` for queries, `isStillUncertain` for rows already read.
 */
export function stillUncertainSql(now: Date): SQL {
  const attempts = schema.paymentAttempts;
  return and(
    inArray(attempts.status, ['REDIRECTED', 'EXPIRED']),
    gte(attempts.redirectedAt, new Date(now.getTime() - LATE_SUCCESS_WINDOW_MS)),
  ) as SQL;
}

/** `stillUncertainSql` for a row already read. */
export function isStillUncertain(
  attempt: Pick<PaymentAttempt, 'status' | 'redirectedAt'>,
  now: Date,
): boolean {
  return (
    (attempt.status === 'REDIRECTED' || attempt.status === 'EXPIRED') &&
    attempt.redirectedAt !== null &&
    attempt.redirectedAt.getTime() >= now.getTime() - LATE_SUCCESS_WINDOW_MS
  );
}

/**
 * The one definition of a stranded payment (S19 step 0, rounds 3 to 5): a LIVE payment whose money
 * is still uncertain (`isStillUncertain`: the gateway may have taken real money, and the daily
 * check would still ask it), made with a provider that is not configured here now, so nobody can
 * ask. Only such a payment stops a new one. A test payment (no real money), one that never reached
 * the gateway (CREATED) and one older than the window never block; the daily check still counts
 * the open ones for staff. A REDIRECTED payment older than the window is still asked once by the
 * daily check (to close it), but never blocks, so an invoice can never be blocked for good.
 * `hasStrandedAttempt` is the same rule as one query.
 */
export function isStrandedAttempt(
  attempt: Pick<PaymentAttempt, 'status' | 'redirectedAt' | 'provider' | 'mode'>,
  configuredProviders: readonly string[],
  now: Date,
): boolean {
  return (
    attempt.mode === 'LIVE' &&
    isStillUncertain(attempt, now) &&
    !configuredProviders.includes(attempt.provider)
  );
}

/** Whether any payment of this invoice is stranded (`isStrandedAttempt`), as one indexed probe. */
async function hasStrandedAttempt(
  db: Db,
  invoiceId: string,
  configuredProviders: readonly string[],
  now: Date,
): Promise<boolean> {
  const attempts = schema.paymentAttempts;
  const found = await db
    .select({ id: attempts.id })
    .from(attempts)
    .where(
      and(
        eq(attempts.invoiceId, invoiceId),
        eq(attemptModeColumn(), 'LIVE'),
        stillUncertainSql(now),
        configuredProviders.length === 0
          ? undefined
          : notInArray(attempts.provider, [...configuredProviders]),
      ),
    )
    .limit(1);
  return found.length > 0;
}

/**
 * What an agency is told while the gateway is in test mode (S29): a test payment would mark a real
 * invoice paid, so only the platform owner may make one.
 */
export const TEST_PAYMENTS_ONLY =
  'Online payment is being tested right now, so it is not open to agencies yet. Nothing was charged. Please pay another way or try again later.';
const START_FAILED = 'We could not open the payment page. Nothing was charged. Try again.';

/**
 * Starts paying the whole outstanding balance of one invoice online. Only an owner or admin of
 * the agency the invoice belongs to may do it; anyone else sees "not found", exactly as for an
 * invoice that does not exist. Online payment covers invoices that are open or part paid, in a
 * currency a configured provider takes (S19 step 0: the earliest provider in the owner's order that
 * takes the invoice's currency; with SSLCOMMERZ alone, taka only). If the gateway cannot open a
 * page (or takes longer than 15 seconds) the attempt is closed as failed: the payer never reached
 * the gateway, so no money can have moved.
 */
export async function startOnlinePayment(
  db: Db,
  payments: PaymentPortResolver,
  input: StartOnlinePaymentInput,
): Promise<Result<StartedPayment, ServiceError>> {
  const offered = payments.configured();
  const fallback = offered[0];
  if (fallback === undefined) return err(serviceError('invalid', NOT_AVAILABLE));
  const now = input.now ?? new Date();
  try {
    // S29: every attempt records its mode, which needs migration 0107.
    if (!(await entitlementsSchemaPresent(db))) return err(serviceError('invalid', NOT_AVAILABLE));
    // An agency invoice only (ADR 0025): a person pays their own invoice through the person
    // checkout, never here, so it reads as not found before any membership check.
    const invoice = first(
      await db
        .select()
        .from(schema.invoices)
        .where(
          and(eq(schema.invoices.id, input.invoiceId), isNotNull(schema.invoices.organizationId)),
        )
        .limit(1),
    );
    if (!invoice || !(await isOrgAdmin(db, input.actorAccountId, invoice.organizationId))) {
      return err(serviceError('not_found', 'invoice not found'));
    }
    return await openInvoicePayment(
      db,
      payments,
      { id: invoice.id, currency: invoice.currency },
      {
        payerLimit: {
          subjectId: invoice.organizationId,
          action: 'payments.start_org',
          config: RATE_LIMITS.PAYMENT_START_ORG,
        },
        audit: { organizationId: invoice.organizationId },
        customerName: async (tx) =>
          first(
            await tx
              .select({ name: schema.organizations.name })
              .from(schema.organizations)
              .where(eq(schema.organizations.id, invoice.organizationId))
              .limit(1),
          )?.name ?? null,
        insertAttempt: async (tx, values) =>
          required(
            first(
              await tx
                .insert(schema.paymentAttempts)
                .values({ ...values, organizationId: invoice.organizationId })
                .returning(attemptColumns()),
            ),
            'payment attempt',
          ),
      },
      { ...input, now },
      fallback,
    );
  } catch (error) {
    if (isMissingRelationError(error)) return err(serviceError('invalid', NOT_AVAILABLE));
    throw error;
  }
}

export interface StartPersonPaymentInput {
  readonly invoiceId: string;
  readonly urlFor: (kind: PaymentReturnKind, merchantTranId: string, provider: string) => string;
  readonly startAnother?: boolean;
  /** The person's sign-in email and the bootstrap owner list, for test mode (owner only). */
  readonly actorEmail?: string;
  readonly bootstrapEmails?: readonly string[];
  readonly now?: Date;
  readonly timeoutMs?: number;
}

/**
 * Starts the online payment of the signed-in person's own purchase invoice (ADR 0025), through the
 * same opening as an agency's: in test mode only the platform owner may pay, and the person's own
 * start allowance applies (there is no agency allowance to share). An invoice whose payer is
 * anyone else reads as not found. Waits for `TRAVELLER_PLANS_ENABLED` and migrations 0110 and 0111.
 */
export async function startPersonPayment(
  db: Db,
  payments: PaymentPortResolver,
  self: SelfScope,
  input: StartPersonPaymentInput,
): Promise<Result<StartedPayment, ServiceError>> {
  const denied = selfScopeProblem(self);
  if (denied) return err(denied);
  if (!travellerPlansEnabled()) return err(refusal('selling_off', PERSON_SELLING_OFF));
  const fallback = payments.configured()[0];
  if (fallback === undefined) return err(serviceError('invalid', NOT_AVAILABLE));
  const now = input.now ?? new Date();
  try {
    if (!(await personBillingPresent(db))) return err(serviceError('invalid', NOT_AVAILABLE));
    const invoice = await ownPersonInvoice(db, self, input.invoiceId);
    if (!invoice) return err(serviceError('not_found', 'invoice not found'));
    const accountId = self.accountId;
    return await openInvoicePayment(
      db,
      payments,
      invoice,
      {
        payerLimit: null,
        audit: { payerKind: 'person' },
        // The payment page shows the part of the email before the @, never a stored name.
        customerName: async (tx) => {
          const row = first(
            await tx
              .select({ email: schema.accounts.email })
              .from(schema.accounts)
              .where(eq(schema.accounts.id, accountId))
              .limit(1),
          );
          return row ? (row.email.split('@')[0] ?? row.email) : null;
        },
        insertAttempt: personAttemptWriter(self),
      },
      {
        actorAccountId: accountId,
        invoiceId: invoice.id,
        urlFor: input.urlFor,
        ...(input.startAnother !== undefined ? { startAnother: input.startAnother } : {}),
        ...(input.actorEmail !== undefined ? { actorEmail: input.actorEmail } : {}),
        ...(input.bootstrapEmails !== undefined ? { bootstrapEmails: input.bootstrapEmails } : {}),
        ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
        now,
      },
      fallback,
    );
  } catch (error) {
    if (isMissingRelationError(error)) return err(serviceError('invalid', NOT_AVAILABLE));
    throw error;
  }
}

/** The columns of a new payment attempt that do not name its payer (ADR 0025). */
export interface NewAttemptValues {
  readonly invoiceId: string;
  readonly provider: string;
  readonly merchantTranId: string;
  readonly amountMinorUnits: number;
  readonly currency: string;
  readonly status: 'CREATED';
  readonly mode: PaymentMode;
  readonly initiatedByAccountId: string;
}

/**
 * Who pays an invoice online, for `openInvoicePayment` (ADR 0025): an agency or a person. The
 * caller has already found the invoice and checked that this payer may pay it; this says how the
 * payer is limited, named, recorded and audited.
 */
export interface InvoicePaymentPayer {
  /** A second start allowance after the person's own (an agency's); none for a person. */
  readonly payerLimit: {
    readonly subjectId: string;
    readonly action: string;
    readonly config: (typeof RATE_LIMITS)[keyof typeof RATE_LIMITS];
  } | null;
  /** Ids added to the audit record of the start (never a name or an email). */
  readonly audit: Readonly<Record<string, string>>;
  /** The name the payment page shows, read under the invoice lock; null reads as not found. */
  readonly customerName: (tx: Db) => Promise<string | null>;
  /** Writes the attempt row with its payer. */
  readonly insertAttempt: (tx: Db, values: NewAttemptValues) => Promise<PaymentAttempt>;
}

/**
 * Opens an online payment for an invoice the caller has already found and authorized, for an agency
 * (`startOnlinePayment`) or a person (`startPersonPayment`): the provider for its currency, the
 * test-mode rule, the start allowances, then under the invoice lock its balance, a recent or
 * stranded payment and the new attempt, then the payment page. The refusals come in that order,
 * as they always have.
 */
async function openInvoicePayment(
  db: Db,
  payments: PaymentPortResolver,
  invoice: { readonly id: string; readonly currency: string },
  payer: InvoicePaymentPayer,
  input: StartOnlinePaymentInput & { readonly now: Date },
  fallback: PaymentPort,
): Promise<Result<StartedPayment, ServiceError>> {
  const now = input.now;
  // The provider that takes this invoice's currency. When none does, the first configured one
  // answers the test-mode question below, so the order of refusals is the one it always was
  // (with a single provider, exactly the same); the currency refusal itself comes in the
  // transaction, after the invoice's own state.
  const chosen = payments.forCurrency(invoice.currency);
  const gateMode = (chosen ?? fallback).mode;
  if (gateMode === null) return err(serviceError('invalid', NOT_AVAILABLE));
  const mode: PaymentMode = gateMode;
  // A test payment marks a real invoice paid, so in test mode only the platform owner may start
  // one (checked before anything is written or sent).
  if (
    mode === 'TEST' &&
    !(await isPlatformOwner(db, {
      accountId: input.actorAccountId,
      email: input.actorEmail ?? '',
      bootstrapEmails: input.bootstrapEmails ?? [],
    }))
  ) {
    return err(refusal('test_mode_owner_only', TEST_PAYMENTS_ONLY));
  }

  // The person first, then the agency: once a person is refused they cannot spend the rest of
  // the agency's allowance by trying again.
  const limited = await checkRateLimits(
    db,
    [
      {
        input: { subjectId: input.actorAccountId, action: 'payments.start', label: 'payment' },
        config: RATE_LIMITS.PAYMENT_START,
      },
      ...(payer.payerLimit
        ? [
            {
              input: {
                subjectId: payer.payerLimit.subjectId,
                action: payer.payerLimit.action,
                label: 'payment',
              },
              config: payer.payerLimit.config,
            },
          ]
        : []),
    ],
    now,
  );
  if (!limited.allowed) return err(serviceError('rate_limited', limited.reason));

  // The invoice row is locked while the balance, the recent-payment check and the new attempt
  // are settled, so two clicks arriving together cannot both start a payment.
  const attempts = schema.paymentAttempts;
  const merchantTranId = newMerchantTranId();
  const prepared = await db.transaction(
    async (tx): Promise<Result<PreparedStart, ServiceError>> => {
      const locked = first(
        await tx
          .select()
          .from(schema.invoices)
          .where(eq(schema.invoices.id, invoice.id))
          .limit(1)
          .for('update'),
      );
      if (!locked) return err(serviceError('not_found', 'invoice not found'));
      if (locked.status === 'PAID') {
        return err(serviceError('invalid', 'This invoice is already paid.'));
      }
      if (locked.status !== 'OPEN' && locked.status !== 'PARTIALLY_PAID') {
        return err(serviceError('invalid', 'This invoice cannot be paid online.'));
      }
      // Read in the invoice's stored currency, under the lock: the provider must be the one
      // chosen above (the same currency), or nothing starts.
      const port = payments.forCurrency(locked.currency);
      if (port === null || port !== chosen) {
        return err(refusal('currency_not_offered', payments.currencyRefusal));
      }
      const amount = outstandingMinorUnits(
        locked.invoicedAmountMinorUnits,
        locked.collectedAmountMinorUnits,
      );
      if (amount <= 0) return err(serviceError('invalid', 'This invoice is already paid.'));
      // Without the ledger no payment could be counted safely, so none is started.
      if (!(await invoiceLedgerPresent(tx))) return err(serviceError('invalid', NOT_AVAILABLE));
      // S18 (D2): a refunded invoice is never owed again, so it is never paid again either.
      if (await invoiceHasRefund(tx, locked.id)) {
        return err(serviceError('invalid', REFUNDED_INVOICE_MESSAGE));
      }

      // S19 step 0: a stranded payment (`isStrandedAttempt`) cannot be checked, so no other
      // payment starts for this invoice, even on purpose.
      const configuredProviders = payments.configured().map((port) => port.provider);
      if (await hasStrandedAttempt(tx, locked.id, configuredProviders, now)) {
        return err(refusal('provider_not_configured', PAYMENT_METHOD_OFF));
      }

      if (input.startAnother !== true) {
        const earlier = await tx
          .select(attemptColumns())
          .from(attempts)
          .where(
            and(
              eq(attempts.invoiceId, locked.id),
              inArray(attempts.status, ['CREATED', 'REDIRECTED']),
            ),
          )
          .orderBy(desc(attempts.createdAt))
          .limit(5);
        const recent = earlier.find((a) => isRecentAttempt(a, now));
        if (recent) {
          return ok({
            kind: 'recent',
            attemptId: recent.id,
            startedAt: recent.redirectedAt ?? recent.createdAt,
          });
        }
      }

      const actor = first(
        await tx
          .select({ email: schema.accounts.email })
          .from(schema.accounts)
          .where(eq(schema.accounts.id, input.actorAccountId))
          .limit(1),
      );
      const customerName = await payer.customerName(tx);
      if (!actor || customerName === null) {
        return err(serviceError('not_found', 'invoice not found'));
      }

      const row = await payer.insertAttempt(tx, {
        invoiceId: locked.id,
        provider: port.provider,
        merchantTranId,
        amountMinorUnits: amount,
        currency: normalizeCurrency(locked.currency),
        status: 'CREATED',
        mode,
        initiatedByAccountId: input.actorAccountId,
      });
      await appendAuditEvent(tx, {
        eventType: 'PAYMENT_ATTEMPT_STARTED',
        actorAccountId: input.actorAccountId,
        action: 'MANAGE',
        method: 'MANUAL',
        result: 'ALLOWED',
        resourceType: 'payment_attempt',
        resourceId: row.id,
        metadata: {
          invoiceId: locked.id,
          ...payer.audit,
          provider: port.provider,
          amountMinorUnits: amount,
          currency: normalizeCurrency(locked.currency),
          mode,
        },
      });
      return ok({
        kind: 'created',
        port,
        attempt: row,
        amount,
        invoiceRef: locked.invoiceRef,
        customer: { name: customerName, email: actor.email },
      });
    },
  );
  if (!prepared.ok) return prepared;
  if (prepared.value.kind === 'recent') {
    return ok({
      kind: 'recent_attempt',
      attemptId: prepared.value.attemptId,
      startedAt: prepared.value.startedAt,
    });
  }
  const { port, attempt: created, amount, invoiceRef, customer } = prepared.value;

  let session: Awaited<ReturnType<PaymentPort['createCheckout']>>;
  try {
    session = await withTimeout(
      port.createCheckout({
        merchantTranId,
        amountMinorUnits: amount,
        currency: created.currency,
        invoiceRef,
        customer,
        urls: {
          success: input.urlFor('success', merchantTranId, port.provider),
          fail: input.urlFor('fail', merchantTranId, port.provider),
          cancel: input.urlFor('cancel', merchantTranId, port.provider),
          ipn: input.urlFor('ipn', merchantTranId, port.provider),
        },
      }),
      input.timeoutMs ?? START_TIMEOUT_MS,
    );
  } catch {
    await db.transaction(async (tx) => {
      await tx
        .update(attempts)
        .set({ status: 'FAILED', reasonCode: 'start_failed', updatedAt: now })
        .where(and(eq(attempts.id, created.id), eq(attempts.status, 'CREATED')));
      await auditAttemptMove(tx, created, 'FAILED', 'start', 'start_failed');
    });
    return err(serviceError('upstream_error', START_FAILED));
  }

  await db
    .update(attempts)
    .set({
      status: 'REDIRECTED',
      providerSessionKey: session.sessionKey,
      redirectedAt: now,
      updatedAt: now,
    })
    .where(and(eq(attempts.id, created.id), eq(attempts.status, 'CREATED')));
  return ok({ kind: 'redirect', attemptId: created.id, redirectUrl: session.redirectUrl });
}

/**
 * The 15-second limit on opening a payment page (ADR 0020) is enforced here, not trusted to the
 * adapter: the port is an interface, and a provider that never answers must still leave the
 * attempt closed as failed. (The adapter's own socket timeout only frees its connection.)
 */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

// --- Reconciliation --------------------------------------------------------------------------

export interface ReconciliationSummary {
  /** False when the attempts table is not there yet (migration not run). */
  readonly available: boolean;
  readonly configured: boolean;
  readonly checked: number;
  readonly recorded: number;
  readonly held: number;
  readonly closed: number;
  readonly stillPending: number;
  /** Payments the gateway could not be asked about in this run. */
  readonly unavailable: number;
  /**
   * Payments the gateway confirmed that VisaStack did not count and that nobody has resolved yet
   * (held for review). A number above zero is the signal that staff have something to look at.
   */
  readonly awaitingReview: number;
  /** Payments not asked about because the run's time budget ran out; the next run asks. */
  readonly leftForLater: number;
  /**
   * Open payments made with a provider that is no longer configured here (S19 step 0). They are
   * left exactly as they are, never closed or expired, and counted so staff can see them.
   */
  readonly providerNotConfigured: number;
}

const EMPTY_SUMMARY: ReconciliationSummary = {
  available: true,
  configured: true,
  checked: 0,
  recorded: 0,
  held: 0,
  closed: 0,
  stillPending: 0,
  unavailable: 0,
  awaitingReview: 0,
  leftForLater: 0,
  providerNotConfigured: 0,
};

/** Held payments of every provider: each one is staff work, whichever gateway it came through. */
async function countAwaitingReview(db: Db): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.paymentAttempts)
    .where(eq(schema.paymentAttempts.status, 'HELD_FOR_REVIEW'));
  return rows[0]?.n ?? 0;
}

/**
 * Open payments (still being opened, sent to a gateway, or closed as expired within the late
 * window) whose provider is not one of `providers` (with none configured, every open payment): no
 * gateway here can be asked about them.
 */
async function countProviderNotConfigured(
  db: Db,
  providers: readonly string[],
  now: Date,
): Promise<number> {
  const attempts = schema.paymentAttempts;
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(attempts)
    .where(
      and(
        providers.length === 0 ? undefined : notInArray(attempts.provider, [...providers]),
        // Every open payment, and every one whose money is still uncertain (round 5).
        or(inArray(attempts.status, ['CREATED', 'REDIRECTED']), stillUncertainSql(now)),
      ),
    );
  return rows[0]?.n ?? 0;
}

/** After this many gateway outages in a row a run stops asking, so a down gateway is not hammered. */
const MAX_CONSECUTIVE_OUTAGES = 3;

/**
 * Asks the gateway about payments that have not been confirmed: ones sent to the gateway more
 * than 15 minutes ago and still open, and ones closed as expired within the last 7 days (a late
 * success is still counted). Payments still unconfirmed after 24 hours are closed as expired; an
 * attempt that never reached the gateway is closed as failed. Safe to run any number of times.
 * Counts only.
 */
export async function reconcilePaymentAttempts(
  db: Db,
  scope: SystemScope<'process-payment-reconciliation'>,
  payments: PaymentPortResolver,
  options: {
    readonly now?: Date;
    readonly limit?: number;
    /** A clock time (ms) after which no new gateway call is started (the job has 60 seconds). */
    readonly deadline?: number;
  } = {},
): Promise<ReconciliationSummary> {
  if (scope.job !== 'process-payment-reconciliation') throw new Error('wrong job scope');
  const ports = payments.configured();
  const now = options.now ?? new Date();
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
  try {
    // S19 step 0: each provider is asked only about its own payments, in the owner's order, so
    // one provider being down never stops another from being asked; each gets an equal share of
    // the time that is left. With none configured nothing is asked, but open payments are still
    // counted, so payments stranded by a provider being switched off stay visible.
    let summary: ReconciliationSummary = { ...EMPTY_SUMMARY, configured: ports.length > 0 };
    for (const [index, port] of ports.entries()) {
      summary = await reconcileProvider(db, port, summary, {
        now,
        limit,
        deadline: providerShareDeadline(options.deadline ?? null, index, ports.length),
      });
    }
    return {
      ...summary,
      awaitingReview: await countAwaitingReview(db),
      providerNotConfigured: await countProviderNotConfigured(
        db,
        ports.map((port) => port.provider),
        now,
      ),
    };
  } catch (error) {
    // S19 step 0 round 3: with no provider configured, a table a lagging migration has not made
    // yet is nothing to do (a quiet run, nothing stranded), never a failed one.
    if (isMissingRelationError(error)) {
      return ports.length === 0
        ? { ...EMPTY_SUMMARY, configured: false }
        : { ...EMPTY_SUMMARY, available: false };
    }
    throw error;
  }
}

/** One provider's part of the reconciliation, added to `start`. */
async function reconcileProvider(
  db: Db,
  port: PaymentPort,
  start: ReconciliationSummary,
  options: { readonly now: Date; readonly limit: number; readonly deadline: number | null },
): Promise<ReconciliationSummary> {
  const { now, limit } = options;
  const attempts = schema.paymentAttempts;
  // Attempts that never reached the gateway cannot have been paid.
  const staleBefore = new Date(now.getTime() - STALE_CREATED_MS);
  const stale = await db
    .select(attemptColumns())
    .from(attempts)
    .where(
      and(
        eq(attempts.provider, port.provider),
        eq(attempts.status, 'CREATED'),
        lte(attempts.createdAt, staleBefore),
      ),
    )
    .limit(limit);
  let closed = 0;
  for (const attempt of stale) {
    const moved = await db.transaction(async (tx) => {
      const rows = await tx
        .update(attempts)
        .set({ status: 'FAILED', reasonCode: 'start_incomplete', updatedAt: now })
        .where(and(eq(attempts.id, attempt.id), eq(attempts.status, 'CREATED')))
        .returning({ id: attempts.id });
      if (rows.length > 0)
        await auditAttemptMove(tx, attempt, 'FAILED', 'reconcile', 'start_incomplete');
      return rows.length;
    });
    closed += moved;
  }

  const redirectedBefore = new Date(now.getTime() - RECONCILE_MIN_AGE_MS);
  // Payments still open come first, oldest first. Closed-as-expired ones (which may yet turn out
  // to have succeeded) take whatever room is left, least recently asked about first, so a pile
  // of abandoned payments can never crowd out a live one and each is revisited in turn.
  const open = await db
    .select(attemptColumns())
    .from(attempts)
    .where(
      and(
        eq(attempts.provider, port.provider),
        eq(attempts.status, 'REDIRECTED'),
        lte(attempts.redirectedAt, redirectedBefore),
        // S29 round 3: a live payment is left alone while the gateway is in test mode (never
        // expired, never asked), so it takes no room in the batch either. A test payment open
        // when the gateway is live is still taken, once, to be closed as expired.
        port.mode === 'TEST' ? eq(attemptModeColumn(), 'TEST') : undefined,
      ),
    )
    .orderBy(attempts.redirectedAt)
    .limit(limit);
  const room = limit - open.length;
  const expired =
    room > 0
      ? await db
          .select(attemptColumns())
          .from(attempts)
          .where(
            and(
              eq(attempts.provider, port.provider),
              eq(attempts.status, 'EXPIRED'),
              // The late-success selection: the same condition a stranded payment uses (round 5).
              stillUncertainSql(now),
              // Only the gateway's own mode can say a closed payment succeeded late.
              port.mode === null ? undefined : eq(attemptModeColumn(), port.mode),
            ),
          )
          .orderBy(sql`${attempts.lastCheckedAt} asc nulls first`)
          .limit(room)
      : [];
  return settleBatch(
    db,
    () => port,
    [...open, ...expired],
    'reconcile',
    now,
    { ...start, closed: start.closed + closed },
    false,
    options.deadline,
  );
}

async function settleBatch(
  db: Db,
  portOf: (attempt: PaymentAttempt) => PaymentPort | null,
  batch: readonly PaymentAttempt[],
  source: SettlementSource,
  now: Date,
  start: ReconciliationSummary,
  concurrent = false,
  deadline: number | null = null,
): Promise<ReconciliationSummary> {
  let providerNotConfigured = 0;
  // A payment whose provider is not configured here is never asked about, closed or expired: it
  // is counted and left as it is (S19 step 0).
  const settleOne = async (attempt: PaymentAttempt): Promise<SettlementOutcome | null> => {
    const port = portOf(attempt);
    if (port === null) {
      providerNotConfigured++;
      return null;
    }
    return settlePaymentAttempt(db, port, { merchantTranId: attempt.merchantTranId, source, now });
  };
  const codes: SettlementCode[] = [];
  let leftForLater = 0;
  if (concurrent) {
    // A person is waiting (an invoice being opened): ask about the few payments together.
    const results = await Promise.all(batch.map(settleOne));
    for (const result of results) if (result !== null) codes.push(result.code);
  } else {
    let outagesInARow = 0;
    for (const [index, attempt] of batch.entries()) {
      if (deadline !== null && Date.now() >= deadline) {
        leftForLater = batch.length - index;
        break;
      }
      const settled = await settleOne(attempt);
      if (settled === null) continue;
      const { code } = settled;
      codes.push(code);
      outagesInARow = code === 'unavailable' ? outagesInARow + 1 : 0;
      if (outagesInARow >= MAX_CONSECUTIVE_OUTAGES) break;
    }
  }
  let { recorded, held, closed, stillPending, unavailable } = start;
  for (const code of codes) {
    if (code === 'recorded' || code === 'already_recorded') recorded++;
    else if (code === 'held') held++;
    else if (code === 'failed' || code === 'cancelled' || code === 'expired' || code === 'refunded')
      closed++;
    else if (code === 'unavailable') unavailable++;
    else stillPending++;
  }
  return {
    ...start,
    checked: start.checked + codes.length,
    recorded,
    held,
    closed,
    stillPending,
    unavailable,
    leftForLater: start.leftForLater + leftForLater,
    providerNotConfigured: start.providerNotConfigured + providerNotConfigured,
  };
}

/** Who is asking about the payments of one invoice: the agency's owners and admins, or platform staff. */
export interface InvoicePaymentsReader {
  readonly actorAccountId: string;
  readonly organizationId: string;
  readonly invoiceId: string;
  readonly actorEmail?: string;
  readonly bootstrapEmails?: readonly string[];
}

/**
 * The reader's standing and the invoice, looked up inside the named organization only, so another
 * agency's invoice looks exactly like a missing one (the same rule as `getInvoiceLedger`).
 */
async function readerFor(
  db: Db,
  input: InvoicePaymentsReader,
): Promise<Result<{ reader: 'member' | 'platform'; invoiceId: string }, ServiceError>> {
  const reader = await invoiceLedgerReader(db, input);
  if (reader === null) {
    return err(serviceError('forbidden', 'not allowed to see the payments of this invoice'));
  }
  const invoice = first(
    await db
      .select({ id: schema.invoices.id })
      .from(schema.invoices)
      .where(
        and(
          eq(schema.invoices.id, input.invoiceId),
          eq(schema.invoices.organizationId, input.organizationId),
        ),
      )
      .limit(1),
  );
  if (!invoice) return err(serviceError('not_found', 'invoice not found'));
  return ok({ reader, invoiceId: invoice.id });
}

/**
 * Asks the gateway about the open payments of one invoice, for the moment someone opens it (the
 * agency's owners and admins, or platform billing staff; anyone else is refused). `minAgeMs`
 * defaults to the reconciliation age; pass 0 for an explicit "Check Status". At most five
 * payments are asked about, together, so opening the invoice waits no longer than one gateway
 * call. Each is asked of the provider it was made with (S19 step 0); one whose provider is no
 * longer configured is counted and left as it is.
 */
export async function refreshInvoicePaymentAttempts(
  db: Db,
  payments: PaymentPortResolver,
  input: InvoicePaymentsReader & {
    readonly minAgeMs?: number;
    readonly now?: Date;
    /**
     * Also answer whether a payment of the invoice is stranded (Check Status only, S19 step 0
     * round 4); the page-load check leaves it out and runs no extra query.
     */
    readonly withStranded?: boolean;
  },
): Promise<Result<InvoicePaymentCheck, ServiceError>> {
  const allowed = await readerFor(db, input);
  if (!allowed.ok) return allowed;
  // With no provider configured nothing is asked, but an open payment is still counted as one no
  // gateway here can be asked about, so the payer is told before paying again.
  const configured = payments.configured().length > 0;
  const now = input.now ?? new Date();
  const minAge = Math.max(0, input.minAgeMs ?? RECONCILE_MIN_AGE_MS);
  const attempts = schema.paymentAttempts;
  try {
    const open = await db
      .select(attemptColumns())
      .from(attempts)
      .where(
        and(
          eq(attempts.invoiceId, allowed.value.invoiceId),
          inArray(attempts.status, ['REDIRECTED', 'EXPIRED']),
        ),
      )
      .orderBy(desc(attempts.createdAt))
      .limit(5);
    const eligible = open.filter(
      (a) =>
        a.redirectedAt !== null &&
        now.getTime() - a.redirectedAt.getTime() >= minAge &&
        (a.status === 'REDIRECTED' ||
          now.getTime() - a.redirectedAt.getTime() <= LATE_SUCCESS_WINDOW_MS),
    );
    const summary = await settleBatch(
      db,
      (attempt) => payments.forProvider(attempt.provider),
      eligible,
      'refresh',
      now,
      { ...EMPTY_SUMMARY, configured },
      true,
    );
    const strandedPayment =
      input.withStranded === true &&
      (await hasStrandedAttempt(
        db,
        allowed.value.invoiceId,
        payments.configured().map((port) => port.provider),
        now,
      ));
    return ok({ ...summary, strandedPayment });
  } catch (error) {
    if (isMissingRelationError(error)) {
      return ok({ ...EMPTY_SUMMARY, available: false, strandedPayment: false });
    }
    throw error;
  }
}

/** Check Status's answer: the counts, and whether a payment of the invoice is stranded. */
export type InvoicePaymentCheck = ReconciliationSummary & {
  /**
   * `isStrandedAttempt` for any payment of the invoice (the payer must contact VisaStack); false
   * unless `withStranded` was asked for.
   */
  readonly strandedPayment: boolean;
};

// --- Reading ----------------------------------------------------------------------------------

export interface PaymentResultView {
  readonly state: PaymentResultState;
  readonly invoiceRef: string;
  readonly amountMinorUnits: number;
  readonly currency: string;
  /** Who paid (ADR 0025): an agency's invoice, or a person's own plan purchase. */
  readonly payer: 'organization' | 'person';
}

/**
 * What the payer is told after coming back from the gateway: one of four plain results, from the
 * attempt's own state (never from anything the browser said). Null when there is no such payment
 * or the attempts table is not there yet.
 */
export async function getPaymentResultView(
  db: Db,
  merchantTranId: string,
): Promise<PaymentResultView | null> {
  if (!isMerchantTranId(merchantTranId)) return null;
  try {
    const row = first(
      await db
        .select({
          status: schema.paymentAttempts.status,
          amountMinorUnits: schema.paymentAttempts.amountMinorUnits,
          currency: schema.paymentAttempts.currency,
          invoiceRef: schema.invoices.invoiceRef,
          // A person's own attempt has no organization (ADR 0025).
          agency: sql<boolean>`${schema.paymentAttempts.organizationId} is not null`,
        })
        .from(schema.paymentAttempts)
        .innerJoin(schema.invoices, eq(schema.invoices.id, schema.paymentAttempts.invoiceId))
        .where(eq(schema.paymentAttempts.merchantTranId, merchantTranId))
        .limit(1),
    );
    if (!row) return null;
    return {
      state: paymentResultState(row.status),
      invoiceRef: row.invoiceRef,
      amountMinorUnits: row.amountMinorUnits,
      currency: row.currency,
      payer: row.agency ? 'organization' : 'person',
    };
  } catch (error) {
    if (isMissingRelationError(error)) return null;
    throw error;
  }
}

/**
 * One payment attempt as an invoice screen shows it. Gateway identifiers (session key, validation
 * id, bank reference) and the person who started it are never part of it; the plain reason code
 * and the VisaStack transaction id are shown to platform staff only.
 */
export interface PaymentAttemptView {
  readonly id: string;
  readonly status: PaymentAttemptStatus;
  readonly amountMinorUnits: number;
  readonly currency: string;
  readonly createdAt: Date;
  readonly redirectedAt: Date | null;
  readonly recordedAt: Date | null;
  readonly reasonCode: string | null;
  readonly merchantTranId: string | null;
  /** S29: TEST for a payment started in the gateway's test mode (shown as "Test Payment"). */
  readonly mode: PaymentMode;
}

/** One attempt as a screen shows it: the plain reason code and the VisaStack transaction id for platform staff only. */
export function attemptView(row: PaymentAttempt, platform: boolean): PaymentAttemptView {
  return {
    id: row.id,
    status: row.status,
    amountMinorUnits: row.amountMinorUnits,
    currency: row.currency,
    createdAt: row.createdAt,
    redirectedAt: row.redirectedAt,
    recordedAt: row.recordedAt,
    reasonCode: platform ? row.reasonCode : null,
    merchantTranId: platform ? row.merchantTranId : null,
    mode: row.mode,
  };
}

/**
 * The payment attempts of one invoice, newest first. Readable by the owners and admins of the
 * organization the invoice belongs to, or by a platform owner; an invoice is looked up inside the
 * named organization only. Empty while the attempts table does not exist yet.
 */
export async function getInvoicePaymentAttempts(
  db: Db,
  input: InvoicePaymentsReader,
): Promise<Result<PaymentAttemptView[], ServiceError>> {
  const allowed = await readerFor(db, input);
  if (!allowed.ok) return allowed;
  try {
    const rows = await db
      .select(attemptColumns())
      .from(schema.paymentAttempts)
      .where(eq(schema.paymentAttempts.invoiceId, allowed.value.invoiceId))
      .orderBy(desc(schema.paymentAttempts.createdAt))
      .limit(50);
    const platform = allowed.value.reader === 'platform';
    return ok(rows.map((row) => attemptView(row, platform)));
  } catch (error) {
    if (isMissingRelationError(error)) return ok([]);
    throw error;
  }
}
