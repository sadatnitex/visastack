import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../components/i18n-provider';
import { renderServer, textOf } from '../../../../../lib/next-mocks.test-support';
import { expectEveryLiveMessageRendered } from '../bn-coverage.test-support';
import { CALENDAR_ITEMS, TASK_KEY, ownerProof } from './fixtures.test-support';

vi.mock('@visastack/i18n', async (original) =>
  (await import('../bn-coverage.test-support')).trackBengali(await original()),
);

const state = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'bn',
  holder: null as unknown,
  forced: undefined as unknown,
}));
// The language switch is off in the product, so the locale is set here directly.
vi.mock('../../../../../lib/locale', () => ({ getLocale: async () => state.locale }));
// Outside the server runtime React's cache remembers nothing; stand in for one request per render.
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    cache: (build: () => unknown) => () => {
      state.holder ??= build();
      return state.holder;
    },
    useActionState: ((...args: Parameters<typeof actual.useActionState>) =>
      state.forced
        ? [state.forced, () => undefined, false]
        : actual.useActionState(...args)) as typeof actual.useActionState,
  };
});

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  listCalendarDates: vi.fn(),
  getCalendarFeedStatus: vi.fn(),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  requireAccess: mocks.requireAccess,
  listCalendarDates: mocks.listCalendarDates,
  recordCalendarExport: vi.fn(),
  getCalendarFeedStatus: mocks.getCalendarFeedStatus,
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'traveller@example.com' }),
}));
vi.mock('./feed-actions', () => ({ calendarFeedAction: async () => ({ ok: true, message: '' }) }));

const { applicantCalendarCatalog } = await import('../../../../../i18n/applicant-calendar');
const { default: CalendarPage } = await import('./page');

const bn = applicantCalendarCatalog.bn as Record<string, string>;
const en = applicantCalendarCatalog.en as Record<string, string>;
const PAGE = 'applicantCalendar.appApplicantIdCalendarPage.';
const PANEL = 'applicantCalendar.appApplicantIdCalendarCalendarFeedPanel.';
const RAW_KEY = /applicant[A-Z][A-Za-z]+\.app[A-Z]/;
const BENGALI = /[ঀ-৿]/;
const LINK = `https://vs.example.test/api/calendar-feed/${'z'.repeat(43)}.ics`;

async function render(
  locale: 'en' | 'bn',
  query: Record<string, string | string[]> = {},
): Promise<{ html: string; marked: string; text: string }> {
  state.holder = null;
  state.locale = locale;
  const marked = await renderServer(
    CalendarPage({
      params: Promise.resolve({ id: 'a1' }),
      searchParams: Promise.resolve(query),
    }).then((page) => (
      <I18nProvider locale={locale} pageLang={locale}>
        {page}
      </I18nProvider>
    )),
  );
  // Bengali on a page marked English carries its own language; the checks below read the words.
  const html = marked.replace(/<span lang="bn">([^<]*)<\/span>/g, '$1');
  return { html, marked, text: textOf(html) };
}

const listing = (items = CALENDAR_ITEMS) => ({
  ok: true,
  value: { applicantId: 'a1', items, truncated: false },
});

beforeEach(() => {
  state.forced = undefined;
  mocks.requireAccess.mockResolvedValue(ownerProof());
  mocks.listCalendarDates.mockResolvedValue(listing());
  mocks.getCalendarFeedStatus.mockResolvedValue({ ok: true, value: { state: 'off' } });
});
afterEach(() => {
  state.locale = 'en';
});

