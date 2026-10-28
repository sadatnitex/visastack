/**
 * Who an evidence request is waiting on, defined once (owner decision D4, ADR 0015 section 5).
 *
 * The real request statuses are OPEN, RECEIVED, UNDER_REVIEW, ACCEPTED, NEEDS_REPLACEMENT,
 * CANCELLED, FULFILLED and DECLINED. A request that is not yet closed is waiting on someone:
 *
 * - the traveller, while it is open or sent back for a fix;
 * - the agency, once the traveller has answered and a person still has to look at it.
 *
 * Every count, quick view and ranking row that talks about waiting requests reads these lists, so
 * the numbers cannot drift apart. Pure: no database read.
 */

import type { schema } from './db';

type RequestStatus = (typeof schema.evidenceRequestStatus.enumValues)[number];

/**
 * Every status, classified. Typed against the database list, so adding a status there stops the
 * build until someone decides who it waits on (a new status can never silently count as closed).
 */
const WAITING_ON: Record<RequestStatus, 'traveller' | 'agency' | 'closed'> = {
  OPEN: 'traveller',
  NEEDS_REPLACEMENT: 'traveller',
  RECEIVED: 'agency',
  UNDER_REVIEW: 'agency',
  ACCEPTED: 'closed',
  CANCELLED: 'closed',
  FULFILLED: 'closed',
  DECLINED: 'closed',
};

/** Request statuses waiting on the traveller: a first request, and one sent back for a fix. */
export const WAITING_ON_TRAVELLER_REQUEST_STATUSES = ['OPEN', 'NEEDS_REPLACEMENT'] as const;

/** Request statuses waiting on the agency: the traveller has answered, a person has the next move. */
export const WAITING_ON_AGENCY_REQUEST_STATUSES = ['RECEIVED', 'UNDER_REVIEW'] as const;

/** Every request not yet closed: both groups above and nothing else. */
export const PENDING_REQUEST_STATUSES = [
  ...WAITING_ON_TRAVELLER_REQUEST_STATUSES,
  ...WAITING_ON_AGENCY_REQUEST_STATUSES,
] as const;

/** True when the request waits on the traveller (open, or sent back for a fix). */
export function isWaitingOnTraveller(status: string): boolean {
  return (WAITING_ON as Record<string, string>)[status] === 'traveller';
}

/** True when the request waits on the agency (received, or under review). */
export function isWaitingOnAgency(status: string): boolean {
  return (WAITING_ON as Record<string, string>)[status] === 'agency';
}

export interface PendingRequestCounts {
  /** Every request not yet closed. Always `waitingOnTravellers + waitingOnAgency`. */
  readonly pending: number;
  readonly waitingOnTravellers: number;
  readonly waitingOnAgency: number;
}

/** The Pending Requests total and its two parts, from one pass over the requests. */
export function countPendingRequests(
  requests: readonly { readonly status: string }[],
): PendingRequestCounts {
  let waitingOnTravellers = 0;
  let waitingOnAgency = 0;
  for (const request of requests) {
    if (isWaitingOnTraveller(request.status)) waitingOnTravellers += 1;
    else if (isWaitingOnAgency(request.status)) waitingOnAgency += 1;
  }
  return {
    pending: waitingOnTravellers + waitingOnAgency,
    waitingOnTravellers,
    waitingOnAgency,
  };
}
