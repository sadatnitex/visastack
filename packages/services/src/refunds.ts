import { type Result, err, ok } from '@visastack/core';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { StaffScope, SystemScope } from './access/principal';
import { staffScopeProblem } from './access/principal';
import { appendAuditEvent } from './audit';
import {
  billingContacts,
  billingDay,
  invoiceNotRefundedSql,
  invoicesPath,
} from './billing-standing';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import {
  type InvoicePayment,
  applyInvoiceCollection,
  applyInvoiceRefund,
  isUuid,
  isValidMinorUnitAmount,
  normalizeCurrency,
  outstandingMinorUnits,
} from './invoice-ledger';
import {
  cancelQueuedNotificationsForResource,
  enqueueNotificationBothChannels,
} from './notifications';
import type { PaymentAttempt } from './payments';
import { type PaymentPort, type RefundingPaymentPort, isRefundingPaymentPort } from './ports';

/**
 * Refunds and credits (Small Commercial V1 S18, ADR 0020 Phase 2 and its S18 amendment).
 *
 * Money only leaves the ledger when it has really gone back:
 *
 * - A refund through the gateway is written as a request (`REQUESTED`) and committed before the
 *   gateway is asked, so the request counts against what can still be refunded even if the call
 *   is lost. The gateway's refund reference moves it to `SUBMITTED`; only the gateway saying
 *   "refunded" (asked by the daily reconciliation or by staff with Check Now) confirms it, and
 *   that is the one moment the negative `REFUND` ledger row is written (`applyInvoiceRefund`).
 *   A definite refusal or a gateway cancellation is `FAILED`. A call whose outcome is unknown
 *   leaves the request `REQUESTED`: it keeps counting against the limit, and staff are told to
 *   check the gateway panel, then try again (with the same refund id) or cancel it.
 * - A refund made outside VisaStack (a bank transfer back, or a refund made in the gateway panel)
 *   is recorded by the platform owner with its reference and date: one transaction writes the
 *   confirmed request and the ledger row together.
 * - Held money (an online payment the gateway confirmed that VisaStack did not count) was never in
 *   the ledger, so refunding it writes no ledger row; it closes the held payment instead
 *   (`REFUNDED`, or `RECORDED` when part of it was applied as a credit). "Apply to Next Invoice"
 *   counts held money once, as a `CREDIT` ledger row whose source is the held payment and whose
 *   gateway key is the held payment's own, so the same money can never also be counted online.
 *
 * Limits: what one ledger entry can still give back is its amount less every refund on it that is
 * asked for, sent or confirmed; what a held payment can still give is its amount less the credit
 * applied from it and every such refund on it.
 *
 * Lock order on every path here, the S17 order with the held payment in front: the held payment
 * row, then an existing refund request row, then the invoice row, then the billing account row
 * (only a credit takes it, inside `applyInvoiceCollection`), then the audit chain. A new request
 * row is inserted while its source is locked (the held payment, or the invoice for a ledger
 * entry), which is what serialises two requests for the same money.
 *
 * Platform owner only (`BILLING_REFUND_MANAGE`, held by no other role, owner decision D1), and
 * every action that moves or releases money needs a fresh sign-in check. Before migration 0104
 * nothing here writes anything: every action answers "Refunds are not available yet."
 */

export type RefundRequest = typeof schema.refundRequests.$inferSelect;
export type RefundStatus = (typeof schema.refundStatus.enumValues)[number];
export type RefundMethod = (typeof schema.refundMethod.enumValues)[number];

export const REFUNDS_UNAVAILABLE = 'Refunds are not available yet.';
export const NO_OPEN_INVOICE_FOR_CREDIT =
  'This agency has no open invoice yet. Apply the credit after its next invoice is made, or refund it.';
const NOT_ALLOWED = 'Only the platform owner can refund or apply credits.';

/** Requests that count against what can still be refunded: asked for, sent, or confirmed. */
export const LIMIT_STATUSES: readonly RefundStatus[] = ['REQUESTED', 'SUBMITTED', 'CONFIRMED'];
const OPEN_STATUSES: readonly RefundStatus[] = ['REQUESTED', 'SUBMITTED'];

/** On a sent refund: the gateway confirmed it, but the ledger refused it. A person must look. */
export const NEEDS_CHECK_CODE = 'ledger_refused';
/** On a refund waiting to send: Send Again was answered "failed". Staff must check the panel. */
export const RETRY_REFUSED_CODE = 'retry_refused';

/**
 * Why money can be held, where the gateway confirmed exactly this payment's amount and currency
 * (risky, or the invoice was settled or cancelled another way). Only such money can be applied as
 * a credit or refunded through the gateway; money held for a mismatch or a key conflict can only
 * be recorded as refunded outside VisaStack, after staff have checked it in the gateway panel.
 */
const VERIFIED_HOLD_REASONS: ReadonlySet<string> = new Set([
  'already_paid',
  'invoice_void',
  'invoice_refunded',
  'risky_payment',
  'risk_unknown',
]);

const MAX_REASON = 500;
const MAX_REFERENCE = 120;
/** The gateway's refund remark is short and fixed; the reason staff typed stays with VisaStack. */
const MAX_REMARKS = 100;

// --- Is it there yet --------------------------------------------------------------------------

/** Handles already seen with migration 0104 applied. Only a "yes" is kept (migrations are additive). */
const refundsSeen = new WeakMap<object, true>();

/**
 * Whether migration 0104 has run: the refund table exists and the attempt status has its
 * `REFUNDED` value. Never raises, so a surrounding transaction is never aborted.
 */
export async function refundsPresent(db: Db): Promise<boolean> {
  if (refundsSeen.has(db)) return true;
  const rows = await db
    .select({
      present: sql<boolean>`(to_regclass('refund_requests') is not null and exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'payment_attempt_status' and e.enumlabel = 'REFUNDED'))`,
    })
    .from(sql`(select 1) as probe`);
  const present = rows[0]?.present === true;
  if (present) refundsSeen.set(db, true);
  return present;
}

// --- Pure rules -------------------------------------------------------------------------------

/** The sum of the requests that count against a limit. */
export function committedMinorUnits(
  requests: readonly Pick<RefundRequest, 'status' | 'amountMinorUnits'>[],
): number {
  return requests
    .filter((request) => LIMIT_STATUSES.includes(request.status))
    .reduce((sum, request) => sum + request.amountMinorUnits, 0);
}

/** What one ledger entry can still give back: its amount less every committed refund on it. */
export function entryRefundableMinorUnits(
  entryAmountMinorUnits: number,
  requests: readonly Pick<RefundRequest, 'status' | 'amountMinorUnits'>[],
): number {
  return Math.max(0, entryAmountMinorUnits - committedMinorUnits(requests));
}

/** What a held payment can still give: its amount less the credit applied from it and every committed refund on it. */
export function heldRemainingMinorUnits(
  attemptAmountMinorUnits: number,
  creditedMinorUnits: number,
  requests: readonly Pick<RefundRequest, 'status' | 'amountMinorUnits'>[],
): number {
  return Math.max(0, attemptAmountMinorUnits - creditedMinorUnits - committedMinorUnits(requests));
}

// --- Shapes -----------------------------------------------------------------------------------

export type RefundSource =
  /** Money VisaStack counted: one ledger entry (online, reported, typed in, or a credit). */
  | { readonly kind: 'entry'; readonly invoicePaymentId: string }
  /** Money the gateway confirmed that VisaStack held and never counted. */
  | { readonly kind: 'held'; readonly paymentAttemptId: string };

export interface RefundRequestView {
  readonly id: string;
  readonly invoiceId: string;
  readonly invoiceRef: string;
  readonly method: RefundMethod;
  readonly status: RefundStatus;
  readonly amountMinorUnits: number;
  readonly currency: string;
  readonly fromHeldPayment: boolean;
  readonly reason: string;
  /** The outside reference of a refund made outside VisaStack, or the gateway's refund reference. */
  readonly reference: string | null;
  readonly failureCode: string | null;
  readonly createdAt: Date;
  readonly confirmedAt: Date | null;
  /** The day the money went back, as the gateway or the person recording it said. */
  readonly refundedOn: Date | null;
}

function requestView(row: RefundRequest, invoiceRef: string): RefundRequestView {
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    invoiceRef,
    method: row.method,
    status: row.status,
    amountMinorUnits: row.amountMinorUnits,
    currency: row.currency,
    fromHeldPayment: row.paymentAttemptId !== null,
    reason: row.reason,
    reference: row.method === 'MANUAL' ? row.reference : row.providerRefundId,
    failureCode: row.failureCode,
    createdAt: row.createdAt,
    confirmedAt: row.confirmedAt,
    refundedOn: row.providerRefundedAt,
  };
}

