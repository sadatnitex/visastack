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

async function cases(locale: 'en' | 'bn', query: Record<string, string> = {}) {
  current.holder = null;
  current.locale = locale;
  const marked = await renderServer(
    CasesPage({ params: Promise.resolve({ id: 'person' }), searchParams: Promise.resolve(query) }),
  );
  // Bengali on a page marked English carries its own language; the checks below read the words.
  const html = marked.replace(/<span lang="bn">([^<]*)<\/span>/g, '$1');
  return { html, marked, text: textOf(html) };
}

async function again(locale: 'en' | 'bn') {
  current.holder = null;
  current.locale = locale;
  const marked = await renderServer(
    PrepareAgainPage({
      params: Promise.resolve({ id: 'person' }),
      searchParams: Promise.resolve({ from: 'm1' }),
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
    const { html, marked, text } = await cases('bn');
    expect(marked).toContain('<span lang="bn">');
    expect(text).toContain(bn[`${PAGE}cases`]);
    expect(text).toContain(bn[`${PAGE}aboutCases`]);
    expect(text).toContain(bn[`${PAGE}new`]);
    expect(html).toMatch(new RegExp(`class="btn btn-primary"[^>]*>${bn[`${PAGE}startATrip`]}</a>`));
    // The person's own case name, the status word and the plain explanation stay as they are.
    expect(text).toContain('Your case: Japan Visit');
    expect(text).toContain(bn[`${PAGE}aCaseChecksThisTravellerS`]);
    expect(text).not.toContain(en[`${PAGE}aCaseChecksThisTravellerS`]);
    expect(text).toContain('চলমান (১)');
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

  it('with no case it says so in Bengali', async () => {
    service.listMissions.mockResolvedValue({ ok: true, value: [] });
    const { html, text } = await cases('bn');
    expect(text).toContain(bn[`${PAGE}noCasesYet`]);
    expect(text).toContain(bn[`${PAGE}sayWhereYouAreGoingAnd`]);
    expect(text).not.toContain('No Cases Yet');
    expect(text).toContain(bn[`${PAGE}cases`]);
    expect(html).not.toMatch(RAW_KEY);
  });

  it('a deleted case, past trips and an unreadable list are Bengali (refill 3)', async () => {
    service.listMissions.mockResolvedValue({
      ok: true,
      value: [aCase, { ...aCase, id: 'c2', title: 'Old Trip', state: 'CLOSED' }],
    });
    const done = await cases('bn', { deleted: '1' });
    expect(done.text).toContain(bn[`${PAGE}caseDeleted`]);
    expect(done.text).toContain('আগের ট্রিপ (১)');
    expect(done.text).toContain(bn[`${PAGE}caseHistory`]);
    expect(done.text).not.toContain('Past Trips');
    service.listMissions.mockResolvedValue({ ok: false, error: { code: 'unavailable' } });
    const failed = await cases('bn');
    expect(failed.text).toContain(bn[`${PAGE}yourCasesCouldNotBeLoaded`]);
    expect(failed.text).not.toContain(en[`${PAGE}yourCasesCouldNotBeLoaded`]);
    expect(done.html + failed.html).not.toMatch(RAW_KEY);
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
    expect(html).toContain(`placeholder="${bn[`${FORM}eGUkStudentVisaAutumn`]}"`);
    expect(html).toContain(`placeholder="${bn[`${FORM}notSureYet`]}"`);
    expect(text).toContain(bn[`${FORM}aboutChecklists`]);
    expect(text).toContain(bn[`${FORM}startDate`]);
    expect(text).toContain(bn[`${FORM}endDate`]);
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

  it('the sharing question names who sees every case, in Bengali (refill 3)', async () => {
    service.planPrepareAgain.mockResolvedValue({
      ok: true,
      value: {
        source: { id: 'm1', title: 'Japan trip 2025' },
        packVersion: null,
        checklistUnavailable: false,
        notApplicableCount: 0,
        items: [],
        sharingQuestions: [
          {
            kind: 'grant',
            id: 'g1',
            recipient: { label: 'Harbor Visas' },
            purpose: 'Visa help',
            status: 'ACTIVE',
          },
        ],
      },
    });
    const { html, text } = await again('bn');
    expect(text).toContain(bn[`${AGAIN}whoCanSeeThisCase`]);
    expect(text).toContain(bn[`${AGAIN}thesePeopleAndAgenciesCanSee`]);
    expect(text).not.toContain(en[`${AGAIN}thesePeopleAndAgenciesCanSee`]);
    expect(text).toContain('Harbor Visas');
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
