import type {
  EvidenceSubmissionList,
  EvidenceSubmissionState,
  EvidenceSubmissionView,
  LegacyEvidenceSend,
  VersionScanEvidence,
} from '@visastack/services';
import { Icon } from '../../../../components/icons';
import type { Tone } from '../../../../components/ui';
import { AboutDisclosure, StatusPill } from '../../../../components/ui-lift';
import { appAgencyCatalog } from '../../../../i18n/app-agency';
import { humanizeCode } from '../../../../lib/format-code';
import { formatFileSize } from '../../../../lib/format-size';
import { getServerT } from '../../../../lib/i18n-server';
import { formatMoment } from '../../../../lib/save-status';
import { presentScanState } from '../../../../lib/scan-state';
import { REQ_STATUS } from './console-format';
import { downloadEvidenceCopyAction } from './evidence-copy-actions';

/**
 * The copies a traveller sent for one request, on the agency's request card (Lane E). It shows the
 * exact copy waiting for a decision in full (the name it had when sent, its kind, when it was sent
 * and which send it is, its size and a short fingerprint, how it was checked), the same copy the
 * Accept and Send Back buttons decide on, and every earlier send folded below with what happened
 * to it. A reason the agency gave a traveller stays on this page and the traveller's page; it is
 * never in an email.
 *
 * The file itself opens only when the service says it can (`fileAvailable`): an original download
 * after the person confirms it is them, never a preview, never a newer version of the file. Where
 * the service does not keep exact copies yet, nothing here claims one and no file action shows.
 */

const MOMENT_ZONE = null;

const STATE_WORDS: Record<EvidenceSubmissionState, { label: string; tone: Tone }> = {
  AWAITING_DECISION: { label: 'Waiting for a Decision', tone: 'neutral' },
  ACCEPTED: { label: 'Accepted', tone: 'success' },
  NEEDS_REPLACEMENT: { label: 'Sent Back for a Replacement', tone: 'warning' },
  CONTRADICTION: { label: 'Flagged as a Contradiction', tone: 'warning' },
  CORRECTION_PROPOSED: { label: 'Correction Suggested', tone: 'warning' },
  WITHDRAWN: { label: 'Request Withdrawn', tone: 'neutral' },
};

/** The request statuses where a decision can be made on a copy that is waiting. */
const DECIDABLE: ReadonlySet<string> = new Set(['RECEIVED', 'UNDER_REVIEW']);

export const FILE_UNAVAILABLE_NOTICE =
  'That file could not be opened. It may have been sent back or replaced, or access ended. Refresh to see the copy now waiting.';
export const NOT_KEPT_NOTICE =
  'Exact sent copies are not kept on this service yet, so this file cannot be opened from here.';
export const COPIES_UNREAD_NOTICE =
  'The copy that was sent could not be shown here. Refresh to try again.';

/**
 * The send waiting for a decision right now, or undefined when none is pinned: the newest send,
 * only while the request is Received or Under Review and nobody has decided it. Its id is what the
 * decision buttons post, so a newer copy that arrives later is never decided unseen.
 */
export function waitingCopy(
  list: EvidenceSubmissionList | undefined,
  status: string,
): EvidenceSubmissionView | undefined {
  if (!list?.available || !DECIDABLE.has(status)) return undefined;
  const newest = list.submissions.reduce<EvidenceSubmissionView | undefined>(
    (best, s) => (!best || s.roundNo > best.roundNo ? s : best),
    undefined,
  );
  return newest?.state === 'AWAITING_DECISION' ? newest : undefined;
}

/** The copy shown in full: the one waiting, or, once accepted, the accepted one. */
function shownCopy(
  list: EvidenceSubmissionList,
  status: string,
): EvidenceSubmissionView | undefined {
  const waiting = waitingCopy(list, status);
  if (waiting) return waiting;
  if (status !== 'ACCEPTED') return undefined;
  return [...list.submissions].reverse().find((s) => s.state === 'ACCEPTED');
}

function CopyFacts({ copy }: { readonly copy: EvidenceSubmissionView }) {
  return (
    <p className="evidence-copy-meta u-m-0">
      {copy.docType ? `${humanizeCode(copy.docType)} · ` : ''}Send {copy.roundNo} · Sent{' '}
      {formatMoment(copy.sentAt, MOMENT_ZONE)}
      {copy.sizeBytes !== null ? ` · ${formatFileSize(copy.sizeBytes)}` : ''}
    </p>
  );
}

function Fingerprint({ copy }: { readonly copy: EvidenceSubmissionView }) {
  const t = getServerT(appAgencyCatalog);
  return copy.checksumFingerprint ? (
    <p className="evidence-copy-meta u-m-0">
      {t.node('appAgency.appAgencyOrgidEvidenceCopies.fingerprint')}{' '}
      <code className="evidence-copy-code lc-copy-code">{copy.checksumFingerprint}</code>
    </p>
  ) : null;
}