/** What a refund action did, in plain codes the screen turns into words. */
export type RefundOutcomeCode =
  /** The gateway took it; it is confirmed later. */
  | 'sent'
  /** The gateway said no. Nothing changed in the ledger. */
  | 'refused'
  /** The gateway could not be reached or its answer could not be read: check the gateway panel. */
  | 'unconfirmed'
  /** This exact request was already made (a repeated send); nothing new happened. */
  | 'already_requested'
  /** Recorded and confirmed now (a refund made outside VisaStack). */
  | 'recorded';

export interface RefundOutcome {
  readonly code: RefundOutcomeCode;
  readonly request: RefundRequestView;
}

// --- Guards shared by every staff action ------------------------------------------------------

function denied(staff: unknown): ServiceError | undefined {
  const problem = staffScopeProblem(staff, 'BILLING_REFUND_MANAGE');
  return problem ? serviceError('forbidden', NOT_ALLOWED) : undefined;
}

function cleanText(raw: string, max: number): string | null {
  const text = raw.trim();
  return text.length > 0 && text.length <= max ? text : null;
}

/** Thrown inside a transaction to roll it back with a plain refusal; caught by `inTransaction`. */
class Refusal extends Error {
  constructor(readonly error: ServiceError) {
    super(error.message);
  }
}

async function inTransaction<T>(
  db: Db,
  work: (tx: Db) => Promise<Result<T, ServiceError>>,
): Promise<Result<T, ServiceError>> {
  try {
    return await db.transaction(async (tx) => {
      const result = await work(tx);
      // A refusal decided after something was written must undo it: throwing rolls back.
      if (!result.ok) throw new Refusal(result.error);
      return result;
    });
  } catch (error) {
    if (error instanceof Refusal) return err(error.error);
    throw error;
  }
}

// --- Reading sources under their locks --------------------------------------------------------

interface LockedEntry {
  readonly kind: 'entry';
  readonly entry: InvoicePayment;
  readonly invoice: typeof schema.invoices.$inferSelect;
  /** The held or recorded online payment behind an online entry or a credit, when there is one. */
  readonly attempt: PaymentAttempt | null;
  readonly refundable: number;
}

interface LockedHeld {
  readonly kind: 'held';
  readonly attempt: PaymentAttempt;
  readonly credited: number;
  readonly remaining: number;
}

type LockedSource = LockedEntry | LockedHeld;

async function requestsFor(tx: Db, source: RefundSource): Promise<RefundRequest[]> {
  const r = schema.refundRequests;
  return tx
    .select()
    .from(r)
    .where(
      source.kind === 'entry'
        ? eq(r.invoicePaymentId, source.invoicePaymentId)
        : eq(r.paymentAttemptId, source.paymentAttemptId),
    );
}

async function creditFrom(tx: Db, attemptId: string): Promise<InvoicePayment | undefined> {
  const p = schema.invoicePayments;
  return first(
    await tx
      .select()
      .from(p)
      .where(and(eq(p.kind, 'CREDIT'), eq(p.sourceId, attemptId)))
      .limit(1),
  );
}

/** The held payment of this agency, locked (lock order: first). */
async function lockAttempt(
  tx: Db,
  organizationId: string,
  attemptId: string,
): Promise<PaymentAttempt | undefined> {
  const a = schema.paymentAttempts;
  return first(
    await tx
      .select()
      .from(a)
      .where(and(eq(a.id, attemptId), eq(a.organizationId, organizationId)))
      .limit(1)
      .for('update'),
  );
}

/**
 * The source of a refund, locked: the held payment, or the invoice of a ledger entry (lock order:
 * held payment, request, invoice). Looked up inside the named agency only, so another agency's
 * money looks exactly like a missing one.
 */
async function lockSource(
  tx: Db,
  organizationId: string,
  source: RefundSource,
): Promise<LockedSource | null> {
  if (source.kind === 'held') {
    if (!isUuid(source.paymentAttemptId)) return null;
    const attempt = await lockAttempt(tx, organizationId, source.paymentAttemptId);
    if (!attempt) return null;
    const credit = await creditFrom(tx, attempt.id);
    const credited = credit?.amountMinorUnits ?? 0;
    return {
      kind: 'held',
      attempt,
      credited,
      remaining: heldRemainingMinorUnits(
        attempt.amountMinorUnits,
        credited,
        await requestsFor(tx, source),
      ),
    };
  }
  if (!isUuid(source.invoicePaymentId)) return null;
  const p = schema.invoicePayments;
  const unlocked = first(
    await tx.select().from(p).where(eq(p.id, source.invoicePaymentId)).limit(1),
  );
  if (!unlocked) return null;
  const invoice = first(
    await tx
      .select()
      .from(schema.invoices)
      .where(
        and(
          eq(schema.invoices.id, unlocked.invoiceId),
          eq(schema.invoices.organizationId, organizationId),
        ),
      )
      .limit(1)
      .for('update'),
  );
  if (!invoice) return null;
  const entry = unlocked;
  let attempt: PaymentAttempt | null = null;
  if ((entry.kind === 'ONLINE' || entry.kind === 'CREDIT') && entry.sourceId !== null) {
    attempt =
      first(
        await tx
          .select()
          .from(schema.paymentAttempts)
          .where(eq(schema.paymentAttempts.id, entry.sourceId))
          .limit(1),
      ) ?? null;
  }
  return {
    kind: 'entry',
    entry,
    invoice,
    attempt,
    refundable: entryRefundableMinorUnits(entry.amountMinorUnits, await requestsFor(tx, source)),
  };
}

/** Why this source cannot give back this amount, or null. */
function limitProblem(source: LockedSource, amount: number): ServiceError | null {
  if (source.kind === 'entry') {
    if (source.entry.kind === 'REFUND') {
      return serviceError('invalid', 'A refund cannot itself be refunded.');
    }
    if (source.invoice.status === 'VOID') {
      return serviceError('invalid', 'This invoice is cancelled.');
    }
    if (amount > source.refundable) {
      return serviceError(
        'invalid',
        source.refundable === 0
          ? 'Everything from this payment has already been refunded or is being refunded.'
          : 'This is more than can still be refunded from this payment.',
      );
    }
    return null;
  }
  if (source.attempt.status !== 'HELD_FOR_REVIEW') {
    return serviceError('invalid', 'This payment no longer needs a check.');
  }
  if (amount > source.remaining) {
    return serviceError(
      'invalid',
      source.remaining === 0
        ? 'Everything from this payment has already been credited or refunded.'
        : 'This is more than is left of this payment.',
    );
  }
  return null;
}

/** The gateway's id of the original payment, when VisaStack may ask the gateway to refund it. */
function providerTarget(source: LockedSource, provider: string): string | null {
  const attempt = source.attempt;
  if (!attempt || attempt.provider !== provider || !attempt.bankTranId) return null;
  if (source.kind === 'entry') {
    return source.entry.provider === provider ? attempt.bankTranId : null;
  }
  return VERIFIED_HOLD_REASONS.has(attempt.reasonCode ?? '') ? attempt.bankTranId : null;
}

function sourceIds(source: LockedSource): {
  readonly invoiceId: string;
  readonly invoicePaymentId: string | null;
  readonly paymentAttemptId: string | null;
  readonly currency: string;
} {
  return source.kind === 'entry'
    ? {
        invoiceId: source.invoice.id,
        invoicePaymentId: source.entry.id,
        paymentAttemptId: null,
        currency: normalizeCurrency(source.invoice.currency),
      }
    : {
        invoiceId: source.attempt.invoiceId,
        invoicePaymentId: null,
        paymentAttemptId: source.attempt.id,
        currency: normalizeCurrency(source.attempt.currency),
      };
}

async function invoiceRefOf(db: Db, invoiceId: string): Promise<string> {
  const row = first(
    await db
      .select({ ref: schema.invoices.invoiceRef })
      .from(schema.invoices)
      .where(eq(schema.invoices.id, invoiceId))
      .limit(1),
  );
  return row?.ref ?? '';
}

async function byIdempotencyKey(tx: Db, key: string): Promise<RefundRequest | undefined> {
  return first(
    await tx
      .select()
      .from(schema.refundRequests)
      .where(eq(schema.refundRequests.idempotencyKey, key))
      .limit(1),
  );
}

function sameSource(row: RefundRequest, source: RefundSource): boolean {
  return source.kind === 'entry'
    ? row.invoicePaymentId === source.invoicePaymentId
    : row.paymentAttemptId === source.paymentAttemptId;
}

