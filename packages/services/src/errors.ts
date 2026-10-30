/**
 * Recoverable service failures.
 *
 * Services never throw for expected, caller-addressable conditions — they
 * return `Result<T, ServiceError>` (Build Spec: "no silent mutation",
 * "recoverable failures"). Thrown errors are reserved for genuine
 * programmer/infrastructure faults.
 */

export type ServiceErrorCode =
  /** The actor is not permitted to perform this action on this resource. */
  | 'forbidden'
  /** The actor may proceed, but only after a genuine, recent reauthentication. */
  | 'step_up_required'
  /** Account access requires stronger identity proof through controlled recovery. */
  | 'identity_recovery_required'
  /** A referenced resource does not exist. */
  | 'not_found'
  /** A required consent (Build Spec §13) has not been granted. */
  | 'consent_required'
  /** The field key is not in the canonical registry — it cannot be invented. */
  | 'unknown_field'
  /** The request is malformed (e.g. a non-repeating field with a record key). */
  | 'invalid'
  /** A dependent external service (e.g. the AI provider) failed or is unreachable. */
  | 'upstream_error'
  /** The actor has exceeded an anti-automation rate limit; retry later. */
  | 'rate_limited'
  /** The operation needs a capability (e.g. protected-field encryption) that isn't configured in this environment — a server gap, not a client mistake. */
  | 'encryption_unavailable'
  /** The caller's view of the world (a revision, checksum, or other precondition) is no longer current - retry against fresh data, this is not a malformed request. */
  | 'stale';

/**
 * Why a capacity-consuming action was refused (S30, audit M5), for the web layer to choose its
 * words without reading the message: the agency's billing is suspended, or a plan limit is
 * reached. The message stays a plain sentence for whoever reads it.
 */
export type RefusalReason =
  | 'billing_suspended'
  | 'limit_reached'
  | FieldReason
  | PlanAdminReason
  | PaymentModeReason
  | PaymentProviderReason;

/**
 * Why a plan change was refused (S29): plans cannot change before migration 0107, a plan's period
 * is fixed once an agency has been on it, or the plan may not be retired.
 */
export type PlanAdminReason = 'plans_unavailable' | 'period_locked' | 'retire_blocked';

/**
 * Why a payment step was refused because of the gateway's mode (S29): in test mode only the
 * platform owner can start a payment, and a test payment cannot be refunded through the live
 * gateway.
 */
export type PaymentModeReason = 'test_mode_owner_only' | 'test_payment_live_gateway';

/**
 * Why an online payment could not start on any provider (S19 step 0): no configured provider
 * takes the invoice's currency.
 */
export type PaymentProviderReason = 'currency_not_offered';

/**
 * Why a typed money field was refused (S30), so a form can point to the field at fault without
 * reading the message: an amount that is not a plain amount in the stored currency, an amount
 * over what is owed or left, or a currency that does not match the stored one.
 */
export type FieldReason =
  | 'amount_invalid'
  | 'amount_over_balance'
  | 'currency_mismatch'
  | 'currency_invalid';

export interface ServiceError {
  readonly code: ServiceErrorCode;
  readonly message: string;
  /** Set on plan and billing refusals, and on money-field refusals. */
  readonly reason?: RefusalReason;
}

export function serviceError(code: ServiceErrorCode, message: string): ServiceError {
  return { code, message };
}

/** A typed plan or billing refusal: an `invalid` error that also says why. */
export function refusal(reason: RefusalReason, message: string): ServiceError {
  return { code: 'invalid', message, reason };
}
