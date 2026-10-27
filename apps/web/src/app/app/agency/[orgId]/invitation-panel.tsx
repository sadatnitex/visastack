'use client';

import type { ReactNode } from 'react';
import { FormMessage } from '../../../../components/form-feedback';
import { LatestResultArea, useLatestResult } from '../../../../components/latest-result';
import type { ActionState } from './actions';
import { InvitationLink } from './invitation-link';

const INITIAL: ActionState = { ok: true, message: '' };

/**
 * The Team and Clients panels: a list of people and pending invitations, the buttons on each
 * row, and the form that invites someone new. They say what happened in one place, below the
 * form, and only for the latest action. Revoking an invitation, or any later action here,
 * replaces the earlier line, so a private link to accept an invitation is never left on screen
 * once something else has happened (it may be the very invitation that was just revoked).
 */
export function InvitationPanel({ children }: { readonly children: ReactNode }) {
  const area = useLatestResult(INITIAL);
  const { result } = area;
  return (
    <LatestResultArea area={area}>
      {children}
      <div>
        <FormMessage result={result} />
        {/* Keyed by the link, so "Link copied." from an earlier invitation never shows on a new one. */}
        {result.ok && result.invitationUrl ? (
          <InvitationLink key={result.invitationUrl} url={result.invitationUrl} />
        ) : null}
      </div>
    </LatestResultArea>
  );
}
