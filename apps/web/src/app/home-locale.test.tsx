import { describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../lib/next-mocks.test-support';

vi.mock('server-only', () => ({}));
// The locale is set here directly, as the auth screens' test does.
const current = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', generation: 0, betaOpen: false }));
vi.mock('../lib/locale', () => ({ getLocale: async () => current.locale }));
// Outside the server runtime React's cache remembers nothing; stand in for one request per render.
// Each cached function keeps its own result, per request.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T extends (...args: never[]) => unknown>(build: T): T => {
    let seen = -1;
    let value: unknown;
    const cached = (...args: Parameters<T>) => {
      if (seen !== current.generation || args.length > 0) {
        seen = current.generation;
        value = build(...args);
      }
      return value;
    };
    return cached as unknown as T;
  },
}));
vi.mock('../lib/public-beta', () => ({ isPublicBetaOpen: () => current.betaOpen }));
vi.mock('../lib/signed-in', () => ({ isSignedIn: async () => false }));

import { homeCatalog } from '../i18n/home';

const { default: HomePage } = await import('./page');

const BENGALI = /[\u0980-\u09FF]/;

async function render(locale: 'en' | 'bn') {
  current.locale = locale;
  current.generation += 1;
  return textOf(await renderServer(HomePage({ searchParams: Promise.resolve({}) })));
}

/** Every string that used to sit in the landing page's own lists, exactly as it was written. */
const OLD_LIST_ENGLISH = [
  'A clean file',
  'you can stand behind.',
  'Passport',
  'Current record · Version 2',
  'Current',
  'Employment Letter',
  'Added to Japan case',
  'Added',
  'Bank Statement',
  'Newer copy requested',
  'Update',
  'Document Needs Updating',
  'Bank statement · Japan case',
  'Previous Version Kept',
  'History stays available to you',
  'Reminder Before It Expires',
  'Passport · sample record',
  'Access Ends 30 November',
  'Three selected records shared',
  'The same passport scan sent again for every application',
  'Documents buried in chats, emails and phone galleries',
  'No idea which version an agency is holding',
  'Surprise requests for papers that have quietly expired',
  'Enter your details once and reuse them everywhere',
  'Every document in one private place, with its date',
  'Every change kept as a new version you can look back on',
  'A warning before a document runs out, not after',
  'Add Your Details Once',
  'Fill in your profile and upload your documents. Each change is saved with its date, so you can always see what was added and when.',
  'See what is missing',
  'Pick a visa route and check your file against its requirements. You see what is complete, what is missing and what is close to expiring.',
  'Share only what is needed',
  'Invite an agency to see specific items for a set time. You approve it, you can stop it, and you can see what they opened.',
  'For travellers',
  'Know where your papers are and what to do next',
  'Store passport and supporting documents once, then reuse them',
  'See which documents are missing for each visa route',
  'Answer an agency’s document request in one place',
  'For Agencies',
  'Stop Chasing Documents by Message',
  'Ask a client for a specific document and see when it arrives',
  'Open a case and see at once what is missing or overdue',
  'Keep a clear record of who did what, and when',
  'Record sharing starts with your permission',
  'Sharing decisions are recorded',
  'Changes are kept as new versions',
  'Official information shows where it came from',
  'AI never changes your profile on its own',
  'A manual way to manage your profile',
  'In the Pilot Today',
  'The Core of One Profile',
  'Your profile with saved versions, a private document vault, document checks against official requirements, and sharing with agencies.',
  'Being Switched On',
  'Help That Stays in Your Hands',
  'AI suggestions from your documents and earlier warnings before papers expire, each switched on step by step. The status page shows exactly what works today.',
  'Where we are heading',
  'One Trusted File for Every Journey',
  'We are working toward a single, verified file that follows a person across visa routes and countries, and gives agencies a calm, clear way to work with it.',
];

describe('the home page lists (the former module-level label maps)', () => {
  it('render their exact old English under en', async () => {
    const text = await render('en');
    for (const english of OLD_LIST_ENGLISH) expect(text, english).toContain(english);
    expect(text).not.toMatch(BENGALI);
    expect(text).not.toMatch(/home\.page\./);
  });
});

describe('the home page under Bengali', () => {
  it('shows Bengali where the catalogue has it and no raw keys or placeholders', async () => {
    const text = await render('bn');
    expect(text).toMatch(BENGALI);
    expect(text).toContain(homeCatalog.bn['home.page.passport']);
    expect(text).toContain(homeCatalog.bn['home.page.addYourDetailsOnce']);
    expect(text).not.toMatch(/home\.(page|countryChecklistPicker)\.[a-zA-Z0-9]+/);
    expect(text).not.toMatch(/\{[A-Za-z]+\}/);
  });

  it('shows English where a key has no Bengali yet', async () => {
    const text = await render('bn');
    // Register ambiguity and the version-wording review leave these four in English.
    for (const key of [
      'home.page.previousVersionKept',
      'home.page.noIdeaWhichVersionAnAgency',
      'home.page.openYourWorkspace',
      'home.page.createYourFreeAccount',
    ] as const) {
      expect(key in homeCatalog.bn, key).toBe(false);
      // The workspace and free-account buttons show only to other visitors, so only the catalogue is checked.
      if (key !== 'home.page.openYourWorkspace' && key !== 'home.page.createYourFreeAccount')
        expect(text, key).toContain(homeCatalog.en[key]);
    }
  });

  // Owner sign-off of 2026-11-12 (blanket approval): the legal, privacy and consent wording is Bengali now.
  it('shows the signed-off privacy heading, sharing wording and consent promise in Bengali', async () => {
    const text = await render('bn');
    for (const key of [
      'home.page.howVisastackTreatsYourInformation',
      'home.page.selectRecordsReviewTheScopeAnd',
      'home.page.recordSharingStartsWithYourPermission',
    ] as const) {
      expect(key in homeCatalog.bn, key).toBe(true);
      expect(text, key).toContain(homeCatalog.bn[key]);
      expect(text, key).not.toContain(homeCatalog.en[key]);
    }
  });

  it('shows the risk notice in Bengali while the public beta is open', async () => {
    current.betaOpen = true;
    try {
      const key = 'home.page.itIsFreeToUseAt' as const;
      expect(key in homeCatalog.bn).toBe(true);
      const text = await render('bn');
      expect(text).toContain(homeCatalog.bn[key]);
      expect(text).not.toContain(homeCatalog.en[key]);
    } finally {
      current.betaOpen = false;
    }
  });

  it('has no raw placeholder in any Bengali string', () => {
    for (const [key, value] of Object.entries(homeCatalog.bn)) {
      const bare = value.replace(/\{[A-Za-z]+\}/g, '');
      expect(bare, key).not.toMatch(/[{}]/);
    }
  });
});
