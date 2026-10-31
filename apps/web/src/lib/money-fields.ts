import type { RefusalReason } from '@visastack/services';

/**
 * The form field a typed money refusal is about, from the service's typed reason (S30), never
 * from its wording: an amount reason points to the amount field, a currency reason to the
 * currency field. Anything else points nowhere.
 */
export function moneyFieldOf(
  reason: RefusalReason | undefined,
  fields: { readonly amount?: string; readonly currency?: string } = {},
): string | undefined {
  if (reason === 'amount_invalid' || reason === 'amount_over_balance') {
    return fields.amount ?? 'amount';
  }
  if (reason === 'currency_mismatch' || reason === 'currency_invalid') {
    return fields.currency ?? 'currency';
  }
  return undefined;
}

/**
 * The payment report field a refusal is about, from the service's typed reason, never from its
 * wording; a money reason points to the amount field. Anything else points nowhere.
 */
export function claimFieldOf(reason: RefusalReason | undefined): string | undefined {
  switch (reason) {
    case 'claim_method_invalid':
      return 'method';
    case 'claim_reference_invalid':
      return 'reference';
    case 'claim_note_invalid':
      return 'note';
    case 'claim_date_invalid':
      return 'paidOn';
    case 'claim_proof_invalid':
      return 'proof';
    default:
      return moneyFieldOf(reason);
  }
}
