import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../components/i18n-provider';
import { caseCountryOptions, casePurposeGroups } from '../../../../../lib/case-choices';
import { renderServer, stub, textOf } from '../../../../../lib/next-mocks.test-support';
import { expectEveryLiveMessageRendered } from '../bn-coverage.test-support';

vi.mock('@visastack/i18n', async (original) =>
  (await import('../bn-coverage.test-support')).trackBengali(await original()),
);

const current = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', holder: null as unknown }));
// The language switch is off in the product, so the locale is set here directly.
vi.mock('../../../../../lib/locale', () => ({ getLocale: async () => current.locale }));
// Outside the server runtime React's cache remembers nothing; stand in for one request per render.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: (build: () => unknown) => () => {
    current.holder ??= build();
    return current.holder;
  },
}));

const service = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  listMissions: vi.fn(),
  hasConsent: vi.fn(),
  computeReadiness: vi.fn(),
  requireAccess: vi.fn(),
  planPrepareAgain: vi.fn(),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  ...service,
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: (callback: (ctx: unknown) => unknown) => callback({ db: {}, accountId: 'owner' }),
}));
vi.mock('../../../../../lib/ccd/depth.server', () => ({ readDepth: async () => 'auto' }));
vi.mock('./actions', () => ({ createMissionAction: vi.fn() }));
vi.mock('./prepare-again/actions', () => ({ prepareCaseAgainAction: vi.fn() }));
// The page is tested with the real form in its own test below, so here it only marks its place.
vi.mock('./create-mission-form', async (importOriginal) => {
  const real = await importOriginal<typeof import('./create-mission-form')>();
  return { ...real, CreateMissionForm: stub('CreateMissionForm') };
});

const { default: CasesPage } = await import('./page');
const { default: PrepareAgainPage } = await import('./prepare-again/page');
const { CreateMissionForm } =
  await vi.importActual<typeof import('./create-mission-form')>('./create-mission-form');
const { applicantMissionsCatalog } = await import('../../../../../i18n/applicant-missions');

const bn = applicantMissionsCatalog.bn as Record<string, string>;
const en = applicantMissionsCatalog.en as Record<string, string>;
const PAGE = 'applicantMissions.appApplicantIdMissionsPage.';
const FORM = 'applicantMissions.appApplicantIdMissionsCreateMissionForm.';
const AGAIN_PAGE = 'applicantMissions.appApplicantIdMissionsPrepareAgainPage.';
const AGAIN = 'applicantMissions.appApplicantIdMissionsPrepareAgainPrepareAgainForm.';
const RAW_KEY = /applicantMissions\.app[A-Z]/;
const BENGALI = /[ঀ-৿]/;

async function cases(locale: 'en' | 'bn') {
  current.holder = null;
  current.locale = locale;
  const html = await renderServer(CasesPage({ params: Promise.resolve({ id: 'person' }) }));
  return { html, text: textOf(html) };
}

async function again(locale: 'en' | 'bn') {
  current.holder = null;
  current.locale = locale;
  const html = await renderServer(
    PrepareAgainPage({
      params: Promise.resolve({ id: 'person' }),
      searchParams: Promise.resolve({ from: 'm1' }),
    }).then((page) => (
      <I18nProvider locale={locale} pageLang={locale}>
        {page}
      </I18nProvider>
    )),
  );
  return { html, text: textOf(html) };
}

const client = (locale: 'en' | 'bn', node: React.ReactNode) =>
  renderToStaticMarkup(
    <I18nProvider locale={locale} pageLang={locale}>
      {node}
    </I18nProvider>,
  );

const aCase = {
  id: 'c1',
  title: 'Japan Visit',
  state: 'IN_PROGRESS',
  destination: null,
  purpose: null,
  packVersionId: null,
  updatedAt: new Date('2026-10-20T08:00:00Z'),
};

beforeEach(() => {
  service.getApplicant.mockResolvedValue({
    id: 'person',
    displayName: 'Karim Hossain',
    ownerAccountId: 'owner',
  });
  service.listMissions.mockResolvedValue({ ok: true, value: [aCase] });
  service.hasConsent.mockResolvedValue(true);
  service.requireAccess.mockResolvedValue({ ok: true, value: { applicant: { id: 'person' } } });
  service.planPrepareAgain.mockResolvedValue({
    ok: true,
    value: {
      source: { id: 'm1', title: 'Japan trip 2025' },
      packVersion: null,
      checklistUnavailable: false,
      notApplicableCount: 0,
      items: [],
      sharingQuestions: [],
    },
  });
});
afterEach(() => {
  current.locale = 'en';
});

