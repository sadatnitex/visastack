import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
// The language switch is off in the product, so the locale is set here directly.
const current = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', holder: null as unknown }));
vi.mock('../../../../lib/locale', () => ({ getLocale: async () => current.locale }));
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
  listApplicantProfile: vi.fn(),
  hasConsent: vi.fn(),
  listDocumentsDetailed: vi.fn(),
  listPendingProposals: vi.fn(),
  listMissions: vi.fn(),
  listEvidenceRequestsForApplicant: vi.fn(),
  listAccessForApplicant: vi.fn(),
  computeReadiness: vi.fn(),
  getProfileSectionState: vi.fn(),
  accountPrincipal: vi.fn(),
  requireAccess: vi.fn(),
  listDeadlineClock: vi.fn(),
  listNeedsAttention: vi.fn(),
}));
vi.mock('@visastack/services', () => service);
vi.mock('../../../../lib/session', () => ({
  withSession: (callback: (ctx: unknown) => unknown) => callback({ db: {}, accountId: 'owner' }),
}));
vi.mock('../../../../lib/ccd/depth.server', () => ({ readDepth: async () => 'auto' }));
vi.mock('../../agency/[orgId]/case-search-form', () => ({
  STAGE_LABELS: { IN_PROGRESS: 'In Progress' },
}));

import { I18nProvider } from '../../../../components/i18n-provider';
import { appApplicantCatalog } from '../../../../i18n/app-applicant';
import { primeLocale } from '../../../../lib/i18n-server';
import { renderServer, textOf } from '../../../../lib/next-mocks.test-support';

const { default: Home } = await import('./page');

const bn = appApplicantCatalog.bn as Record<string, string>;
const en = appApplicantCatalog.en as Record<string, string>;
const K = 'appApplicant.appApplicantIdPage.';
const BENGALI = /[ঀ-৿]/;

async function home(locale: 'en' | 'bn') {
  current.holder = null;
  current.locale = locale;
  await primeLocale();
  const page = (await Home({ params: Promise.resolve({ id: 'person' }) })) as React.ReactElement;
  // The root layout puts the language around every page; client components read it from there.
  return textOf(
    await renderServer(
      <I18nProvider locale={locale} pageLang={locale}>
        {page}
      </I18nProvider>,
    ),
  );
}

const openCase = {
  id: 'case-1',
  title: 'Japan Tourist Visa',
  state: 'IN_PROGRESS',
  updatedAt: new Date('2026-10-11'),
  targetDeadline: null,
  travelStartDate: null,
  jurisdiction: 'Japan',
  serviceCategory: 'Tourist',
  packVersionId: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  service.getApplicant.mockResolvedValue({
    id: 'person',
    displayName: 'Karim Hossain',
    ownerAccountId: 'owner',
  });
  service.listApplicantProfile.mockResolvedValue([]);
  service.hasConsent.mockResolvedValue(true);
  service.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [] });
  service.listPendingProposals.mockResolvedValue([]);
  service.listMissions.mockResolvedValue({ ok: true, value: [] });
  service.listEvidenceRequestsForApplicant.mockResolvedValue({ ok: true, value: [] });
  service.listAccessForApplicant.mockResolvedValue({ ok: true, value: [] });
  service.accountPrincipal.mockReturnValue({ kind: 'account', accountId: 'owner' });
  service.requireAccess.mockResolvedValue({
    ok: true,
    value: { actor: { kind: 'applicant_owner' }, applicantId: 'person' },
  });
  service.listDeadlineClock.mockResolvedValue({
    ok: true,
    value: { applicantId: 'person', entries: [] },
  });
  service.listNeedsAttention.mockResolvedValue({
    ok: true,
    value: {
      applicantId: 'person',
      applicantName: 'Karim Hossain',
      items: [],
      activeCases: [],
      activeCaseCount: 0,
      requests: { waitingOnYou: 0, withAgency: 0 },
    },
  });
  service.getProfileSectionState.mockResolvedValue({
    activated: new Set(),
    notApplicable: new Set(),
    noneDeclared: new Set(),
  });
});
afterEach(() => {
  current.locale = 'en';
});

const quarantined = {
  id: 'd1',
  safetyStatus: 'QUARANTINED',
  classification: null,
  createdAt: new Date('2026-10-12'),
  updatedAt: new Date('2026-10-12'),
  uploadedAt: new Date('2026-10-12'),
};

