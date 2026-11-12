import type { AnswerReceiptLine, EvidenceAnswerReceipt } from '@visastack/services';
import { ReferenceCode } from '../../../../../../components/reference-code';
import { StatusPill } from '../../../../../../components/ui-lift';
import { evidenceAnswerCatalog } from '../../../../../../i18n/evidence-answer';
import { getServerT } from '../../../../../../lib/i18n-server';
import { formatMoment } from '../../../../../../lib/save-status';

type StateWords = {
  readonly key:
    | 'evidenceAnswer.receipt.stateWaiting'
    | 'evidenceAnswer.receipt.stateAccepted'
    | 'evidenceAnswer.receipt.stateSentBack'
    | 'evidenceAnswer.receipt.stateClosed';
  readonly tone: 'info' | 'success' | 'warning' | 'neutral';
};

/**
 * Where a sent copy stands now. Received is blue and never green, and is never worded as accepted
 * or reviewed: only the agency's own decision says Accepted.
 */
const STATES: Readonly<Record<AnswerReceiptLine['state'], StateWords>> = {
  WAITING_FOR_REVIEW: { key: 'evidenceAnswer.receipt.stateWaiting', tone: 'info' },
  ACCEPTED: { key: 'evidenceAnswer.receipt.stateAccepted', tone: 'success' },
  SENT_BACK: { key: 'evidenceAnswer.receipt.stateSentBack', tone: 'warning' },
  CLOSED: { key: 'evidenceAnswer.receipt.stateClosed', tone: 'neutral' },
};

/**
 * What one confirmation sent, read back from the saved records: the exact copies that went to the
 * agency, each with the name it had when it was sent, its version, a short fingerprint of the file,
 * the time in the traveller's own zone, the request's reference and where it stands now. It states
 * only what is on record; the same address shows it again on a later visit.
 */
export function AnswersSent({
  receipt,
  timeZone,
}: {
  readonly receipt: EvidenceAnswerReceipt;
  readonly timeZone: string;
}) {
  const t = getServerT(evidenceAnswerCatalog);
  if (receipt.lines.length === 0) return null;
  return (
    <article className="card answers-sent" aria-labelledby="answers-sent-title">
      <h2 className="card-title" id="answers-sent-title">
        {t.node('evidenceAnswer.receipt.title')}
      </h2>
      <output className="answers-sent-summary">
        {t.node('evidenceAnswer.receipt.summary', {
          count: receipt.lines.length,
          agency: receipt.organizationName,
        })}
      </output>
      <ul className="answers-sent-list">
        {receipt.lines.map((line) => {
          const sentAt = formatMoment(line.sentAt, timeZone);
          const state = STATES[line.state];
          return (
            <li key={line.submissionId} className="answers-sent-line">
              <span className="row-key" data-value>
                {line.title}
              </span>
              <span className="evidence-pick-meta" data-value>
                {line.checksumFingerprint
                  ? t.node('evidenceAnswer.receipt.factsWithFingerprint', {
                      number: line.versionNumber,
                      fingerprint: line.checksumFingerprint,
                      sentAt,
                    })
                  : t.node('evidenceAnswer.receipt.facts', {
                      number: line.versionNumber,
                      sentAt,
                    })}
              </span>
              {line.referenceCode ? (
                <span data-value>
                  <ReferenceCode
                    code={line.referenceCode}
                    label={t('evidenceAnswer.receipt.reference')}
                  />
                </span>
              ) : null}
              <StatusPill tone={state.tone}>{t(state.key)}</StatusPill>
            </li>
          );
        })}
      </ul>
    </article>
  );
}