describe('calendar page under Bengali', () => {
  it('the choose-dates state shows the Bengali headings and labels and keeps the held lines in English', async () => {
    const { html, marked, text } = await render('bn');
    expect(marked).toContain('<span lang="bn">');
    for (const key of [
      'calendar',
      'addDatesToMyCalendar',
      'chooseTheDatesYouWantCheck',
      'thisIsAOneTimeCopy',
      'chooseDates',
      'datesToAdd',
      'titles',
      'addCaseNames',
      'remindMe',
      'preview',
    ]) {
      expect(text, key).toContain(bn[`${PAGE}${key}`]);
    }
    // The hidden group name of the button bar is Bengali too.
    expect(html).toContain(`<legend class="sr-only">${bn[`${PAGE}previewYourDates`]}</legend>`);
    expect(html).toMatch(new RegExp(`>${bn[`${PAGE}preview`]}</button>`));
    // Held in English: what the case name does, the time-zone note and the reminder choices.
    expect(text).toContain(en[`${PAGE}addsTheCaseNameAfterThe`]);
    expect(text).toContain('Dates without a time are added');
    expect(text).toContain('Task Due');
    // No preview yet, so no preview heading and no download button.
    expect(html).not.toContain('calendar-preview-heading');
    expect(text).not.toContain('Download Calendar File');
    expect(html).not.toMatch(RAW_KEY);
  });

  it('the preview state shows the Bengali Preview heading and keeps the file wording in English', async () => {
    const { html, text } = await render('bn', { preview: '1', key: TASK_KEY });
    expect(html).toMatch(new RegExp(`id="calendar-preview-heading">${bn[`${PAGE}preview`]}</h3>`));
    expect(text).toContain('Download Calendar File');
    expect(text).toContain('Clear Choices');
    expect(text).toContain('The file will hold 1 event');
    expect(html).not.toMatch(RAW_KEY);
  });

  it('the link panel keeps its working lines in English and shows only the Bengali heading when it is off', async () => {
    const { html, text } = await render('bn');
    const panel = html.slice(html.indexOf('calendar-feed-heading'));
    expect(textOf(panel)).toContain(bn[`${PANEL}subscribeInYourCalendarApp`]);
    expect(text).toContain(en[`${PANEL}turnOnAPrivateLinkAnd`]);
    expect(text).toContain('Turn On Calendar Link');
    expect(`${PANEL}turnOnAPrivateLinkAnd` in bn).toBe(false);
    expect(`${PANEL}anyoneWhoHasThisLinkCan` in bn).toBe(false);
  });

  it('the new-link state shows a Bengali Copy Link button and keeps the steps and the show-once warning in English', async () => {
    state.forced = {
      ok: true,
      message: 'Your calendar link is on.',
      feed: 'on',
      known: 'on',
      link: LINK,
    };
    const { html, text } = await render('bn');
    expect(html).toContain(`value="${LINK}"`);
    expect(html).toMatch(new RegExp(`<button[^>]*>${bn[`${PANEL}copyLink`]}</button>`));
    expect(text).toContain(en[`${PANEL}yourPrivateCalendarLink`]);
    expect(text).toContain(en[`${PANEL}thisLinkIsShownOnlyNow`]);
    expect(text).toContain(en[`${PANEL}outlookChooseAddCalendarThenSubscribe`]);
    expect(text).toContain('Make a New Link');
    expect(text).toContain('Stop Sharing');
    expect(html).not.toMatch(RAW_KEY);
  });

  it('the empty state keeps its own wording in English with the Bengali header above it', async () => {
    mocks.listCalendarDates.mockResolvedValue(listing([]));
    const { html, text } = await render('bn');
    expect(text).toContain(bn[`${PAGE}addDatesToMyCalendar`]);
    expect(text).toContain('No Dates to Add');
    expect(text).not.toContain(bn[`${PAGE}chooseDates`]);
    expect(html).not.toMatch(RAW_KEY);
  });

  it('the could-not-load state keeps the warning in English', async () => {
    mocks.listCalendarDates.mockResolvedValue({ ok: false, error: { code: 'unavailable' } });
    const { html, text } = await render('bn');
    expect(text).toContain('We could not load your dates');
    expect(text).toContain(bn[`${PAGE}addDatesToMyCalendar`]);
    expect(html).not.toMatch(RAW_KEY);
  });

  it('is the same English as before under English, with no Bengali', async () => {
    const { text } = await render('en', { preview: '1', key: TASK_KEY });
    expect(text).not.toMatch(BENGALI);
    expect(text).toContain('Add Dates to My Calendar');
    expect(text).toContain('Choose Dates');
    expect(text).toContain('Subscribe in Your Calendar App');
    expect(text).toContain('Download Calendar File');
  });

  it('every live Bengali message of this surface was rendered by a test above', () => {
    expectEveryLiveMessageRendered(applicantCalendarCatalog);
  });
});
