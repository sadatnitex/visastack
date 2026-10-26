import { CALENDAR_SOURCE_LIMIT } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EmptyState, PageHeader } from '../../../../../components/ui';
import {
  CALENDAR_EXPORT_LIMIT,
  calendarEventTitle,
  describeCalendarWhen,
  selectCalendarEvents,
} from '../../../../../lib/ics';
import { plural } from '../../../../../lib/plural';
import { loadCalendarDates, readCalendarSelection } from './load';

export const metadata: Metadata = { title: 'Add Dates to Your Calendar' };

export const dynamic = 'force-dynamic';

/**
 * Calendar export (v1.2 B05): the traveller picks dated items, sees a preview of exactly the
 * titles and dates the file will hold, then downloads one calendar file. Plain GET forms, so no
 * script is needed. Owner-only through the access gate; anyone else sees "not found". Every
 * title and date shown is rebuilt from the server's own items: only the chosen keys and the
 * case-names choice are read from the address.
 */
/** What the page reads from its address: only keys and choices, never a title or a date. */
type CalendarQuery = {
  readonly key?: string | string[];
  readonly names?: string | string[];
  readonly preview?: string | string[];
  readonly error?: string | string[];
};

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

  const pageHref = `/app/applicant/${id}/calendar`;
  const header = (
    <PageHeader
      as="h2"
      eyebrow="Calendar"
      title="Add Dates to Your Calendar"
      description="Choose the dates you want, check the preview, then download one file to open in your calendar app."
      back={{ href: '/app', label: 'Home' }}
    />
  );
  const notes = (
    <div className="notice u-mb-150">
      <p className="u-m-0">
        This is a one-time copy. If a date changes later, your calendar will not update; download a
        new file.
      </p>
      <p className="u-m-0">
        Dates without a time are added as all-day events. Titles are general, such as &quot;Task
        Due&quot;, unless you choose to add case names.
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
      </>
    );
  }

  const { items, truncated } = loaded.dates;
  const selection = readCalendarSelection(query);
  const chosen = new Set(selection.keys);
  const wantsPreview = query.preview === '1';
  const preview = wantsPreview
    ? selectCalendarEvents(items, selection.keys, { caseNames: selection.caseNames })
    : null;
  const nothingChosen =
    (preview !== null && preview.events.length === 0) || query.error === 'nothing';
  const failed = query.error === 'failed';

  if (items.length === 0) {
    return (
      <>
        {header}
        {notes}
        <EmptyState title="No Dates to Add" icon="calendar">
          Appointments, due dates and document expiry dates appear here once they are set. Items
          without a date are never added.
        </EmptyState>
      </>
    );
  }

  return (
    <>
      {header}
      {notes}

      {nothingChosen ? (
        <p role="alert" className="notice notice-warn u-mb-150">
          Choose at least one date first.
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
            The file will hold {plural(preview.events.length, 'event')}, exactly as shown here.
          </p>
          <ol className="calendar-preview-list">
            {preview.events.map((event) => (
              <li key={event.key} className="calendar-preview-item">
                <span className="calendar-preview-title">{event.summary}</span>
                <span className="calendar-preview-when">{describeCalendarWhen(event.when)}</span>
              </li>
            ))}
          </ol>
          {preview.leftOut > 0 ? (
            <p className="muted">
              One file holds up to {CALENDAR_EXPORT_LIMIT} events, so the last{' '}
              {plural(preview.leftOut, 'date')} you chose {preview.leftOut === 1 ? 'is' : 'are'}{' '}
              left out. Download them in a second file.
            </p>
          ) : null}
          <form method="get" action={`${pageHref}/download`} className="calendar-actions">
            {preview.events.map((event) => (
              <input key={event.key} type="hidden" name="key" value={event.key} />
            ))}
            {selection.caseNames ? <input type="hidden" name="names" value="1" /> : null}
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
                        name="key"
                        value={item.key}
                        defaultChecked={chosen.has(item.key)}
                      />
                      <span className="calendar-date-text">
                        <span className="calendar-date-title">
                          {calendarEventTitle(item, { caseNames: false })}
                        </span>
                        <span className="calendar-date-when">
                          {describeCalendarWhen(item.when)}
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
                name="names"
                value="1"
                defaultChecked={selection.caseNames}
                aria-describedby="calendar-case-names-note"
              />
              <span>Add Case Names</span>
            </label>
            <p id="calendar-case-names-note" className="muted u-fs-075 u-m-0">
              Adds the case name after the title, for example &quot;Task Due - Japan Visit&quot;.
              Anyone who can see your calendar will see it.
            </p>
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
    </>
  );
}
