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
  | 'encryption_unavailable';

export interface ServiceError {
  readonly code: ServiceErrorCode;
  readonly message: string;
}

export function serviceError(code: ServiceErrorCode, message: string): ServiceError {
  return { code, message };
}
