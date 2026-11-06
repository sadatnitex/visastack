import { accountPrincipal, type recordPackageChoice, requireAccess } from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import type { FormResult } from '../../../../components/form-feedback';
import { reportServerError } from '../../../../lib/server-error';
import { withSession } from '../../../../lib/session';

/**
 * The one way a case page action gets its access proof: the access gate's MANAGE proof for the
 * signed-in account and this one case, then the action's own work, then a refresh of the page. A
 * refused or unknown case, or an id that is not an id, gets the same plain answer. Signing in again
 * (a redirect) goes ahead; any other failure is reported and shown as a try they can repeat.
 */

export const CASE_UNAVAILABLE = 'This case is not available to you.';
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function withCaseProof<T extends FormResult>(
  missionId: string,
  errorLabel: string,
  run: (proof: Parameters<typeof recordPackageChoice>[0]) => Promise<T>,
): Promise<FormResult> {
  if (!UUID.test(missionId)) return { ok: false, message: CASE_UNAVAILABLE };
  try {
    const outcome = await withSession(async ({ db, accountId }) => {
      const proof = await requireAccess(
        db,
        accountPrincipal(accountId),
        'MANAGE',
        { missionId },
        { purpose: 'self' },
      );
      if (!proof.ok) return { ok: false, message: CASE_UNAVAILABLE } satisfies FormResult;
      return run(proof.value);
    });
    if (outcome.ok) revalidatePath(`/app/mission/${missionId}`);
    return outcome;
  } catch (error) {
    unstable_rethrow(error);
    reportServerError(errorLabel, error);
    return { ok: false, message: 'Something went wrong. Try again.' };
  }
}