function CurrentCopy({
  organizationId,
  requestId,
  status,
  copy,
  scan,
}: {
  readonly organizationId: string;
  readonly requestId: string;
  readonly status: string;
  readonly copy: EvidenceSubmissionView;
  readonly scan: VersionScanEvidence | undefined;
}) {
  const t = getServerT(appAgencyCatalog);
  const waiting = copy.state === 'AWAITING_DECISION';
  const note = presentScanState(scan);
  const requestWords = REQ_STATUS[status];
  const copyPill = waiting ? (requestWords?.label ?? 'Received') : 'Accepted';
  return (
    <div className="evidence-copy lc-copy" data-copy-state={copy.state}>
      <div className="evidence-copy-head">
        <p className="evidence-copy-title u-m-0">
          {waiting
            ? t.node('appAgency.appAgencyOrgidEvidenceCopies.copyWaitingForYourDecision')
            : t.node('appAgency.appAgencyOrgidEvidenceCopies.acceptedCopy')}
        </p>
        {copyPill === requestWords?.label ? null : (
          <StatusPill tone={waiting ? 'info' : 'success'}>{copyPill}</StatusPill>
        )}
      </div>
      <div className="lc-copy-file">
        <span className="lift-action-tile" aria-hidden="true">
          <Icon name="file" size={20} />
        </span>
        <p className="evidence-copy-name lc-copy-name u-m-0">{copy.title}</p>
      </div>
      <CopyFacts copy={copy} />
      <Fingerprint copy={copy} />
      {note.recipientNote ? (
        <p
          className={`evidence-copy-scan lc-copy-scan u-m-0${note.warn ? ' evidence-copy-scan-warn' : ''}`}
        >
          {note.warn ? (
            <span className="lc-copy-scan-icon" aria-hidden="true">
              <Icon name="alert" size={16} />
            </span>
          ) : null}
          {note.recipientNote}
        </p>
      ) : null}
      {waiting ? (
        <p className="evidence-copy-meta u-m-0">
          {t.node('appAgency.appAgencyOrgidEvidenceCopies.receivedIsNotAccepted')}
        </p>
      ) : null}
      {copy.fileAvailable ? (
        <form action={downloadEvidenceCopyAction} className="evidence-copy-file">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="submissionId" value={copy.id} />
          <button type="submit" className="btn btn-secondary evidence-copy-button">
            {t.node('appAgency.appAgencyOrgidEvidenceCopies.downloadSentFile')}
            <span className="sr-only">: {copy.title}</span>
          </button>
          <AboutDisclosure summary={t('appAgency.appAgencyOrgidEvidenceCopies.aboutDownloading')}>
            <p className="evidence-copy-meta u-m-0">
              {t.node('appAgency.appAgencyOrgidEvidenceCopies.downloadsTheOriginalYouConfirmIt')}
            </p>
          </AboutDisclosure>
        </form>
      ) : (
        <>
          <p className="evidence-copy-meta u-m-0">
            {t.node('appAgency.appAgencyOrgidEvidenceCopies.cannotBeOpenedRightNow')}
          </p>
          <AboutDisclosure summary={t('appAgency.appAgencyOrgidEvidenceCopies.whyNot')}>
            <p className="evidence-copy-meta u-m-0">
              {t.node('appAgency.appAgencyOrgidEvidenceCopies.thisCopyCannotBeOpenedFrom')}
            </p>
          </AboutDisclosure>
        </>
      )}
    </div>
  );
}

/** A send made before exact copies were kept that is still waiting: shown plainly, with no file. */
function LegacyCurrent({ send }: { readonly send: LegacyEvidenceSend }) {
  const t = getServerT(appAgencyCatalog);
  return (
    <div className="evidence-copy lc-copy" data-copy-state="LEGACY_WAITING">
      <div className="evidence-copy-head">
        <p className="evidence-copy-title u-m-0">
          {t.node('appAgency.appAgencyOrgidEvidenceCopies.copyWaitingForYourDecision')}
        </p>
        <StatusPill tone="info">
          {t('appAgency.appAgencyOrgidEvidenceCopies.waitingForADecision')}
        </StatusPill>
      </div>
      <div className="lc-copy-file">
        <span className="lift-action-tile" aria-hidden="true">
          <Icon name="file" size={20} />
        </span>
        <p className="evidence-copy-name lc-copy-name u-m-0">{send.label}</p>
      </div>
      <p className="evidence-copy-meta u-m-0">
        {send.sentAt
          ? t.node('appAgency.appAgencyOrgidEvidenceCopies.sentFormatmoment', {
              formatMoment: formatMoment(send.sentAt, MOMENT_ZONE),
            })
          : t.node('appAgency.appAgencyOrgidEvidenceCopies.sendTimeNotKept')}
      </p>
      <p className="evidence-copy-meta u-m-0">
        {t.node('appAgency.appAgencyOrgidEvidenceCopies.receivedIsNotAccepted')}
      </p>
      <AboutDisclosure summary={t('appAgency.appAgencyOrgidEvidenceCopies.aboutThisSend')}>
        <p className="evidence-copy-meta u-m-0">
          {t.node('appAgency.appAgencyOrgidEvidenceCopies.thisSendHasNoExactCopy')}
        </p>
      </AboutDisclosure>
    </div>
  );
}

