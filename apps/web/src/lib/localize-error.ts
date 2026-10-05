import type { I18n, MessageKey } from '@visastack/i18n';
import type { ServiceError, ServiceErrorCode } from '@visastack/services';

const CODE_KEYS: Readonly<Record<ServiceErrorCode, MessageKey>> = {
  forbidden: 'error.code.forbidden',
  step_up_required: 'error.code.step_up_required',
  not_found: 'error.code.not_found',
  consent_required: 'error.code.consent_required',
  unknown_field: 'error.code.unknown_field',
  invalid: 'error.code.invalid',
  upstream_error: 'error.code.upstream_error',
  rate_limited: 'error.code.rate_limited',
  encryption_unavailable: 'error.code.encryption_unavailable',
  stale: 'error.code.stale',
};

/**
 * The words to show a person when a service call failed, in their language.
 *
 * A service describes a failure in English for logs and for the audit trail. A
 * screen must not put that English in the middle of a Bangla page, so:
 * - when the service named a message for the failure (`key`), that message in the
 *   reader's language, in either language;
 * - otherwise, an English reader sees the service's own wording exactly as before,
 *   and a Bangla reader sees the plain message for the kind of failure it was
 *   (not allowed, not found, try again later...).
 */
export function errorText(
  i18n: I18n,
  error: Pick<ServiceError, 'code' | 'message' | 'key'>,
): string {
  if (error.key) return i18n.t(error.key);
  if (i18n.locale === 'en') return error.message;
  return i18n.t(CODE_KEYS[error.code] ?? 'error.code.unknown');
}
