'use client';

import { useActionState, useEffect } from 'react';
import { FormMessage, SubmitButton } from '../form-feedback';
import { type ExtendGrantState, extendGrantAction } from './extend-grant-action';

const INITIAL: ExtendGrantState = { ok: true, message: '' };

/**
 * The traveller's one-tap Keep Sharing for 30 More Days, on a sharing row and the place the
 * "sharing ends soon" reminder leads (`#extend-grant-<id>`). Shown only to the traveller who owns
 * the sharing; the server checks that again, so showing it is a courtesy, not the protection.
 */
export function ExtendGrantButton({
  applicantId,
  grantId,
  expiresAt,
}: {
  readonly applicantId: string;
  readonly grantId: string;
  /** The end date shown on the row, as an ISO string. It travels with the tap so a second tap adds nothing. */
  readonly expiresAt: string;
}) {
  const [state, formAction, pending] = useActionState(extendGrantAction, INITIAL);
  useEffect(() => {
    if (state.ok && state.refreshPath) window.location.assign(state.refreshPath);
  }, [state]);

  return (
    <div id={`extend-grant-${grantId}`} className="lc-grant-ops">
      <form action={formAction}>
        <input type="hidden" name="applicantId" value={applicantId} />
        <input type="hidden" name="grantId" value={grantId} />
        <input type="hidden" name="expectedExpiryAt" value={expiresAt} />
        <SubmitButton
          pending={pending}
          idle="Keep Sharing for 30 More Days"
          busy="Extending"
          className="btn btn-secondary u-btn-sm"
        />
      </form>
      <FormMessage result={state} />
    </div>
  );
}