describe('the traveller home under Bengali', () => {
  it('shows the empty home in Bengali, with counts in Bengali digits and held lines in English', async () => {
    const text = await home('bn');
    for (const key of [
      'home',
      'nothingIsWaitingForYou',
      'startACase',
      'activeCases',
      'documentsInYourWallet',
      'itemsNeedingAttention',
      'aboutTheseTotals',
      'noActiveCaseYet',
      'needsYourAttention',
      'noUpcomingCaseDates',
      'recentActivity',
      'noRecordedActivityYet',
      'profileSharing',
      'continueProfile',
      'manageSharing',
    ])
      expect(text, key).toContain(bn[`${K}${key}`]);
    // The tiles and the meter use Bengali digits, not Latin ones.
    expect(text).toContain(`${bn[`${K}activeCases`]} ০ ${bn[`${K}documentsInYourWallet`]} ০`);
    expect(text).toContain('০ / ১২');
    expect(text).not.toContain('0 / 12');
    // The disclaimer is Bengali since the owner sign-off of 2026-11-12, and never a raw key.
    expect(`${K}completenessDoesNotVerifyIdentity` in bn).toBe(true);
    expect(text).toContain(bn[`${K}completenessDoesNotVerifyIdentity`]);
    expect(text).not.toContain(en[`${K}completenessDoesNotVerifyIdentity`]);
    expect(text).not.toMatch(/appApplicant\./);
  });

  it('shows a home with a case: the case lines, the date and the step marks in Bengali', async () => {
    service.listMissions.mockResolvedValue({ ok: true, value: [openCase] });
    const text = await home('bn');
    expect(text).toContain(bn[`${K}continueCase`]);
    expect(text).toContain(bn[`${K}checklistProgress`]);
    expect(text).toContain(bn[`${K}allCases`]);
    expect(text).toContain('আপডেট করা হয়েছে ১১ অক্টো, ২০২৬');
    expect(text).not.toContain(bn[`${K}noActiveCaseYet`]);
    expect(text).toContain(`${bn[`${K}activeCases`]} ১`);
    // The case title and the unconverted checklist line stay as they were.
    expect(text).toContain('Japan Tourist Visa');
    expect(text).toContain('Pick a Checklist');
  });

  it('counts what needs attention in Bengali digits', async () => {
    service.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [quarantined] });
    const text = await home('bn');
    expect(text).toContain(bn[`${K}documentsNeedingReview`]);
    expect(text).toContain(`${bn[`${K}itemsNeedingAttention`]} ১`);
    expect(text).not.toContain(bn[`${K}nothingIsWaitingForYou`]);
  });

  it('shows the open request line, the checklist meter label and the case fallbacks in Bengali', async () => {
    service.listEvidenceRequestsForApplicant.mockResolvedValue({
      ok: true,
      value: [{ id: 'r1', status: 'OPEN' }],
    });
    service.listMissions.mockResolvedValue({
      ok: true,
      value: [{ ...openCase, state: 'SOMETHING_NEW', jurisdiction: null, packVersionId: 'pv1' }],
    });
    service.computeReadiness.mockResolvedValue({
      ok: true,
      value: { requiredCount: 3, satisfiedRequired: 1, items: [] },
    });
    const text = await home('bn');
    for (const key of ['evidenceRequestsWaitingForAReply', 'inProgress', 'visaCase'])
      expect(text, key).toContain(bn[`${K}${key}`]);
    expect(text).toContain(`${bn[`${K}evidenceRequestsWaitingForAReply`]} ১`);
    expect(text).not.toMatch(/appApplicant\./);
  });

  it('writes counts of a thousand or more with no grouping under English', async () => {
    service.listDocumentsDetailed.mockResolvedValue({
      ok: true,
      value: Array.from({ length: 1234 }, (_, i) => ({
        id: `d${i}`,
        safetyStatus: 'CLEAN',
        classification: null,
        createdAt: new Date('2026-10-12'),
        updatedAt: new Date('2026-10-12'),
        uploadedAt: new Date('2026-10-12'),
      })),
    });
    const english = await home('en');
    expect(english).toContain('1234');
    expect(english).not.toContain('1,234');
    expect(await home('bn')).toContain('১,২৩৪');
  });

  it('keeps the same English as before under English, with Latin digits', async () => {
    service.listMissions.mockResolvedValue({ ok: true, value: [openCase] });
    service.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [quarantined] });
    const text = await home('en');
    expect(text).not.toMatch(BENGALI);
    expect(text).toContain(en[`${K}documentsNeedingReview`]);
    expect(text).toContain('0 / 12');
    expect(text).toContain('Updated 11 Oct 2026');
  });
});

