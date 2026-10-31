import type { OverallPaymentMode } from './payment-providers';

/**
 * What the Platform Readiness Detail says about paid traveller plans (ADR 0025 T6). Shown to
 * platform administrators only, and never part of `evaluateReadiness().ready` or
 * /api/health/ready: selling traveller plans is optional, so it can never make the platform
 * "degraded".
 */
export interface TravellerPlansReading {
  /** `TRAVELLER_PLANS_ENABLED` (`travellerPlansEnabled`). */
  readonly selling: boolean;
  /** `paymentMode()`: null when online payment is not set up. */
  readonly mode: OverallPaymentMode | null;
  /** Migrations 0110 and 0111 (`personBillingPresent`); null when the database could not be read. */
  readonly personBilling: boolean | null;
  /** Migration 0112 (`personRefundGuardPresent`); null when the database could not be read. */
  readonly refundGuard: boolean | null;
}

export interface TravellerPlansRow {
  readonly value: string;
  /** False only when real money is taken without the refund guard of migration 0112. */
  readonly good: boolean;
}

const SELLING_WORDS: Record<OverallPaymentMode | 'NONE', string> = {
  TEST: 'Test (only the platform owner can pay)',
  LIVE: 'Live',
  MIXED: 'Partly Live',
  NONE: 'On, online payment not set up',
};

export function travellerPlansRow(reading: TravellerPlansReading): TravellerPlansRow {
  const parts = [reading.selling ? SELLING_WORDS[reading.mode ?? 'NONE'] : 'Off'];
  if (reading.personBilling === null || reading.refundGuard === null) {
    parts.push('Database could not be checked');
  } else {
    if (!reading.personBilling) parts.push('Database behind');
    if (!reading.refundGuard) parts.push('Refunds not ready yet');
  }
  const takesRealMoney = reading.selling && (reading.mode === 'LIVE' || reading.mode === 'MIXED');
  return { value: parts.join(', '), good: !(takesRealMoney && reading.refundGuard !== true) };
}
