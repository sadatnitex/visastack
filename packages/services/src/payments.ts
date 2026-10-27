import { randomBytes } from 'node:crypto';
import { type Result, err, ok } from '@visastack/core';
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { SystemScope } from './access/principal';
import { appendAuditEvent } from './audit';
import { invoiceLedgerReader } from './billing';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import {
  applyInvoiceCollection,
  invoiceLedgerPresent,
  normalizeCurrency,
  outstandingMinorUnits,
} from './invoice-ledger';
import { isMissingRelationError } from './missing-relation';
import { isOrgAdmin } from './organizations';
import type { PaymentPort, PaymentValidation } from './ports';
import { RATE_LIMITS, checkRateLimit, checkRateLimits } from './rate-limit';

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
 * Every function tolerates migration 0095 not having run: it reports "not available yet" and
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
      .select()
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
      await tx.select().from(attempts).where(eq(attempts.id, seen.id)).limit(1).for('update'),
    );
    if (!attempt) return outcome('unknown_transaction');
    if (attempt.status === 'RECORDED') return outcome('already_recorded', attempt.status);
    if (attempt.status === 'HELD_FOR_REVIEW') return outcome('held', attempt.status);

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
  /** The absolute address the gateway should send this payer or its server to. */
  readonly urlFor: (kind: PaymentReturnKind, merchantTranId: string) => string;
  /** True once the person has seen a recent unfinished payment and still wants a new one. */
  readonly startAnother?: boolean;
  readonly now?: Date;
  /** How long the gateway may take to open a payment page. Defaults to 15 seconds; tests shorten it. */
  readonly timeoutMs?: number;
}

type PreparedStart =
  | { readonly kind: 'recent'; readonly attemptId: string; readonly startedAt: Date }
  | {
      readonly kind: 'created';
      readonly attempt: PaymentAttempt;
      readonly amount: number;
      readonly invoiceRef: string;
      readonly customer: { readonly name: string; readonly email: string };
    };

