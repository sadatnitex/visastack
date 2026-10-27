import {
  type CaseCountryOption,
  type CasePurposeOption,
  caseCountry,
  casePurpose,
} from '../../../../../lib/case-choices';
import {
  type ActionState,
  CASE_FORM_FIELDS,
  type CaseFormField,
  type CaseFormValues,
  TITLE_MAX,
} from './case-form-fields';

/**
 * Reading the Start a Case form (owner list item 1). The server decides what is valid: the
 * browser's own checks are switched off on the form so every problem is shown beside its field,
 * in the same words, whether or not the page's scripts have loaded.
 */

export interface CaseFormInput {
  readonly applicantId: string;
  readonly title: string;
  readonly country: CaseCountryOption | null;
  readonly purpose: CasePurposeOption | null;
  readonly itineraryRef: string;
  readonly jurisdiction: string;
  readonly serviceCategory: string;
  readonly travelStartDate: Date | undefined;
  readonly travelEndDate: Date | undefined;
  readonly targetDeadline: Date | undefined;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar date as the date box sends it (YYYY-MM-DD), checked to be a real day. */
function readDate(raw: string): Date | 'invalid' | undefined {
  if (raw.length === 0) return undefined;
  if (!DATE_ONLY.test(raw)) return 'invalid';
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw
    ? 'invalid'
    : parsed;
}

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '').trim();
}

/** Check the form. Either the input to save, or the state that shows each problem. */
export function readCaseForm(
  formData: FormData,
  attempt: number,
):
  | { readonly ok: true; readonly input: CaseFormInput; readonly values: CaseFormValues }
  | { readonly ok: false; readonly state: ActionState } {
  const values: Partial<Record<CaseFormField, string>> = {};
  for (const name of CASE_FORM_FIELDS) values[name] = text(formData, name);
  const errors: Partial<Record<CaseFormField, string>> = {};

  const title = values.title ?? '';
  if (title.length === 0) errors.title = 'Give the case a name, for example the visa and the year.';
  else if (title.length > TITLE_MAX)
    errors.title = `Keep the name to ${TITLE_MAX} characters or fewer.`;

  const destination = values.destination ?? '';
  const country = destination.length > 0 ? caseCountry(destination) : null;
  if (destination.length > 0 && !country) errors.destination = 'Choose a country from the list.';

  const purposeKey = values.purpose ?? '';
  const purpose = purposeKey.length > 0 ? casePurpose(purposeKey) : null;
  if (purposeKey.length > 0 && !purpose) errors.purpose = 'Choose a purpose from the list.';

  const dates: Partial<Record<'travelStartDate' | 'travelEndDate' | 'targetDeadline', Date>> = {};
  for (const name of ['travelStartDate', 'travelEndDate', 'targetDeadline'] as const) {
    const read = readDate(values[name] ?? '');
    if (read === 'invalid') errors[name] = 'Enter a full date: day, month and year.';
    else if (read) dates[name] = read;
  }
  if (
    dates.travelStartDate &&
    dates.travelEndDate &&
    dates.travelEndDate.getTime() < dates.travelStartDate.getTime()
  ) {
    errors.travelEndDate = 'The trip cannot end before it starts.';
  }

  const invalid = CASE_FORM_FIELDS.filter((name) => errors[name] !== undefined);
  const first = invalid[0];
  if (first) {
    return {
      ok: false,
      state: {
        ok: false,
        message:
          invalid.length === 1
            ? 'Check the field marked above.'
            : `Check the ${invalid.length} fields marked above.`,
        field: first,
        fieldErrors: errors,
        values,
        attempt,
      },
    };
  }

  return {
    ok: true,
    values,
    input: {
      applicantId: text(formData, 'applicantId'),
      title,
      country,
      purpose,
      itineraryRef: values.itineraryRef ?? '',
      jurisdiction: values.jurisdiction ?? '',
      serviceCategory: values.serviceCategory ?? '',
      travelStartDate: dates.travelStartDate,
      travelEndDate: dates.travelEndDate,
      targetDeadline: dates.targetDeadline,
    },
  };
}
