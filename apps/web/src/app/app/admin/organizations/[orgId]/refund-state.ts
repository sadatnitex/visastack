import type { FormResult } from '../../../../../components/form-feedback';

/**
 * What every refund and credit action answers (S18): the plain result, the values as typed (empty
 * once a refund request was written), a fresh idempotency key for the next send, and the id of
 * the refund's line in the Refunds list, which focus moves to. Types and one constant only, so the
 * forms in the browser can use it.
 */
export interface RefundFormState extends FormResult {
  readonly values?: Readonly<Record<string, string>>;
  readonly nextKey?: string;
  readonly focusId?: string;
}

export const REFUND_NO_REPLY: RefundFormState = { ok: true, message: '' };