/** A payment still being opened (a minute) or sent to the gateway less than 30 minutes ago. */
const IN_FLIGHT_START_MS = MINUTE_MS;
function isRecentAttempt(attempt: PaymentAttempt, now: Date): boolean {
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
const START_FAILED = 'We could not open the payment page. Nothing was charged. Try again.';

/**
 * Starts paying the whole outstanding balance of one invoice online. Only an owner or admin of
 * the agency the invoice belongs to may do it; anyone else sees "not found", exactly as for an
 * invoice that does not exist. Online payment covers BDT invoices that are open or part paid.
 * If the gateway cannot open a page (or takes longer than 15 seconds) the attempt is closed as
 * failed: the payer never reached the gateway, so no money can have moved.
 */
export async function startOnlinePayment(
  db: Db,
  port: PaymentPort,
  input: StartOnlinePaymentInput,
): Promise<Result<StartedPayment, ServiceError>> {
  if (!port.configured) return err(serviceError('invalid', NOT_AVAILABLE));
  const now = input.now ?? new Date();
  try {
    const invoice = first(
      await db
        .select()
        .from(schema.invoices)
        .where(eq(schema.invoices.id, input.invoiceId))
        .limit(1),
    );
    if (!invoice || !(await isOrgAdmin(db, input.actorAccountId, invoice.organizationId))) {
      return err(serviceError('not_found', 'invoice not found'));
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
        {
          input: {
            subjectId: invoice.organizationId,
            action: 'payments.start_org',
            label: 'payment',
          },
          config: RATE_LIMITS.PAYMENT_START_ORG,
        },
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
        if (normalizeCurrency(locked.currency) !== 'BDT') {
          return err(
            serviceError('invalid', 'Only invoices in Bangladeshi taka can be paid online.'),
          );
        }
        const amount = outstandingMinorUnits(
          locked.invoicedAmountMinorUnits,
          locked.collectedAmountMinorUnits,
        );
        if (amount <= 0) return err(serviceError('invalid', 'This invoice is already paid.'));
        // Without the ledger no payment could be counted safely, so none is started.
        if (!(await invoiceLedgerPresent(tx))) return err(serviceError('invalid', NOT_AVAILABLE));

        if (input.startAnother !== true) {
          const earlier = await tx
            .select()
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

        const payer = first(
          await tx
            .select({ email: schema.accounts.email })
            .from(schema.accounts)
            .where(eq(schema.accounts.id, input.actorAccountId))
            .limit(1),
        );
        const organization = first(
          await tx
            .select({ name: schema.organizations.name })
            .from(schema.organizations)
            .where(eq(schema.organizations.id, locked.organizationId))
            .limit(1),
        );
        if (!payer || !organization) return err(serviceError('not_found', 'invoice not found'));

        const row = required(
          first(
            await tx
              .insert(attempts)
              .values({
                invoiceId: locked.id,
                organizationId: locked.organizationId,
                provider: port.provider,
                merchantTranId,
                amountMinorUnits: amount,
                currency: normalizeCurrency(locked.currency),
                status: 'CREATED',
                initiatedByAccountId: input.actorAccountId,
              })
              .returning(),
          ),
          'payment attempt',
        );
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
            organizationId: locked.organizationId,
            provider: port.provider,
            amountMinorUnits: amount,
            currency: normalizeCurrency(locked.currency),
          },
        });
        return ok({
          kind: 'created',
          attempt: row,
          amount,
          invoiceRef: locked.invoiceRef,
          customer: { name: organization.name, email: payer.email },
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
    const { attempt: created, amount, invoiceRef, customer } = prepared.value;

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
            success: input.urlFor('success', merchantTranId),
            fail: input.urlFor('fail', merchantTranId),
            cancel: input.urlFor('cancel', merchantTranId),
            ipn: input.urlFor('ipn', merchantTranId),
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
  } catch (error) {
    if (isMissingRelationError(error)) return err(serviceError('invalid', NOT_AVAILABLE));
    throw error;
  }
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
};

async function countAwaitingReview(db: Db, provider: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.paymentAttempts)
    .where(
      and(
        eq(schema.paymentAttempts.provider, provider),
        eq(schema.paymentAttempts.status, 'HELD_FOR_REVIEW'),
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
  port: PaymentPort,
  options: { readonly now?: Date; readonly limit?: number } = {},
): Promise<ReconciliationSummary> {
  if (scope.job !== 'process-payment-reconciliation') throw new Error('wrong job scope');
  if (!port.configured) return { ...EMPTY_SUMMARY, configured: false };
  const now = options.now ?? new Date();
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
  const attempts = schema.paymentAttempts;
  try {
    // Attempts that never reached the gateway cannot have been paid.
    const staleBefore = new Date(now.getTime() - STALE_CREATED_MS);
    const stale = await db
      .select()
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
    const lateAfter = new Date(now.getTime() - LATE_SUCCESS_WINDOW_MS);
    // Payments still open come first, oldest first. Closed-as-expired ones (which may yet turn out
    // to have succeeded) take whatever room is left, least recently asked about first, so a pile
    // of abandoned payments can never crowd out a live one and each is revisited in turn.
    const open = await db
      .select()
      .from(attempts)
      .where(
        and(
          eq(attempts.provider, port.provider),
          eq(attempts.status, 'REDIRECTED'),
          lte(attempts.redirectedAt, redirectedBefore),
        ),
      )
      .orderBy(attempts.redirectedAt)
      .limit(limit);
    const room = limit - open.length;
    const expired =
      room > 0
        ? await db
            .select()
            .from(attempts)
            .where(
              and(
                eq(attempts.provider, port.provider),
                eq(attempts.status, 'EXPIRED'),
                gte(attempts.redirectedAt, lateAfter),
              ),
            )
            .orderBy(sql`${attempts.lastCheckedAt} asc nulls first`)
            .limit(room)
        : [];
    const awaitingReview = await countAwaitingReview(db, port.provider);
    return await settleBatch(db, port, [...open, ...expired], 'reconcile', now, {
      ...EMPTY_SUMMARY,
      closed,
      awaitingReview,
    });
  } catch (error) {
    if (isMissingRelationError(error)) return { ...EMPTY_SUMMARY, available: false };
    throw error;
  }
}

async function settleBatch(
  db: Db,
  port: PaymentPort,
  batch: readonly PaymentAttempt[],
  source: SettlementSource,
  now: Date,
  start: ReconciliationSummary,
  concurrent = false,
): Promise<ReconciliationSummary> {
  const settleOne = (attempt: PaymentAttempt) =>
    settlePaymentAttempt(db, port, { merchantTranId: attempt.merchantTranId, source, now });
  const codes: SettlementCode[] = [];
  if (concurrent) {
    // A person is waiting (an invoice being opened): ask about the few payments together.
    const results = await Promise.all(batch.map(settleOne));
    codes.push(...results.map((r) => r.code));
  } else {
    let outagesInARow = 0;
    for (const attempt of batch) {
      const { code } = await settleOne(attempt);
      codes.push(code);
      outagesInARow = code === 'unavailable' ? outagesInARow + 1 : 0;
      if (outagesInARow >= MAX_CONSECUTIVE_OUTAGES) break;
    }
  }
  let { recorded, held, closed, stillPending, unavailable } = start;
  for (const code of codes) {
    if (code === 'recorded' || code === 'already_recorded') recorded++;
    else if (code === 'held') held++;
    else if (code === 'failed' || code === 'cancelled' || code === 'expired') closed++;
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
 * call.
 */
export async function refreshInvoicePaymentAttempts(
  db: Db,
  port: PaymentPort,
  input: InvoicePaymentsReader & { readonly minAgeMs?: number; readonly now?: Date },
): Promise<Result<ReconciliationSummary, ServiceError>> {
  const allowed = await readerFor(db, input);
  if (!allowed.ok) return allowed;
  if (!port.configured) return ok({ ...EMPTY_SUMMARY, configured: false });
  const now = input.now ?? new Date();
  const minAge = Math.max(0, input.minAgeMs ?? RECONCILE_MIN_AGE_MS);
  const attempts = schema.paymentAttempts;
  try {
    const open = await db
      .select()
      .from(attempts)
      .where(
        and(
          eq(attempts.invoiceId, allowed.value.invoiceId),
          eq(attempts.provider, port.provider),
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
    return ok(await settleBatch(db, port, eligible, 'refresh', now, EMPTY_SUMMARY, true));
  } catch (error) {
    if (isMissingRelationError(error)) return ok({ ...EMPTY_SUMMARY, available: false });
    throw error;
  }
}

// --- Reading ----------------------------------------------------------------------------------

export interface PaymentResultView {
  readonly state: PaymentResultState;
  readonly invoiceRef: string;
  readonly amountMinorUnits: number;
  readonly currency: string;
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
      .select()
      .from(schema.paymentAttempts)
      .where(eq(schema.paymentAttempts.invoiceId, allowed.value.invoiceId))
      .orderBy(desc(schema.paymentAttempts.createdAt))
      .limit(50);
    const platform = allowed.value.reader === 'platform';
    return ok(
      rows.map((row) => ({
        id: row.id,
        status: row.status,
        amountMinorUnits: row.amountMinorUnits,
        currency: row.currency,
        createdAt: row.createdAt,
        redirectedAt: row.redirectedAt,
        recordedAt: row.recordedAt,
        reasonCode: platform ? row.reasonCode : null,
        merchantTranId: platform ? row.merchantTranId : null,
      })),
    );
  } catch (error) {
    if (isMissingRelationError(error)) return ok([]);
    throw error;
  }
}
