import { renderToStaticMarkup } from 'react-dom/server';
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
  getProfileSectionState: vi.fn(),
  getWalletView: vi.fn(),
  hasConsent: vi.fn(),
  listApplicantAssurance: vi.fn(),
  listApplicantProfile: vi.fn(),
  listDocumentsDetailed: vi.fn(),
  listPendingAppSuggestions: vi.fn(),
  aiSuggestionsInUse: vi.fn(),
  requireAccess: vi.fn(),
  listEndedRecords: vi.fn(),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  ...service,
}));
vi.mock('../../../../lib/session', () => ({
  withSession: (callback: (ctx: unknown) => unknown) => callback({ db: {}, accountId: 'owner' }),
}));
vi.mock('../../../../lib/profile-photos', () => ({ ownedPhotoUrl: () => null }));
vi.mock('../../../../lib/providers', () => ({
  createKeyManagementPort: () => ({ port: 'keys' }),
}));
vi.mock('../../../../lib/ccd/depth.server', () => ({ readDepth: async () => 'auto' }));
vi.mock('../../../../components/profile-photo/profile-photo-control', () => ({
  ProfilePhotoControl: () => <div>Photo control</div>,
}));
vi.mock('./actions', () => ({
  saveFactAction: vi.fn(),
  decideProposalAction: vi.fn(),
  acceptClearDetailsAction: vi.fn(),
  decideClassificationProposalAction: vi.fn(),
  decideInconsistencyFlagAction: vi.fn(),
  readAgainAction: vi.fn(),
  runClassificationAction: vi.fn(),
  runInconsistencyCheckAction: vi.fn(),
}));
vi.mock('./section-actions', () => ({
  markEndedAction: vi.fn(),
  markNotCurrentAction: vi.fn(),
  openSuggestedSectionsAction: vi.fn(),
  saveOtherItemAction: vi.fn(),
  setExemptionAction: vi.fn(),
  setSectionOpenAction: vi.fn(),
}));

import { I18nProvider } from '../../../../components/i18n-provider';
import { appApplicantCatalog } from '../../../../i18n/app-applicant';
import { primeLocale } from '../../../../lib/i18n-server';
import { fixtureView } from '../../../../lib/master-profile-fixture';
import { renderServer, textOf } from '../../../../lib/next-mocks.test-support';
import { ProfileEditor } from './profile-editor';

const { default: ProfilePage } = await import('./profile/page');

const bn = appApplicantCatalog.bn as Record<string, string>;
const en = appApplicantCatalog.en as Record<string, string>;
const K = 'appApplicant.appApplicantId';
const BENGALI = /[ঀ-৿]/;

const editor = (locale: 'en' | 'bn', startWithAll = false) =>
  textOf(
    renderToStaticMarkup(
      <I18nProvider locale={locale} pageLang={locale}>
        <ProfileEditor
          applicantId="synthetic-person"
          values={{}}
          repeatingValues={{}}
          assurance={new Map()}
          view={fixtureView()}
          startWithAll={startWithAll}
        />
      </I18nProvider>,
    ),
  );

async function page(locale: 'en' | 'bn') {
  current.holder = null;
  current.locale = locale;
  await primeLocale();
  const built = (await ProfilePage({
    params: Promise.resolve({ id: 'person' }),
    searchParams: Promise.resolve({}),
  } as never)) as React.ReactElement;
  // The root layout puts the language around every page; client components read it from there.
  return textOf(
    await renderServer(
      <I18nProvider locale={locale} pageLang={locale}>
        {built}
      </I18nProvider>,
    ),
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  service.getApplicant.mockResolvedValue({
    id: 'person',
    displayName: 'Karim Hossain',
    relationship: 'SELF',
    ownerAccountId: 'owner',
    createdAt: new Date('2026-01-01'),
  });
  service.getProfileSectionState.mockResolvedValue({
    activated: new Set(),
    notApplicable: new Set(),
    noneDeclared: new Set(),
  });
  service.getWalletView.mockResolvedValue({ ok: true, value: [] });
  service.hasConsent.mockResolvedValue(true);
  service.listApplicantAssurance.mockResolvedValue({ ok: true, value: [] });
  service.listApplicantProfile.mockResolvedValue([]);
  service.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [] });
  service.listPendingAppSuggestions.mockResolvedValue([]);
  service.aiSuggestionsInUse.mockResolvedValue(false);
  service.requireAccess.mockResolvedValue({ ok: true, value: { proof: 'owner' } });
  service.listEndedRecords.mockResolvedValue(new Map());
});
afterEach(() => {
  current.locale = 'en';
});

