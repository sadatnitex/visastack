'use server';

import {
  GRANT_EXTEND_ENDED,
  GRANT_EXTEND_RESUME_FIRST,
  GRANT_EXTENSION_DAYS,
  accountPrincipal,
  extendGrant,
  requireAccess,
} from '@visastack/services';
import { redirect } from 'next/navigation';
import { withSession } from '../../lib/session';
import { STEP_UP_NOT_CONFIGURED_MESSAGE, establishStepUpProof } from '../../lib/step-up';

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
const CONSENT_LINE = 'Turn sharing back on in your privacy settings, then try again.';

function parseExpected(raw: FormDataEntryValue | null): Date | undefined {
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * Keep Sharing for 30 More Days. Only the traveller who owns the sharing can do this: the check is
 * a MANAGE proof on the record, so an agency, a team member or a stranger gets the same plain
 * "could not extend" as a grant that does not exist. The end date the person saw travels with the
 * tap, so a second tap (or a second device) does not add 30 days twice. A grant that hands out a
 * step-up action asks for a fresh sign-in first, exactly as creating it did; an ordinary one is
 * one tap.
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
  const returnTo = `/app/applicant/${applicantId}/sharing#extend-grant-${grantId}`;

  return withSession(async ({ db, accountId }): Promise<ExtendGrantState> => {
    const access = await requireAccess(
      db,
      accountPrincipal(accountId),
      'MANAGE',
      { applicantId },
      { purpose: 'self' },
    );
    if (!access.ok) return { ok: false, message: COULD_NOT_EXTEND_LINE };
    const input = { grantId, ...(expectedExpiryAt ? { expectedExpiryAt } : {}) };
    let extended = await extendGrant(access.value, input);
    if (!extended.ok && extended.error.code === 'step_up_required') {
      const stepUp = await establishStepUpProof(
        { accountId, action: 'SHARE', resourceId: applicantId },
        returnTo,
      );
      if (stepUp.kind === 'not_configured') {
        return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE };
      }
      if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);
      extended = await extendGrant(access.value, { ...input, stepUp: stepUp.proof });
    }
    if (!extended.ok) {
      const { code, message } = extended.error;
      if (code === 'consent_required') return { ok: false, message: CONSENT_LINE };
      if (code === 'invalid' && message === GRANT_EXTEND_RESUME_FIRST) {
        return { ok: false, message: RESUME_FIRST_LINE };
      }
      if (code === 'invalid' && message === GRANT_EXTEND_ENDED) {
        return { ok: false, message: ALREADY_ENDED_LINE };
      }
      return { ok: false, message: COULD_NOT_EXTEND_LINE };
    }
    const { extended: moved, atLimit, daysAdded } = extended.value;
    // The words say what really happened: the full 30 days (also when an earlier tap already added
    // them), fewer when the 90-day ceiling cut it short, or nothing new when it already ran as long
    // as it can.
    const done =
      !moved && atLimit
        ? 'extend-limit'
        : moved && daysAdded < GRANT_EXTENSION_DAYS
          ? 'extended-short'
          : 'extended';
    return {
      ok: true,
      message: '',
      refreshPath: `/app/applicant/${applicantId}/sharing?done=${done}`,
    };
  });
}
