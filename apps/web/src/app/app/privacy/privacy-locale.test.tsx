import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bengaliMarking } from '../../../lib/bengali-marked.test-support';
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
const usage = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('../../../lib/ai-usage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/ai-usage')>()),
  readAiUsage: async () => usage.value,
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
const markups: string[] = [];

async function page(locale: 'en' | 'bn') {
  state.locale = locale;
  state.generation += 1;
  const element = await PrivacyPage({ searchParams: Promise.resolve({}) });
  const markup = await renderServer(
    <I18nProvider locale={locale} pageLang="en">
      {element}
    </I18nProvider>,
  );
  // The markup (attributes included) is kept for the coverage check; the text is what a reader sees.
  if (locale === 'bn') markups.push(markup);
  return textOf(markup);
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

const bn = appPrivacyCatalog.bn as Record<string, string>;
const en = appPrivacyCatalog.en as Record<string, string>;
/** Every Bengali screen drawn below, to measure that each live Bengali message is rendered. */
const seen: string[] = [];
const drawPanels = (
  locale: 'en' | 'bn',
  jobs: Parameters<typeof LargeExportPanel>[0]['jobs'],
  scheduledFor: Date | null = null,
) =>
  textOf(
    renderToStaticMarkup(
      <I18nProvider locale={locale} pageLang="en">
        <DeletionPanel
          scheduledFor={scheduledFor}
          impact={{
            applicants: [],
            missionCount: 0,
            documentCount: 0,
            activePlatformRoleCount: 0,
            authoredMissionNoteCount: 0,
          }}
          holds={[]}
        />
        <LargeExportPanel jobs={jobs} />
      </I18nProvider>,
    ),
  );
const job = (status: string, lastError: string | null = null) => ({
  id: 'j1',
  status,
  createdAt: '2026-10-01T00:00:00Z',
  readyAt: status === 'READY' ? '2026-10-01T00:05:00Z' : null,
  expiresAt: '2026-10-02T00:05:00Z',
  lastError,
});

describe('privacy screens under Bengali (owner-approved legal wording, signed off 2026-11-12)', () => {
  it('has a Bengali draft for each message with a cleared one, and none without an English twin', () => {
    expect(Object.keys(bn).length).toBeGreaterThanOrEqual(24);
    for (const key of Object.keys(bn)) expect(en[key], key).toBeTruthy();
  });

  it('empty history: the page shows the Bengali headings and sentences, no raw key', async () => {
    const shown = await page('bn');
    seen.push(shown);
    expect(shown).toMatch(BENGALI);
    for (const key of [
      'appPrivacy.appPrivacyPage.privacyConsent',
      'appPrivacy.appPrivacyPage.yourRights',
      'appPrivacy.appPrivacyPage.exportYourData',
      'appPrivacy.appPrivacyPage.deleteYourAccount',
      'appPrivacy.appPrivacyPage.whatHappensToYourAuditTrail',
      'appPrivacy.appPrivacyPage.yourAuditTrailIsKeptAs',
      'appPrivacy.appPrivacyPage.deletionIsReversibleDuringA7',
      'appPrivacy.appPrivacyPage.eachTimeYouTurnAPermission',
    ]) {
      // A heading shows in the text; a label read by screen readers sits in an attribute.
      expect(shown + (markups.at(-1) ?? ''), key).toContain(bn[key]);
      expect(shown, key).not.toContain(en[key]);
    }
    // A label read by screen readers is Bengali too (it sits in an attribute, not in the text).
    expect(markups.at(-1)).toContain(`aria-label="${bn['appPrivacy.appPrivacyPage.yourRights']}"`);
    expect(shown).not.toMatch(/appPrivacy\./);
    expect(await page('en')).not.toMatch(BENGALI);
  });

  it('with consent history: the history heading and the entries label are Bengali', async () => {
    service.listConsentHistory.mockResolvedValue({ items: consentItems, nextCursor: null });
    const shown = await page('bn');
    seen.push(shown);
    for (const key of ['appPrivacy.appPrivacyPage.consentHistory'])
      expect(shown + (markups.at(-1) ?? ''), key).toContain(bn[key]);
    expect(markups.at(-1)).toContain(bn['appPrivacy.appPrivacyPage.consentHistoryEntries']);
    expect(await page('en')).not.toMatch(BENGALI);
  });

  it('the AI use card is Bengali when usage is shown', async () => {
    usage.value = [
      {
        feature: 'DOCUMENT_READING',
        name: 'Document Reading',
        unit: 'files',
        used: 1,
        dailyLimit: 5,
        available: true,
        reason: null,
      },
    ];
    try {
      const shown = await page('bn');
      for (const key of [
        'appPrivacy.appPrivacyPage.aiUseToday',
        'appPrivacy.appPrivacyPage.howMuchYouUsedEachAi',
      ])
        expect(shown, key).toContain(bn[key]);
    } finally {
      usage.value = null;
    }
  });

  it('a pending deletion keeps working under Bengali and English', async () => {
    service.getPendingDeletion.mockResolvedValue({
      scheduledFor: new Date(Date.UTC(2026, 10, 20)),
    });
    const shown = await page('bn');
    seen.push(shown);
    expect(shown).not.toMatch(/appPrivacy\./);
    expect(await page('en')).not.toMatch(BENGALI);
  });

  it('the deletion and export panels are Bengali, and English under en', () => {
    const shown = drawPanels('bn', [job('READY')]);
    seen.push(shown, drawPanels('bn', []));
    for (const key of [
      'appPrivacy.appPrivacyDeletionPanel.requestAccountDeletion',
      'appPrivacy.appPrivacyLargeExportPanel.needTheActualDocumentFilesToo',
    ])
      expect(shown, key).toContain(bn[key]);
    expect(drawPanels('en', [job('READY')])).not.toMatch(BENGALI);
    expect(drawPanels('en', [job('READY')])).toContain('Request Account Deletion');
  });

  it('live N, rendered N: every live Bengali message was shown by a state above', () => {
    const text = [...seen, ...markups].join('\n');
    const shownValue = (value: string) =>
      value.split(/\{\w+\}/).every((part) => text.includes(part));
    // The confirmation that opens after the request button is a client state: it is drawn, and
    // asserted, in deletion-panel-locale.test.tsx.
    const elsewhere = new Set([
      bn['appPrivacy.appPrivacyDeletionPanel.schedulePermanentDeletionOfYourAccount'],
    ]);
    expect(
      Object.values(bn).filter((value) => !elsewhere.has(value) && !shownValue(value)),
    ).toEqual([]);
  });
});

describe('privacy screens, language of parts', () => {
  it('has no Bengali to mark, and the English activity log carries no language mark', async () => {
    state.locale = 'bn';
    state.generation += 1;
    const element = await PrivacyPage({ searchParams: Promise.resolve({}) });
    const html = await renderServer(
      <I18nProvider locale="bn" pageLang="en">
        {element}
      </I18nProvider>,
    );
    const r = bengaliMarking(html);
    expect(r.unmarked).toEqual([]);
    expect(r.marked).toBe(0);
    expect(html).not.toContain('lang="');
  });
});
