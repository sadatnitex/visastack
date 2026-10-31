import { CATALOGUE_DOCUMENTS } from '@visastack/core/catalogue';
import { describe, expect, it } from 'vitest';
import { BOOKING_DOCUMENT_KEYS, BOOKING_REMINDER, bookingReminderFor } from './booking-reminder';

describe('booking reminder', () => {
  it('applies to travel booking documents only', () => {
    expect(bookingReminderFor('DOCUMENT', 'HOTEL_BOOKING')).toBe(BOOKING_REMINDER);
    expect(bookingReminderFor('DOCUMENT', 'flight_ticket')).toBe(BOOKING_REMINDER);
    expect(bookingReminderFor('DOCUMENT', 'PASSPORT')).toBeNull();
    expect(bookingReminderFor('FIELD', 'HOTEL_BOOKING')).toBeNull();
  });

  it('finds a booking a pack names in its own words', () => {
    expect(bookingReminderFor('DOCUMENT', 'Hotel Booking')).toBe(BOOKING_REMINDER);
    expect(bookingReminderFor('DOCUMENT', 'hotel or stay booking')).toBeNull();
    for (const document of CATALOGUE_DOCUMENTS) {
      if (!BOOKING_DOCUMENT_KEYS.has(document.key)) continue;
      for (const alias of document.aliases) {
        expect(bookingReminderFor('DOCUMENT', alias), alias).toBe(BOOKING_REMINDER);
      }
    }
  });

  it('only names document types that exist in the catalogue', () => {
    const known = new Set(CATALOGUE_DOCUMENTS.map((d) => d.key));
    for (const key of BOOKING_DOCUMENT_KEYS) expect(known.has(key), key).toBe(true);
  });

  it('uses plain words and no dash characters', () => {
    const dashes = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);
    expect(BOOKING_REMINDER).not.toMatch(dashes);
  });
});
