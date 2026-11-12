import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../../../lib/next-mocks.test-support';

vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', generation: 0 }));
const service = vi.hoisted(() => ({
  listConsentHistory: vi.fn(),
  getPendingDeletion: vi.fn(),
  getDeletionImpactSummary: vi.fn(),
  listActiveLegalHoldsForAccount: vi.fn(),
  listAccountExportJobsForAccount: vi.fn(),
}));
vi.mock('../../../lib/locale', () => ({ getLocale: async () => state.locale }));
// Outside the server runtime React's cache remembers nothing; stand in for one request per render.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T extends (...args: never[]) => unknown>(build: T): T => {
    let seen = -1;
    let value: unknown;
    const cached = (...args: Parameters<T>) => {
      if (seen !== state.generation || args.length > 0) {
        seen = state.generation;
        value = build(...args);
      }
      return value;
    };
    return cached as unknown as T;
  },
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  ...service,
}));
vi.mock('../../../lib/session', () => ({
  withSession: (callback: (ctx: unknown) => unknown) => callback({ db: {}, accountId: 'owner' }),
}));
vi.mock('../../../lib/ccd/depth.server', () => ({ readDepth: async () => 'auto' }));
vi.mock('../../../lib/ai-usage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/ai-usage')>()),
  readAiUsage: async () => null,
}));
vi.mock('./actions', () => ({
  requestDeletionAction: async () => ({ ok: true, message: '' }),
  cancelDeletionAction: async () => ({ ok: true, message: '' }),
  requestLargeExportAction: async () => ({ ok: true, message: '' }),
}));

import { I18nProvider } from '../../../components/i18n-provider';
import { appPrivacyCatalog } from '../../../i18n/app-privacy';

const { default: PrivacyPage } = await import('./page');
const { DeletionPanel } = await import('./deletion-panel');
const { LargeExportPanel } = await import('./large-export-panel');

const BENGALI = /[ঀ-৿]/;

async function page(locale: 'en' | 'bn') {
  state.locale = locale;
  state.generation += 1;
  const element = await PrivacyPage({ searchParams: Promise.resolve({}) });
  return textOf(await renderServer(<I18nProvider locale={locale} pageLang="en">{element}</I18nProvider>));
}

const consentItems = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    accountId: 'owner',
    type: 'MARKETING',
    grantedAt: new Date(Date.UTC(2026, 9, 1)),
    revokedAt: null,
    createdAt: new Date(Date.UTC(2026, 9, 1)),
  },
];

beforeEach(() => {
  vi.resetAllMocks();
  service.listConsentHistory.mockResolvedValue({ items: [], nextCursor: null });
  service.getPendingDeletion.mockResolvedValue(null);
  service.getDeletionImpactSummary.mockResolvedValue({
    applicants: [],
    missionCount: 0,
    documentCount: 0,
    activePlatformRoleCount: 0,
    authoredMissionNoteCount: 0,
  });
  service.listActiveLegalHoldsForAccount.mockResolvedValue([]);
  service.listAccountExportJobsForAccount.mockResolvedValue([]);
});

describe('privacy screens under Bengali (owner-approved legal wording, PR #518)', () => {
  it('has no Bengali draft for any message on the privacy screens', () => {
    expect(Object.keys(appPrivacyCatalog.bn)).toEqual([]);
  });

  it('empty history: the page is word for word the English page', async () => {
    expect(await page('bn')).toBe(await page('en'));
  });

  it('with consent history: the page is word for word the English page', async () => {
    service.listConsentHistory.mockResolvedValue({ items: consentItems, nextCursor: null });
    const shown = await page('bn');
    expect(shown).toBe(await page('en'));
    expect(shown).not.toMatch(BENGALI);
  });

  it('a pending deletion and a legal hold keep the English wording', async () => {
    service.getPendingDeletion.mockResolvedValue({
      scheduledFor: new Date(Date.UTC(2026, 10, 20)),
    });
    expect(await page('bn')).toBe(await page('en'));
  });

  it('the deletion and export panels stay English', async () => {
    const render = (locale: 'en' | 'bn') =>
      textOf(
        renderToStaticMarkup(
          <I18nProvider locale={locale} pageLang="en">
            <DeletionPanel
              scheduledFor={null}
              impact={{
                applicants: [],
                missionCount: 0,
                documentCount: 0,
                activePlatformRoleCount: 0,
                authoredMissionNoteCount: 0,
              }}
              holds={[]}
            />
            <LargeExportPanel
              jobs={[
                {
                  id: 'j1',
                  status: 'READY',
                  createdAt: '2026-10-01T00:00:00Z',
                  readyAt: '2026-10-01T00:05:00Z',
                  expiresAt: '2026-10-02T00:05:00Z',
                  lastError: null,
                },
              ]}
            />
          </I18nProvider>,
        ),
      );
    const shown = render('bn');
    expect(shown).toBe(render('en'));
    expect(shown).toContain('Request Account Deletion');
    expect(shown).not.toMatch(BENGALI);
  });
});
