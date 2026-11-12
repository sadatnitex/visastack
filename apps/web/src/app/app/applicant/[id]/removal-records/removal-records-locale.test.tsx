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

const service = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  listDeletionReceipts: vi.fn(),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  ...service,
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: (callback: (ctx: unknown) => unknown) => callback({ db: {}, accountId: 'owner' }),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  // primeLocale lets Next's own signals travel on; nothing here throws one.
  unstable_rethrow: () => undefined,
}));

import { appApplicantCatalog } from '../../../../../i18n/app-applicant';
import { primeLocale } from '../../../../../lib/i18n-server';
import { renderServer, textOf } from '../../../../../lib/next-mocks.test-support';

const { default: RemovalRecordsPage } = await import('./page');

const bn = appApplicantCatalog.bn as Record<string, string>;
const en = appApplicantCatalog.en as Record<string, string>;
const K = 'appApplicant.appApplicantIdRemovalRecordsPage.';
const BENGALI = /[ঀ-৿]/;

async function render(locale: 'en' | 'bn') {
  current.holder = null;
  current.locale = locale;
  await primeLocale();
  return textOf(await renderServer(RemovalRecordsPage({ params: Promise.resolve({ id: 'a1' }) })));
}

const record = {
  id: 'r1',
  subjectKind: 'DOCUMENT',
  subjectCode: 'D-7K2Q9M',
  documentKind: 'passport',
  scheduledFor: null,
  verifiedGoneAt: null,
  requestedAt: new Date('2026-11-03T14:05:00Z'),
  requestedBy: 'OWNER_ACCOUNT',
  approvedBy: null,
  status: 'REMOVING',
  effects: {},
};

beforeEach(() => {
  vi.resetAllMocks();
  service.requireAccess.mockResolvedValue({
    ok: true,
    value: { actor: { kind: 'applicant_owner' } },
  });
  service.listDeletionReceipts.mockResolvedValue({ ok: true, value: [record] });
});
afterEach(() => {
  current.locale = 'en';
});

describe('the Removal Records page under Bengali', () => {
  it('shows the title and the records heading in Bengali, with the same term the tab uses', async () => {
    const text = await render('bn');
    expect(text).toContain(bn[`${K}removalRecords`]);
    expect(text).toContain(bn[`${K}records`]);
    // One Bengali name for Removal Records everywhere it is a label.
    expect(bn[`${K}removalRecords`]).toBe(
      bn['appApplicant.appApplicantIdDocumentsManageLifecycleTabs.removalRecords'],
    );
    expect(text).not.toMatch(/appApplicant\./);
  });

  it('shows the explanation in Bengali (signed off 2026-11-12) and keeps the record lines English', async () => {
    const text = await render('bn');
    expect(`${K}whatWasDeletedFromThisRecord` in bn).toBe(true);
    expect(text).toContain(bn[`${K}whatWasDeletedFromThisRecord`]);
    expect(text).toContain('Removing Securely: Passport D-7K2Q9M.');
    expect(text).toContain('Times are shown in UTC.');
  });

  it('shows the empty state in each language without a raw key', async () => {
    service.listDeletionReceipts.mockResolvedValue({ ok: true, value: [] });
    const text = await render('bn');
    expect(text).toContain('Nothing has been removed from this record.');
    expect(text).toContain(bn[`${K}removalRecords`]);
    expect(text).not.toMatch(/appApplicant\./);
    void en;
  });

  it('is the same English as before under English', async () => {
    const text = await render('en');
    expect(text).not.toMatch(BENGALI);
    expect(text).toContain('Removal Records');
  });
});
