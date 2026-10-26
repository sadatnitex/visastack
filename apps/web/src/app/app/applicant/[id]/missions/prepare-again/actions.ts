'use server';

import { accountPrincipal, prepareCaseAgain, requireAccess } from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { withSession } from '../../../../../../lib/session';

export interface ActionState {
  readonly ok: boolean;
  readonly message: string;
}

function parseOptionalDate(value: FormDataEntryValue | null): Date | undefined {
  const raw = String(value ?? '').trim();
  if (raw.length === 0) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

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
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicantId = String(formData.get('applicantId') ?? '');
  const from = String(formData.get('from') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  if (title.length === 0) return { ok: false, message: 'Give the case a title.' };
  const expected = String(formData.get('expectedPackVersionId') ?? '');
  const travelStartDate = parseOptionalDate(formData.get('travelStartDate'));
  const travelEndDate = parseOptionalDate(formData.get('travelEndDate'));
  const targetDeadline = parseOptionalDate(formData.get('targetDeadline'));

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
    redirect(`/app/mission/${outcome.id}`);
  }
  return outcome.state;
}
