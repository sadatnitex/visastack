import { resolveDocumentType } from '@visastack/core/catalogue';

/**
 * A short reminder shown on a missing travel booking in the case checklist. People often pay for
 * tickets or hotels just to have a booking to show. The reminder asks them to keep any booking
 * free to cancel until the decision, and never says what an embassy will accept.
 */
export const BOOKING_DOCUMENT_KEYS: ReadonlySet<string> = new Set([
  'FLIGHT_TICKET',
  'FLIGHT_BOOKING',
  'RETURN_TICKET',
  'HOTEL_BOOKING',
]);

export const BOOKING_REMINDER =
  'Keep any booking free to cancel until you have the decision. Do not pay for tickets or stays you cannot get back.';

/**
 * A pack names a document in its own words ("Hotel booking", "hotel_booking"), so the name goes
 * through the catalogue lookup (key or any alias, ignoring case and punctuation) before matching.
 */
export function bookingReminderFor(kind: 'FIELD' | 'DOCUMENT', name: string): string | null {
  if (kind !== 'DOCUMENT') return null;
  const key = resolveDocumentType(name)?.key;
  return key !== undefined && BOOKING_DOCUMENT_KEYS.has(key) ? BOOKING_REMINDER : null;
}
