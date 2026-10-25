import type { ChangesSinceConfirmed } from '@visastack/services';
import Link from 'next/link';
import {
  changeLine,
  comparableVersionId,
  compareHref,
  memoryHref,
} from '../../../../lib/application-memory-labels';
import { formatTimestampDate } from '../../../../lib/format-date';

/** At most this many changes are listed in the alert; the full list is one link away. */
export const ALERT_CHANGE_LIMIT = 8;

/**
 * WP-V3 part 3: the changed-fields list inside the WP-X1 changed-case alert.
 * Names what changed since the applicant last confirmed the case (details,
 * documents and case fields) and never a value, so it is safe in an alert.
 * A changed detail links to the then-and-now view.
 */
export function ChangesSinceConfirmedList({
  applicantId,
  changes,
}: {
  readonly applicantId: string;
  /** Null when the list could not be read; the alert still shows. */
  readonly changes: ChangesSinceConfirmed | null;
}) {
  if (!changes) {
    return (
      <p className="case-changes-note">
        <Link href={memoryHref(applicantId)}>Open Application Memory</Link> to see what you
        confirmed before.
      </p>
    );
  }
  const { snapshot } = changes;
  const heading = `What changed since you confirmed snapshot ${snapshot.version} on ${formatTimestampDate(changes.confirmedAt)}`;
  if (!snapshot.exact) {
    return (
      <div className="case-changes">
        <p className="case-changes-title">{heading}</p>
        <p className="case-changes-note">
          This older snapshot did not record exact versions, so the changes cannot be listed. Open
          the snapshots to compare them.
        </p>
      </div>
    );
  }
  const shown = changes.changes.slice(0, ALERT_CHANGE_LIMIT);
  const more = changes.changes.length - shown.length;
  return (
    <div className="case-changes">
      <p className="case-changes-title">{heading}</p>
      {shown.length === 0 ? (
        <p className="case-changes-note">
          No detail, document or case date differs from that snapshot. The change may be a different
          choice of evidence; open the snapshots to compare.
        </p>
      ) : (
        <ul className="case-changes-list">
          {shown.map((change) => {
            const line = changeLine(change);
            const versionId = comparableVersionId(change);
            const key =
              change.kind === 'detail'
                ? `detail-${change.factId}`
                : change.kind === 'document'
                  ? `document-${change.documentId}`
                  : `case-${change.caseField}`;
            return (
              <li key={key}>
                <span className="case-change-text">
                  <span className="case-change-name">{line.name}</span>: {line.what}
                </span>
                {versionId ? (
                  <Link
                    className="case-change-link"
                    href={compareHref(applicantId, snapshot.id, versionId)}
                    aria-label={`Compare ${line.name}, then and now`}
                  >
                    Compare
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <Link className="case-changes-all" href={compareHref(applicantId, snapshot.id)}>
        {more > 0 ? `See All ${changes.changes.length} Changes` : 'See What Changed'}
      </Link>
    </div>
  );
}
