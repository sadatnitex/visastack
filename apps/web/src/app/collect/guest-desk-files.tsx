import type {
  CollectionReviewDecision,
  GuestChecklistItem,
  GuestFileView,
  GuestUploadDesk,
} from '@visastack/services';
import { collectCatalog } from '../../i18n/collect';
import { formatTimestampDate } from '../../lib/format-date';
import { formatFileSize } from '../../lib/format-size';
import { getServerT } from '../../lib/i18n-server';
import { Fold } from './fold';
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
 * suggestion from its name is marked as one until the guest saves it). What each item still
 * lacks is shown on the checklist itself. Server-rendered from the guest's own request-scoped
 * rows only.
 */
export function GuestFileList({
  desk,
  items,
}: {
  readonly desk: GuestUploadDesk;
  readonly items: readonly GuestChecklistItem[];
}) {
  const t = getServerT(collectCatalog);
  const labels = new Map(items.map((item) => [item.id, item.label] as const));
  const options = items.map((item) => ({ id: item.id, label: item.label }));
  if (desk.files.length === 0) return null;
  // A file that is ready, on the list and confirmed by the guest needs nothing; the rest stay in
  // view. The confirmed ones fold away behind a count, one tap from their Change Item and Remove.
  const settled = desk.files.filter(
    (f) => f.status === 'ready' && f.itemId !== null && f.mapping === 'chosen',
  );
  const attention = desk.files.filter((f) => !settled.includes(f));
  const fileList = (files: readonly GuestFileView[]) => (
    <ul className="collect-file-list">
      {files.map((file) => (
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
            {file.sent ? t('collect.collectGuestDeskFiles.alreadySent') : ''}
          </p>
          <div className="collect-file-actions">
            {file.status === 'ready' ? (
              file.itemId === null || file.mapping === 'proposed' ? (
                <div className="collect-file-change collect-file-choose">
                  <PlaceFileForm
                    fileId={file.id}
                    fileName={file.name}
                    itemId={file.itemId}
                    items={options}
                  />
                </div>
              ) : (
                <details className="collect-file-change">
                  <summary>{t('collect.collectGuestDeskFiles.changeItem')}</summary>
                  <PlaceFileForm
                    fileId={file.id}
                    fileName={file.name}
                    itemId={file.itemId}
                    items={options}
                  />
                </details>
              )
            ) : null}
            {file.status !== 'checking' ? (
              <RemoveFileForm fileId={file.id} fileName={file.name} />
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
  // With nothing needing the guest, the fold is the section: one heading, one line, one tap.
  if (attention.length === 0) {
    return (
      <section className="collect-files" aria-labelledby="collect-files-title">
        <Fold
          title={t('collect.collectGuestDeskFiles.yourFiles')}
          headingId="collect-files-title"
          status={`${settled.length} ${settled.length === 1 ? 'file' : 'files'}, all placed`}
          open={false}
        >
          {fileList(settled)}
        </Fold>
      </section>
    );
  }
  return (
    <section className="collect-files" aria-labelledby="collect-files-title">
      <h2 id="collect-files-title" className="collect-step-title">
        {t('collect.collectGuestDeskFiles.yourFiles')}
      </h2>
      {fileList(attention)}
      {settled.length > 0 ? (
        <Fold
          title={t('collect.collectGuestDeskFiles.filesAlreadyPlaced')}
          status={`${settled.length} ${settled.length === 1 ? 'file' : 'files'}`}
          open={false}
        >
          {fileList(settled)}
        </Fold>
      ) : null}
    </section>
  );
}

/** Everything the guest sent before, with the agency's decision and notes (never "Reviewed"). */
export function GuestSentHistory({ desk }: { readonly desk: GuestUploadDesk }) {
  const t = getServerT(collectCatalog);
  if (desk.submissions.length === 0) return null;
  return (
    <section className="collect-sent" aria-labelledby="collect-sent-title">
      <h2 id="collect-sent-title" className="collect-step-title">
        {t('collect.collectGuestDeskFiles.whatYouSent')}
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
                    {line.missing
                      ? t('collect.collectAccountResponseForm.stillMissing')
                      : line.files.join(', ')}
                  </span>
                  {line.note ? (
                    <span className="collect-item-note u-fs-085">
                      {t('collect.collectGuestDeskFiles.agencyNoteNote', { note: line.note })}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}
