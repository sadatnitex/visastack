import type { RefusalReason } from '@visastack/services';

/** The fields of the payment report form ("I Paid Another Way") a refusal can be about. */
export const CLAIM_FIELDS = ['method', 'reference', 'amount', 'paidOn', 'note', 'proof'] as const;
export type ClaimField = (typeof CLAIM_FIELDS)[number];

export function isClaimField(field: string | undefined): field is ClaimField {
  return (CLAIM_FIELDS as readonly (string | undefined)[]).includes(field);
}

/**
 * The report field a refusal is about, from the service's typed reason, never from its wording.
 * A reason about something the form does not show (for example a currency) points nowhere, so the
 * message stays under the button where it is seen.
 */
export function claimFieldOf(reason: RefusalReason | undefined): ClaimField | undefined {
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
    case 'amount_invalid':
    case 'amount_over_balance':
      return 'amount';
    default:
      return undefined;
  }
}
