'use server';

import { accountPrincipal, prepareCaseAgain, requireAccess } from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { readCaseDates } from '../../../../../../lib/form-dates';
import { withSession } from '../../../../../../lib/session';
import type { ActionState } from '../actions';
import { CASE_FORM_FIELDS, type CaseFormField, TITLE_MAX } from '../case-form-fields';

/** `<requirement>|f|<fact>` or `<requirement>|d|<document>`; anything else is dropped and the service refuses what does not match its own list. */
function parseCarry(values: readonly FormDataEntryValue[]) {
  const carry: { packRequirementId: string; factId?: string; documentId?: string }[] = [];
  for (const value of values) {
    const [packRequirementId, kind, id, ...rest] = String(value).split('|');
    if (!packRequirementId || !id || rest.length > 0) continue;
    if (kind === 'f') carry.push({ packRequirementId, factId: id });
    else if (kind === 'd') carry.push({ packRequirementId, documentId: id });
  }
  return carry;
}

/** Start a new case from a previous one (Programme X U02), then open it. */
export async function prepareCaseAgainAction(
  prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicantId = String(formData.get('applicantId') ?? '');
  const from = String(formData.get('from') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  const expected = String(formData.get('expectedPackVersionId') ?? '');
  // The same checks and words as Start a Case, each problem beside its field, focus on the first:
  // an impossible date is refused, never dropped.
  const { dates, errors: dateErrors } = readCaseDates((name) => formData.get(name));
  const errors: Partial<Record<CaseFormField, string>> = { ...dateErrors };
  if (title.length === 0) errors.title = 'Give the case a name, for example the visa and the year.';
  else if (title.length > TITLE_MAX) {
    errors.title = `Keep the name to ${TITLE_MAX} characters or fewer.`;
  }
  const invalid = CASE_FORM_FIELDS.filter((name) => errors[name] !== undefined);
  const [first] = invalid;
  if (first) {
    return {
      ok: false,
      message:
        invalid.length === 1
          ? 'Check the field marked above.'
          : `Check the ${invalid.length} fields marked above.`,
      field: first,
      fieldErrors: errors,
      values: {
        title,
        travelStartDate: String(formData.get('travelStartDate') ?? ''),
        travelEndDate: String(formData.get('travelEndDate') ?? ''),
        targetDeadline: String(formData.get('targetDeadline') ?? ''),
      },
      attempt: (prev.attempt ?? 0) + 1,
    };
  }
  const { travelStartDate, travelEndDate, targetDeadline } = dates;

  const outcome = await withSession(async ({ db, accountId }) => {
    const access = await requireAccess(
      db,
      accountPrincipal(accountId),
      'MANAGE',
      { missionId: from },
      { purpose: 'owner_prepare_again' },
    );
    if (!access.ok || access.value.applicant.id !== applicantId) {
      return { state: { ok: false, message: 'Not authorized.' } as ActionState, id: null };
    }
    const created = await prepareCaseAgain(access.value, {
      title,
      ...(travelStartDate ? { travelStartDate } : {}),
      ...(travelEndDate ? { travelEndDate } : {}),
      ...(targetDeadline ? { targetDeadline } : {}),
      expectedPackVersionId: expected.length > 0 ? expected : null,
      carry: parseCarry(formData.getAll('carry')),
      sharing: {
        allowedGrantIds: formData.getAll('allowGrant').map(String),
        allowedInvitationIds: formData.getAll('allowInvitation').map(String),
      },
    });
    if (!created.ok) {
      return { state: { ok: false, message: created.error.message } as ActionState, id: null };
    }
    return { state: { ok: true, message: '' } as ActionState, id: created.value.id };
  });

  if (outcome.id) {
    revalidatePath(`/app/applicant/${applicantId}/missions`);
    redirect(`/app/mission/${outcome.id}?welcome=1`);
  }
  // A refusal usually means the list changed (a newer checklist, a record
  // that went out of date, a share that ended): redraw it so a retry works.
  revalidatePath(`/app/applicant/${applicantId}/missions/prepare-again`);
  return outcome.state;
}
