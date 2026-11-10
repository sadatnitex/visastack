/**
 * The plain words for where a saved profile value stands and how it was saved. Display text only:
 * the stored codes (DECLARED, STALE, API and the rest) never change and no logic reads these words.
 * Used by History, the profile editor and the profile page so one state has one name everywhere.
 * Truthful on purpose: Suggested is never Confirmed, and nothing here implies an approval.
 */
/** The word for a version that a newer one has taken the place of. */
export const REPLACED_WORD = 'Replaced';

export const FIELD_STATUS_WORDS: Readonly<Record<string, string>> = {
  DECLARED: 'Entered',
  EXTRACTED_PENDING: 'Suggested',
  APPLICANT_CONFIRMED: 'Confirmed',
  DOCUMENT_SUPPORTED: 'Backed by a Document',
  AGENCY_REVIEWED: 'Reviewed by an Agency',
  CONFLICTED: 'Does Not Match',
  // LC-G1: the person said this value is no longer current (the version holds no value).
  STALE: 'No Longer Current',
  SUPERSEDED: REPLACED_WORD,
};

/** How a version was saved: by typing, from a document, by a connected app or by VisaStack itself. */
export const FIELD_METHOD_WORDS: Readonly<Record<string, string>> = {
  MANUAL: 'Typed In',
  DOCUMENT: 'From a Document',
  API: 'From a Connected App',
  SYSTEM: 'Added by VisaStack',
};

/** The words for a saved method, or null for a code this list does not know (never shown raw). */
export function fieldMethodWords(method: string | null | undefined): string | null {
  return method ? (FIELD_METHOD_WORDS[method] ?? null) : null;
}
