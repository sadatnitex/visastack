/**
 * The Start a Case form's field names, problems and echoed values: plain data shared by the form in
 * the browser and the server's reader (case-form.ts), which alone holds the country and purpose lists.
 */

/** The form's fields in the order a person meets them, so focus goes to the first problem. */
export const CASE_FORM_FIELDS = [
  'title',
  'destination',
  'purpose',
  'itineraryRef',
  'jurisdiction',
  'serviceCategory',
  'travelStartDate',
  'travelEndDate',
  'targetDeadline',
] as const;

export type CaseFormField = (typeof CASE_FORM_FIELDS)[number];

/** Fields that sit under Add More Details, which opens by itself when one of them has a problem. */
export const CASE_DETAIL_FIELDS: ReadonlySet<CaseFormField> = new Set([
  'itineraryRef',
  'jurisdiction',
  'serviceCategory',
  'travelStartDate',
  'travelEndDate',
  'targetDeadline',
]);

export type CaseFormValues = Readonly<Partial<Record<CaseFormField, string>>>;

/** Result surfaced back to the client for inline feedback. */
export interface ActionState {
  readonly ok: boolean;
  readonly message: string;
  /** The first field with a problem, which receives focus. */
  readonly field?: string;
  /** One message per field with a problem, shown beside it. */
  readonly fieldErrors?: Readonly<Partial<Record<CaseFormField, string>>>;
  /** What was typed, so a refused form comes back filled in. */
  readonly values?: CaseFormValues;
  /** Counts each refused attempt, so the form is drawn afresh with the values above. */
  readonly attempt?: number;
}

/** The longest case name the form accepts. */
export const TITLE_MAX = 200;
