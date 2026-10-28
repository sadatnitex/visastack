import {
  CALENDAR_KINDS,
  CALENDAR_OPTION_FIELDS,
  calendarOptionFields,
  parseCalendarExportOptions,
} from '@visastack/core/calendar';
import { CALENDAR_PAST_DAYS, CALENDAR_SOURCE_LIMIT } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EmptyState, PageHeader } from '../../../../../components/ui';
import {
  CALENDAR_EXPORT_LIMIT,
  describeCalendarItem,
  describeCalendarStart,
  selectCalendarEvents,
} from '../../../../../lib/ics';
import { CALENDAR_REMINDER_LABELS, CALENDAR_REMINDER_ORDER } from '../../../../../lib/labels';
import { plural } from '../../../../../lib/plural';
import { formatMoment } from '../../../../../lib/save-status';
import { CalendarFeedPanel, type CalendarFeedPanelStatus } from './calendar-feed-panel';
import { CALENDAR_KEY_FIELD, loadCalendarDates, readCalendarKeys } from './load';

export const metadata: Metadata = { title: 'Add Dates to My Calendar' };

export const dynamic = 'force-dynamic';

/** What the page reads from its address: chosen keys and options, never a title or a date. */
type CalendarQuery = {
  readonly key?: string | string[];
  readonly titles?: string | string[];
  readonly remind?: string | string[];
  readonly kind?: string | string[];
  readonly v?: string | string[];
  readonly preview?: string | string[];
  readonly error?: string | string[];
};

const REMINDER_CHOICES = CALENDAR_REMINDER_ORDER.map(
  (value) => [value, CALENDAR_REMINDER_LABELS[value]] as const,
);

/**
 * Calendar export (v1.2 B05): the traveller picks dated items and choices, sees a preview of
 * exactly the titles, dates and reminder the file will hold, then downloads one calendar file.
 * Plain forms, so no script is needed: the preview is a GET to this page, the download a POST to
 * the route. Owner-only through the access gate; anyone else sees "not found". Every title and
 * date shown is rebuilt from the server's own items; only keys and options come from the address.
 */