async function auditRefund(
  tx: Db,
  eventType:
    | 'INVOICE_REFUND_REQUESTED'
    | 'INVOICE_REFUND_SUBMITTED'
    | 'INVOICE_REFUND_CONFIRMED'
    | 'INVOICE_REFUND_FAILED'
    | 'INVOICE_REFUND_CANCELLED'
    | 'INVOICE_REFUND_RECORDED'
    | 'INVOICE_REFUND_NEEDS_CHECK',
  row: RefundRequest,
  actorAccountId: string | null,
  extra: Readonly<Record<string, unknown>> = {},
  reason: string | null = null,
): Promise<void> {
  await appendAuditEvent(tx, {
    eventType,
    actorAccountId,
    action: 'MANAGE',
    method: actorAccountId === null ? 'API' : 'MANUAL',
    result: 'ALLOWED',
    resourceType: 'refund_request',
    resourceId: row.id,
    reason,
    metadata: {
      organizationId: row.organizationId,
      invoiceId: row.invoiceId,
      invoicePaymentId: row.invoicePaymentId,
      paymentAttemptId: row.paymentAttemptId,
      method: row.method,
      status: row.status,
      amountMinorUnits: row.amountMinorUnits,
      currency: row.currency,
      ...extra,
    },
  });
}

/** Tells the agency's owners and admins, naming the invoice and never an amount. */
async function noticeRefund(tx: Db, row: RefundRequest, invoiceRef: string): Promise<void> {
  for (const recipientAccountId of await billingContacts(tx, row.organizationId)) {
    await enqueueNotificationBothChannels(tx, {
      eventType: 'INVOICE_REFUNDED',
      resourceId: row.id,
      recipientAccountId,
      organizationId: row.organizationId,
      payload: {
        subject: 'Refund made',
        summary: `A refund was made on invoice ${invoiceRef}. Open your invoices to see what it shows now.`,
        deepLinkPath: invoicesPath(row.organizationId),
      },
    });
  }
}

/**
 * After a held payment's credit or refund is confirmed, under the held payment's lock: when
 * nothing is left of it and nothing is still on its way, it is closed. `REFUNDED` when all of it
 * went back, `RECORDED` when part of it was counted as a credit. Otherwise it stays held, so staff
 * still see what is left.
 */
async function closeHeldIfSettled(
  tx: Db,
  attempt: PaymentAttempt,
  actorAccountId: string | null,
  now: Date,
): Promise<PaymentAttempt['status']> {
  if (attempt.status !== 'HELD_FOR_REVIEW') return attempt.status;
  const requests = await requestsFor(tx, { kind: 'held', paymentAttemptId: attempt.id });
  if (requests.some((request) => OPEN_STATUSES.includes(request.status))) return attempt.status;
  const credited = (await creditFrom(tx, attempt.id))?.amountMinorUnits ?? 0;
  const confirmed = requests
    .filter((request) => request.status === 'CONFIRMED')
    .reduce((sum, request) => sum + request.amountMinorUnits, 0);
  if (credited + confirmed < attempt.amountMinorUnits) return attempt.status;
  const to = credited > 0 ? 'RECORDED' : 'REFUNDED';
  await tx
    .update(schema.paymentAttempts)
    .set({ status: to, ...(to === 'RECORDED' ? { recordedAt: now } : {}), updatedAt: now })
    .where(eq(schema.paymentAttempts.id, attempt.id));
  await appendAuditEvent(tx, {
    eventType: 'PAYMENT_ATTEMPT_STATUS_CHANGED',
    actorAccountId,
    method: actorAccountId === null ? 'API' : 'MANUAL',
    result: 'ALLOWED',
    resourceType: 'payment_attempt',
    resourceId: attempt.id,
    reason: to === 'RECORDED' ? 'credited' : 'refunded',
    metadata: {
      invoiceId: attempt.invoiceId,
      organizationId: attempt.organizationId,
      from: attempt.status,
      to,
      source: 'refund',
      amountMinorUnits: attempt.amountMinorUnits,
      currency: attempt.currency,
    },
  });
  return to;
}

// --- Asking the gateway to refund -------------------------------------------------------------

export interface RequestRefundInput {
  readonly organizationId: string;
  readonly source: RefundSource;
  readonly amountMinorUnits: number;
  readonly reason: string;
  /** From the form, one per intended refund: sending the form twice makes one request. */
  readonly idempotencyKey: string;
  readonly stepUpSatisfied: boolean;
  readonly now?: Date;
}

function refundPort(port: PaymentPort): RefundingPaymentPort | null {
  return port.configured && isRefundingPaymentPort(port) ? port : null;
}

/**
 * Asks the gateway to refund part or all of one payment (a ledger entry paid online, a credit
 * from a held online payment, or held money). Transaction 1 checks the limit under the source's
 * lock and writes the request `REQUESTED` with its audit record; the gateway is called only after
 * that commits; transaction 2 records what the gateway said. Nothing reaches the ledger here.
 */
