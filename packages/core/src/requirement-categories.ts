/**
 * The one list of requirement categories (UMPE G2, R02): where a checklist item sits in the rule
 * taxonomy. MECE for the taxonomy only (annex section 1): every requirement gets at most one primary
 * category, but one document may still satisfy requirements in several categories.
 *
 * This vocabulary organises rules. It is never a sharing category: `PROFILE_PACKS` and the
 * catalogue's proposed packs decide who may see what, and none of their keys may appear here (a
 * test pins that). A requirement with no category is shown under "Other Items" and nothing is
 * guessed about it.
 */

export const REQUIREMENT_CATEGORIES = [
  'IDENTITY_TRAVEL_DOCUMENTS',
  'IMMIGRATION_HISTORY',
  'DECLARATIONS_CIRCUMSTANCES',
  'FINANCIAL_MEANS',
  'EMPLOYMENT_BUSINESS',
  'EDUCATION_ACADEMIC',
  'FAMILY_SPONSORSHIP',
  'JOURNEY_ITINERARY',
  'MEDICAL_HEALTH',
  'FORMS_PROCEDURES',
  'ROUTE_SPECIFIC_OTHER',
] as const;
export type RequirementCategory = (typeof REQUIREMENT_CATEGORIES)[number];

/** Plain Title Case headings, in the order the checklist shows them. */
export const REQUIREMENT_CATEGORY_LABELS: Readonly<Record<RequirementCategory, string>> = {
  IDENTITY_TRAVEL_DOCUMENTS: 'Identity and Travel Documents',
  IMMIGRATION_HISTORY: 'Visas and Travel History',
  DECLARATIONS_CIRCUMSTANCES: 'Declarations and Personal Circumstances',
  FINANCIAL_MEANS: 'Money and Proof of Funds',
  EMPLOYMENT_BUSINESS: 'Work and Business',
  EDUCATION_ACADEMIC: 'Study and Academic Admission',
  FAMILY_SPONSORSHIP: 'Family, Hosts and Sponsors',
  JOURNEY_ITINERARY: 'Trip Plans, Stay and Transport',
  MEDICAL_HEALTH: 'Medical and Health',
  FORMS_PROCEDURES: 'Forms, Photos, Fees and Appointments',
  ROUTE_SPECIFIC_OTHER: 'Other Items for This Route',
};

/** The heading for items with no category. */
export const UNCATEGORISED_LABEL = 'Other Items';

export function isRequirementCategory(value: unknown): value is RequirementCategory {
  return typeof value === 'string' && (REQUIREMENT_CATEGORIES as readonly string[]).includes(value);
}

/** The order of a category on the checklist; uncategorised items come last. */
export function requirementCategoryOrder(category: RequirementCategory | null): number {
  return category === null
    ? REQUIREMENT_CATEGORIES.length
    : REQUIREMENT_CATEGORIES.indexOf(category);
}

/**
 * Rows grouped by category in the fixed order, keeping each group's rows in the order given.
 * Groups with no rows are left out.
 */
export function groupByRequirementCategory<T>(
  rows: readonly T[],
  categoryOf: (row: T) => RequirementCategory | null,
): { readonly category: RequirementCategory | null; readonly label: string; readonly rows: T[] }[] {
  const groups = new Map<RequirementCategory | null, T[]>();
  for (const row of rows) {
    const category = categoryOf(row);
    const list = groups.get(category);
    if (list) list.push(row);
    else groups.set(category, [row]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => requirementCategoryOrder(a) - requirementCategoryOrder(b))
    .map(([category, list]) => ({
      category,
      label: category === null ? UNCATEGORISED_LABEL : REQUIREMENT_CATEGORY_LABELS[category],
      rows: list,
    }));
}

// --- Document format rules (UMPE G2, R12) ---------------------------------------------------------

/** The form a document is accepted in. Whether the original must also be shown is separate. */
export const ACCEPTED_FORMS = [
  'DIGITAL_COPY',
  'PRINTED_COPY',
  'CERTIFIED_COPY',
  'NOTARISED_COPY',
] as const;
export type AcceptedForm = (typeof ACCEPTED_FORMS)[number];

export const ACCEPTED_FORM_LABELS: Readonly<Record<AcceptedForm, string>> = {
  DIGITAL_COPY: 'Digital Copy',
  PRINTED_COPY: 'Printed Copy',
  CERTIFIED_COPY: 'Certified Copy',
  NOTARISED_COPY: 'Notarised Copy',
};

export function isAcceptedForm(value: unknown): value is AcceptedForm {
  return typeof value === 'string' && (ACCEPTED_FORMS as readonly string[]).includes(value);
}

/** Bounds an editor may enter, so a typo can never become a nonsense rule. */
export const STATEMENT_PERIOD_MONTHS_MAX = 60;
export const VALID_MONTHS_AFTER_TRAVEL_MAX = 120;

/** The structured format rules a requirement may carry. Every field may be unset. */
export interface RequirementFormatRules {
  readonly acceptedForm: AcceptedForm | null;
  readonly translationNeeded: boolean | null;
  readonly originalNeeded: boolean | null;
  readonly statementPeriodMonths: number | null;
  readonly validMonthsAfterTravel: number | null;
}

export const NO_FORMAT_RULES: RequirementFormatRules = {
  acceptedForm: null,
  translationNeeded: null,
  originalNeeded: null,
  statementPeriodMonths: null,
  validMonthsAfterTravel: null,
};

const NOTE_TRANSLATION = /\btranslat\w*/i;
const NOTE_ORIGINAL = /\b(original|hard copy|notari[sz]ed)\b/i;

const months = (count: number) => `${count} ${count === 1 ? 'Month' : 'Months'}`;

/**
 * Plain lines describing how a document must be provided. Structured rules come first; a note is
 * read only as a fallback for translation and originals when the structured value is unset, and
 * then says only that the checklist's notes mention it (the note text itself is never shown as a
 * rule). `maxAgeDays` is the existing freshness rule.
 */
export function requirementFormatLines(
  rules: RequirementFormatRules,
  notes: string | null,
  maxAgeDays: number | null,
): string[] {
  const lines: string[] = [];
  if (rules.acceptedForm) lines.push(`Accepted As: ${ACCEPTED_FORM_LABELS[rules.acceptedForm]}`);
  if (rules.originalNeeded === true) lines.push('Original Needed');
  else if (rules.originalNeeded === null && notes && NOTE_ORIGINAL.test(notes)) {
    lines.push('Checklist Notes Mention Originals');
  }
  if (rules.translationNeeded === true) lines.push('Translation Needed');
  else if (rules.translationNeeded === null && notes && NOTE_TRANSLATION.test(notes)) {
    lines.push('Checklist Notes Mention a Translation');
  }
  if (rules.statementPeriodMonths !== null) {
    lines.push(`Must Cover the Last ${months(rules.statementPeriodMonths)}`);
  }
  if (maxAgeDays !== null) lines.push(`Dated Within ${maxAgeDays} Days`);
  if (rules.validMonthsAfterTravel === 0) lines.push('Valid Until Your Trip Ends');
  else if (rules.validMonthsAfterTravel !== null) {
    lines.push(`Valid ${months(rules.validMonthsAfterTravel)} After Your Trip Ends`);
  }
  return lines;
}
