/**
 * Brand symbols for the central access gate.
 *
 * These values are what make `AuthorizedApplicant`, `SystemScope` and
 * `StaffScope` impossible to build by hand: each type carries a property
 * keyed by one of these symbols, and only code that can read the symbol
 * value can write that property without a cast. This module is internal to
 * `access/`. It is deliberately not re-exported from `access/index.ts` or the
 * package index, and `enforcement.test.ts` fails if any module outside
 * `access/` imports it.
 */

export const AUTHORIZED_APPLICANT: unique symbol = Symbol('visastack.access.AuthorizedApplicant');
export const SYSTEM_SCOPE: unique symbol = Symbol('visastack.access.SystemScope');
export const STAFF_SCOPE: unique symbol = Symbol('visastack.access.StaffScope');
