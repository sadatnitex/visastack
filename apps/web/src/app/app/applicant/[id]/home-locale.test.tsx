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
    // Held back or not yet drafted: English stays, never a raw key.
    expect(`${K}completenessDoesNotVerifyIdentity` in bn).toBe(false);
    expect(text).toContain(en[`${K}completenessDoesNotVerifyIdentity`]);
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
