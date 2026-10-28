'use client';

import { useState } from 'react';
import { FormMessage, NO_RESULT } from '../../../../components/form-feedback';
import type { ActionState } from './actions';
import { InvitationLink } from './invitation-link';

/**
 * What an invitation form says after it sends: the "Invitation ready" line and the private
 * link, for that one invitation. Once the page has listed the invitation as waiting and later
 * stops listing it (revoked or accepted), both go, so a dead link is never offered. An
 * invitation the page has not listed yet still shows, so a slow or failed list never hides the
 * only copy of a new link.
 *
 * The message region stays in the page (empty when there is nothing to say) so screen readers
 * announce the next answer. The link is keyed by its address, so "Link copied." never carries
 * over from one invitation to the next.
 */
export function InvitationOutcome({
  state,
  pendingInvitationIds,
}: {
  readonly state: ActionState;
  /** Invitations still waiting, as the page last read them. */
  readonly pendingInvitationIds: readonly string[];
}) {
  const id = state.invitationId;
  const listed = id !== undefined && pendingInvitationIds.includes(id);
  const [seenListed, setSeenListed] = useState<string | null>(null);
  // Adjusting state while rendering: remember that the page has listed this invitation.
  if (listed && seenListed !== id) setSeenListed(id);
  const gone = id !== undefined && !listed && seenListed === id;
  const shown = gone ? NO_RESULT : state;
  return (
    <>
      <FormMessage result={shown} />
      {shown.ok && shown !== NO_RESULT && state.invitationUrl ? (
        <InvitationLink key={state.invitationUrl} url={state.invitationUrl} />
      ) : null}
    </>
  );
}
