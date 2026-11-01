import { CALENDAR_KINDS, type CalendarKind } from '@visastack/core/calendar';
import { CollapsibleGroup } from '../../../../../components/collapsible-group';
import { CalendarSelectAll } from './calendar-select-all';

/** One date to choose, already in words (the page words it from the server's own item). */
export interface CalendarDateRow {
  readonly key: string;
  readonly kind: CalendarKind;
  /** When it happens, for example "Tue 3 Nov 2026, all day". */
  readonly when: string;
  readonly caseTitle: string | null;
}

/** One event of the preview, already in words. */
export interface CalendarPreviewRow {
  readonly key: string;
  readonly title: string;
  readonly when: string;
}

/** The name of each group of dates on the page, in the order the groups are shown. */
export const CALENDAR_GROUP_TITLES: Readonly<Record<CalendarKind, string>> = {
  appointment: 'Appointments',
  task_due: 'Tasks Due',
  request_due: 'Requests Due',
  document_expires: 'Document Expiry Dates',
};
const GROUP_ORDER = Object.keys(CALENDAR_GROUP_TITLES) as CalendarKind[];

/**
 * The dates to choose from, grouped by kind (WP-SB4): each group opens and closes, says how many
 * dates it holds, and has Select All once scripts run. A group with a ticked date starts open;
 * with nothing ticked, the first group does. Each date keeps its place in the whole list, so its
 * box id is the same as before grouping. Every box is sent whether its group is open or not.
 */
export function CalendarDateGroups({
  items,
  chosen,
  fieldName = 'key',
}: {
  readonly items: readonly CalendarDateRow[];
  readonly chosen: ReadonlySet<string>;
  /** The form field each date box sends its key in. */
  readonly fieldName?: string;
}) {
  const groups = GROUP_ORDER.map((kind) => ({
    kind,
    dates: items.flatMap((item, index) => (item.kind === kind ? [{ item, index }] : [])),
  })).filter((group) => group.dates.length > 0);
  const anyChosen = items.some((item) => chosen.has(item.key));
  return (
    <div className="collapsible-groups">
      {groups.map((group, groupIndex) => {
        const open = anyChosen
          ? group.dates.some(({ item }) => chosen.has(item.key))
          : groupIndex === 0;
        return (
          <div key={group.kind} className="calendar-group">
            <CollapsibleGroup
              id={`calendar-group-${group.kind}`}
              title={CALENDAR_GROUP_TITLES[group.kind]}
              count={group.dates.length}
              noun={{ one: 'date', other: 'dates' }}
              open={open}
            >
              <CalendarSelectAll
                id={`calendar-all-${group.kind}`}
                groupLabel={CALENDAR_GROUP_TITLES[group.kind]}
              />
              <ul className="calendar-dates">
                {group.dates.map(({ item, index }) => {
                  const inputId = `calendar-date-${index}`;
                  return (
                    <li key={item.key}>
                      <label className="check calendar-date" htmlFor={inputId}>
                        <input
                          id={inputId}
                          type="checkbox"
                          name={fieldName}
                          value={item.key}
                          data-calendar-date="1"
                          defaultChecked={chosen.has(item.key)}
                        />
                        <span className="calendar-date-text">
                          <span className="calendar-date-title">
                            {CALENDAR_KINDS[item.kind].title}
                          </span>
                          <span className="calendar-date-when">
                            {item.when}
                            {item.caseTitle ? ` · ${item.caseTitle}` : ''}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </CollapsibleGroup>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The events the file will hold, in a fixed panel that scrolls inside (WP-SB4), so a long preview
 * keeps Download close. The panel takes keyboard focus, so it can be scrolled without a mouse.
 */
export function CalendarPreviewPanel({
  events,
}: { readonly events: readonly CalendarPreviewRow[] }) {
  return (
    <section
      className="activity-log-scroll calendar-preview-scroll"
      aria-label="Events in the File"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling box must take focus so the keyboard can scroll it
      tabIndex={0}
    >
      <ol className="calendar-preview-list">
        {events.map((event) => (
          <li key={event.key} className="calendar-preview-item">
            <span className="calendar-preview-title">{event.title}</span>
            <span className="calendar-preview-when">{event.when}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
