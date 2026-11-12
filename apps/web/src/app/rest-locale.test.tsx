import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@neondatabase/auth/next/server', () => ({ createNeonAuth: vi.fn() }));
// The locale is set here directly, as the auth screens' test does.
const current = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', holder: null as unknown }));
vi.mock('../lib/locale', () => ({ getLocale: async () => current.locale }));
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: (build: () => unknown) => () => {
    current.holder ??= build();
    return current.holder;
  },
}));
vi.mock('../lib/providers', () => ({
  createIdentityPort: () => ({ currentIdentity: async () => null }),
}));
vi.mock('../lib/session', () => ({
  withSession: async () => ({ ok: false, reason: 'not_found' }),
}));

import { HOLDBACK } from '../../../../scripts/i18n/register.mjs';
import { I18nProvider } from '../components/i18n-provider';
import { appClientInvitationsCatalog } from '../i18n/app-client-invitations';
import { appContributorRequestsCatalog } from '../i18n/app-contributor-requests';
import { appInvitationsCatalog } from '../i18n/app-invitations';
import { appSharingInvitationsCatalog } from '../i18n/app-sharing-invitations';
import { homeCatalog } from '../i18n/home';
import { oauthCatalog } from '../i18n/oauth';
import { paymentsCatalog } from '../i18n/payments';
import { pilotAccessDeniedCatalog } from '../i18n/pilot-access-denied';
import AcceptClientInvitationPage from './app/client-invitations/accept/page';
import AcceptContributorPage from './app/contributor-requests/accept/page';
import AcceptInvitationPage from './app/invitations/accept/page';
import AppError from './error';
import PilotAccessDeniedPage from './pilot-access-denied/page';

const BENGALI = /[ঀ-৿]/;
const noToken = { searchParams: Promise.resolve({}) };

const seen: string[] = [];

async function html(build: () => unknown | Promise<unknown>): Promise<Document> {
  current.holder = null;
  const element = (await build()) as Parameters<typeof renderToStaticMarkup>[0];
  const doc = new JSDOM(renderToStaticMarkup(element)).window.document;
  if (current.locale === 'bn') seen.push(doc.body.textContent ?? '');
  return doc;
}

afterEach(() => {
  current.locale = 'en';
});
beforeEach(() => {
  current.holder = null;
});

describe('rest surfaces under Bengali', () => {
  it('pilot-access-denied shows its Bengali drafts and keeps the unsigned legal-style sentence English', async () => {
    current.locale = 'bn';
    const doc = await html(() => PilotAccessDeniedPage());
    expect(doc.querySelector('h1')?.textContent).toBe(
      pilotAccessDeniedCatalog.bn['pilotAccessDenied.pilotAccessDeniedPage.thisPilotIsInviteOnly'],
    );
    expect(doc.body.textContent).toMatch(BENGALI);
    expect(doc.body.textContent).toContain("isn't on the invited list");
  });

  it('pilot-access-denied is unchanged English under English', async () => {
    const doc = await html(() => PilotAccessDeniedPage());
    expect(doc.querySelector('h1')?.textContent).toBe('This pilot is invite-only');
    expect(doc.body.textContent).not.toMatch(BENGALI);
  });

  it.each([
    [
      'invitations',
      () => AcceptInvitationPage(noToken),
      appInvitationsCatalog,
      'appInvitations.appInvitationsAcceptPage.thisInvitationLinkIsMissingIts',
    ],
    [
      'client invitations',
      () => AcceptClientInvitationPage(noToken),
      appClientInvitationsCatalog,
      'appClientInvitations.appClientInvitationsAcceptPage.thisInvitationLinkIsMissingIts',
    ],
    [
      'contributor requests',
      () => AcceptContributorPage(noToken),
      appContributorRequestsCatalog,
      'appContributorRequests.appContributorRequestsAcceptPage.thisLinkIsMissingItsToken',
    ],
  ] as const)(
    '%s: the missing-token state is Bengali under bn and English under en',
    async (_n, build, catalog, key) => {
      const cat = catalog as unknown as { en: Record<string, string>; bn: Record<string, string> };
      current.locale = 'bn';
      expect((await html(build)).body.textContent).toContain(cat.bn[key]);
      current.locale = 'en';
      expect((await html(build)).body.textContent).toContain(cat.en[key]);
    },
  );

  it('error page shows the Bengali Back to Home and keeps the data-safety promise English', async () => {
    const draw = (locale: 'en' | 'bn') =>
      html(() => (
        <I18nProvider locale={locale} pageLang="en">
          <AppError error={Object.assign(new Error('x'), { digest: 'd1' })} reset={() => {}} />
        </I18nProvider>
      ));
    const bn = await draw('bn');
    expect(bn.body.textContent).toContain(homeCatalog.bn['home.error.backToHome']);
    expect(bn.body.textContent).toContain('Everything you already saved is safe');
    expect((await draw('en')).body.textContent).toContain('Back to Home');
  });
});

describe('every live Bengali key of the pilot, error and invitation screens is rendered by a test', () => {
  it('live N, rendered N', () => {
    const text = seen.join('\n');
    const live = [
      ...Object.values(pilotAccessDeniedCatalog.bn),
      ...Object.values(appInvitationsCatalog.bn).filter((v) => v.includes('নেই')),
      ...Object.values(appContributorRequestsCatalog.bn).filter((v) => v.includes('নেই')),
      homeCatalog.bn['home.error.backToHome'] ?? '',
    ];
    expect(live.filter((v) => !text.includes(v))).toEqual([]);
  });
});

describe('held wording is never Bengali', () => {
  const surfaces = [
    ['app-sharing-invitations', appSharingInvitationsCatalog],
    ['app-client-invitations', appClientInvitationsCatalog],
    ['app-contributor-requests', appContributorRequestsCatalog],
    ['app-invitations', appInvitationsCatalog],
    ['oauth', oauthCatalog],
    ['payments', paymentsCatalog],
    ['pilot-access-denied', pilotAccessDeniedCatalog],
    ['home', homeCatalog],
  ] as const;

  it('no key whose register group is in HOLDBACK has a Bengali value, on any surface of this wave', () => {
    let checked = 0;
    for (const [surface, catalog] of surfaces) {
      const sources = JSON.parse(
        readFileSync(path.join(__dirname, '../i18n', `${surface}.sources.json`), 'utf8'),
      ) as Record<string, string | null>;
      for (const [key, groups] of Object.entries(sources)) {
        if (!groups) continue;
        if (!groups.split('|').some((g) => HOLDBACK.has(g))) continue;
        checked += 1;
        expect(Object.keys(catalog.bn), key).not.toContain(key);
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('every oauth sentence is held: the oauth catalogue carries no Bengali at all', () => {
    expect(Object.keys(oauthCatalog.bn)).toEqual([]);
  });
});
