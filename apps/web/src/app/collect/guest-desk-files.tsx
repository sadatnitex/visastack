import { NECESSITY_LABELS } from '@visastack/core';
import type {
  CollectionReviewDecision,
  GuestChecklistItem,
  GuestFileView,
  GuestUploadDesk,
} from '@visastack/services';
import { formatTimestampDate } from '../../lib/format-date';
import { formatFileSize } from '../../lib/format-size';
import { PlaceFileForm, RemoveFileForm } from './guest-files';

/** The agency's decision in plain words. Received is never Reviewed or Accepted. */
export const DECISION_LABELS: Readonly<Record<CollectionReviewDecision, string>> = {
  RECEIVED: 'Received',
  NEEDS_CORRECTION: 'Needs Correction',
  ACCEPTED: 'Accepted',
};

function fileLine(file: GuestFileView): string {
  if (file.status === 'checking') return 'Being checked.';
  if (file.status === 'refused') return 'Did not pass the safety checks. It was not kept.';
  if (file.status === 'stalled')
    return 'This file did not finish uploading. Remove it, then add it again.';
  const checked = file.virusScanned
    ? 'Checked for viruses.'
    : 'File checked. Not scanned for viruses.';
  if (!file.itemId) return `${checked} Choose which item it is for.`;
  return file.mapping === 'proposed' ? `${checked} Suggested from its name: check it.` : checked;
}

/**
 * The guest's files on the desk (UMPE P9): each with its state and the item it answers (a
 * suggestion from its name is marked as one until the guest saves it), what is still missing, and
 * everything they sent before with the agency's decision and notes. Server-rendered from the
 * guest's own request-scoped rows only.
 */
export function GuestDeskFiles({
  desk,
  items,
}: {
  readonly desk: GuestUploadDesk;
  readonly items: readonly GuestChecklistItem[];
}) {
  const labels = new Map(items.map((item) => [item.id, item.label] as const));
  const options = items.map((item) => ({ id: item.id, label: item.label }));
  const missing = items.filter((item) => desk.stillMissing.includes(item.id));
  return (
    <>
      <section className="collect-files" aria-labelledby="collect-files-title">
        <h2 id="collect-files-title" className="collect-step-title">
          Your Files
        </h2>
        {desk.files.length === 0 ? (
          <p className="muted">No files added yet.</p>
        ) : (
          <ul className="collect-file-list">
            {desk.files.map((file) => (
              <li key={file.id} className="collect-file">
                <p className="collect-file-name">
                  <strong>{file.name}</strong>{' '}
                  <span className="muted u-fs-085">{formatFileSize(file.sizeBytes)}</span>
                </p>
                <p className="muted u-fs-085">
                  {fileLine(file)}
                  {file.itemId && file.status === 'ready'
                    ? ` For: ${labels.get(file.itemId) ?? 'An Earlier Item'}.`
                    : ''}
                  {file.sent ? ' Already sent.' : ''}
                </p>
                <div className="collect-file-actions">
                  {file.status === 'ready' ? (
                    <PlaceFileForm
                      fileId={file.id}
                      fileName={file.name}
                      itemId={file.itemId}
                      items={options}
                    />
                  ) : null}
                  {file.status !== 'checking' ? (
                    <RemoveFileForm fileId={file.id} fileName={file.name} />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="collect-missing" aria-labelledby="collect-missing-title">
        <h2 id="collect-missing-title" className="collect-step-title">
          Still Missing
        </h2>
        {missing.length === 0 ? (
          <p>Every item on the checklist has a file.</p>
        ) : (
          <ul className="collect-items">
            {missing.map((item) => (
              <li key={item.id} className="collect-item">
                <span className="collect-item-label">{item.label}</span>
                <span className="collect-item-meta muted u-fs-085">
                  {NECESSITY_LABELS[item.necessity]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {desk.submissions.length > 0 ? (
        <section className="collect-sent" aria-labelledby="collect-sent-title">
          <h2 id="collect-sent-title" className="collect-step-title">
            What You Sent
          </h2>
          <ol className="collect-sent-list">
            {desk.submissions.map((submission) => (
              <li key={submission.id} className="collect-sent-entry">
                <p>
                  <strong>Sent {formatTimestampDate(submission.submittedAt)}</strong> ·{' '}
                  {submission.decision
                    ? DECISION_LABELS[submission.decision]
                    : 'Submitted to Agency, Not Reviewed Yet'}
                </p>
                {submission.decisionNote ? (
                  <p className="collect-notice">{submission.decisionNote}</p>
                ) : null}
                <ul className="collect-items">
                  {submission.lines.map((line) => (
                    <li key={line.itemId} className="collect-item">
                      <span className="collect-item-label">{line.label}</span>
                      <span className="muted u-fs-085">
                        {line.missing ? 'Still Missing' : line.files.join(', ')}
                      </span>
                      {line.note ? (
                        <span className="collect-item-note u-fs-085">Agency note: {line.note}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </>
  );
}
