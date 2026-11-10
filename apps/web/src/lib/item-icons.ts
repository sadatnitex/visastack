import type { IconName } from '../components/icons';
import type { StatusTone } from './status-words';

/**
 * The one map from a thing to its picture and its tone (owner decision, 10 Nov 2026: things
 * "talk loudly", like flags - an icon says what a thing is, or what state it is in, without
 * reading). Screens never choose an icon or a tone themselves; they ask here, so the same thing
 * shows the same symbol on every traveller and agency screen.
 *
 * The rule this file holds:
 *  1. Meaning, never decoration: an icon appears only where it says what a thing is or what state
 *     it is in, and always beside its plain word (the icon is hidden from screen readers).
 *  2. One symbol, one meaning. A document kind, a trip purpose and a status never share a symbol
 *     (`item-icons.test.ts` fails if they do), except the ones named in SHARED_ON_PURPOSE.
 *  3. Colour is only the six Harbor tones (`WP-PLAIN-TONE` in globals.css): green, amber and red
 *     say how a thing stands; blue, violet and teal say what kind of thing it is. Grey is the
 *     neutral token, not a seventh colour.
 */

/** The names of the six Harbor tones, plus grey for "nothing is asked". */
export type MarkTone = 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'teal' | 'neutral';

export interface ItemMark {
  readonly icon: IconName;
  readonly tone: MarkTone;
}

/** The two-word rule for state colours: green, amber and red are states; the rest are kinds. */
export const STATE_TONES: readonly MarkTone[] = ['green', 'amber', 'red'];
export const KIND_TONES: readonly MarkTone[] = ['blue', 'violet', 'teal'];

// ---------------------------------------------------------------------------------------------
// Document kinds
// ---------------------------------------------------------------------------------------------

export type DocumentIcon =
  | 'docPassport'
  | 'docId'
  | 'docPhoto'
  | 'docBank'
  | 'docSalary'
  | 'docTax'
  | 'docLicence'
  | 'docCertificate'
  | 'docLetter'
  | 'docFlight'
  | 'docHotel'
  | 'docInsurance'
  | 'file';

/** A paper that fits no specific picture reads as a plain document. */
export const GENERIC_DOCUMENT_ICON: DocumentIcon = 'file';

/** Identity is blue, money is teal, everything else on paper is violet. */
const DOCUMENT_TONE: Readonly<Record<DocumentIcon, MarkTone>> = {
  docPassport: 'blue',
  docId: 'blue',
  docPhoto: 'blue',
  docBank: 'teal',
  docSalary: 'teal',
  docTax: 'teal',
  docLicence: 'violet',
  docCertificate: 'violet',
  docLetter: 'violet',
  docFlight: 'violet',
  docHotel: 'violet',
  docInsurance: 'violet',
  file: 'violet',
};

/**
 * Every catalogue document type (`packages/core` CATALOGUE_DOCUMENTS) that has a picture of its
 * own, listed by the picture. A type not listed reads as a plain document: the test prints that
 * list so a new type is never hidden in the fallback by accident.
 */
