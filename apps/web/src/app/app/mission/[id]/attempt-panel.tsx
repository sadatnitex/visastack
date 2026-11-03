import {
  type AttemptView,
  MAX_REQUESTED_DOC_TYPES,
  type OutcomeAttemptsView,
} from '@visastack/services';
import { formatDateOnly } from '../../../../lib/format-date';
import {
  type AttemptChoice,
  AttemptEventForm,
  RecordAttemptForm,
  TrackReportForm,
} from './attempt-forms';
import {
  ATTEMPT_CHANNEL_LABELS,
  ATTEMPT_DECISION_LABELS,
  ATTEMPT_DECISION_TONES,
  ATTEMPT_EVENT_LABELS,
  AUTHORITY_SOURCE_LABELS,
  basisLabel,
} from './attempt-labels';

/**
 * UMPE P12: Application Attempts. Each time this application went to an authority is its own
 * attempt with the exact package that was ready then, and what followed it. A person's own record
 * stays "Reported by You"; an attached document says so. Nothing here is ever "confirmed" or
 * "verified", and nothing predicts a decision.
 */

function packageLine(attempt: AttemptView): string {
  if (attempt.binding === 'PACKAGE_HANDOFF') {
    const name = attempt.packName
      ? `${attempt.packName}${attempt.packVersion ? `, Version ${attempt.packVersion}` : ''}`
      : 'Package';
    return `Prepared Package: ${name} (${attempt.selectedDocuments} documents, ${attempt.selectedDetails} details)`;
  }
  if (attempt.binding === 'SNAPSHOT_ONLY') {
    return `Prepared Snapshot (${attempt.selectedDocuments} documents, ${attempt.selectedDetails} details)`;
  }
  return 'No Prepared Package on Record';
}

function receiptLine(attempt: AttemptView): string {
  if (attempt.receipt === 'DOCUMENT_SUPPLIED') return 'Receipt: Document Attached';
  if (attempt.receipt === 'REPORTED') return 'Receipt: Reported by You';
  return 'Receipt: Not Recorded';
}

export function AttemptPanel({
  missionId,
  view,
  today,
  documentKinds,
}: {
  readonly missionId: string;
  readonly view: OutcomeAttemptsView;
  readonly today: string;
  readonly documentKinds: readonly AttemptChoice[];
}) {
  const evidenceChoices: AttemptChoice[] = view.evidenceChoices.map((c) => ({
    value: c.versionId,
    label: c.label,
  }));
  const canAdd = view.attempts.length > 0 || view.untrackedReports.length > 0;
  return (
    <article className="card attempt-panel" aria-labelledby="attempts-title">
      <p className="card-kicker">After Submission</p>
      <h2 className="card-title" id="attempts-title">
        Application Attempts
      </h2>
      <p className="card-body u-mb-100">
        Each time this application goes to an embassy, consulate or visa centre is its own attempt,
        with the package that was ready then. What you record stays your own report unless you
        attach a document. VisaStack does not see or check what an authority does.
      </p>
      {!view.available ? (
        <p className="card-body">Attempts can be recorded here soon.</p>
      ) : (
        <>
          {view.untrackedReports.length > 0 ? (
            <div className="rows u-mb-125">
              {view.untrackedReports.map((r) => {
                const name = `Submission Reported on ${formatDateOnly(r.submittedOn)}`;
                return (
                  <div className="row attempt-row" key={r.id}>
                    <span className="row-key">{name}</span>
                    <TrackReportForm
                      missionId={missionId}
                      missionSubmissionId={r.id}
                      reportName={name}
                    />
                  </div>
                );
              })}
            </div>
          ) : null}
          {view.attempts.length === 0 && view.untrackedReports.length === 0 ? (
            <p className="card-body">
              Nothing recorded yet. Report the submission of this case first; it becomes Attempt 1.
            </p>
          ) : null}
          <ol className="attempt-list">
            {view.attempts.map((attempt) => (
              <li className="attempt-item" key={attempt.id}>
                <div className="attempt-head">
                  <h3 className="attempt-title">Attempt {attempt.attemptNo}</h3>
                  {attempt.standing.kind === 'DECIDED' ? (
                    <span
                      className={`badge ${ATTEMPT_DECISION_TONES[attempt.standing.decision] ?? 'badge-neutral'}`}
                    >
                      {ATTEMPT_DECISION_LABELS[attempt.standing.decision] ?? 'Other Decision'}
                    </span>
                  ) : (
                    <span className="badge badge-neutral">No Decision Recorded</span>
                  )}
                </div>
                <p className="muted attempt-meta">
                  Sent {formatDateOnly(attempt.submittedOn)} by{' '}
                  {ATTEMPT_CHANNEL_LABELS[attempt.channel] ?? 'Other Way'}.{' '}
                  {basisLabel(attempt.documentSupplied)}.
                </p>
                <p className="muted attempt-meta">{packageLine(attempt)}</p>
                <p className="muted attempt-meta">{receiptLine(attempt)}</p>
                {attempt.standing.kind === 'DECIDED' ? (
                  <p className="muted attempt-meta">
                    Decision on {formatDateOnly(attempt.standing.occurredOn)}:{' '}
                    {basisLabel(attempt.standing.documentSupplied)}.
                  </p>
                ) : null}
                {attempt.events.length > 0 ? (
                  <ul className="attempt-events">
                    {attempt.events.map((event) => (
                      <li key={event.id}>
                        <span className="row-key">{formatDateOnly(event.occurredOn)}</span>{' '}
                        {event.kind === 'DECISION'
                          ? (ATTEMPT_DECISION_LABELS[event.decision ?? ''] ?? 'Decision')
                          : ATTEMPT_EVENT_LABELS[event.kind]}
                        {event.kind === 'AUTHORITY_REQUEST' ? (
                          <>
                            {' '}
                            (
                            {AUTHORITY_SOURCE_LABELS[event.requestSource ?? ''] ??
                              'Official Office'}
                            ):{' '}
                            {event.requestedDocTypes
                              .map((k) => documentKinds.find((d) => d.value === k)?.label ?? k)
                              .join(', ')}
                          </>
                        ) : null}{' '}
                        <span className="muted">{basisLabel(event.documentSupplied)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <details className="attempt-details">
                  <summary>Add What Happened</summary>
                  <AttemptEventForm
                    missionId={missionId}
                    attemptId={attempt.id}
                    attemptNo={attempt.attemptNo}
                    today={today}
                    evidenceChoices={evidenceChoices}
                    documentKinds={documentKinds}
                    maxKinds={MAX_REQUESTED_DOC_TYPES}
                  />
                </details>
              </li>
            ))}
          </ol>
          {canAdd ? (
            <details className="attempt-details u-mt-100">
              <summary>Record Another Attempt</summary>
              <p className="card-body">
                For a resubmission, a new application after a refusal, or the same package sent to a
                second office.
              </p>
              <RecordAttemptForm
                missionId={missionId}
                today={today}
                evidenceChoices={evidenceChoices}
              />
            </details>
          ) : null}
        </>
      )}
    </article>
  );
}