describe('the Cases page under Bengali', () => {
  it('with a case being worked on it shows the Bengali title, About Cases and start card, and keeps the case lines in English', async () => {
    const { html, text } = await cases('bn');
    expect(text).toContain(bn[`${PAGE}cases`]);
    expect(text).toContain(bn[`${PAGE}aboutCases`]);
    expect(text).toContain(bn[`${PAGE}new`]);
    expect(html).toMatch(new RegExp(`class="btn btn-primary"[^>]*>${bn[`${PAGE}startATrip`]}</a>`));
    // The person's own case name, the status word and the plain explanation stay as they are.
    expect(text).toContain('Your case: Japan Visit');
    expect(text).toContain(en[`${PAGE}aCaseChecksThisTravellerS`]);
    expect(text).toContain('Start a Trip');
    expect(html).not.toMatch(RAW_KEY);
  });

  it('without consent the start card keeps the consent line in English and has no Bengali button', async () => {
    service.hasConsent.mockResolvedValue(false);
    const { html, text } = await cases('bn');
    expect(text).toContain('Turn on Let VisaStack Process My Details');
    expect(text).not.toContain(bn[`${PAGE}startATrip`]);
    expect(text).toContain(bn[`${PAGE}cases`]);
    expect(text).toContain(bn[`${PAGE}new`]);
    expect(html).not.toMatch(RAW_KEY);
  });

  it('with no case it keeps the empty-state wording in English', async () => {
    service.listMissions.mockResolvedValue({ ok: true, value: [] });
    const { html, text } = await cases('bn');
    expect(text).toContain('No Cases Yet');
    expect(text).toContain(en[`${PAGE}noActiveCaseYet`]);
    expect(text).toContain(bn[`${PAGE}cases`]);
    expect(html).not.toMatch(RAW_KEY);
  });

  it('is the same English as before under English, with no Bengali', async () => {
    const { text } = await cases('en');
    expect(text).not.toMatch(BENGALI);
    expect(text).toContain('About Cases');
    expect(text).toContain('New');
    expect(text).toContain('Start a Trip');
  });
});

describe('the new case form under Bengali', () => {
  const form = (locale: 'en' | 'bn') =>
    client(
      locale,
      <CreateMissionForm
        applicantId="a-1"
        countries={caseCountryOptions()}
        purposes={casePurposeGroups()}
        openDetails
      />,
    );

  it('shows the Bengali details heading, date group and example text, and keeps the questions and button in English', () => {
    const html = form('bn');
    const text = textOf(html);
    expect(text).toContain(bn[`${FORM}addMoreDetailsOptional`]);
    expect(text).toContain(bn[`${FORM}travelDatesOptional`]);
    expect(html).toContain(`placeholder="${bn[`${FORM}eGSmithFamilyEurope2026`]}"`);
    expect(html).toContain(`placeholder="${bn[`${FORM}eGTouristStudentWork`]}"`);
    expect(text).toContain('What is this case for?');
    expect(text).toContain('Where are you going?');
    expect(text).toContain('Create Case');
    expect(html).not.toMatch(RAW_KEY);
  });

  it('is the same English as before under English, with no Bengali', () => {
    const html = form('en');
    expect(html).not.toMatch(BENGALI);
    expect(textOf(html)).toContain('Add More Details (Optional)');
    expect(textOf(html)).toContain('Travel Dates (Optional)');
    expect(html).toContain(`placeholder="${en[`${FORM}eGSmithFamilyEurope2026`]}"`);
  });
});

describe('Start a New Case from This One under Bengali', () => {
  it('shows the Bengali heading and keeps the checklist note and group wording in English', async () => {
    const { html, text } = await again('bn');
    expect(text).toContain(bn[`${AGAIN_PAGE}startANewCaseFromThis`]);
    expect(text).toContain(bn[`${PAGE}cases`]);
    expect(text).toContain(en[`${AGAIN_PAGE}startANewCaseFromThisad706c`]);
    expect(text).toContain('Your last case had no checklist');
    expect(text).toContain('Reusable');
    expect(html).not.toMatch(RAW_KEY);
  });

  it('the form shows Bengali date and deadline labels, with the screen-reader names in the same language', async () => {
    const { html, text } = await again('bn');
    expect(text).toContain(bn[`${FORM}travelDatesOptional`]);
    expect(text).toContain(bn[`${AGAIN}targetDeadlineOptional`]);
    expect(html).toContain(`aria-label="${bn[`${AGAIN}travelStartDate`]}"`);
    expect(html).toContain(`aria-label="${bn[`${AGAIN}travelEndDate`]}"`);
    expect(text).toContain('Create the New Case');
    expect(html).not.toMatch(RAW_KEY);
  });

  it('without consent it keeps the consent line in English', async () => {
    service.hasConsent.mockResolvedValue(false);
    const { text } = await again('bn');
    expect(text).toContain('Turn on Let VisaStack Process My Details');
    expect(text).toContain(bn[`${AGAIN_PAGE}startANewCaseFromThis`]);
  });

  it('is the same English as before under English, with no Bengali', async () => {
    const { html, text } = await again('en');
    expect(html).not.toMatch(BENGALI);
    expect(text).toContain('Start a New Case from This One');
    expect(html).toContain('aria-label="Travel Start Date"');
  });
});

describe('Bengali coverage of the cases surface', () => {
  it('every live Bengali message was rendered by a test above', () => {
    expectEveryLiveMessageRendered(applicantMissionsCatalog);
  });
});