const DOCUMENT_KEYS: Readonly<Record<Exclude<DocumentIcon, 'file'>, readonly string[]>> = {
  docPassport: [
    'PASSPORT',
    'SPOUSE_PASSPORT',
    'HOST_PASSPORT',
    'TRAVEL_DOCUMENT',
    'EMERGENCY_TRAVEL',
    'LAISSEZ_PASSER',
    'REFUGEE_DOCUMENT',
    'STATELESS_DOCUMENT',
    'VISA',
    'VISA_STAMP',
    'OTHER_TRAVEL_DOCUMENT',
  ],
  docId: [
    'NID',
    'STUDENT_ID',
    'HOST_ID',
    'DRIVING_LICENCE',
    'RESIDENCE_PERMIT',
    'TEMPORARY_RESIDENCE_PERMIT',
    'PERMANENT_RESIDENCE',
    'GREEN_CARD',
    'WORK_PERMIT',
    'STUDENT_PERMIT',
    'BLOOD_GROUP_CARD',
    'ALLERGY_CARD',
    'OTHER_IDENTITY_DOCUMENT',
  ],
  docPhoto: ['PHOTO', 'PHOTO_FAMILY', 'OTHER_PHOTO_DOCUMENT'],
  docBank: [
    'BANK_STATEMENT',
    'SOLVENCY_CERTIFICATE',
    'FDR_CERTIFICATE',
    'SANCHAYPATRA',
    'LOAN_STATEMENT',
    'CREDIT_CARD_STATEMENT',
    'CREDIT_REPORT',
    'JOINT_ACCOUNT_STATEMENT',
    'BANK_REFERENCE_LETTER',
    'BUSINESS_BANK_STATEMENT',
    'HOST_BANK_STATEMENT',
    'PENSION_STATEMENT',
    'DIVIDEND_STATEMENT',
    'INVESTMENT_PROOF',
    'STOCK_CERTIFICATE',
    'CRYPTOCURRENCY_PROOF',
    'REMITTANCE_RECORD',
    'LARGE_DEPOSIT_EXPLANATION',
    'COMPANY_ACCOUNTS',
    'OTHER_FINANCIAL_DOCUMENT',
  ],
  docSalary: [
    'SALARY_SLIP',
    'SALARY_CERTIFICATE',
    'INCOME_CERTIFICATE',
    'RENTAL_INCOME_PROOF',
    'AGRICULTURAL_INCOME_PROOF',
    'FREELANCE_PROOF',
    'FEE_PAYMENT_RECEIPT',
    'WELFARE_FEE_RECEIPT',
    'RECRUITMENT_FEE_RECEIPT',
    'FORM_I901_FEE_RECEIPT',
  ],
  docTax: [
    'TAX_RETURN',
    'TIN_CERTIFICATE',
    'TAX_ACKNOWLEDGEMENT_SLIP',
    'TAX_RESIDENCY_CERTIFICATE',
  ],
  docLicence: [
    'TRADE_LICENSE',
    'BUSINESS_REGISTRATION',
    'COMPANY_MEMORANDUM',
    'RECRUITING_AGENCY_LICENCE',
    'PROFESSIONAL_LICENSE',
    'OTHER_EMPLOYMENT_DOCUMENT',
  ],
  docCertificate: [
    'BIRTH_CERTIFICATE',
    'MARRIAGE_CERTIFICATE',
    'DIVORCE_CERTIFICATE',
    'DEATH_CERTIFICATE',
    'ADOPTION_CERTIFICATE',
    'NAME_CHANGE_CERTIFICATE',
    'GENDER_CERTIFICATE',
    'CITIZENSHIP_CERTIFICATE',
    'CHILD_BIRTH_CERTIFICATE',
    'EMPLOYMENT_CERTIFICATE',
    'EXPERIENCE_CERTIFICATE',
    'EDUCATION_CERTIFICATE',
    'DEGREE_CERTIFICATE',
    'TRANSCRIPT',
    'LANGUAGE_PROFICIENCY',
    'IELTS_CERTIFICATE',
    'TOEFL_CERTIFICATE',
    'GMAT_GRE_SCORE',
    'COURSE_COMPLETION',
    'TRAINING_CERTIFICATE',
    'QUALIFICATION_RECOGNITION',
    'PRE_DEPARTURE_TRAINING_CERTIFICATE',
    'SKILL_TEST_CERTIFICATE',
    'SKILL_ASSESSMENT',
    'CITIZENSHIP_TEST_RESULT',
    'APPROVED_MEDICAL_CENTRE_RESULT',
    'MEDICAL_REPORT',
    'MEDICAL_CERTIFICATE',
    'VACCINATION_CERTIFICATE',
    'TB_TEST_CERTIFICATE',
    'YELLOW_FEVER_CERTIFICATE',
    'COVID_CERTIFICATE',
    'FIT_TO_TRAVEL',
    'DISABILITY_CERTIFICATE',
    'MENTAL_HEALTH_CERTIFICATE',
    'POLICE_CLEARANCE',
    'CHARACTER_CERTIFICATE',
    'EMIGRATION_CLEARANCE',
    'ATTESTATION_CERTIFICATE',
    'LEGALISATION_CERTIFICATE',
    'CERTIFIED_TRANSLATION',
    'NOTARIZED_DOCUMENT',
    'PROPERTY_DEED',
    'GIFT_DEED',
    'SALE_DEED',
    'INHERITANCE_DOCUMENT',
    'OTHER_EDUCATION_DOCUMENT',
    'OTHER_MEDICAL_DOCUMENT',
  ],
  docLetter: [
    'NOC_EMPLOYER',
    'NOC_GOVERNMENT',
    'LEAVE_APPROVAL',
    'APPOINTMENT_LETTER',
    'PROMOTION_LETTER',
    'RESIGNATION_LETTER',
    'TERMINATION_LETTER',
    'RETIREMENT_LETTER',
    'REFERENCE_LETTER',
    'JOB_OFFER_LETTER',
    'SPONSORSHIP_LETTER',
    'GRANT_LETTER',
    'SCHOLARSHIP_LETTER',
    'ADMISSION_LETTER',
    'ENROLLMENT_LETTER',
    'CONFIRMATION_OF_ENROLMENT',
    'RECOMMENDATION_LETTER',
    'INVITATION_LETTER',
    'COVER_LETTER',
    'STATEMENT_OF_PURPOSE',
    'EXPLANATION_LETTER',
    'STUDY_GAP_EXPLANATION',
    'REFUSAL_LETTER',
    'VISA_GRANT_NOTICE',
    'VISA_CANCELLATION_NOTICE',
    'APPEAL_DECISION',
    'PARENTAL_CONSENT',
    'MINOR_TRAVEL_CONSENT',
    'FINANCIAL_GUARANTEE',
    'AFFIDAVIT_OF_SUPPORT',
    'AFFIDAVIT',
    'STATUTORY_DECLARATION',
    'TRAVEL_HISTORY_DECLARATION',
    'GO_LETTER',
    'DEPUTATION_ORDER',
    'MINISTRY_APPROVAL',
    'BOARD_RESOLUTION',
    'OTHER_LETTER',
  ],
  docFlight: [
    'FLIGHT_TICKET',
    'FLIGHT_BOOKING',
    'RETURN_TICKET',
    'TRAVEL_ITINERARY',
    'CRUISE_BOOKING',
    'CAR_RENTAL',
    'PILGRIMAGE_PACKAGE_CONFIRMATION',
  ],
  docHotel: [
    'HOTEL_BOOKING',
    'ACCOMMODATION_PROOF',
    'HOST_RESIDENCE_PROOF',
    'OTHER_ACCOMMODATION_DOCUMENT',
  ],
  docInsurance: ['TRAVEL_INSURANCE', 'MEDICAL_INSURANCE', 'INSURANCE'],
};

