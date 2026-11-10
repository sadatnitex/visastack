import type { GrantWithRecipient } from '@visastack/services';
import type { ComponentProps } from 'react';
import {
  SelectedScopeSummary,
  describeGrantScope,
} from '../../../../../components/selected-scope-summary';
import { AGENCY_AI_ALLOWED_LINE } from '../../../../../lib/agency-ai';
import { formatTimestampDate } from '../../../../../lib/format-date';
import { categoryLabel } from '../../../../../lib/master-profile';
import { permissionPhrase } from '../../../../../lib/permission-phrases';
import { CaseExceptions } from './case-exceptions';
import { GrantAiChoice } from './grant-ai-choice';
import { GrantOpButtons } from './grant-op-buttons';
import { ScopeExpansionForm } from './scope-expansion-form';

/** The one sentence beside Pause and Revoke: the same words as the page's revoke banner. */
export const REVOKE_SENTENCE =
  'Pausing or revoking stops access now; copies already downloaded cannot be erased.';

export interface GrantPaneProps {
  readonly applicantId: string;
  readonly grant: GrantWithRecipient;
  /** Revoked, expired, or past its end day. */
  readonly ended: boolean;
  /** The status in words and its badge tone, from the page's one status table. */
  readonly badge: { readonly label: string; readonly tone: string };
  readonly documents: ReadonlyArray<{
    readonly id: string;
    readonly approvedName: string | null;
    readonly originalName: string;
  }>;
  readonly aiAssistReady: boolean;
  readonly expansions: ComponentProps<typeof ScopeExpansionForm>['candidates'];
}

/**
 * Everything about one grant that the row does not say: what they receive in full, when it was
 * accepted, the agency AI choice, the cases left out, and Pause, Resume and Revoke with the revoke
 * warning beside them (so it is read on a phone, where this panel covers the page). Nothing here
 * is new: it is the old "Grant Details" block, moved into the list pattern's panel.
 */
export function GrantPane({
  applicantId,
  grant,
  ended,
  badge,
  documents,
  aiAssistReady,
  expansions,
}: GrantPaneProps) {
  const canPause = grant.status === 'ACTIVE';
  const canResume = grant.status === 'PAUSED';
  const canRevoke =
    grant.status === 'ACTIVE' || grant.status === 'PAUSED' || grant.status === 'PENDING_ACCEPTANCE';
  return (
    <div className="lp-pane-content sharing-grant-pane">
      <h3 className="lp-pane-title">
        {grant.recipient.label}
        {grant.recipient.kind === 'organization' ? ' (organization)' : ''}
      </h3>
      <p className="lp-pane-line">
        <span className={`badge ${badge.tone} lift-pill lift-pill-md`}>{badge.label}</span>
      </p>
      <SelectedScopeSummary
        purpose={grant.purpose}
        permissions={grant.actions.filter((a) => a !== 'AI_ASSIST').map((a) => permissionPhrase(a))}
        {...describeGrantScope({
          // AI tools are their own line below, never part of this sentence.
          actions: grant.actions.filter((a) => a !== 'AI_ASSIST'),
          caseGrant: Boolean(grant.missionId),
          partLabels: (grant.categories ?? []).map((c) => categoryLabel(c)),
          documentNames: (grant.documentIds ?? []).map((documentId) => {
            const document = documents.find((record) => record.id === documentId);
            return document
              ? (document.approvedName ?? document.originalName)
              : 'Document details unavailable';
          }),
          hasDocuments: true,
          partsWhen: 'atSharing',
        })}
        tense={ended ? 'ended' : grant.status === 'ACTIVE' ? 'live' : 'notYet'}
        revoked={grant.status === 'REVOKED'}
        endsOn={grant.expiryAt ? formatTimestampDate(grant.expiryAt) : null}
      />
      {grant.acceptedAt ? (
        <p className="muted lc-small-m0">Accepted {formatTimestampDate(grant.acceptedAt)}</p>
      ) : null}
      {aiAssistReady &&
      grant.recipient.kind === 'organization' &&
      !ended &&
      grant.status !== 'REVOKED' &&
      grant.actions.includes('VIEW_METADATA') ? (
        <GrantAiChoice
          applicantId={applicantId}
          grantId={grant.id}
          agencyName={grant.recipient.label}
          allowed={grant.actions.includes('AI_ASSIST')}
        />
      ) : null}
      {grant.missionId === null &&
      canRevoke &&
      grant.caseExceptions.length > 0 &&
      (grant.expiryAt === null || new Date(grant.expiryAt).getTime() > Date.now()) ? (
        <CaseExceptions
          applicantId={applicantId}
          grantId={grant.id}
          recipientLabel={grant.recipient.label}
          exceptions={grant.caseExceptions.map((exception) => ({
            missionId: exception.missionId,
            title: exception.missionTitle,
            sharedSeparately: exception.reachedByAnotherGrant,
          }))}
        />
      ) : null}
      {grant.actions.includes('AI_ASSIST') && !ended ? (
        <p className="u-m-0">
          <span className="badge badge-neutral">{AGENCY_AI_ALLOWED_LINE}</span>
        </p>
      ) : null}
      {canPause || canResume || canRevoke ? (
        <div className="lp-pane-section">
          <p className="lc-revoke-short u-m-0">{REVOKE_SENTENCE}</p>
          <GrantOpButtons
            applicantId={applicantId}
            grantId={grant.id}
            ops={[
              ...(canPause
                ? [{ op: 'pause' as const, label: 'Pause', variant: 'btn-secondary' }]
                : []),
              ...(canResume
                ? [{ op: 'resume' as const, label: 'Resume', variant: 'btn-secondary' }]
                : []),
              ...(canRevoke
                ? [{ op: 'revoke' as const, label: 'Revoke', variant: 'btn-danger' }]
                : []),
            ]}
          />
        </div>
      ) : null}
      {expansions.length > 0 ? (
        <ScopeExpansionForm applicantId={applicantId} grantId={grant.id} candidates={expansions} />
      ) : null}
    </div>
  );
}
