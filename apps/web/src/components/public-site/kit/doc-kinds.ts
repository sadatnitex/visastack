/**
 * The eight kinds of paper the public pictures draw (R1 kit). Each maps to a document type the
 * picture layer already knows, so no new artwork exists: `DocumentPicture` draws them.
 */
export const DOC_KINDS = [
  'passport',
  'photo',
  'flight',
  'insurance',
  'itinerary',
  'bank',
  'hotel',
  'invitation',
] as const;

export type DocKind = (typeof DOC_KINDS)[number];

/** The document type each kind stands for, as `DocumentPicture` reads it. */
export const DOC_TYPE: Readonly<Record<DocKind, string>> = {
  passport: 'PASSPORT',
  photo: 'PHOTO',
  flight: 'FLIGHT_TICKET',
  insurance: 'TRAVEL_INSURANCE',
  itinerary: 'TRAVEL_ITINERARY',
  bank: 'BANK_STATEMENT',
  hotel: 'HOTEL_BOOKING',
  invitation: 'INVITATION_LETTER',
};

/** The plain name of each kind, Title Case, as a picture's label. */
export const DOC_NAME: Readonly<Record<DocKind, string>> = {
  passport: 'Passport',
  photo: 'Photo',
  flight: 'Flights',
  insurance: 'Insurance',
  itinerary: 'Itinerary',
  bank: 'Bank Statement',
  hotel: 'Hotel Booking',
  invitation: 'Invitation',
};

/** `lang="en"` on a figure whose words are English while the page is not (WCAG 3.1.2). */
export function englishOn(pageLang: string): { lang?: string } {
  return pageLang === 'en' ? {} : { lang: 'en' };
}
