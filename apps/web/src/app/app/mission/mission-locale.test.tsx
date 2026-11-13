import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bengaliMarking } from '../../../lib/bengali-marked.test-support';
vi.mock('server-only', () => ({}));
vi.mock('./[id]/actions', () => ({
  transitionMissionAction: vi.fn(),
  snapshotMissionAction: vi.fn(),
  deleteCancelledCaseAction: vi.fn(),
}));
// The language switch is off in the product, so the locale is set here directly.
const current = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', holder: null as unknown }));
vi.mock('../../../lib/locale', () => ({ getLocale: async () => current.locale }));
// Outside the server runtime React's cache remembers nothing; stand in for one request per render.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: (build: () => unknown) => () => {
    current.holder ??= build();
    return current.holder;
  },
}));

import { I18nProvider } from '../../../components/i18n-provider';
import { appMissionCatalog } from '../../../i18n/app-mission';
import { primeLocale } from '../../../lib/i18n-server';
import { CaseMobileBar } from './[id]/case-mobile-bar';
import type { CaseAttentionItem } from './[id]/case-model';
import { CaseMoreMenu } from './[id]/case-more-menu';

const BENGALI = /[ঀ-৿]/;
const bn = appMissionCatalog.bn as Record<string, string>;
const en = appMissionCatalog.en as Record<string, string>;
const sources = JSON.parse(
  readFileSync(join(__dirname, '../../../i18n/app-mission.sources.json'), 'utf8'),
) as Record<string, string>;

/** Register rows that were held back for sign-off: official requirement wording, sharing, access, deletion, AI. */
const HELD = [
  'SG-a5fa0621',
  'SG-9574696f',
  'SG-8987f99a',
  'SG-991b05ef',
  'SG-079d1f0e',
  'SG-e4a97e33',
  'SG-98c55098',
  'SG-f0bd6092',
  'SG-63dab094',
  'SG-d3914f71',
  'SG-5efa8d43',
  'SG-84514c27',
  'SG-c0b36ea9',
  // Label in name: the visible button text is still English, so its screen reader name stays English.
  'SG-86f84a55',
];

const missing: CaseAttentionItem = {
  kind: 'missing',
  label: 'required items to fix',
  href: '#readiness',
  count: 4,
  tone: 'danger',
  opens: 'case-checklist-needs-you',
};

async function bar(locale: 'en' | 'bn', progress: { done: number; total: number } | null) {
  current.holder = null;
  current.locale = locale;
  await primeLocale();
  return renderToStaticMarkup(<CaseMobileBar nextStep={missing} progress={progress} />);
}

afterEach(() => {
  current.locale = 'en';
});

describe('the case screens under Bengali', () => {
  it('shows the Bengali label and keeps Latin digits in a message that has no Bengali yet', async () => {
    const html = await bar('bn', { done: 6, total: 12 });
    // "{done} of {total}" has no Bengali value, so it stays English and its digits stay Latin.
    expect(html).toContain('>6 of 12<');
    expect(html).toContain(bn['appMission.appMissionIdCaseMobileBar.nextStep']);
    expect(html).not.toMatch(/appMission\./);
  });

  it('still renders the bar when there is no checklist progress yet', async () => {
    const html = await bar('bn', null);
    expect(html).toContain(bn['appMission.appMissionIdCaseMobileBar.nextStep']);
    expect(html).not.toContain('of');
  });

  // Owner sign-off of 2026-11-12: all but three of these now have Bengali. SG-a5fa0621 is held after
  // reading (official authority was rendered as government authority); SG-c0b36ea9 is a count
  // built from an English word helper; SG-86f84a55 is a button name whose visible text is English.
  const STILL_HELD = ['SG-a5fa0621', 'SG-c0b36ea9', 'SG-86f84a55'];
  it('shows the signed-off sharing, access, deletion and AI wording in Bengali and keeps one sentence English', () => {
    const entries = Object.entries(sources).filter(([, group]) => HELD.includes(group));
    expect(entries.length).toBeGreaterThanOrEqual(HELD.length);
    for (const [key, group] of entries) {
      expect(en[key], key).toBeTruthy();
      expect(key in bn, key).toBe(!STILL_HELD.includes(group));
    }
  });

  it('leaves no raw placeholder in any Bengali string', () => {
    for (const [key, text] of Object.entries(bn)) {
      const names = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
      expect(names(text), key).toBe(names(en[key] ?? ''));
    }
  });
});

describe('the case screens under English', () => {
  it('renders the original English text with no Bengali', async () => {
    const html = await bar('en', { done: 6, total: 12 });
    expect(html).not.toMatch(BENGALI);
    expect(html).toContain('6 of 12');
  });
});

describe('the case screens, language of parts', () => {
  it('marks the Bengali on an English page lang="bn"', () => {
    const r = bengaliMarking(
      renderToStaticMarkup(
        <I18nProvider locale="bn" pageLang="en">
          <CaseMoreMenu missionId="case-1" applicantId="person-1" canCancel canDelete={false} />
        </I18nProvider>,
      ),
    );
    expect(r.unmarked).toEqual([]);
    expect(r.marked).toBeGreaterThan(0);
  });
});
