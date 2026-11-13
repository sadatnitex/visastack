import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appApplicantCatalog } from '../../../../../i18n/app-applicant';
import { renderServer, textOf } from '../../../../../lib/next-mocks.test-support';

/**
 * The Expiry page under Bengali (refill 7): the note under a date the person typed, and the held
 * English note for a typed date that differs from the one read. The page is the real
 * server page; the services stand in with made-up data.
 */

const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', holder: null as unknown }));
// The locale is set here directly, as the language cookie would.
vi.mock('../../../../../lib/locale', () => ({ getLocale: async () => state.locale }));
// Outside the server runtime React's cache remembers nothing; stand in for one request per render.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: (build: () => unknown) => () => {
    state.holder ??= build();
    return state.holder;
  },
}));

const service = vi.hoisted(() => ({
  getApplicant: vi.fn(),
  listDocumentsDetailed: vi.fn(),
  getReminderThresholds: vi.fn(),
  listIssuerVerificationsForDocument: vi.fn(),
  listMissions: vi.fn(),
  getEvidenceCandidates: vi.fn(),
  accountPrincipal: vi.fn(),
  requireAccess: vi.fn(),
  listDeadlineClock: vi.fn(),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  ...service,
}));
vi.mock('../../../../../lib/ccd/depth.server', () => ({ readDepth: async () => 'auto' }));
vi.mock('../../../../../lib/session', () => ({
  withSession: (callback: (ctx: unknown) => unknown) => callback({ db: {}, accountId: 'owner' }),
}));

const { default: Page } = await import('./page');

const bn = appApplicantCatalog.bn as Record<string, string>;
const en = appApplicantCatalog.en as Record<string, string>;
const K = 'appApplicant.appApplicantIdExpiryPage.';

async function page(locale: 'en' | 'bn') {
  state.locale = locale;
  state.holder = null;
  return textOf(await renderServer(Page({ params: Promise.resolve({ id: 'person' }) })));
}

beforeEach(() => {
  vi.resetAllMocks();
  const soon = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000).toISOString();
  service.getApplicant.mockResolvedValue({ id: 'person', ownerAccountId: 'owner' });
  service.listDocumentsDetailed.mockResolvedValue({
    ok: true,
    value: [
      {
        id: 'd2',
        docType: 'VISA',
        expiresAt: soon,
        approvedName: null,
        originalName: 'typed-visa.pdf',
        expiry: { origin: 'TYPED', typedOn: soon.slice(0, 10), mismatch: false, canType: true },
      },
      {
        id: 'd3',
        docType: 'PASSPORT',
        expiresAt: soon,
        approvedName: null,
        originalName: 'read-passport.pdf',
        expiry: { origin: 'READ', typedOn: '2040-01-01', mismatch: true, canType: true },
      },
    ],
  });
  service.getReminderThresholds.mockResolvedValue([90, 60, 30, 7, 0]);
  service.listIssuerVerificationsForDocument.mockResolvedValue([]);
  service.listMissions.mockResolvedValue({ ok: true, value: [] });
  service.getEvidenceCandidates.mockResolvedValue({ ok: true, value: [] });
  service.accountPrincipal.mockReturnValue({ kind: 'account', accountId: 'owner' });
  service.requireAccess.mockResolvedValue({
    ok: true,
    value: { actor: { kind: 'applicant_owner' }, applicantId: 'person' },
  });
  service.listDeadlineClock.mockResolvedValue({
    ok: true,
    value: { applicantId: 'person', entries: [] },
  });
});

describe('the Expiry page under Bengali', () => {
  it('says a date was entered by the person in Bengali, and keeps the different-date note English', async () => {
    const text = await page('bn');
    expect(text.split(bn[`${K}enteredByYou`] ?? '\u0000')).toHaveLength(2);
    expect(text).not.toContain(en[`${K}enteredByYou`]);
    // Held (refill 7): it names Documents, whose menu item and link are still English.
    expect(bn[`${K}youEnteredADifferentDateCheck`]).toBeUndefined();
    expect(text.split(en[`${K}youEnteredADifferentDateCheck`] ?? '\u0000')).toHaveLength(2);
    // The file names stay as they are.
    expect(text).toContain('typed-visa.pdf');
    expect(text).toContain('read-passport.pdf');
    expect(text).not.toMatch(/appApplicant\./);
  });

  it('is the same English as before under English', async () => {
    const text = await page('en');
    expect(text).not.toMatch(/[ঀ-৿]/);
    expect(text).toContain('Entered by you.');
    expect(text).toContain('You entered a different date. Check which is right on Documents.');
  });
});
