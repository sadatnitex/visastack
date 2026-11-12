import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
// The language switch is off in the product, so the locale is set here directly.
const current = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', holder: null as unknown }));
vi.mock('../../../../../lib/locale', () => ({ getLocale: async () => current.locale }));
// Outside the server runtime React's cache remembers nothing; stand in for one request per render.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: (build: () => unknown) => () => {
    current.holder ??= build();
    return current.holder;
  },
}));

const mocks = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  listApplicantProfile: vi.fn(),
  getProfileSectionState: vi.fn(),
  getWalletView: vi.fn(),
  listDocumentsDetailed: vi.fn(),
}));
vi.mock('@visastack/services', async (original) => ({
  ...(await original<typeof import('@visastack/services')>()),
  ...mocks,
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) => fn({ db: {}, accountId: 'owner' }),
}));

import { appApplicantCatalog } from '../../../../../i18n/app-applicant';
import { primeLocale } from '../../../../../lib/i18n-server';
import { renderServer, stub, stubProps, textOf } from '../../../../../lib/next-mocks.test-support';
import type { RecordItem } from '../record-hub';

vi.mock('../record-browser', () => ({ RecordBrowser: stub('RecordBrowser') }));
const { default: Page } = await import('./page');

const bn = appApplicantCatalog.bn as Record<string, string>;
const en = appApplicantCatalog.en as Record<string, string>;
const K = 'appApplicant.appApplicantIdRecordPage.';
const BENGALI = /[ঀ-৿]/;
const person = '10000000-0000-4000-8000-000000000001';

async function render(locale: 'en' | 'bn') {
  current.holder = null;
  current.locale = locale;
  await primeLocale();
  return renderServer(Page({ params: Promise.resolve({ id: person }) }));
}

const walletRow = {
  document: {
    id: 'd1',
    approvedName: null,
    originalName: 'Synthetic bank statement',
    docType: 'BANK_STATEMENT',
    subject: null,
    expiresAt: new Date('2030-01-01T00:00:00Z'),
    supersededByDocumentId: null,
  },
  status: 'CURRENT',
  usedInMissions: [],
  accessibleTo: [],
};
const summary = {
  id: 'd1',
  safetyStatus: 'CLEAN',
  processingStatus: 'AWAITING_REVIEW',
  latestVersionNumber: 1,
  updatedAt: '2026-10-01T00:00:00.000Z',
  classification: null,
  pendingNameVersion: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getApplicant.mockResolvedValue({
    id: person,
    ownerAccountId: 'owner',
    displayName: 'Synthetic Self',
  });
  mocks.listApplicantProfile.mockResolvedValue([]);
  mocks.getProfileSectionState.mockResolvedValue({
    activated: new Set(),
    notApplicable: new Set(),
    noneDeclared: new Set(),
  });
  mocks.getWalletView.mockResolvedValue({ ok: true, value: [] });
  mocks.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [] });
});
afterEach(() => {
  current.locale = 'en';
});

describe('the Record hub page under Bengali', () => {
  it('shows the title, the description with the name and the two actions in Bengali', async () => {
    const text = textOf(await render('bn'));
    expect(text).toContain(bn[`${K}allRecords`]);
    expect(text).toContain(bn[`${K}addADocument`]);
    expect(text).toContain(bn[`${K}updateYourProfile`]);
    expect(text).toContain('Synthetic Self-এর জন্য সংরক্ষিত সবকিছু');
    // The small label above the title has no Bengali draft yet, so it stays English.
    expect('appApplicant.appApplicantIdExpiryPage.record' in bn).toBe(false);
    expect(text).toMatch(/^Record /);
    expect(text).not.toMatch(/appApplicant\./);
  });

  it('draws the not-yet-drafted empty-vault line in English, never a raw key', async () => {
    const text = textOf(await render('bn'));
    expect(`${K}youHaveNotAddedADocument` in bn).toBe(false);
    expect(text).toContain(en[`${K}youHaveNotAddedADocument`]);
  });

  it('shows the could-not-load state, which is held, in English, and gives the list its dates in Bengali digits', async () => {
    mocks.getWalletView.mockResolvedValue({ ok: true, value: [walletRow] });
    mocks.listDocumentsDetailed.mockResolvedValue({ ok: true, value: [summary] });
    const html = await render('bn');
    const [props] = stubProps<{ items: RecordItem[] }>(html, 'RecordBrowser');
    const doc = props?.items.find((item) => item.kind === 'document');
    const dates = JSON.stringify(doc?.facts ?? []);
    expect(dates).toMatch(BENGALI);
    mocks.getWalletView.mockResolvedValue({ ok: false, error: { code: 'internal', message: 'x' } });
    const failed = textOf(await render('bn'));
    expect(failed).toContain(en[`${K}yourDocumentsCouldNotBeLoaded`]);
  });

  it('is the same English as before under English', async () => {
    const text = textOf(await render('en'));
    expect(text).not.toMatch(BENGALI);
    expect(text).toContain('All Records');
    expect(text).toContain('Add a Document');
  });
});
