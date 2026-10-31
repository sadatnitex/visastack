import { schema } from '@visastack/db';
import { boolean, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * The billing tables as a person's own billing sees them (ADR 0025, migration 0110): the same
 * tables as `schema.ts`, with the payer columns 0110 added and `organization_id` that may be empty.
 *
 * Why a second declaration: `schema.ts` does not declare the 0110 columns yet (ADR 0025 section
 * 13), because Drizzle names every declared column in each insert and plain select, and the agency
 * billing code must keep working on the older databases its tests build. These declarations are
 * used only by person billing code, only after `personBillingPresent` says migrations 0110 and
 * 0111 have run (0111 lets a person's own subscription have no assigning account), and are
 * never exported from `@visastack/db` (drizzle-kit reads `schema.ts` only, so they never produce
 * a migration).
 *
 * Guards: `person-billing-tables.test.ts` compares every column here with the migrated database,
 * so the two cannot drift; and the access ratchet (`access/enforcement.test.ts`) requires every
 * exported function that touches one of these tables to take a `SelfScope`, `StaffScope` or
 * `SystemScope`.
 *
 * Constraints, indexes and foreign keys live in the database (migrations 0110 and 0111) and are
 * not repeated here.
 */

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const personSubscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id'),
  payerAccountId: uuid('payer_account_id'),
  planId: uuid('plan_id').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  assignedByAccountId: uuid('assigned_by_account_id'),
  reason: text('reason').notNull(),
  renews: boolean('renews').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const personInvoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id'),
  payerAccountId: uuid('payer_account_id'),
  subscriptionId: uuid('subscription_id'),
  planId: uuid('plan_id').notNull(),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  invoiceRef: text('invoice_ref').notNull(),
  invoicedAmountMinorUnits: integer('invoiced_amount_minor_units').notNull(),
  currency: text('currency').notNull(),
  dueDate: timestamp('due_date', { withTimezone: true }).notNull(),
  status: schema.invoiceStatus('status').notNull().default('OPEN'),
  collectedAmountMinorUnits: integer('collected_amount_minor_units').notNull().default(0),
  collectedDate: timestamp('collected_date', { withTimezone: true }),
  paymentReference: text('payment_reference'),
  ...timestamps,
});

export const personPaymentAttempts = pgTable('payment_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  invoiceId: uuid('invoice_id').notNull(),
  organizationId: uuid('organization_id'),
  payerAccountId: uuid('payer_account_id'),
  provider: text('provider').notNull(),
  merchantTranId: text('merchant_tran_id').notNull(),
  amountMinorUnits: integer('amount_minor_units').notNull(),
  currency: text('currency').notNull(),
  status: schema.paymentAttemptStatus('status').notNull().default('CREATED'),
  providerSessionKey: text('provider_session_key'),
  providerValId: text('provider_val_id'),
  bankTranId: text('bank_tran_id'),
  riskLevel: integer('risk_level'),
  lastProviderStatus: text('last_provider_status'),
  reasonCode: text('reason_code'),
  mode: schema.paymentMode('mode').notNull(),
  initiatedByAccountId: uuid('initiated_by_account_id'),
  redirectedAt: timestamp('redirected_at', { withTimezone: true }),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  recordedAt: timestamp('recorded_at', { withTimezone: true }),
  ...timestamps,
});

export const personRefundRequests = pgTable('refund_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id'),
  payerAccountId: uuid('payer_account_id'),
  invoiceId: uuid('invoice_id').notNull(),
  invoicePaymentId: uuid('invoice_payment_id'),
  paymentAttemptId: uuid('payment_attempt_id'),
  method: schema.refundMethod('method').notNull(),
  status: schema.refundStatus('status').notNull().default('REQUESTED'),
  amountMinorUnits: integer('amount_minor_units').notNull(),
  currency: text('currency').notNull(),
  provider: text('provider'),
  providerRefundId: text('provider_refund_id'),
  bankTranId: text('bank_tran_id'),
  idempotencyKey: uuid('idempotency_key').notNull(),
  reason: text('reason').notNull(),
  reference: text('reference'),
  failureCode: text('failure_code'),
  requestedByAccountId: uuid('requested_by_account_id').notNull(),
  providerRefundedAt: timestamp('provider_refunded_at', { withTimezone: true }),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  ...timestamps,
});

export const personPaymentReceipts = pgTable('payment_receipts', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id'),
  payerAccountId: uuid('payer_account_id'),
  invoiceId: uuid('invoice_id').notNull(),
  invoicePaymentId: uuid('invoice_payment_id').notNull(),
  receiptNumber: integer('receipt_number').notNull(),
  amountMinorUnits: integer('amount_minor_units').notNull(),
  currency: text('currency').notNull(),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
});

/** A person's own receipt numbering (migration 0110): one row per person, the last number used. */
export const personReceiptCounters = pgTable('person_receipt_counters', {
  accountId: uuid('account_id').primaryKey(),
  lastNumber: integer('last_number').notNull().default(0),
});
