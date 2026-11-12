'use client';

import { useActionState } from 'react';
import { FormMessage, SubmitButton } from '../../../../components/form-feedback';
import { useT } from '../../../../components/i18n-provider';
import { useShareMessage } from '../../../../components/share/use-share-message';
import { WhatsAppShare } from '../../../../components/share/whatsapp-share';
import { appMissionCatalog } from '../../../../i18n/app-mission';
import { formatTimestampDate } from '../../../../lib/format-date';
import { documentTypeLabel } from '../../../../lib/labels';
import {
  type ActionState,
  createContributorRequestAction,
  revokeContributorRequestAction,
} from './actions';

const INITIAL: ActionState = { ok: true, message: '' };

const STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  PENDING: { label: 'Pending', tone: 'badge-warning' },
  SUBMITTED: { label: 'Submitted', tone: 'badge-success' },
  REVOKED: { label: 'Revoked', tone: 'badge-neutral' },
};

export interface ContributorRequestRow {
  readonly id: string;
  readonly contributorEmail: string;
  readonly docType: string;
  readonly purpose: string;
  readonly status: string;
  readonly expiresAt: string;
}

/** CAS-08: ask a named third party (a sponsor, a family member) for exactly one piece of evidence, without giving them any other access to this case. */
export function ContributorRequestsPanel({
  missionId,
  requests,
}: {
  readonly missionId: string;
  readonly requests: readonly ContributorRequestRow[];
}) {
  const t = useT(appMissionCatalog);
  const [state, formAction, pending] = useActionState(createContributorRequestAction, INITIAL);

  return (
    <>
      {requests.length > 0 ? (
        <div className="rows u-mb-125">
          {requests.map((r) => {
            const badge = STATUS_LABELS[r.status] ?? { label: r.status, tone: 'badge-neutral' };
            return (
              <div
                className="row"
                key={r.id}
                style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.2rem' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                  <span className="row-key">
                    {documentTypeLabel(r.docType)} · {r.contributorEmail}
                  </span>
                  <span className={`badge ${badge.tone}`}>{badge.label}</span>
                </div>
                <span className="muted u-fs-085">
                  {r.purpose}
                  {r.status === 'PENDING'
                    ? t.node(
                        'appMission.appMissionIdContributorRequestsPanel.expiresFormattimestampdate',
                        { formatTimestampDate: formatTimestampDate(r.expiresAt) },
                      )
                    : ''}
                </span>
                {r.status === 'PENDING' ? (
                  <RevokeButton missionId={missionId} requestId={r.id} />
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      <form action={formAction} className="field-list">
        <input type="hidden" name="missionId" value={missionId} />
        <div className="field-row">
          <label className="field-label" htmlFor="contributorEmail">
            {t.node('appMission.appMissionIdContributorRequestsPanel.contributorEmail')}
          </label>
          <input
            id="contributorEmail"
            name="contributorEmail"
            type="email"
            required
            className="input"
            placeholder={t('appMission.appMissionIdContributorRequestsPanel.sponsorExampleCom')}
          />
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="docType">
            {t.node(
              'appMission.appMissionIdContributorRequestsPanel.whatSNeededExactlyOneDocument',
            )}
          </label>
          <input
            id="docType"
            name="docType"
            type="text"
            required
            className="input"
            placeholder={t(
              'appMission.appMissionIdContributorRequestsPanel.eGSponsorBankStatement',
            )}
          />
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="purpose">
            {t.node('appMission.appMissionIdContributorRequestsPanel.whyTheContributorWillSeeThis')}
          </label>
          <input
            id="purpose"
            name="purpose"
            type="text"
            required
            className="input"
            placeholder={t(
              'appMission.appMissionIdContributorRequestsPanel.eGToSupportTheFinancial',
            )}
          />
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="message">
            {t.node('appMission.appMissionIdContributorRequestsPanel.messageOptional')}
          </label>
          <input id="message" name="message" type="text" className="input" />
        </div>
        <div>
          <SubmitButton
            pending={pending}
            idle="Ask for This"
            busy="Creating…"
            className="btn btn-secondary"
          />
          <FormMessage result={state} style={{ wordBreak: 'break-all' }} />
        </div>
        {state.ok && state.acceptUrl && !revokedSince(requests, state.requestId) ? (
          <ContributorLinkShare
            url={state.acceptUrl}
            {...(state.askedFor ? { askedFor: state.askedFor } : {})}
          />
        ) : null}
      </form>
    </>
  );
}

/**
 * Whether the request just made has since been revoked or answered, so its link no longer works
 * and must not be offered again. A request not in the list (it may be past the part shown) is
 * taken as still open.
 */
function revokedSince(requests: readonly ContributorRequestRow[], requestId: string | undefined) {
  const made = requestId ? requests.find((request) => request.id === requestId) : undefined;
  return made !== undefined && made.status !== 'PENDING';
}

/**
 * Send on WhatsApp for the private link of a request just made. The words come from the one
 * builder (kind of document and the link, nothing else); when it refuses them, no WhatsApp action
 * shows and the link in the message above still works.
 */
function ContributorLinkShare({
  url,
  askedFor,
}: {
  readonly url: string;
  readonly askedFor?: string;
}) {
  const t = useT(appMissionCatalog);
  const message = useShareMessage({
    template: 'contributor-request',
    link: url,
    ...(askedFor ? { documentKind: askedFor } : {}),
  });
  return message ? (
    <WhatsAppShare
      message={message}
      title={t('appMission.appMissionIdContributorRequestsPanel.visastackRequest')}
    />
  ) : null;
}

function RevokeButton({
  missionId,
  requestId,
}: {
  readonly missionId: string;
  readonly requestId: string;
}) {
  const [state, formAction, pending] = useActionState(revokeContributorRequestAction, INITIAL);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm('Revoke this request? The link will stop working immediately.')) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="missionId" value={missionId} />
      <input type="hidden" name="requestId" value={requestId} />
      <SubmitButton
        pending={pending}
        idle="Revoke"
        busy="Revoking…"
        className="btn btn-danger"
        style={{ alignSelf: 'flex-start' }}
      />
      {state.message && !state.ok ? (
        <p className="field-msg field-msg-err">{state.message}</p>
      ) : null}
    </form>
  );
}
