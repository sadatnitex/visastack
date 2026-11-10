'use server';

import { accountPrincipal, extendGrant, requireAccess } from '@visastack/services';
import { withSession } from '../../lib/session';
import { ACCESS_AT_LIMIT_LINE, ACCESS_EXTENDED_LINE } from '../../lib/success-lines';

/** What the Keep Sharing button shows after a tap. */
export interface ExtendGrantState {
  readonly ok: boolean;
  readonly message: string;
  /** Where to reload so the row shows its new end date. */
  readonly refreshPath?: string;
}

const COULD_NOT_EXTEND_LINE = 'We could not extend this sharing. Please try again.';
const ALREADY_ENDED_LINE = 'This sharing has already ended.';
const RESUME_FIRST_LINE = 'Resume this sharing first, then extend it.';

function parseExpected(raw: FormDataEntryValue | null): Date | undefined {
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * Keep Sharing for 30 More Days. Only the traveller who owns the sharing can do this: the check is
 * a MANAGE proof on the record, so an agency, a team member or a stranger gets the same plain
 * "could not extend" as a grant that does not exist. The end date the person saw travels with the
 * tap, so a second tap (or a second device) does not add 30 days twice.
 */
export async function extendGrantAction(
  _previous: ExtendGrantState,
  formData: FormData,
): Promise<ExtendGrantState> {
  const applicantId = String(formData.get('applicantId') ?? '');
  const grantId = String(formData.get('grantId') ?? '');
  if (applicantId.length === 0 || grantId.length === 0) {
    return { ok: false, message: COULD_NOT_EXTEND_LINE };
  }
  const expectedExpiryAt = parseExpected(formData.get('expectedExpiryAt'));

  const result = await withSession(async ({ db, accountId }) => {
    const access = await requireAccess(
      db,
      accountPrincipal(accountId),
      'MANAGE',
      { applicantId },
      { purpose: 'self' },
    );
    if (!access.ok) return { ok: false, message: COULD_NOT_EXTEND_LINE } satisfies ExtendGrantState;
    const extended = await extendGrant(access.value, {
      grantId,
      ...(expectedExpiryAt ? { expectedExpiryAt } : {}),
    });
    if (!extended.ok) {
      const text = extended.error.message;
      return {
        ok: false,
        message: text.includes('resume')
          ? RESUME_FIRST_LINE
          : text.includes('ended')
            ? ALREADY_ENDED_LINE
            : COULD_NOT_EXTEND_LINE,
      } satisfies ExtendGrantState;
    }
    const done = extended.value.extended || !extended.value.atLimit ? 'extended' : 'extend-limit';
    return {
      ok: true,
      message: done === 'extended' ? ACCESS_EXTENDED_LINE : ACCESS_AT_LIMIT_LINE,
      refreshPath: `/app/applicant/${applicantId}/sharing?done=${done}`,
    } satisfies ExtendGrantState;
  });
  return result;
}
