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

async function html(build: () => unknown | Promise<unknown>): Promise<Document> {
  current.holder = null;
  const element = (await build()) as Parameters<typeof renderToStaticMarkup>[0];
  return new JSDOM(renderToStaticMarkup(element)).window.document;
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

describe('consent and authorization wording is never Bengali', () => {
  it('has no Bengali for any held sentence on the sharing, client invitation, contributor and oauth screens', () => {
    const held: Array<[Record<string, string>, string[]]> = [
      [
        appSharingInvitationsCatalog.bn,
        [
          'accessEnds',
          'askTheSenderForANew',
          'invitationExpires',
          'invitationUnavailable',
          'openingThisInvitationGrantsNoAccess',
          'permissions',
        ],
      ],
      [
        appClientInvitationsCatalog.bn,
        [
          'aiTools',
          'turnOnLabel',
          'ifYouAcceptTheyWillBe',
          'turnTheseOnBeforeAcceptingBoth',
          'agencyaitravellernoteIfYourSignInIs',
        ],
      ],
      [appContributorRequestsCatalog.bn, ['thisRequestWasSentToA']],
      [homeCatalog.bn, ['thisIsOnOurSideNot']],
    ];
    for (const [bn, fragments] of held)
      for (const f of fragments)
        expect(
          Object.keys(bn).filter((k) => k.endsWith(`.${f}`)),
          f,
        ).toEqual([]);
    expect(Object.keys(oauthCatalog.bn)).toEqual([]);
    expect(paymentsCatalog.bn).toHaveProperty(['payments.paymentsResultPage.goToWorkspace']);
  });
});
