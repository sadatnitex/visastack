/**
 * UMPE P5: the pure rules of a group trip, with no database access.
 *
 * - Who may be added: only a traveller record the account holder manages. A family member or a
 *   child needs the account holder's own recorded confirmation that they may act for that person
 *   (IAM-04); a relationship label, a shared surname or a household dropdown never counts. A child
 *   is a parent-or-guardian record, so a child's case always rests on that confirmation.
 * - What may be common trip evidence: travel documents a whole group can share (bookings,
 *   itineraries, invitations, accommodation). Identity, financial and medical papers never are,
 *   whatever the protection settings say.
 * - The one next action for a traveller, read from their own case package (P4).
 */
import { resolveDocumentType } from '@visastack/core/catalogue/documents';
import { isRestrictedDocumentType } from './access/require-access';
import type { AttentionReason, PackagePhrase } from './umpe-package-phrases';

/** How many travellers one trip holds at most (the same limit as Start a Trip). */
export const TRIP_MAX_TRAVELLERS = 12;

export type TripRelationship = 'SELF' | 'FAMILY_MEMBER' | 'MINOR_GUARDIAN';

export type TravellerAuthorityProblem = 'AUTHORITY_NOT_CONFIRMED' | 'GUARDIAN_NOT_CONFIRMED';

/**
 * Why this traveller cannot join a trip on the account holder's word, or null when they can. The
 * account holder's own record needs nothing more. Every other record needs the confirmation the
 * account holder gave when they added it; records made before that confirmation existed have none
 * and must be confirmed first.
 */
export function travellerAuthorityProblem(traveller: {
  readonly relationship: TripRelationship;
  readonly authorityConfirmedAt: Date | null;
}): TravellerAuthorityProblem | null {
  if (traveller.relationship === 'SELF') return null;
  if (traveller.authorityConfirmedAt !== null) return null;
  return traveller.relationship === 'MINOR_GUARDIAN'
    ? 'GUARDIAN_NOT_CONFIRMED'
    : 'AUTHORITY_NOT_CONFIRMED';
}

/** Catalogue keys of the travel documents a group may share as common trip evidence. */
export const COMMON_TRIP_EVIDENCE_TYPES: ReadonlySet<string> = new Set([
  'FLIGHT_TICKET',
  'FLIGHT_BOOKING',
  'RETURN_TICKET',
  'HOTEL_BOOKING',
  'TRAVEL_ITINERARY',
  'CRUISE_BOOKING',
  'INVITATION_LETTER',
  'ACCOMMODATION_PROOF',
  'OTHER_ACCOMMODATION_DOCUMENT',
]);

/**
 * True only for a known travel document type on the list above that the built-in protection rule
 * does not restrict. Fails closed: an unknown or unclassified type is never common evidence.
 */
export function isCommonTripEvidenceType(docType: string | null): boolean {
  if (!docType) return false;
  const known = resolveDocumentType(docType);
  if (!known || !COMMON_TRIP_EVIDENCE_TYPES.has(known.key)) return false;
  return !isRestrictedDocumentType(docType);
}

export type TripNextAction =
  | 'REVIEW_CHANGE'
  | 'CHOOSE_CHECKLIST'
  | 'ANSWER_QUESTIONS'
  | 'CHOOSE_COPY'
  | 'CHECK_CHECKLIST'
  | 'ADD_MISSING'
  | 'CHECK_BY_HAND'
  | 'FINAL_REVIEW'
  | 'SHARE_WHEN_READY'
  | 'VIEW_CASE';

/** The words for each next action (Title Case, plain; never "submitted" or "approved"). */
export const TRIP_NEXT_ACTION_LABELS: Readonly<Record<TripNextAction, string>> = {
  REVIEW_CHANGE: 'Review What Changed',
  CHOOSE_CHECKLIST: 'Choose a Checklist',
  ANSWER_QUESTIONS: 'Answer a Few Questions',
  CHOOSE_COPY: 'Choose Which Copy to Use',
  CHECK_CHECKLIST: 'Check the Newer Checklist',
  ADD_MISSING: 'Add the Missing Items',
  CHECK_BY_HAND: 'Check Each Item With the Official Source',
  FINAL_REVIEW: 'Do the Final Review',
  SHARE_WHEN_READY: 'Share the Package When You Are Ready',
  VIEW_CASE: 'View the Case',
};

/** Which reason leads, when a case has several: the one that unblocks the most comes first. */
const REASON_ORDER: readonly (readonly [AttentionReason, TripNextAction])[] = [
  ['NO_CHECKLIST', 'CHOOSE_CHECKLIST'],
  ['CHECKLIST_WITHDRAWN', 'CHECK_CHECKLIST'],
  ['NEEDS_ANSWER', 'ANSWER_QUESTIONS'],
  ['PINNED_COPY_UNUSABLE', 'CHOOSE_COPY'],
  ['PINNED_COPY_REPLACED', 'CHOOSE_COPY'],
  ['REQUIRED_GAP', 'ADD_MISSING'],
  ['CHECKLIST_REPLACED', 'CHECK_CHECKLIST'],
  ['MANUAL_CHECK', 'CHECK_BY_HAND'],
  ['SOMETHING_CHANGED', 'REVIEW_CHANGE'],
];

/**
 * The one next action for a traveller, from their own case package: an open change first (it is
 * the most precise thing to look at), then the reason that unblocks the most, then the final
 * review, then sharing. A closed, cancelled or submitted case only offers to view it.
 */
export function tripNextAction(input: {
  readonly phrase: PackagePhrase;
  readonly reasons: readonly AttentionReason[];
  readonly hasChange: boolean;
  readonly active: boolean;
}): TripNextAction {
  if (!input.active) return 'VIEW_CASE';
  if (input.hasChange) return 'REVIEW_CHANGE';
  for (const [reason, action] of REASON_ORDER) {
    if (input.reasons.includes(reason)) return action;
  }
  if (input.phrase === 'PREPARED_FOR_HANDOFF') return 'SHARE_WHEN_READY';
  if (input.phrase === 'READY_FOR_FINAL_REVIEW') return 'FINAL_REVIEW';
  return 'VIEW_CASE';
}