export async function requestRefund(
  db: Db,
  port: PaymentPort,
  staff: StaffScope<'BILLING_REFUND_MANAGE'>,
  input: RequestRefundInput,
): Promise<Result<RefundOutcome, ServiceError>> {
  const forbidden = denied(staff);
  if (forbidden) return err(forbidden);
  const reason = cleanText(input.reason, MAX_REASON);
  if (!isValidMinorUnitAmount(input.amountMinorUnits)) {
    return err(serviceError('invalid', 'Enter an amount above zero.'));
  }
  if (!reason) return err(serviceError('invalid', 'Give a reason, up to 500 characters.'));
  if (!isUuid(input.idempotencyKey) || !isUuid(input.organizationId)) {
    return err(serviceError('invalid', 'This page is out of date. Reload it and try again.'));
  }
  if (!input.stepUpSatisfied) {
    return err(serviceError('step_up_required', 'a refund requires reauthentication'));
  }
  if (!(await refundsPresent(db))) return err(serviceError('invalid', REFUNDS_UNAVAILABLE));
  const gateway = refundPort(port);
  if (!gateway) {
    return err(
      serviceError(
        'invalid',
        'Refunds through the payment gateway are not available here. Record a refund made outside VisaStack instead.',
      ),
    );
  }
  const now = input.now ?? new Date();

  const prepared = await inTransaction(
    db,
    async (tx): Promise<Result<{ row: RefundRequest; replay: boolean }, ServiceError>> => {
      const source = await lockSource(tx, input.organizationId, input.source);
      if (!source) return err(serviceError('not_found', 'payment not found'));
      // A repeated send is answered from the first request, under the same lock.
      const replay = await byIdempotencyKey(tx, input.idempotencyKey);
      if (replay) {
        if (
          !sameSource(replay, input.source) ||
          replay.amountMinorUnits !== input.amountMinorUnits
        ) {
          return err(serviceError('invalid', 'This page is out of date. Reload it and try again.'));
        }
        return ok({ row: replay, replay: true });
      }
      const problem = limitProblem(source, input.amountMinorUnits);
      if (problem) return err(problem);
      const bankTranId = providerTarget(source, gateway.provider);
      if (!bankTranId) {
        return err(
          serviceError(
            'invalid',
            'This payment cannot be refunded through the payment gateway. Refund it another way, then record it here.',
          ),
        );
      }
      const ids = sourceIds(source);
      const inserted = first(
        await tx
          .insert(schema.refundRequests)
          .values({
            organizationId: input.organizationId,
            ...ids,
            method: 'PROVIDER',
            status: 'REQUESTED',
            amountMinorUnits: input.amountMinorUnits,
            provider: gateway.provider,
            bankTranId,
            idempotencyKey: input.idempotencyKey,
            reason,
            requestedByAccountId: staff.accountId,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing()
          .returning(),
      );
      if (!inserted) {
        return err(serviceError('invalid', 'This page is out of date. Reload it and try again.'));
      }
      await auditRefund(tx, 'INVOICE_REFUND_REQUESTED', inserted, staff.accountId, {}, reason);
      return ok({ row: inserted, replay: false });
    },
  );
  if (!prepared.ok) return prepared;
  const invoiceRef = await invoiceRefOf(db, prepared.value.row.invoiceId);
  if (prepared.value.replay) {
    return ok({
      code: 'already_requested',
      request: requestView(prepared.value.row, invoiceRef),
    });
  }
  return ok(
    await sendToGateway(db, gateway, prepared.value.row, invoiceRef, staff.accountId, now, 'first'),
  );
}

/**
 * Asks the gateway, after the request is committed, then records its answer under the request's
 * lock. An answer that cannot be trusted (no answer, a reference another request already holds)
 * leaves the request `REQUESTED`, still counting against the limit.
 *
 * A refusal frees the limit (`FAILED`) only on the **first** send, and only when the adapter
 * calls it definite (for SSLCOMMERZ: `APIConnect` is `DONE`, `status` is `failed` and the reply
 * names no `refund_ref_id`, so the gateway took nothing it could name). On **Send Again** the same
 * refund id has been sent before with an unknown outcome, and what the gateway does with a
 * repeated `refund_trans_id` is not documented: a "failed" may mean "already refunded under this
 * id". So a refusal on a resend keeps the request `REQUESTED` and counted, marks it
 * `retry_refused`, and staff are told to check the merchant panel (then It Went Through or It Did
 * Not Go Through).
 */
async function sendToGateway(
  db: Db,
  gateway: RefundingPaymentPort,
  row: RefundRequest,
  invoiceRef: string,
  actorAccountId: string,
  now: Date,
  sending: 'first' | 'again',
): Promise<RefundOutcome> {
  const unconfirmed = (): RefundOutcome => ({
    code: 'unconfirmed',
    request: requestView(row, invoiceRef),
  });
  if (row.bankTranId === null) return unconfirmed();
  let answer: Awaited<ReturnType<RefundingPaymentPort['refund']>>;
  try {
    answer = await gateway.refund({
      bankTranId: row.bankTranId,
      amountMinorUnits: row.amountMinorUnits,
      refundId: row.id,
      // A fixed remark naming the invoice: the reason staff typed stays with VisaStack.
      remarks: `Refund for invoice ${invoiceRef}`.slice(0, MAX_REMARKS),
    });
  } catch {
    await db
      .update(schema.refundRequests)
      .set({ lastCheckedAt: now, updatedAt: now })
      .where(
        and(eq(schema.refundRequests.id, row.id), eq(schema.refundRequests.status, 'REQUESTED')),
      );
    return unconfirmed();
  }
  return db.transaction(async (tx): Promise<RefundOutcome> => {
    const r = schema.refundRequests;
    const locked = first(await tx.select().from(r).where(eq(r.id, row.id)).limit(1).for('update'));
    if (!locked) return unconfirmed();
    if (locked.status !== 'REQUESTED') {
      return { code: 'already_requested', request: requestView(locked, invoiceRef) };
    }
    if (answer.kind === 'refused' && sending === 'again') {
      const marked = required(
        first(
          await tx
            .update(r)
            .set({ failureCode: RETRY_REFUSED_CODE, lastCheckedAt: now, updatedAt: now })
            .where(eq(r.id, locked.id))
            .returning(),
        ),
        'refund request',
      );
      if (locked.failureCode !== RETRY_REFUSED_CODE) {
        await auditRefund(tx, 'INVOICE_REFUND_NEEDS_CHECK', marked, actorAccountId, {
          failureCode: RETRY_REFUSED_CODE,
        });
      }
      return { code: 'unconfirmed', request: requestView(marked, invoiceRef) };
    }
    if (answer.kind === 'refused') {
      const failed = required(
        first(
          await tx
            .update(r)
            .set({
              status: 'FAILED',
              failureCode: answer.code.slice(0, 60),
              closedAt: now,
              lastCheckedAt: now,
              updatedAt: now,
            })
            .where(eq(r.id, locked.id))
            .returning(),
        ),
        'refund request',
      );
      await auditRefund(tx, 'INVOICE_REFUND_FAILED', failed, actorAccountId, {
        failureCode: failed.failureCode,
      });
      return { code: 'refused', request: requestView(failed, invoiceRef) };
    }
    const taken = first(
      await tx
        .select({ id: r.id })
        .from(r)
        .where(and(eq(r.provider, gateway.provider), eq(r.providerRefundId, answer.refundRefId)))
        .limit(1),
    );
    if (taken && taken.id !== locked.id) return unconfirmed();
    const sent = required(
      first(
        await tx
          .update(r)
          .set({
            status: 'SUBMITTED',
            providerRefundId: answer.refundRefId,
            submittedAt: now,
            lastCheckedAt: now,
            updatedAt: now,
          })
          .where(eq(r.id, locked.id))
          .returning(),
      ),
      'refund request',
    );
    await auditRefund(tx, 'INVOICE_REFUND_SUBMITTED', sent, actorAccountId);
    return { code: 'sent', request: requestView(sent, invoiceRef) };
  });
}

export interface RefundRequestActionInput {
  readonly organizationId: string;
  readonly refundRequestId: string;
  readonly stepUpSatisfied: boolean;
  readonly now?: Date;
}

async function openProviderRequest(
  db: Db,
  input: RefundRequestActionInput,
): Promise<Result<RefundRequest, ServiceError>> {
  if (!isUuid(input.refundRequestId) || !isUuid(input.organizationId)) {
    return err(serviceError('not_found', 'refund not found'));
  }
  const r = schema.refundRequests;
  const row = first(
    await db
      .select()
      .from(r)
      .where(and(eq(r.id, input.refundRequestId), eq(r.organizationId, input.organizationId)))
      .limit(1),
  );
  if (!row) return err(serviceError('not_found', 'refund not found'));
  if (row.method !== 'PROVIDER' || row.status !== 'REQUESTED') {
    return err(
      serviceError(
        'invalid',
        'Only a refund that was not confirmed as sent can be sent again or cancelled.',
      ),
    );
  }
  return ok(row);
}

/**
 * Sends a refund whose first sending could not be confirmed, again, with the same refund id (so
 * the gateway can only see the same refund twice, never two refunds).
 */
export async function retryRefund(
  db: Db,
  port: PaymentPort,
  staff: StaffScope<'BILLING_REFUND_MANAGE'>,
  input: RefundRequestActionInput,
): Promise<Result<RefundOutcome, ServiceError>> {
  const forbidden = denied(staff);
  if (forbidden) return err(forbidden);
  if (!input.stepUpSatisfied) {
    return err(serviceError('step_up_required', 'a refund requires reauthentication'));
  }
  if (!(await refundsPresent(db))) return err(serviceError('invalid', REFUNDS_UNAVAILABLE));
  const gateway = refundPort(port);
  if (!gateway) return err(serviceError('invalid', 'The payment gateway is not available here.'));
  const row = await openProviderRequest(db, input);
  if (!row.ok) return row;
  if (row.value.provider !== gateway.provider) {
    return err(serviceError('invalid', 'This refund belongs to another payment gateway.'));
  }
  const invoiceRef = await invoiceRefOf(db, row.value.invoiceId);
  return ok(
    await sendToGateway(
      db,
      gateway,
      row.value,
      invoiceRef,
      staff.accountId,
      input.now ?? new Date(),
      'again',
    ),
  );
}

/**
 * Cancels a refund whose sending could not be confirmed, after staff checked in the gateway panel
 * that it never arrived there. It stops counting against the limit. Never for a refund the
 * gateway has taken (`SUBMITTED`): that one is settled by the gateway.
 */
export async function cancelRefund(
  db: Db,
  staff: StaffScope<'BILLING_REFUND_MANAGE'>,
  input: RefundRequestActionInput & { readonly reason: string },
): Promise<Result<RefundRequestView, ServiceError>> {
  const forbidden = denied(staff);
  if (forbidden) return err(forbidden);
  const reason = cleanText(input.reason, MAX_REASON);
  if (!reason) return err(serviceError('invalid', 'Give a reason, up to 500 characters.'));
  if (!input.stepUpSatisfied) {
    return err(serviceError('step_up_required', 'cancelling a refund requires reauthentication'));
  }
  if (!(await refundsPresent(db))) return err(serviceError('invalid', REFUNDS_UNAVAILABLE));
  const seen = await openProviderRequest(db, input);
  if (!seen.ok) return seen;
  const now = input.now ?? new Date();
  const done = await inTransaction(db, async (tx): Promise<Result<RefundRequest, ServiceError>> => {
    // Lock order: a held payment first, then the request.
    if (seen.value.paymentAttemptId !== null) {
      await lockAttempt(tx, seen.value.organizationId, seen.value.paymentAttemptId);
    }
    const r = schema.refundRequests;
    const locked = first(
      await tx.select().from(r).where(eq(r.id, seen.value.id)).limit(1).for('update'),
    );
    if (!locked || locked.status !== 'REQUESTED') {
      return err(serviceError('invalid', 'This refund changed meanwhile. Reload the page.'));
    }
    const cancelled = required(
      first(
        await tx
          .update(r)
          .set({ status: 'CANCELLED', closedAt: now, updatedAt: now })
          .where(eq(r.id, locked.id))
          .returning(),
      ),
      'refund request',
    );
    await auditRefund(tx, 'INVOICE_REFUND_CANCELLED', cancelled, staff.accountId, {}, reason);
    return ok(cancelled);
  });
  if (!done.ok) return done;
  return ok(requestView(done.value, await invoiceRefOf(db, done.value.invoiceId)));
}

export interface ConfirmUnsentRefundInput extends RefundRequestActionInput {
  /** The refund reference the merchant panel shows. */
  readonly reference: string;
  /** The day the panel says the refund was made. */
  readonly refundedOn: Date;
}

/**
 * "It Went Through": a refund whose sending VisaStack could not confirm, that staff found made in
 * the gateway's merchant panel. Under the locks (held payment, request, invoice), in one
 * transaction, the request is confirmed with the panel's refund reference and day, and (for
 * counted money) the one `REFUND` ledger row is written, recorded by this staff member. The day may
 * not be before the request was made, nor in the future. Only for a request still `REQUESTED`.
 */
export async function confirmUnsentRefund(
  db: Db,
  staff: StaffScope<'BILLING_REFUND_MANAGE'>,
  input: ConfirmUnsentRefundInput,
): Promise<Result<RefundRequestView, ServiceError>> {
  const forbidden = denied(staff);
  if (forbidden) return err(forbidden);
  const reference = cleanText(input.reference, MAX_REFERENCE);
  if (!reference) {
    return err(serviceError('invalid', 'Enter the refund reference, up to 120 characters.'));
  }
  const now = input.now ?? new Date();
  const notLater = refundDayProblem(input.refundedOn, null, now);
  if (notLater) return err(notLater);
  if (!input.stepUpSatisfied) {
    return err(serviceError('step_up_required', 'confirming a refund requires reauthentication'));
  }
  if (!(await refundsPresent(db))) return err(serviceError('invalid', REFUNDS_UNAVAILABLE));
  const seen = await openProviderRequest(db, input);
  if (!seen.ok) return seen;
  const tooEarly = refundDayProblem(input.refundedOn, seen.value.createdAt, now);
  if (tooEarly) return err(tooEarly);
  const done = await inTransaction(db, async (tx): Promise<Result<RefundRequest, ServiceError>> => {
    // Lock order: the held payment, then the request, then (inside the ledger write) the invoice.
    const attempt =
      seen.value.paymentAttemptId !== null
        ? await lockAttempt(tx, seen.value.organizationId, seen.value.paymentAttemptId)
        : undefined;
    const r = schema.refundRequests;
    const locked = first(
      await tx.select().from(r).where(eq(r.id, seen.value.id)).limit(1).for('update'),
    );
    if (!locked || locked.status !== 'REQUESTED') {
      return err(serviceError('invalid', 'This refund changed meanwhile. Reload the page.'));
    }
    const taken = first(
      await tx
        .select({ id: r.id })
        .from(r)
        .where(and(eq(r.provider, locked.provider ?? ''), eq(r.providerRefundId, reference)))
        .limit(1),
    );
    if (taken) {
      return err(
        serviceError('invalid', 'That refund reference is already recorded for another refund.'),
      );
    }
    if (locked.invoicePaymentId !== null) {
      const written = await applyInvoiceRefund(tx, {
        invoiceId: locked.invoiceId,
        refundRequestId: locked.id,
        amountMinorUnits: locked.amountMinorUnits,
        currency: locked.currency,
        provider: locked.provider,
        providerTransactionId: reference,
        reference,
        refundedAt: input.refundedOn,
        recordedByAccountId: staff.accountId,
      });
      if (!written.ok) {
        return err(
          serviceError('invalid', 'This refund could not be recorded against the invoice.'),
        );
      }
      await cancelQueuedNotificationsForResource(tx, locked.invoiceId);
    }
    const confirmed = required(
      first(
        await tx
          .update(r)
          .set({
            status: 'CONFIRMED',
            providerRefundId: reference,
            reference,
            providerRefundedAt: input.refundedOn,
            confirmedAt: now,
            closedAt: now,
            lastCheckedAt: now,
            updatedAt: now,
          })
          .where(eq(r.id, locked.id))
          .returning(),
      ),
      'refund request',
    );
    if (attempt) await closeHeldIfSettled(tx, attempt, staff.accountId, now);
    await auditRefund(tx, 'INVOICE_REFUND_CONFIRMED', confirmed, staff.accountId, {
      confirmedBy: 'staff_from_panel',
    });
    await noticeRefund(tx, confirmed, await invoiceRefOf(tx, confirmed.invoiceId));
    return ok(confirmed);
  });
  if (!done.ok) return done;
  return ok(requestView(done.value, await invoiceRefOf(db, done.value.invoiceId)));
}

// --- Confirming with the gateway --------------------------------------------------------------

export interface RefundCheckSummary {
  /** False before migration 0104. */
  readonly available: boolean;
  /** False when no gateway that can refund is configured. */
  readonly configured: boolean;
  readonly checked: number;
  readonly confirmed: number;
  readonly failed: number;
  readonly stillProcessing: number;
  /** Refunds the gateway could not be asked about in this run. */
  readonly unavailable: number;
  /** Refunds the gateway confirmed that could not be written (they need a person). */
  readonly needsCheck: number;
  /** Requests whose sending was never confirmed: staff must check the gateway panel. */
  readonly awaitingCheck: number;
  /** Sent refunds not asked about because the run's time budget ran out; the next run asks. */
  readonly leftForLater: number;
}

const EMPTY_CHECK: RefundCheckSummary = {
  available: true,
  configured: true,
  checked: 0,
  confirmed: 0,
  failed: 0,
  stillProcessing: 0,
  unavailable: 0,
  needsCheck: 0,
  awaitingCheck: 0,
  leftForLater: 0,
};

type CheckCode = 'confirmed' | 'failed' | 'processing' | 'unavailable' | 'needs_check' | 'skipped';

/**
 * Asks the gateway about one sent refund and acts on the answer. Refunded: under the locks
 * (held payment, request, invoice), the request is confirmed and, for counted money, the one
 * `REFUND` ledger row is written; a second confirmation finds the request already confirmed and
 * writes nothing. Cancelled by the gateway: `FAILED`. Still processing: nothing but the time it
 * was asked.
 */
async function confirmOne(
  db: Db,
  gateway: RefundingPaymentPort,
  seen: RefundRequest,
  now: Date,
): Promise<CheckCode> {
  if (seen.status !== 'SUBMITTED' || seen.providerRefundId === null) return 'skipped';
  if (seen.provider !== gateway.provider) return 'skipped';
  let report: Awaited<ReturnType<RefundingPaymentPort['queryRefund']>>;
  try {
    report = await gateway.queryRefund(seen.providerRefundId);
  } catch {
    return 'unavailable';
  }
  const r = schema.refundRequests;
  if (report.status === 'PROCESSING' || report.status === 'UNKNOWN') {
    await db
      .update(r)
      .set({ lastCheckedAt: now, updatedAt: now })
      .where(and(eq(r.id, seen.id), eq(r.status, 'SUBMITTED')));
    return 'processing';
  }
  const providerRefundId = seen.providerRefundId;
  const result = await inTransaction(db, async (tx): Promise<Result<CheckCode, ServiceError>> => {
    // Lock order: the held payment, then the request, then (inside the ledger write) the invoice.
    const attempt =
      seen.paymentAttemptId !== null
        ? await lockAttempt(tx, seen.organizationId, seen.paymentAttemptId)
        : undefined;
    const locked = first(await tx.select().from(r).where(eq(r.id, seen.id)).limit(1).for('update'));
    if (!locked || locked.status !== 'SUBMITTED') return ok('skipped');
    if (report.status === 'CANCELLED') {
      const failed = required(
        first(
          await tx
            .update(r)
            .set({
              status: 'FAILED',
              failureCode: 'provider_cancelled',
              closedAt: now,
              lastCheckedAt: now,
              updatedAt: now,
            })
            .where(eq(r.id, locked.id))
            .returning(),
        ),
        'refund request',
      );
      await auditRefund(tx, 'INVOICE_REFUND_FAILED', failed, null, {
        failureCode: failed.failureCode,
      });
      return ok('failed');
    }
    const refundedAt = report.refundedAt ?? now;
    if (locked.invoicePaymentId !== null) {
      const written = await applyInvoiceRefund(tx, {
        invoiceId: locked.invoiceId,
        refundRequestId: locked.id,
        amountMinorUnits: locked.amountMinorUnits,
        currency: locked.currency,
        provider: locked.provider,
        providerTransactionId: providerRefundId,
        reference: providerRefundId,
        refundedAt,
        recordedByAccountId: null,
      });
      // The gateway refunded money the ledger cannot take back as asked: a person must look. The
      // request keeps its status (SUBMITTED) and gets a reason code, which the guard trigger and
      // the checks allow on an open row; it is audited once, the first time it is found.
      if (!written.ok) {
        await tx
          .update(r)
          .set({ failureCode: NEEDS_CHECK_CODE, lastCheckedAt: now, updatedAt: now })
          .where(eq(r.id, locked.id));
        if (locked.failureCode !== NEEDS_CHECK_CODE) {
          await auditRefund(tx, 'INVOICE_REFUND_NEEDS_CHECK', locked, null, {
            failureCode: NEEDS_CHECK_CODE,
            ledgerRefusal: written.error.code,
          });
        }
        return ok('needs_check');
      }
      // A refunded invoice is never chased again (D2): its queued reminders never go out.
      await cancelQueuedNotificationsForResource(tx, locked.invoiceId);
    }
    const confirmed = required(
      first(
        await tx
          .update(r)
          .set({
            status: 'CONFIRMED',
            confirmedAt: now,
            providerRefundedAt: refundedAt,
            closedAt: now,
            lastCheckedAt: now,
            updatedAt: now,
          })
          .where(eq(r.id, locked.id))
          .returning(),
      ),
      'refund request',
    );
    if (attempt) await closeHeldIfSettled(tx, attempt, null, now);
    await auditRefund(tx, 'INVOICE_REFUND_CONFIRMED', confirmed, null);
    await noticeRefund(tx, confirmed, await invoiceRefOf(tx, confirmed.invoiceId));
    return ok('confirmed');
  });
  return result.ok ? result.value : 'needs_check';
}

const MAX_CONSECUTIVE_OUTAGES = 3;

async function checkBatch(
  db: Db,
  gateway: RefundingPaymentPort,
  rows: readonly RefundRequest[],
  now: Date,
  deadline: number | null = null,
): Promise<RefundCheckSummary> {
  let summary = { ...EMPTY_CHECK };
  let outagesInARow = 0;
  for (const [index, row] of rows.entries()) {
    // No new gateway call is started once the time budget is spent (the job has 60 seconds).
    if (deadline !== null && Date.now() >= deadline) {
      summary = { ...summary, leftForLater: rows.length - index };
      break;
    }
    const code = await confirmOne(db, gateway, row, now);
    if (code === 'skipped') continue;
    summary = {
      ...summary,
      checked: summary.checked + 1,
      confirmed: summary.confirmed + (code === 'confirmed' ? 1 : 0),
      failed: summary.failed + (code === 'failed' ? 1 : 0),
      stillProcessing: summary.stillProcessing + (code === 'processing' ? 1 : 0),
      unavailable: summary.unavailable + (code === 'unavailable' ? 1 : 0),
      needsCheck: summary.needsCheck + (code === 'needs_check' ? 1 : 0),
    };
    outagesInARow = code === 'unavailable' ? outagesInARow + 1 : 0;
    if (outagesInARow >= MAX_CONSECUTIVE_OUTAGES) break;
  }
  return summary;
}

async function countAwaitingCheck(db: Db, organizationId: string | null): Promise<number> {
  const r = schema.refundRequests;
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(r)
    .where(
      and(
        eq(r.status, 'REQUESTED'),
        eq(r.method, 'PROVIDER'),
        organizationId === null ? undefined : eq(r.organizationId, organizationId),
      ),
    );
  return rows[0]?.n ?? 0;
}

async function submittedRequests(
  db: Db,
  provider: string,
  organizationId: string | null,
  limit: number,
): Promise<RefundRequest[]> {
  const r = schema.refundRequests;
  return (
    db
      .select()
      .from(r)
      .where(
        and(
          eq(r.status, 'SUBMITTED'),
          eq(r.provider, provider),
          organizationId === null ? undefined : eq(r.organizationId, organizationId),
        ),
      )
      // Refunds that already need a person go last, so they can never crowd out the others.
      .orderBy(
        sql`(${r.failureCode} is not null) asc`,
        sql`${r.lastCheckedAt} asc nulls first`,
        asc(r.createdAt),
      )
      .limit(limit)
  );
}

/**
 * The daily check of refunds the gateway has taken (inside the payment reconciliation job): each
 * is confirmed, failed, or left processing as the gateway says. Counts only.
 */
export async function reconcileRefunds(
  db: Db,
  scope: SystemScope<'process-payment-reconciliation'>,
  port: PaymentPort,
  options: {
    readonly now?: Date;
    readonly limit?: number;
    /** A clock time (ms) after which no new gateway call is started. */
    readonly deadline?: number;
  } = {},
): Promise<RefundCheckSummary> {
  if (scope.job !== 'process-payment-reconciliation') throw new Error('wrong job scope');
  if (!(await refundsPresent(db))) return { ...EMPTY_CHECK, available: false };
  const gateway = refundPort(port);
  if (!gateway) return { ...EMPTY_CHECK, configured: false };
  const now = options.now ?? new Date();
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
  const summary = await checkBatch(
    db,
    gateway,
    await submittedRequests(db, gateway.provider, null, limit),
    now,
    options.deadline ?? null,
  );
  return { ...summary, awaitingCheck: await countAwaitingCheck(db, null) };
}

/** "Check Now" on one agency's page: the same check, for that agency's sent refunds only. */
export async function checkRefundsNow(
  db: Db,
  port: PaymentPort,
  staff: StaffScope<'BILLING_REFUND_MANAGE'>,
  input: { readonly organizationId: string; readonly now?: Date },
): Promise<Result<RefundCheckSummary, ServiceError>> {
  const forbidden = denied(staff);
  if (forbidden) return err(forbidden);
  if (!isUuid(input.organizationId)) return err(serviceError('not_found', 'agency not found'));
  if (!(await refundsPresent(db))) return ok({ ...EMPTY_CHECK, available: false });
  const gateway = refundPort(port);
  if (!gateway) return ok({ ...EMPTY_CHECK, configured: false });
  const now = input.now ?? new Date();
  const summary = await checkBatch(
    db,
    gateway,
    await submittedRequests(db, gateway.provider, input.organizationId, 20),
    now,
  );
  return ok({ ...summary, awaitingCheck: await countAwaitingCheck(db, input.organizationId) });
}

/**
 * Why a refund day cannot be right, or null. A refund day is stored as UTC midnight of its
 * Bangladesh day (the shape every billing day has); it may not be later than today in Bangladesh,
 * nor earlier than `earliest` (the day the money came in, or the day the refund was asked for).
 */
export function refundDayProblem(
  refundedOn: Date,
  earliest: Date | null,
  now: Date,
): ServiceError | null {
  if (Number.isNaN(refundedOn.getTime())) {
    return serviceError('invalid', 'Enter the day the refund was made.');
  }
  const day = billingDay(refundedOn).getTime();
  if (day > billingDay(now).getTime()) {
    return serviceError('invalid', 'The refund day cannot be in the future.');
  }
  if (earliest !== null && day < billingDay(earliest).getTime()) {
    return serviceError(
      'invalid',
      `The refund day cannot be before ${billingDay(earliest).toISOString().slice(0, 10)}, when the money came in or the refund was asked for.`,
    );
  }
  return null;
}

/** The day the money behind a source came in. */
function paymentDay(source: LockedSource): Date {
  return source.kind === 'entry'
    ? source.entry.collectedDate
    : (source.attempt.redirectedAt ?? source.attempt.createdAt);
}

// --- Refunds made outside VisaStack -----------------------------------------------------------

export interface RecordManualRefundInput {
  readonly organizationId: string;
  readonly source: RefundSource;
  readonly amountMinorUnits: number;
  /** The outside reference: a bank transfer id, or the gateway panel's refund reference. */
  readonly reference: string;
  /** When the money went back. Not in the future. */
  readonly refundedOn: Date;
  readonly reason: string;
  readonly idempotencyKey: string;
  readonly stepUpSatisfied: boolean;
  readonly now?: Date;
}

/**
 * Records a refund already made outside VisaStack (by bank transfer, or in the gateway panel):
 * one transaction writes the confirmed request and, for counted money, the ledger row with the
 * same checks as a gateway refund. For held money it closes the held payment when nothing is left.
 */
export async function recordManualRefund(
  db: Db,
  staff: StaffScope<'BILLING_REFUND_MANAGE'>,
  input: RecordManualRefundInput,
): Promise<Result<RefundOutcome, ServiceError>> {
  const forbidden = denied(staff);
  if (forbidden) return err(forbidden);
  const reason = cleanText(input.reason, MAX_REASON);
  const reference = cleanText(input.reference, MAX_REFERENCE);
  const now = input.now ?? new Date();
  if (!isValidMinorUnitAmount(input.amountMinorUnits)) {
    return err(serviceError('invalid', 'Enter an amount above zero.'));
  }
  if (!reference)
    return err(serviceError('invalid', 'Enter the refund reference, up to 120 characters.'));
  if (!reason) return err(serviceError('invalid', 'Give a reason, up to 500 characters.'));
  const notLater = refundDayProblem(input.refundedOn, null, now);
  if (notLater) return err(notLater);
  if (!isUuid(input.idempotencyKey) || !isUuid(input.organizationId)) {
    return err(serviceError('invalid', 'This page is out of date. Reload it and try again.'));
  }
  if (!input.stepUpSatisfied) {
    return err(serviceError('step_up_required', 'recording a refund requires reauthentication'));
  }
  if (!(await refundsPresent(db))) return err(serviceError('invalid', REFUNDS_UNAVAILABLE));

  const done = await inTransaction(
    db,
    async (tx): Promise<Result<{ row: RefundRequest; replay: boolean }, ServiceError>> => {
      const source = await lockSource(tx, input.organizationId, input.source);
      if (!source) return err(serviceError('not_found', 'payment not found'));
      const replay = await byIdempotencyKey(tx, input.idempotencyKey);
      if (replay) {
        if (
          !sameSource(replay, input.source) ||
          replay.amountMinorUnits !== input.amountMinorUnits
        ) {
          return err(serviceError('invalid', 'This page is out of date. Reload it and try again.'));
        }
        return ok({ row: replay, replay: true });
      }
      const problem = limitProblem(source, input.amountMinorUnits);
      if (problem) return err(problem);
      // Never before the money came in (the payment's own day, in Bangladesh time).
      const tooEarly = refundDayProblem(input.refundedOn, paymentDay(source), now);
      if (tooEarly) return err(tooEarly);
      const ids = sourceIds(source);
      const row = first(
        await tx
          .insert(schema.refundRequests)
          .values({
            organizationId: input.organizationId,
            ...ids,
            method: 'MANUAL',
            status: 'CONFIRMED',
            amountMinorUnits: input.amountMinorUnits,
            provider: null,
            idempotencyKey: input.idempotencyKey,
            reason,
            reference,
            requestedByAccountId: staff.accountId,
            providerRefundedAt: input.refundedOn,
            confirmedAt: now,
            closedAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing()
          .returning(),
      );
      if (!row)
        return err(serviceError('invalid', 'This page is out of date. Reload it and try again.'));
      if (source.kind === 'entry') {
        const written = await applyInvoiceRefund(tx, {
          invoiceId: source.invoice.id,
          refundRequestId: row.id,
          amountMinorUnits: row.amountMinorUnits,
          currency: row.currency,
          provider: null,
          providerTransactionId: null,
          reference,
          refundedAt: input.refundedOn,
          recordedByAccountId: staff.accountId,
        });
        if (!written.ok)
          return err(
            serviceError('invalid', 'This refund could not be recorded against the invoice.'),
          );
        await cancelQueuedNotificationsForResource(tx, source.invoice.id);
      } else {
        await closeHeldIfSettled(tx, source.attempt, staff.accountId, now);
      }
      await auditRefund(tx, 'INVOICE_REFUND_RECORDED', row, staff.accountId, {}, reason);
      await noticeRefund(tx, row, await invoiceRefOf(tx, row.invoiceId));
      return ok({ row, replay: false });
    },
  );
  if (!done.ok) return done;
  return ok({
    code: done.value.replay ? 'already_requested' : 'recorded',
    request: requestView(done.value.row, await invoiceRefOf(db, done.value.row.invoiceId)),
  });
}

// --- Held overpayments: Apply to Next Invoice -------------------------------------------------

export interface ApplyHeldCreditInput {
  readonly organizationId: string;
  readonly paymentAttemptId: string;
  /** Another open invoice of the same agency and currency; by default the one due first. */
  readonly targetInvoiceId?: string | null;
  readonly stepUpSatisfied: boolean;
  readonly now?: Date;
}

export interface HeldCreditOutcome {
  readonly invoiceId: string;
  readonly invoiceRef: string;
  readonly creditedMinorUnits: number;
  /** What is left of the held payment; it can only be refunded. */
  readonly remainingMinorUnits: number;
  readonly alreadyApplied: boolean;
}

/** Open invoices of this agency, in this currency, that may take a credit (never a refunded one), oldest due first. */
async function creditTargets(tx: Db, organizationId: string, currency: string) {
  const i = schema.invoices;
  return tx
    .select()
    .from(i)
    .where(
      and(
        eq(i.organizationId, organizationId),
        inArray(i.status, ['OPEN', 'PARTIALLY_PAID']),
        sql`upper(btrim(${i.currency})) = ${currency}`,
        invoiceNotRefundedSql(sql`${i.id}`),
      ),
    )
    .orderBy(asc(i.dueDate), asc(i.createdAt));
}

/**
 * Counts held money towards an open invoice of the same agency, once: a `CREDIT` ledger row whose
 * source is the held payment and whose gateway key is the held payment's own (so the same money
 * can never also be counted as an online payment). The credit is what is left of the held money
 * or the invoice's balance, whichever is smaller; any remainder can only be refunded. A credit
 * that pays everything off ends a Grace or Suspended status VisaStack set (S17's path).
 */
export async function applyHeldPaymentCredit(
  db: Db,
  staff: StaffScope<'BILLING_REFUND_MANAGE'>,
  input: ApplyHeldCreditInput,
): Promise<Result<HeldCreditOutcome, ServiceError>> {
  const forbidden = denied(staff);
  if (forbidden) return err(forbidden);
  if (!isUuid(input.organizationId) || !isUuid(input.paymentAttemptId)) {
    return err(serviceError('not_found', 'payment not found'));
  }
  const target = input.targetInvoiceId ?? null;
  if (target !== null && !isUuid(target))
    return err(serviceError('not_found', 'invoice not found'));
  if (!input.stepUpSatisfied) {
    return err(serviceError('step_up_required', 'applying a credit requires reauthentication'));
  }
  if (!(await refundsPresent(db))) return err(serviceError('invalid', REFUNDS_UNAVAILABLE));
  const now = input.now ?? new Date();

  return inTransaction(db, async (tx): Promise<Result<HeldCreditOutcome, ServiceError>> => {
    // Lock order: the held payment first, then the invoice (and, inside the recording function,
    // the billing account and the audit chain).
    const attempt = await lockAttempt(tx, input.organizationId, input.paymentAttemptId);
    if (!attempt) return err(serviceError('not_found', 'payment not found'));
    const existing = await creditFrom(tx, attempt.id);
    if (existing) {
      const requests = await requestsFor(tx, { kind: 'held', paymentAttemptId: attempt.id });
      return ok({
        invoiceId: existing.invoiceId,
        invoiceRef: await invoiceRefOf(tx, existing.invoiceId),
        creditedMinorUnits: existing.amountMinorUnits,
        remainingMinorUnits: heldRemainingMinorUnits(
          attempt.amountMinorUnits,
          existing.amountMinorUnits,
          requests,
        ),
        alreadyApplied: true,
      });
    }
    if (attempt.status !== 'HELD_FOR_REVIEW') {
      return err(serviceError('invalid', 'This payment no longer needs a check.'));
    }
    if (!VERIFIED_HOLD_REASONS.has(attempt.reasonCode ?? '') || attempt.providerValId === null) {
      return err(
        serviceError(
          'invalid',
          'This payment did not match what the gateway reported, so it cannot be applied as a credit. Check it in the gateway panel, then refund it.',
        ),
      );
    }
    const requests = await requestsFor(tx, { kind: 'held', paymentAttemptId: attempt.id });
    const remaining = heldRemainingMinorUnits(attempt.amountMinorUnits, 0, requests);
    if (remaining === 0) {
      return err(
        serviceError('invalid', 'Everything from this payment is already being refunded.'),
      );
    }
    const currency = normalizeCurrency(attempt.currency);
    const candidates = await creditTargets(tx, attempt.organizationId, currency);
    const chosen =
      target === null ? candidates[0] : candidates.find((invoice) => invoice.id === target);
    if (!chosen) {
      return err(
        serviceError(
          'invalid',
          target === null
            ? NO_OPEN_INVOICE_FOR_CREDIT
            : 'That invoice cannot take this credit. Choose an open invoice of this agency in the same currency.',
        ),
      );
    }
    const invoice = first(
      await tx
        .select()
        .from(schema.invoices)
        .where(eq(schema.invoices.id, chosen.id))
        .limit(1)
        .for('update'),
    );
    if (!invoice || (invoice.status !== 'OPEN' && invoice.status !== 'PARTIALLY_PAID')) {
      return err(serviceError('invalid', 'That invoice changed meanwhile. Reload the page.'));
    }
    const balance = outstandingMinorUnits(
      invoice.invoicedAmountMinorUnits,
      invoice.collectedAmountMinorUnits,
    );
    const credit = Math.min(remaining, balance);
    if (credit <= 0) return err(serviceError('invalid', 'That invoice has nothing left to pay.'));
    const applied = await applyInvoiceCollection(tx, {
      invoiceId: invoice.id,
      amountMinorUnits: credit,
      currency,
      kind: 'CREDIT',
      sourceId: attempt.id,
      provider: attempt.provider,
      providerTransactionId: attempt.providerValId,
      reference: (attempt.bankTranId ?? attempt.merchantTranId).slice(0, 100),
      collectedDate: now,
      recordedByAccountId: staff.accountId,
      reason: 'credit from a held payment',
    });
    if (!applied.ok) {
      return err(
        serviceError(
          'invalid',
          applied.error.code === 'key_conflict'
            ? 'This payment was already counted elsewhere. Check it before doing anything else.'
            : 'This credit could not be applied to that invoice.',
        ),
      );
    }
    await closeHeldIfSettled(tx, attempt, staff.accountId, now);
    await appendAuditEvent(tx, {
      eventType: 'INVOICE_CREDIT_APPLIED',
      actorAccountId: staff.accountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'payment_attempt',
      resourceId: attempt.id,
      metadata: {
        organizationId: attempt.organizationId,
        fromInvoiceId: attempt.invoiceId,
        toInvoiceId: invoice.id,
        amountMinorUnits: credit,
        remainingMinorUnits: remaining - credit,
        currency,
        ledgerEntryId: applied.value.payment?.id ?? null,
      },
    });
    for (const recipientAccountId of await billingContacts(tx, attempt.organizationId)) {
      await enqueueNotificationBothChannels(tx, {
        eventType: 'INVOICE_CREDIT_APPLIED',
        resourceId: attempt.id,
        recipientAccountId,
        organizationId: attempt.organizationId,
        payload: {
          subject: 'Credit applied',
          summary: `An earlier payment was applied to invoice ${invoice.invoiceRef}. Open your invoices to see what is left to pay.`,
          deepLinkPath: invoicesPath(attempt.organizationId),
        },
      });
    }
    return ok({
      invoiceId: invoice.id,
      invoiceRef: invoice.invoiceRef,
      creditedMinorUnits: credit,
      remainingMinorUnits: remaining - credit,
      alreadyApplied: false,
    });
  });
}

// --- What the admin organization page shows ---------------------------------------------------

export interface RefundableEntryView {
  readonly id: string;
  readonly invoiceId: string;
  readonly invoiceRef: string;
  readonly kind: InvoicePayment['kind'];
  readonly amountMinorUnits: number;
  readonly currency: string;
  readonly reference: string;
  readonly createdAt: Date;
  /** The day the money came in: a refund recorded for it cannot be earlier. */
  readonly paidOn: Date;
  readonly refundableMinorUnits: number;
  /** True when the gateway can be asked to refund it (paid online, with the gateway's payment id). */
  readonly viaGateway: boolean;
}

export interface HeldPaymentView {
  readonly id: string;
  readonly invoiceId: string;
  readonly invoiceRef: string;
  readonly amountMinorUnits: number;
  readonly currency: string;
  readonly reasonCode: string | null;
  readonly createdAt: Date;
  /** The day the money came in: a refund recorded for it cannot be earlier. */
  readonly paidOn: Date;
  readonly remainingMinorUnits: number;
  readonly creditedMinorUnits: number;
  /** The gateway confirmed exactly this amount: it can be applied as a credit or refunded through the gateway. */
  readonly verified: boolean;
  readonly viaGateway: boolean;
}

export interface CreditTargetView {
  readonly id: string;
  readonly invoiceRef: string;
  readonly currency: string;
  readonly outstandingMinorUnits: number;
  readonly dueDate: Date;
}

export interface OrganizationRefundWork {
  readonly available: boolean;
  readonly entries: readonly RefundableEntryView[];
  readonly held: readonly HeldPaymentView[];
  readonly requests: readonly RefundRequestView[];
  readonly creditTargets: readonly CreditTargetView[];
  /** True when more payments can still give something back than the lists show (at most 25 each). */
  readonly more: boolean;
}

/** The most payments each list on the admin card shows, newest first. */
export const REFUND_WORK_LIMIT = 25;

/**
 * Everything the admin organization page needs for refunds and credits: the counted payments that
 * can still give something back, the held payments, the refunds (newest first), and the open
 * invoices a credit can go to. Platform owner only. Before migration 0104 it reports not available
 * and lists nothing.
 */
export async function getOrganizationRefundWork(
  db: Db,
  staff: StaffScope<'BILLING_REFUND_MANAGE'>,
  input: { readonly organizationId: string; readonly gatewayProvider: string | null },
): Promise<Result<OrganizationRefundWork, ServiceError>> {
  const forbidden = denied(staff);
  if (forbidden) return err(forbidden);
  const empty: OrganizationRefundWork = {
    available: false,
    entries: [],
    held: [],
    requests: [],
    creditTargets: [],
    more: false,
  };
  if (!isUuid(input.organizationId)) return ok(empty);
  if (!(await refundsPresent(db))) return ok(empty);
  const i = schema.invoices;
  const p = schema.invoicePayments;
  const a = schema.paymentAttempts;
  const r = schema.refundRequests;
  const invoices = await db
    .select({ id: i.id, ref: i.invoiceRef })
    .from(i)
    .where(eq(i.organizationId, input.organizationId));
  const refOf = new Map(invoices.map((row) => [row.id, row.ref]));
  const invoiceIds = invoices.map((row) => row.id);
  if (invoiceIds.length === 0) return ok({ ...empty, available: true });
  const [ledger, attempts, requests] = await Promise.all([
    db.select().from(p).where(inArray(p.invoiceId, invoiceIds)).orderBy(asc(p.seq)),
    db
      .select()
      .from(a)
      .where(and(eq(a.organizationId, input.organizationId), eq(a.status, 'HELD_FOR_REVIEW')))
      .orderBy(asc(a.createdAt)),
    db
      .select()
      .from(r)
      .where(eq(r.organizationId, input.organizationId))
      .orderBy(desc(r.createdAt)),
  ]);
  const attemptIds = [
    ...new Set(
      ledger
        .filter((row) => (row.kind === 'ONLINE' || row.kind === 'CREDIT') && row.sourceId !== null)
        .map((row) => row.sourceId as string),
    ),
  ];
  const sourceAttempts =
    attemptIds.length === 0 ? [] : await db.select().from(a).where(inArray(a.id, attemptIds));
  const attemptById = new Map(sourceAttempts.map((row) => [row.id, row]));
  const gateway = input.gatewayProvider;

  const entries = ledger
    .filter((row) => row.kind !== 'REFUND')
    .map((row): RefundableEntryView => {
      const attempt = row.sourceId === null ? undefined : attemptById.get(row.sourceId);
      return {
        id: row.id,
        invoiceId: row.invoiceId,
        invoiceRef: refOf.get(row.invoiceId) ?? '',
        kind: row.kind,
        amountMinorUnits: row.amountMinorUnits,
        currency: row.currency,
        reference: row.reference,
        createdAt: row.createdAt,
        paidOn: row.collectedDate,
        refundableMinorUnits: entryRefundableMinorUnits(
          row.amountMinorUnits,
          requests.filter((request) => request.invoicePaymentId === row.id),
        ),
        viaGateway:
          gateway !== null &&
          row.provider === gateway &&
          attempt !== undefined &&
          attempt.provider === gateway &&
          attempt.bankTranId !== null,
      };
    })
    .filter((entry) => entry.refundableMinorUnits > 0)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const held = attempts.map((attempt): HeldPaymentView => {
    const credited =
      ledger.find((row) => row.kind === 'CREDIT' && row.sourceId === attempt.id)
        ?.amountMinorUnits ?? 0;
    const verified =
      VERIFIED_HOLD_REASONS.has(attempt.reasonCode ?? '') && attempt.providerValId !== null;
    return {
      id: attempt.id,
      invoiceId: attempt.invoiceId,
      invoiceRef: refOf.get(attempt.invoiceId) ?? '',
      amountMinorUnits: attempt.amountMinorUnits,
      currency: normalizeCurrency(attempt.currency),
      reasonCode: attempt.reasonCode,
      createdAt: attempt.createdAt,
      paidOn: attempt.redirectedAt ?? attempt.createdAt,
      creditedMinorUnits: credited,
      remainingMinorUnits: heldRemainingMinorUnits(
        attempt.amountMinorUnits,
        credited,
        requests.filter((request) => request.paymentAttemptId === attempt.id),
      ),
      verified,
      viaGateway:
        gateway !== null && verified && attempt.provider === gateway && attempt.bankTranId !== null,
    };
  });

  // A credit goes to an open invoice in the held payment's own currency.
  const currencies = [...new Set(held.filter((row) => row.verified).map((row) => row.currency))];
  const targets = (
    await Promise.all(
      currencies.map((currency) => creditTargets(db, input.organizationId, currency)),
    )
  ).flat();

  const heldLeft = held
    .filter((row) => row.remainingMinorUnits > 0)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return ok({
    available: true,
    entries: entries.slice(0, REFUND_WORK_LIMIT),
    held: heldLeft.slice(0, REFUND_WORK_LIMIT),
    more: entries.length > REFUND_WORK_LIMIT || heldLeft.length > REFUND_WORK_LIMIT,
    requests: requests.slice(0, 50).map((row) => requestView(row, refOf.get(row.invoiceId) ?? '')),
    creditTargets: targets.map((invoice) => ({
      id: invoice.id,
      invoiceRef: invoice.invoiceRef,
      currency: normalizeCurrency(invoice.currency),
      outstandingMinorUnits: outstandingMinorUnits(
        invoice.invoicedAmountMinorUnits,
        invoice.collectedAmountMinorUnits,
      ),
      dueDate: invoice.dueDate,
    })),
  });
}
