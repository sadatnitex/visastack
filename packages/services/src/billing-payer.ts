/**
 * Who pays a billing row (ADR 0025): an organization or a person (`payerAccountId`), never both,
 * as the database checks. Agency billing (invoices, online payments, receipts, refunds, the
 * billing run) is written for organizations; until each path learns about persons (packages T3
 * to T6), it states that it handles an organization's rows only, through these helpers. A
 * person's row that reaches an agency path is a programming error: it throws, which rolls the
 * whole step back, rather than bill, remind or refund the wrong party.
 */

/** A person's billing row reached code that handles only organizations' rows. */
export class PersonBillingNotSupportedError extends Error {
  constructor(where: string) {
    super(`a person's billing row reached ${where}, which handles organizations only`);
    this.name = 'PersonBillingNotSupportedError';
  }
}

/** The organization a billing row belongs to; throws for a person's row. */
export function organizationOf(
  row: { readonly organizationId: string | null },
  where: string,
): string {
  if (row.organizationId === null) throw new PersonBillingNotSupportedError(where);
  return row.organizationId;
}

/** The same row, typed as an organization's; throws for a person's row. */
export function asOrganizationRow<T extends { readonly organizationId: string | null }>(
  row: T,
  where: string,
): T & { readonly organizationId: string } {
  organizationOf(row, where);
  return row as T & { readonly organizationId: string };
}