export default async function CalendarExportPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<CalendarQuery>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const loaded = await loadCalendarDates(id);
  if (loaded.state === 'denied') notFound();
  const { feed } = loaded;
  // When the current link was made, in the traveller's own time zone.
  const feedStatus: CalendarFeedPanelStatus =
    feed.state === 'on'
      ? { state: 'on', linkMadeOn: formatMoment(feed.linkMadeAt, loaded.timeZone) }
      : { state: feed.state };
  const subscribe = <CalendarFeedPanel applicantId={id} status={feedStatus} />;

  const pageHref = `/app/applicant/${id}/calendar`;
  const header = (
    <PageHeader
      as="h2"
      eyebrow="Calendar"
      title="Add Dates to My Calendar"
      description="Choose the dates you want, check the preview, then download one file to open in your calendar app."
      back={{ href: '/app', label: 'Home' }}
    />
  );
  const notes = (
    <div className="notice notice-stack u-mb-150">
      <p className="u-m-0">
        This is a one-time copy. If a date changes later, your calendar will not update; download a
        new file. Calendar apps that support updates replace the dates you added before; others may
        add them again.
      </p>
      <p className="u-m-0">
        Dates without a time are added as all-day events. Titles are general, such as &quot;Task
        Due&quot;, unless you choose to add case names. Dates more than {CALENDAR_PAST_DAYS} days
        ago are not listed.
      </p>
    </div>
  );
  if (loaded.state === 'failed') {
    return (
      <>
        {header}
        <p role="alert" className="notice notice-warn">
          We could not load your dates just now. Refresh to try again.
        </p>
        {subscribe}
      </>
    );
  }

  const { items, truncated } = loaded.dates;
  const keys = readCalendarKeys(query);
  const chosen = new Set(keys);
  const options = parseCalendarExportOptions(query);
  const wantsPreview = query.preview === '1';
  const preview = wantsPreview ? selectCalendarEvents(items, keys, options) : null;
  const nothingChosen =
    (preview !== null && preview.events.length === 0) || query.error === 'nothing';
  const failed = query.error === 'failed';
  // The page offers one reminder; the options allow more, and the preview names each.
  const reminder = String(options.alarms[0] ?? '');
  const reminderWords =
    options.alarms.length === 0
      ? 'none'
      : options.alarms
          .map((minutes) =>
            (
              CALENDAR_REMINDER_LABELS[String(minutes) as keyof typeof CALENDAR_REMINDER_LABELS] ??
              `${minutes} minutes before`
            ).toLowerCase(),
          )
          .join(' and ');

  if (items.length === 0) {
    return (
      <>
        {header}
        {notes}
        <EmptyState title="No Dates to Add" icon="calendar">
          Appointments, due dates and document expiry dates appear here once they are set. Items
          without a date are never added.
        </EmptyState>
        {subscribe}
      </>
    );
  }

  return (
    <>
      {header}
      {notes}

      {nothingChosen ? (
        <p role="alert" className="notice notice-warn u-mb-150">
          Choose at least one date first. A date finished or removed since the preview is left out.
        </p>
      ) : null}
      {failed ? (
        <p role="alert" className="notice notice-warn u-mb-150">
          We could not make the file just now. Try again.
        </p>
      ) : null}

      {preview && preview.events.length > 0 ? (
        <section className="card u-mb-150" aria-labelledby="calendar-preview-heading">
          <h3 className="card-title" id="calendar-preview-heading">
            Preview
          </h3>
          <p className="card-body">
            The file will hold {plural(preview.events.length, 'event')}, as shown here. It is made
            again when you download it: anything finished or removed since this preview is left out,
            and anything changed comes in as it is then.
          </p>
          <ol className="calendar-preview-list">
            {preview.events.map((event) => (
              <li key={event.source.key} className="calendar-preview-item">
                <span className="calendar-preview-title">{event.title}</span>
                <span className="calendar-preview-when">{describeCalendarStart(event)}</span>
              </li>
            ))}
          </ol>
          <p className="muted">
            Reminder: {reminderWords}.
            {options.alarms.length > 0
              ? ' For a date without a time, the reminder comes at 09:00.'
              : ''}
          </p>
          {preview.leftOut > 0 ? (
            <p className="muted">
              One file holds up to {CALENDAR_EXPORT_LIMIT} events, so the last{' '}
              {plural(preview.leftOut, 'date')} you chose {preview.leftOut === 1 ? 'is' : 'are'}{' '}
              left out. Download them in a second file.
            </p>
          ) : null}
          <form method="post" action={`${pageHref}/download`} className="calendar-actions">
            {preview.events.map((event) => (
              <input
                key={event.source.key}
                type="hidden"
                name={CALENDAR_KEY_FIELD}
                value={event.source.key}
              />
            ))}
            {calendarOptionFields(options).map(([name, value]) => (
              <input key={`${name}=${value}`} type="hidden" name={name} value={value} />
            ))}
            <button type="submit" className="btn btn-primary">
              Download Calendar File
            </button>
          </form>
        </section>
      ) : null}

      <section className="card" aria-labelledby="calendar-choose-heading">
        <h3 className="card-title" id="calendar-choose-heading">
          Choose Dates
        </h3>
        <form method="get" action={pageHref} className="calendar-form">
          <input type="hidden" name="preview" value="1" />
          <fieldset className="fieldset">
            <legend className="field-label">Dates to Add</legend>
            <ul className="calendar-dates">
              {items.map((item, index) => {
                const inputId = `calendar-date-${index}`;
                return (
                  <li key={item.key}>
                    <label className="check calendar-date" htmlFor={inputId}>
                      <input
                        id={inputId}
                        type="checkbox"
                        name={CALENDAR_KEY_FIELD}
                        value={item.key}
                        defaultChecked={chosen.has(item.key)}
                      />
                      <span className="calendar-date-text">
                        <span className="calendar-date-title">
                          {CALENDAR_KINDS[item.kind].title}
                        </span>
                        <span className="calendar-date-when">
                          {describeCalendarItem(item)}
                          {item.caseTitle ? ` · ${item.caseTitle}` : ''}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            {truncated ? (
              <p className="muted u-m-0">
                Only the earliest {CALENDAR_SOURCE_LIMIT} of each kind of date are listed.
              </p>
            ) : null}
          </fieldset>
          <fieldset className="fieldset">
            <legend className="field-label">Titles</legend>
            <label className="check calendar-date" htmlFor="calendar-case-names">
              <input
                id="calendar-case-names"
                type="checkbox"
                name={CALENDAR_OPTION_FIELDS.titleStyle}
                value="withCaseNames"
                defaultChecked={options.titleStyle === 'withCaseNames'}
                aria-describedby="calendar-case-names-note"
              />
              <span>Add Case Names</span>
            </label>
            <p id="calendar-case-names-note" className="muted u-fs-075 u-m-0">
              Adds the case name after the title, for example &quot;Task Due - Japan Visit&quot;.
              Anyone who can see your calendar will see it. A case name with a number, a link or an
              email address in it is left out.
            </p>
          </fieldset>
          <fieldset className="fieldset">
            <legend className="field-label">Remind Me</legend>
            <div className="checks">
              {REMINDER_CHOICES.map(([value, label]) => (
                <label
                  key={value || 'none'}
                  className="check calendar-date"
                  htmlFor={`calendar-remind-${value || 'none'}`}
                >
                  <input
                    id={`calendar-remind-${value || 'none'}`}
                    type="radio"
                    name={CALENDAR_OPTION_FIELDS.alarms}
                    value={value}
                    defaultChecked={value === reminder}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="calendar-actions">
            <button
              type="submit"
              className={`btn ${preview && preview.events.length > 0 ? 'btn-secondary' : 'btn-primary'}`}
            >
              Preview
            </button>
            {wantsPreview ? (
              <Link href={pageHref} className="btn btn-secondary">
                Clear Choices
              </Link>
            ) : null}
          </div>
        </form>
      </section>
      {subscribe}
    </>
  );
}
