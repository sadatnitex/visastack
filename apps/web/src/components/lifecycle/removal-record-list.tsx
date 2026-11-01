import { formatTimestampDate } from '../../lib/format-date';
import { documentTypeLabel } from '../../lib/labels';

/** What the list needs from one Removal Record (a `DeletionReceiptView` from the services). */
export interface RemovalRecordRow {
  readonly id: string;
  readonly subjectKind: 'DOCUMENT' | 'TRAVELLER';
  readonly subjectCode: string;
  readonly documentKind: string | null;
  readonly scheduledFor: Date | string | null;
  readonly verifiedGoneAt: Date | string | null;
  readonly requestedAt: Date | string;
  readonly status: 'SCHEDULED' | 'RESTORED' | 'REMOVING' | 'REMOVED' | 'BLOCKED';
  readonly effects: {
    readonly casesSwitched?: readonly string[] | undefined;
    readonly casesFlagged?: readonly string[] | undefined;
  };
}

/** Status words (docs/uiux/ccd/VOCABULARY.md). */
export const REMOVAL_STATUS_LABELS: Readonly<Record<RemovalRecordRow['status'], string>> = {
  SCHEDULED: 'Scheduled',
  RESTORED: 'Restored',
  REMOVING: 'Removing Securely',
  REMOVED: 'Removed',
  BLOCKED: 'Kept (Legal Requirement)',
};

/** Rows shown before Show More (WP-SB section 1: 10 rows for travellers). */
export const REMOVAL_RECORDS_FIRST_ROWS = 10;

const DAY_MS = 86_400_000;

function shortDate(value: Date | string): string {
  // "3 Nov": the year is added only when it is not this year.
  const date = new Date(value);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return sameYear
    ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : formatTimestampDate(date);
}

/** One record as a sentence: "Removed on 3 Nov: Passport D-7K2Q9M. Used in 2 cases." */
export function removalRecordSentence(row: RemovalRecordRow, now: Date = new Date()): string {
  const what =
    row.subjectKind === 'TRAVELLER'
      ? `Traveller record ${row.subjectCode}`
      : `${row.documentKind ? documentTypeLabel(row.documentKind) : 'Document'} ${row.subjectCode}`;
  const cases = new Set([...(row.effects.casesSwitched ?? []), ...(row.effects.casesFlagged ?? [])])
    .size;
  const used = cases > 0 ? ` Used in ${cases} ${cases === 1 ? 'case' : 'cases'}.` : '';
  let lead: string;
  if (row.status === 'REMOVED') {
    lead = `Removed on ${shortDate(row.verifiedGoneAt ?? row.requestedAt)}`;
  } else if (row.status === 'SCHEDULED' && row.scheduledFor) {
    const days = Math.max(
      0,
      Math.ceil((new Date(row.scheduledFor).getTime() - now.getTime()) / DAY_MS),
    );
    lead = days === 1 ? 'Removed in 1 Day' : `Removed in ${days} Days`;
  } else {
    lead = REMOVAL_STATUS_LABELS[row.status];
  }
  return `${lead}: ${what}.${used}`;
}

function RecordItem({ row, now }: { readonly row: RemovalRecordRow; readonly now: Date }) {
  return (
    <li className="lc-record">
      <span className="lc-record-status">{REMOVAL_STATUS_LABELS[row.status]}</span>
      <span>{removalRecordSentence(row, now)}</span>
    </li>
  );
}

/**
 * A traveller's Removal Records: reference codes, kinds, dates and counts only, never a name or
 * a title. The first ten show; the rest open with Show More.
 */
export function RemovalRecordList({
  records,
  now = new Date(),
}: {
  readonly records: readonly RemovalRecordRow[];
  readonly now?: Date;
}) {
  if (records.length === 0) {
    return <p className="muted">Nothing has been removed from this record.</p>;
  }
  const first = records.slice(0, REMOVAL_RECORDS_FIRST_ROWS);
  const rest = records.slice(REMOVAL_RECORDS_FIRST_ROWS);
  return (
    <div className="lc-records">
      <ul className="lc-record-list">
        {first.map((row) => (
          <RecordItem key={row.id} row={row} now={now} />
        ))}
      </ul>
      {rest.length > 0 ? (
        <details className="lc-records-more">
          <summary>Show More ({rest.length})</summary>
          <ul className="lc-record-list">
            {rest.map((row) => (
              <RecordItem key={row.id} row={row} now={now} />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
