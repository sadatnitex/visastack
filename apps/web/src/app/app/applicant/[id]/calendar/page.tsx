import {
  CALENDAR_OPTION_FIELDS,
  calendarOptionFields,
  parseCalendarExportOptions,
} from '@visastack/core/calendar';
import { CALENDAR_PAST_DAYS, CALENDAR_SOURCE_LIMIT } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StickyActionBar } from '../../../../../components/sticky-action-bar';
import { EmptyState, PageHeader } from '../../../../../components/ui';
import { applicantCalendarCatalog } from '../../../../../i18n/applicant-calendar';
import { getServerT, primeLocale } from '../../../../../lib/i18n-server';
import {
  CALENDAR_EXPORT_LIMIT,
  describeCalendarItem,
  describeCalendarStart,
  selectCalendarEvents,
} from '../../../../../lib/ics';
import { CALENDAR_REMINDER_LABELS, CALENDAR_REMINDER_ORDER } from '../../../../../lib/labels';
import { plural } from '../../../../../lib/plural';
import { formatMoment } from '../../../../../lib/save-status';
import { CalendarDateGroups, CalendarPreviewPanel } from './calendar-date-groups';
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
  await primeLocale();
  const t = getServerT(applicantCalendarCatalog);
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
      eyebrow={t('applicantCalendar.appApplicantIdCalendarPage.calendar')}
      title={t('applicantCalendar.appApplicantIdCalendarPage.addDatesToMyCalendar')}
      description={t('applicantCalendar.appApplicantIdCalendarPage.chooseTheDatesYouWantCheck')}
      back={{ href: '/app', label: 'Home' }}
    />
  );
  const notes = (
    <div className="notice notice-stack u-mb-150">
      <p className="u-m-0">
        {t('applicantCalendar.appApplicantIdCalendarPage.thisIsAOneTimeCopy')}
      </p>
      <p className="u-m-0">
        {t('applicantCalendar.appApplicantIdCalendarPage.datesWithoutATimeAreAdded', {
          CALENDAR_PAST_DAYS,
        })}
      </p>
    </div>
  );
  if (loaded.state === 'failed') {
    return (
      <>
        {header}
        <p role="alert" className="notice notice-warn">
          {t('applicantCalendar.appApplicantIdCalendarPage.weCouldNotLoadYourDates')}
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
        <EmptyState
          title={t('applicantCalendar.appApplicantIdCalendarPage.noDatesToAdd')}
          icon="calendar"
        >
          {t('applicantCalendar.appApplicantIdCalendarPage.appointmentsDueDatesAndDocumentExpiry')}
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
          {t('applicantCalendar.appApplicantIdCalendarPage.chooseAtLeastOneDateFirst')}
        </p>
      ) : null}
      {failed ? (
        <p role="alert" className="notice notice-warn u-mb-150">
          {t('applicantCalendar.appApplicantIdCalendarPage.weCouldNotMakeTheFile')}
        </p>
      ) : null}

      {preview && preview.events.length > 0 ? (
        <section className="card u-mb-150" aria-labelledby="calendar-preview-heading">
          <h3 className="card-title" id="calendar-preview-heading">
            {t('applicantCalendar.appApplicantIdCalendarPage.preview')}
          </h3>
          <p className="card-body">
            {t('applicantCalendar.appApplicantIdCalendarPage.theFileWillHoldPluralAs', {
              plural: plural(preview.events.length, 'event'),
            })}
          </p>
          <CalendarPreviewPanel
            events={preview.events.map((event) => ({
              key: event.source.key,
              title: event.title,
              when: describeCalendarStart(event),
            }))}
          />
          <p className="muted">
            Reminder: {reminderWords}.
            {options.alarms.length > 0
              ? ' For a date without a time, the reminder comes at 09:00.'
              : ''}
          </p>
          {preview.leftOut > 0 ? (
            <p className="muted">
              {t('applicantCalendar.appApplicantIdCalendarPage.oneFileHoldsUpToCalendar', {
                leftOut: preview.leftOut,
                CALENDAR_EXPORT_LIMIT,
                plural: plural(preview.leftOut, 'date'),
              })}
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
              {t('applicantCalendar.appApplicantIdCalendarPage.downloadCalendarFile')}
            </button>
          </form>
        </section>
      ) : null}

      <section className="card" aria-labelledby="calendar-choose-heading">
        <h3 className="card-title" id="calendar-choose-heading">
          {t('applicantCalendar.appApplicantIdCalendarPage.chooseDates')}
        </h3>
        <form method="get" action={pageHref} className="calendar-form">
          <input type="hidden" name="preview" value="1" />
          <fieldset className="fieldset">
            <legend className="field-label">
              {t('applicantCalendar.appApplicantIdCalendarPage.datesToAdd')}
            </legend>
            <CalendarDateGroups
              items={items.map((item) => ({
                key: item.key,
                kind: item.kind,
                when: describeCalendarItem(item),
                caseTitle: item.caseTitle,
              }))}
              chosen={chosen}
              fieldName={CALENDAR_KEY_FIELD}
            />
            {truncated ? (
              <p className="muted u-m-0">
                {t(
                  'applicantCalendar.appApplicantIdCalendarPage.onlyTheEarliestCalendarSourceLimit',
                  { CALENDAR_SOURCE_LIMIT },
                )}
              </p>
            ) : null}
          </fieldset>
          <fieldset className="fieldset">
            <legend className="field-label">
              {t('applicantCalendar.appApplicantIdCalendarPage.titles')}
            </legend>
            <label className="check calendar-date" htmlFor="calendar-case-names">
              <input
                id="calendar-case-names"
                type="checkbox"
                name={CALENDAR_OPTION_FIELDS.titleStyle}
                value="withCaseNames"
                defaultChecked={options.titleStyle === 'withCaseNames'}
                aria-describedby="calendar-case-names-note"
              />
              <span>{t('applicantCalendar.appApplicantIdCalendarPage.addCaseNames')}</span>
            </label>
            <p id="calendar-case-names-note" className="muted u-fs-075 u-m-0">
              {t('applicantCalendar.appApplicantIdCalendarPage.addsTheCaseNameAfterThe')}
            </p>
          </fieldset>
          <fieldset className="fieldset">
            <legend className="field-label">
              {t('applicantCalendar.appApplicantIdCalendarPage.remindMe')}
            </legend>
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
          <StickyActionBar
            label={t('applicantCalendar.appApplicantIdCalendarPage.previewYourDates')}
          >
            <button
              type="submit"
              className={`btn ${preview && preview.events.length > 0 ? 'btn-secondary' : 'btn-primary'}`}
            >
              {t('applicantCalendar.appApplicantIdCalendarPage.preview')}
            </button>
            {wantsPreview ? (
              <Link href={pageHref} className="btn btn-secondary">
                {t('applicantCalendar.appApplicantIdCalendarPage.clearChoices')}
              </Link>
            ) : null}
          </StickyActionBar>
        </form>
      </section>
      {subscribe}
    </>
  );
}