function EarlierSend({ copy }: { readonly copy: EvidenceSubmissionView }) {
  const t = getServerT(appAgencyCatalog);
  const words = STATE_WORDS[copy.state];
  return (
    <li className="evidence-earlier-item">
      <div className="evidence-copy-head">
        <span className="evidence-copy-name">
          {t.node('appAgency.appAgencyOrgidEvidenceCopies.sendRoundnoTitle', {
            roundNo: copy.roundNo,
            title: copy.title,
          })}
        </span>
        <StatusPill tone={words.tone}>{words.label}</StatusPill>
      </div>
      <p className="evidence-copy-meta u-m-0">
        {copy.docType ? `${humanizeCode(copy.docType)} · ` : ''}Sent{' '}
        {formatMoment(copy.sentAt, MOMENT_ZONE)}
        {copy.decidedAt ? ` · Decided ${formatMoment(copy.decidedAt, MOMENT_ZONE)}` : ''}
      </p>
      {copy.reason ? (
        <p className="evidence-copy-meta u-m-0">
          {t.node('appAgency.appAgencyOrgidEvidenceCopies.yourReasonShownToTheTraveller', {
            reason: copy.reason,
          })}
        </p>
      ) : null}
    </li>
  );
}

function LegacySend({ send }: { readonly send: LegacyEvidenceSend }) {
  const t = getServerT(appAgencyCatalog);
  const words = STATE_WORDS[send.state];
  return (
    <li className="evidence-earlier-item">
      <div className="evidence-copy-head">
        <span className="evidence-copy-name">{send.label}</span>
        <StatusPill tone={words.tone}>{words.label}</StatusPill>
      </div>
      <p className="evidence-copy-meta u-m-0">
        {send.sentAt
          ? t.node('appAgency.appAgencyOrgidEvidenceCopies.sentFormatmoment', {
              formatMoment: formatMoment(send.sentAt, MOMENT_ZONE),
            })
          : t.node('appAgency.appAgencyOrgidEvidenceCopies.sendTimeNotKept')}
        {send.decidedAt
          ? t.node('appAgency.appAgencyOrgidEvidenceCopies.decidedFormatmoment', {
              formatMoment: formatMoment(send.decidedAt, MOMENT_ZONE),
            })
          : ''}
      </p>
    </li>
  );
}

/**
 * Nothing for a request with nothing sent yet. `copies` is undefined when the sent copies could not
 * be read for this request; the card then says so instead of showing nothing.
 */
export function EvidenceCopies({
  organizationId,
  requestId,
  status,
  copies,
  fileUnavailable = false,
}: {
  readonly organizationId: string;
  readonly requestId: string;
  readonly status: string;
  readonly copies:
    | {
        readonly list: EvidenceSubmissionList;
        readonly scan: ReadonlyMap<string, VersionScanEvidence>;
      }
    | undefined;
  /** The address says a file could not be opened (the download sent the person back here). */
  readonly fileUnavailable?: boolean;
}) {
  const t = getServerT(appAgencyCatalog);
  const notice = fileUnavailable ? (
    <output className="evidence-copy-notice u-m-0">{FILE_UNAVAILABLE_NOTICE}</output>
  ) : null;
  if (!copies) {
    return (
      <div className="evidence-copies">
        {notice}
        <output className="evidence-copy-notice u-m-0">{COPIES_UNREAD_NOTICE}</output>
      </div>
    );
  }
  const { list, scan } = copies;
  const shown = shownCopy(list, status);
  const earlier = list.submissions.filter((s) => s.id !== shown?.id);
  const legacyWaiting =
    !shown && DECIDABLE.has(status)
      ? list.legacy.find((send) => send.state === 'AWAITING_DECISION')
      : undefined;
  const earlierLegacy = list.legacy.filter((send) => send !== legacyWaiting);
  const earlierCount = earlier.length + earlierLegacy.length;
  if (!shown && !legacyWaiting && earlierCount === 0 && list.available) return notice;
  return (
    <div className="evidence-copies">
      {notice}
      {shown ? (
        <CurrentCopy
          organizationId={organizationId}
          requestId={requestId}
          status={status}
          copy={shown}
          scan={scan.get(shown.documentVersionId)}
        />
      ) : null}
      {legacyWaiting ? <LegacyCurrent send={legacyWaiting} /> : null}
      {!list.available ? <p className="evidence-copy-notice u-m-0">{NOT_KEPT_NOTICE}</p> : null}
      {earlierCount > 0 ? (
        <details className="evidence-earlier">
          <summary className="evidence-earlier-toggle lc-earlier-toggle">
            {t.node('appAgency.appAgencyOrgidEvidenceCopies.earlierSendsEarliercount', {
              earlierCount,
            })}
          </summary>
          <ol className="evidence-earlier-list">
            {earlier.map((copy) => (
              <EarlierSend key={copy.id} copy={copy} />
            ))}
            {earlierLegacy.map((send) => (
              <LegacySend
                key={`legacy-${send.state}-${send.sentAt?.getTime() ?? 0}-${send.decidedAt?.getTime() ?? 0}`}
                send={send}
              />
            ))}
          </ol>
        </details>
      ) : null}
    </div>
  );
}