/** Refill 7: the home in the states the tests above did not reach, each under Bengali. */
describe('the traveller home under Bengali, in its unavailable and fuller states', () => {
  it('says cases, dates and totals are unavailable in Bengali when cases cannot be read', async () => {
    service.listMissions.mockResolvedValue({ ok: false, error: { code: 'unavailable' } });
    const text = await home('bn');
    // The case tile says Unavailable in place of its count.
    expect(text).toContain(`${bn[`${K}activeCases`]} ${bn[`${K}unavailable`]}`);
    for (const key of [
      'casesAreUnavailable',
      'refreshToTryAgain',
      'datesAreUnavailable',
      'someRecordsCouldNotBeLoaded',
      'someSectionsAreUnavailableUnavailableTotals',
    ]) {
      expect(text, key).toContain(bn[`${K}${key}`]);
      expect(text, key).not.toContain(en[`${K}${key}`]);
    }
    expect(text).not.toMatch(/appApplicant\./);
  });

  it('calls a case with no service category a personal application in Bengali', async () => {
    service.listMissions.mockResolvedValue({
      ok: true,
      value: [{ ...openCase, serviceCategory: null }],
    });
    const text = await home('bn');
    expect(text).toContain(bn[`${K}personalApplication`]);
    expect(text).not.toContain('Personal application');
    expect(text).toContain('Japan Tourist Visa');
  });

  it('lists details waiting for approval and suggestions from AI apps in Bengali, with Bengali counts', async () => {
    service.listPendingProposals.mockResolvedValue([
      { id: 'p1', proposal: { documentVersionId: 'v1' } },
      { id: 'p2', fromApp: { name: 'Helper App' }, proposal: { documentVersionId: null } },
    ]);
    const text = await home('bn');
    expect(text).toContain(`${bn[`${K}suggestedDetailsAwaitingApproval`]} ১`);
    expect(text).toContain(`${bn[`${K}suggestionsFromAiAppsWaitingFor`]} ১`);
    expect(text).not.toContain(en[`${K}suggestedDetailsAwaitingApproval`]);
    expect(text).not.toContain(en[`${K}suggestionsFromAiAppsWaitingFor`]);
  });

  it('keeps the whole-profile meter label English once the essentials are added (held)', async () => {
    const { PROFILE_ESSENTIALS } = await import('../../../../lib/profile-essentials');
    service.listApplicantProfile.mockResolvedValue(
      PROFILE_ESSENTIALS.filter((e) => e.kind === 'field').map((e) => ({
        fieldKey: e.key,
        value: e.key === 'date_of_birth' ? '1990-01-01' : 'Made-up value',
        status: 'CONFIRMED',
      })),
    );
    service.getProfileSectionState.mockResolvedValue({
      activated: new Set(),
      notApplicable: new Set(),
      noneDeclared: new Set(PROFILE_ESSENTIALS.filter((e) => e.kind !== 'field').map((e) => e.key)),
    });
    const text = await home('bn');
    // Held (refill 7): the count beside the label is in Latin digits and the meter's own name is
    // the English "{value} of {max} {label}".
    expect(bn[`${K}detailsWithValuesInOpenSections`]).toBeUndefined();
    expect(text).toContain(en[`${K}detailsWithValuesInOpenSections`]);
    expect(bn[`${K}detailsWithValuesInOpenSections8284e6`]).toBeUndefined();
  });

  it('keeps the same English in those states under English', async () => {
    service.listMissions.mockResolvedValue({ ok: false, error: { code: 'unavailable' } });
    const text = await home('en');
    expect(text).not.toMatch(BENGALI);
    expect(text).toContain('Cases Are Unavailable');
    expect(text).toContain(
      'Some sections are unavailable. Unavailable totals are not reported as zero.',
    );
  });
});
