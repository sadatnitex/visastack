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