const DOCUMENT_ICON_BY_KEY: ReadonlyMap<string, DocumentIcon> = new Map(
  (Object.entries(DOCUMENT_KEYS) as [DocumentIcon, readonly string[]][]).flatMap(([icon, keys]) =>
    keys.map((key): [string, DocumentIcon] => [key, icon]),
  ),
);

/** The document pictures, for the test and for any legend. */
export const DOCUMENT_ICONS: readonly DocumentIcon[] = [
  ...(Object.keys(DOCUMENT_KEYS) as DocumentIcon[]),
  GENERIC_DOCUMENT_ICON,
];

/** The catalogue key a stored type or a typed name stands for ("Bank Statement" is BANK_STATEMENT). */
export function documentKey(typeOrName: string | null | undefined): string {
  return (typeOrName ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** A detail from the person's profile (a name, a date, an address) rather than a paper. */
export const FIELD_MARK: ItemMark = { icon: 'user', tone: 'blue' };

/** True when the type has a picture of its own and does not fall back to the plain document. */
export function hasOwnDocumentIcon(typeOrName: string | null | undefined): boolean {
  return DOCUMENT_ICON_BY_KEY.has(documentKey(typeOrName));
}

/** The picture and tone of a document type: a passport is a passport, anything else a document. */
export function documentMark(typeOrName: string | null | undefined): ItemMark {
  const icon = DOCUMENT_ICON_BY_KEY.get(documentKey(typeOrName)) ?? GENERIC_DOCUMENT_ICON;
  return { icon, tone: DOCUMENT_TONE[icon] };
}

// ---------------------------------------------------------------------------------------------
// Trip purposes
// ---------------------------------------------------------------------------------------------

export type PurposeFamily =
  | 'visit'
  | 'study'
  | 'work'
  | 'settle'
  | 'protection'
  | 'after_decision'
  | 'supporting'
  | 'beyond';

/** The eight pictures a traveller meets first, and the few families that need one of their own. */
export type PurposeIcon =
  | 'tripTourist'
  | 'briefcase'
  | 'tripStudy'
  | 'tripWork'
  | 'tripMedical'
  | 'tripFamily'
  | 'tripPilgrim'
  | 'tripTransit'
  | 'home'
  | 'shield'
  | 'building'
  | 'calendar'
  | 'clipboard'
  | 'globe';

const PURPOSE_TONE: Readonly<Record<PurposeIcon, MarkTone>> = {
  tripTourist: 'teal',
  briefcase: 'blue',
  tripStudy: 'violet',
  tripWork: 'blue',
  tripMedical: 'teal',
  tripFamily: 'violet',
  tripPilgrim: 'violet',
  tripTransit: 'teal',
  home: 'violet',
  shield: 'blue',
  building: 'blue',
  calendar: 'teal',
  clipboard: 'teal',
  globe: 'teal',
};

/** What a family's purposes read as unless the purpose itself says otherwise. */
export const PURPOSE_FAMILY_ICON: Readonly<Record<PurposeFamily, PurposeIcon>> = {
  visit: 'tripTourist',
  study: 'tripStudy',
  work: 'tripWork',
  settle: 'home',
  protection: 'shield',
  after_decision: 'calendar',
  supporting: 'clipboard',
  beyond: 'globe',
};

/** Purposes whose own meaning is not their family's (a hospital stay inside "visit"). */
const PURPOSE_OVERRIDES: Readonly<Record<string, PurposeIcon>> = {
  family_or_friends_visit: 'tripFamily',
  urgent_family_event: 'tripFamily',
  business_visit: 'briefcase',
  conference_or_trade_fair: 'briefcase',
  journalism_media_or_filming: 'briefcase',
  medical_treatment: 'tripMedical',
  accompanying_a_patient: 'tripMedical',
  religious_travel: 'tripPilgrim',
  transit_or_airside_transit: 'tripTransit',
  short_academic_or_research_visit: 'tripStudy',
  self_employed_or_freelancer: 'briefcase',
  start_up_founder_or_entrepreneur: 'briefcase',
  investor_or_business_purchase: 'briefcase',
  spouse_or_partner: 'tripFamily',
  fiance_or_marriage_visa: 'tripFamily',
  child_or_dependent_child: 'tripFamily',
  parent_or_grandparent: 'tripFamily',
  dependants_joining_main_applicant: 'tripFamily',
  adoption: 'tripFamily',
  official_or_diplomatic_travel: 'building',
  international_organisation_staff: 'building',
  military_or_defence_exchange: 'building',
  embassy_or_consular_staff: 'building',
};

/** The purpose families, for the test. */
export const PURPOSE_FAMILIES: readonly PurposeFamily[] = Object.keys(
  PURPOSE_FAMILY_ICON,
) as PurposeFamily[];

/** True when the purpose has its own picture rather than its family's. */
export function hasOwnPurposeIcon(purposeKey: string): boolean {
  return purposeKey in PURPOSE_OVERRIDES;
}

/**
 * The picture and tone of a trip purpose. The family comes from the purpose list (the grouped
 * options already carry it); without one, an unknown purpose reads as the globe.
 */
export function purposeMark(
  purposeKey: string | null | undefined,
  family?: string | null | undefined,
): ItemMark {
  const key = purposeKey ?? '';
  const fromFamily =
    family && family in PURPOSE_FAMILY_ICON
      ? PURPOSE_FAMILY_ICON[family as PurposeFamily]
      : undefined;
  const icon: PurposeIcon = PURPOSE_OVERRIDES[key] ?? fromFamily ?? 'globe';
  return { icon, tone: PURPOSE_TONE[icon] };
}

// ---------------------------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------------------------

export type StatusIcon =
  | 'stateDone'
  | 'stateNeedsYou'
  | 'stateCheck'
  | 'stateWaiting'
  | 'stateReceived'
  | 'lock'
  | 'pause'
  | 'circle';

/**
 * Every chip word (`lib/status-words.ts`) and the symbol it wears. Done, needs you, needs a check,
 * waiting, sent or received, and finished or locked are the six meanings; a paused sharing grant
 * has the pause bars; "nothing is asked of you" is the empty ring.
 */
export const STATUS_ICON_BY_WORD: Readonly<Record<string, StatusIcon>> = {
  // A checklist item.
  Missing: 'stateNeedsYou',
  'Two Values': 'stateNeedsYou',
  'Out of Date': 'stateNeedsYou',
  'To Confirm': 'stateCheck',
  Optional: 'circle',
  'On File': 'stateDone',
  'Not Applicable': 'circle',
  'Covered by Another Option': 'stateDone',
  Received: 'stateReceived',
  Chosen: 'stateDone',
  'Not Eligible': 'stateNeedsYou',
  'Too Old for This Route': 'stateNeedsYou',
  'Freshness Unknown': 'stateCheck',
  // A sharing grant.
  'Pending Acceptance': 'stateWaiting',
  Active: 'stateDone',
  Paused: 'pause',
  Revoked: 'lock',
  Expired: 'lock',
  // A sharing invitation (Revoked and Expired are above).
  Pending: 'stateWaiting',
  Accepted: 'stateDone',
  // A case on the Trips list.
  'Getting Started': 'stateNeedsYou',
  'Gathering Documents': 'stateNeedsYou',
  'Agency Is Checking': 'stateWaiting',
  'Needs You': 'stateNeedsYou',
  'Ready to Submit': 'stateDone',
  Submitted: 'stateReceived',
  Closed: 'lock',
  Cancelled: 'lock',
};

/** The colour of a chip's tone, in Harbor names: green, amber and red say how a thing stands. */
export function toneName(tone: StatusTone): MarkTone {
  switch (tone) {
    case 'success':
      return 'green';
    case 'warning':
      return 'amber';
    case 'danger':
      return 'red';
    case 'info':
      return 'blue';
    default:
      return 'neutral';
  }
}

/** The picture a status word wears, or nothing for a word that is not a status. */
export function statusIcon(word: string): StatusIcon | undefined {
  return STATUS_ICON_BY_WORD[word];
}

/** The picture and the tone of a status word, from the word and the tone it already carries. */
export function statusMark(word: string, tone: StatusTone): ItemMark | undefined {
  const icon = statusIcon(word);
  return icon ? { icon, tone: toneName(tone) } : undefined;
}

/** Symbols the three maps may share on purpose, each with its reason. */
export const SHARED_ON_PURPOSE: ReadonlyArray<{ readonly icon: IconName; readonly why: string }> = [
  { icon: 'circle', why: 'Optional and Not Applicable both mean nothing is asked of the person' },
  { icon: 'lock', why: 'Revoked, Expired, Closed and Cancelled all mean finished or locked' },
];
