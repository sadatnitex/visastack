import { ActivityLog, type ActivityLogEntry } from '../../../../../components/activity-log';

/** The id the log lands on after Show Older Entries or Show Newest Entries. */
export const HISTORY_LOG_ID = 'profile-history-log';

/**
 * The Profile History card (WP-SB1): a choice of profile part, sent to the server, above the log
 * of saved versions, which keeps its fixed height and filters what is loaded.
 */
export function HistoryLog({
  pathname,
  parts,
  section,
  partLabel,
  entries,
  total,
  olderHref,
  newestHref,
}: {
  readonly pathname: string;
  readonly parts: readonly { readonly key: string; readonly label: string }[];
  /** The part chosen now, if any. */
  readonly section: string | undefined;
  readonly partLabel: string | undefined;
  readonly entries: readonly ActivityLogEntry[];
  /** Every saved version that matches, across all pages. */
  readonly total: number;
  readonly olderHref?: string;
  readonly newestHref?: string;
}) {
  return (
    <article className="card">
      <form className="history-part-form" method="get" action={pathname}>
        <label className="history-part-field" htmlFor="history-part">
          <span className="field-label">Part of the Profile</span>
          <select id="history-part" name="section" className="input" defaultValue={section ?? ''}>
            <option value="">Every Part</option>
            {parts.map((part) => (
              <option key={part.key} value={part.key}>
                {part.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-secondary u-btn-sm">
          Show This Part
        </button>
      </form>
      {entries.length === 0 ? (
        <p className="muted">
          Nothing has been saved in {partLabel ?? 'this part of the profile'} yet.
        </p>
      ) : (
        <ActivityLog
          id={HISTORY_LOG_ID}
          label="Profile History Entries"
          entries={entries}
          totalLabel={`${total.toLocaleString('en-US')} saved ${total === 1 ? 'version' : 'versions'} in all${partLabel ? ` in ${partLabel}` : ''}.`}
          {...(olderHref ? { olderHref } : {})}
          {...(newestHref ? { newestHref } : {})}
        />
      )}
    </article>
  );
}