const P = `${K}ProfilePage.`;
const E = `${K}ProfileEditor.`;

describe('the profile page under Bengali', () => {
  it('shows the page, the editor frame and the health counts in Bengali', async () => {
    const text = await page('bn');
    for (const key of [
      'myProfile',
      'addInformation',
      'aboutThisProfile',
      'aboutEssentials',
      'essentialsAdded',
      'profileHealth',
      'confirmedByTheTraveller',
      'fieldsBackedByADocument',
      'fieldsThatDoNotMatch',
      'latestChanges',
      'noSavedChangesYet',
      'yourSavedFieldVersionsWillAppear',
      'allProfileHistory',
      'aboutSuggestions',
      'reviewDocumentSuggestions',
    ])
      expect(text, key).toContain(bn[`${P}${key}`]);
    // The editor inside the page is read under the same language.
    for (const key of ['essentialsFirst', 'showAllSections', 'noneRecordedYet', 'apply'])
      expect(text, key).toContain(bn[`${E}${key}`]);
    expect(text).toContain(`${bn[`${P}confirmedByTheTraveller`]} ০`);
    expect(text).toContain(`${bn[`${P}fieldsThatDoNotMatch`]} ০`);
    expect(text).not.toMatch(/appApplicant\./);
  });

  it('keeps the AI approval promises and the unchecked identity line in English', async () => {
    const text = await page('bn');
    for (const key of [`${P}aiSuggestionsDoNotChangeYour`, `${P}theDetailsMostVisaFormsAsk`]) {
      expect(key in bn, key).toBe(false);
      expect(text, key).toContain(en[key] ?? 'MISSING');
    }
    expect(text).toContain('This does not verify identity.');
  });

  it('shows the profile in the state with a saved change, still with Bengali labels', async () => {
    service.listApplicantProfile.mockResolvedValue([
      {
        factId: 'f1',
        fieldKey: 'given_name',
        repeatingRecordKey: null,
        value: 'Karim',
        status: 'APPLICANT_CONFIRMED',
        method: 'MANUAL',
        updatedAt: '2026-10-10T12:00:00Z',
        effectiveFrom: null,
        isProtected: false,
        sourceDocumentId: null,
      },
    ]);
    const text = await page('bn');
    expect(text).toContain(bn[`${P}latestChanges`]);
    expect(text).toContain(bn[`${P}confirmedByTheTraveller`]);
    expect(text).toContain('Karim');
    expect(text).not.toMatch(/appApplicant\./);
  });

  it('is the same English as before under English, with no Bengali', async () => {
    const text = await page('en');
    expect(text).not.toMatch(BENGALI);
    expect(text).toContain('My Profile');
    expect(text).toContain('Essentials First');
    expect(text).toContain('Show All Sections');
  });
});

describe('the profile editor under Bengali', () => {
  it('shows the open section, its fields and the note about other items in Bengali', () => {
    const text = editor('bn', true);
    for (const key of [
      'addTheDateThisBecameTrue',
      'thisDoesNotApplyToMe',
      'apply',
      'notOnTheListAddIt',
      'noneRecordedYet',
      'locked',
    ])
      expect(text, key).toContain(bn[`${E}${key}`]);
    expect(text).toContain('যোগ করুন');
    // Field names come from the profile catalogue and stay as they are.
    expect(text).toContain('Given Name');
    expect(text).not.toMatch(/appApplicant\./);
  });

  it('shows the locked section and the essentials-only view in each of their states', () => {
    const all = editor('bn', true);
    expect(all).toContain(bn[`${E}locked`]);
    const essentialsOnly = editor('bn', false);
    expect(essentialsOnly).not.toMatch(/appApplicant\./);
    // Held or not yet drafted: English shows, never a raw key.
    for (const key of [`${E}noLongerCurrentLabel`, `${E}iHaveNoTolowercase`]) {
      expect(key in bn, key).toBe(false);
    }
    expect(all).toContain('Use This Section');
  });

  it('is the same English as before under English', () => {
    const text = editor('en', true);
    expect(text).not.toMatch(BENGALI);
    expect(text).toContain('This does not apply to me');
    expect(text).toContain('Add the Date This Became True');
  });
});
