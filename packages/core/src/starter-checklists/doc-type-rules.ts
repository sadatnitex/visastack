/**
 * How a sentence from an agency's own checklist file is given a document type, and how necessary
 * it is. The rules are plain data, applied in one place, so a reviewer can read them and so the
 * result can be checked against the file they were written for.
 *
 * The type decides which uploaded document can satisfy the item, so a wrong guess puts the wrong
 * document against it. Because of that, only a clear first-named document gets a real type; a
 * sentence about something that is not a document, or that names none, becomes an "Other" type,
 * which never counts a document by itself. The full sentence is always kept and shown as written.
 */

interface DocTypeRule {
  /** Matches the words that name the document. The earliest match in the sentence wins. */
  readonly words: RegExp;
  readonly docType: string;
}

/** Ordered: where two rules match at the same place, the first one wins. */
const RULES: readonly DocTypeRule[] = [
  {
    words:
      /visa application|application form|application letter|visa form|e-?visa|online application|questionnaire/i,
    docType: 'VISA_APPLICATION_FORM',
  },
  { words: /photograph|\bphotos?\b|passport.?size|picture/i, docType: 'PHOTO' },
  { words: /passport|travel document/i, docType: 'PASSPORT' },
  { words: /national id|\bnid\b/i, docType: 'NID' },
  { words: /birth certificate/i, docType: 'BIRTH_CERTIFICATE' },
  { words: /marriage|nikah|nika(?:h)? ?nam/i, docType: 'MARRIAGE_CERTIFICATE' },
  {
    words: /bank statement|bank account|dollar endorsement|currency endorsement/i,
    docType: 'BANK_STATEMENT',
  },
  { words: /solvency/i, docType: 'SOLVENCY_CERTIFICATE' },
  { words: /credit card|travel card/i, docType: 'CREDIT_CARD_STATEMENT' },
  { words: /trade licen[cs]e|business licen[cs]e|\blicen[cs]e\b/i, docType: 'TRADE_LICENSE' },
  { words: /memorandum|incorporation|articles? of association/i, docType: 'COMPANY_MEMORANDUM' },
  {
    words:
      /company (?:profile|brochure|registration)|business registration|chamber of commerce|certificate of registration/i,
    docType: 'BUSINESS_REGISTRATION',
  },
  { words: /visiting card|business card/i, docType: 'BUSINESS_CARD' },
  {
    words: /\bgo\b|government order|govt\.? employee|government employee|note verbal/i,
    docType: 'NOC_GOVERNMENT',
  },
  {
    words:
      /\bnoc\b|no objection|employer|employment (?:certificate|letter)|office id|leave (?:approval|letter)/i,
    docType: 'NOC_EMPLOYER',
  },
  { words: /salary|pay ?slip/i, docType: 'SALARY_CERTIFICATE' },
  { words: /\bitr\b|tax return|\btin\b|tax certificate|income tax/i, docType: 'TAX_RETURN' },
  { words: /hotel|accommodation|lodging/i, docType: 'HOTEL_BOOKING' },
  { words: /flight|airline|air ticket|\bticket|itinerar|travel plan/i, docType: 'FLIGHT_BOOKING' },
  { words: /insurance/i, docType: 'TRAVEL_INSURANCE' },
  { words: /invitation|invite\b|sponsor|undertaking|guarantee/i, docType: 'INVITATION_LETTER' },
  {
    words: /student id|school|college|universit|enrol|admission|bonafide/i,
    docType: 'ENROLLMENT_LETTER',
  },
  { words: /covid/i, docType: 'COVID_CERTIFICATE' },
  { words: /yellow fever/i, docType: 'YELLOW_FEVER_CERTIFICATE' },
  { words: /medical|hospital|doctor|prescription|treatment|vaccin/i, docType: 'MEDICAL_REPORT' },
  { words: /cover letter|covering letter|statement of purpose/i, docType: 'COVER_LETTER' },
  { words: /affidavit/i, docType: 'AFFIDAVIT' },
  { words: /police|clearance|character certificate/i, docType: 'POLICE_CLEARANCE' },
  { words: /property|deed|homeownership|rental agreement|tenancy/i, docType: 'PROPERTY_DEED' },
  { words: /electricity|gas bill|landline|utility bill/i, docType: 'UTILITY_BILL' },
  {
    words: /professional (?:certificate|proof)|bmdc|bar council/i,
    docType: 'PROFESSIONAL_LICENSE',
  },
  { words: /retire|pension/i, docType: 'RETIREMENT_LETTER' },
  { words: /refusal/i, docType: 'REFUSAL_LETTER' },
  { words: /previous visas?|old visas?/i, docType: 'VISA' },
  { words: /parental[^.]{0,24}consent|consent letter|custody/i, docType: 'PARENTAL_CONSENT' },
  { words: /relationship|spouse|family register/i, docType: 'RELATIONSHIP_PROOF' },
  { words: /curriculum|\bcv\b|resume/i, docType: 'CURRICULUM_VITAE' },
  { words: /fee receipt|payment receipt|visa fee/i, docType: 'FEE_PAYMENT_RECEIPT' },
  { words: /appointment/i, docType: 'VFS_APPOINTMENT' },
];

/** The type for a sentence that names no document, or that is an instruction. */
export const FALLBACK_DOC_TYPE = 'OTHER';

/**
 * The document type for one sentence of a checklist file: the rule whose words appear earliest in
 * the sentence, or `OTHER` when none does.
 */
export function mapDocType(text: string): string {
  let best: { readonly at: number; readonly docType: string } | null = null;
  for (const rule of RULES) {
    const at = text.search(rule.words);
    if (at >= 0 && (best === null || at < best.at)) {
      best = { at, docType: rule.docType };
    }
  }
  return best?.docType ?? FALLBACK_DOC_TYPE;
}

/** True for the types that never count a document by themselves. */
export function isOtherType(docType: string): boolean {
  return docType === 'OTHER' || docType.startsWith('OTHER_');
}

export type StarterNecessity = 'MANDATORY' | 'RECOMMENDED' | 'OPTIONAL';

/** Words in the sentence itself that make an item something the file does not insist on. */
const SOFTENED_BY_TEXT =
  /not mandatory|not required|optional|may also|if (?:have|has|any|available|applicable|relevant|requested|held|needed|asked)|where (?:required|specified|applicable)|if you have|\(if have\)/i;

/** "Applies when" values that say the item is for everyone. */
const FOR_EVERYONE = new Set(['all applicants']);
/** Values that say the item may not apply at all. */
const MAY_NOT_APPLY = /^(?:as applicable|if applicable|if |where required)/i;

/**
 * How necessary an item is, from who it applies to. Only an item for every applicant, with a real
 * document type, is Required, so a traveller can reach Ready on the list. An item for one kind of
 * traveller (an employee, a student) is Recommended, because nothing on a record yet says which
 * kind the traveller is. An item that may not apply, that the sentence itself says is not
 * mandatory or only if held, or that names no document, is Optional.
 */
export function necessityFor(appliesWhen: string, docType: string, text = ''): StarterNecessity {
  const when = appliesWhen.trim().toLowerCase();
  if (isOtherType(docType) || MAY_NOT_APPLY.test(when) || when === '') return 'OPTIONAL';
  if (SOFTENED_BY_TEXT.test(text)) return 'OPTIONAL';
  return FOR_EVERYONE.has(when) ? 'MANDATORY' : 'RECOMMENDED';
}
