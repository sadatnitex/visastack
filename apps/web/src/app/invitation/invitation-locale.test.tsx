import { DEFAULT_CLIENT_GRANT_ACTIONS } from '@visastack/services';
import { describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../../lib/next-mocks.test-support';

vi.mock('server-only', () => ({}));
// The locale is set here directly, as the auth screens' test does.
const current = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', generation: 0 }));
vi.mock('../../lib/locale', () => ({ getLocale: async () => current.locale }));
// Outside the server runtime React's cache remembers nothing; stand in for one request per render.
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
const preview = vi.hoisted(() => ({ page: { state: 'unavailable' } as Record<string, unknown> }));
vi.mock('../../lib/invitation-preview', () => ({
  loadClientInvitationPage: async () => preview.page,
}));
const session = vi.hoisted(() => ({ signedIn: false }));
vi.mock('../../lib/signed-in', () => ({ isSignedIn: async () => session.signedIn }));

import { invitationCatalog } from '../../i18n/invitation';

const { default: InvitationPage } = await import('./page');

const BENGALI = /[ঀ-৿]/;
const TOKEN = 'a'.repeat(43);

async function render(locale: 'en' | 'bn', searchParams: { kind?: string; token?: string }) {
  current.locale = locale;
  current.generation += 1;
  return textOf(
    await renderServer(InvitationPage({ searchParams: Promise.resolve(searchParams) })),
  );
}

describe('the public invitation page under Bengali', () => {
  it('shows Bengali for the neutral message and the page chrome', async () => {
    const incomplete = await render('bn', {});
    expect(incomplete).toContain(
      invitationCatalog.bn['invitation.invitationPage.incompleteInvitationLink'],
    );
    const page = await render('bn', { kind: 'client', token: TOKEN });
    expect(page).toContain(
      invitationCatalog.bn['invitation.invitationClientInvitationOffer.visastackInvitation'],
    );
    for (const text of [incomplete, page]) {
      expect(text).toMatch(BENGALI);
      expect(text).not.toMatch(/invitation\.(invitationPage|invitationClientInvitationOffer)\./);
      expect(text).not.toMatch(/\{[A-Za-z]+\}/);
    }
  });

  it('shows the expiry rule and the consent or acceptance sentences in Bengali (signed off 2026-11-12)', async () => {
    const page = await render('bn', { kind: 'client', token: TOKEN });
    for (const key of [
      'invitation.invitationPage.invitationsExpireAfter7DaysIf',
      'invitation.invitationClientInvitationOffer.anAdministratorAtAgencynameInvitedYou',
      'invitation.invitationClientInvitationOffer.nothingIsSharedUntilYouAccept',
      'invitation.invitationClientInvitationOffer.openingThisLinkAcceptsNothingYou',
      'invitation.invitationClientInvitationOffer.youCanStopSharingAtAny',
    ] as const) {
      expect(key in invitationCatalog.bn, key).toBe(true);
    }
    expect(page).toContain(
      invitationCatalog.bn['invitation.invitationPage.invitationsExpireAfter7DaysIf'],
    );
    expect(page).not.toContain(
      invitationCatalog.en['invitation.invitationPage.invitationsExpireAfter7DaysIf'],
    );
  });

  it('shows the open offer in Bengali, including the consent sentences (signed off 2026-11-12)', async () => {
    preview.page = {
      state: 'open',
      view: {
        agencyName: 'Acme Visas',
        verified: true,
        accentColor: null,
        logoVersion: null,
        grantActions: DEFAULT_CLIENT_GRANT_ACTIONS,
        expiresAt: new Date(Date.now() + 6.5 * 24 * 60 * 60 * 1000),
      },
    };
    try {
      const offer = await render('bn', { kind: 'client', token: TOKEN });
      const bn = invitationCatalog.bn;
      // The strings that have approved Bengali show it; the rest of the offer stays English.
      expect(offer).toContain(
        bn['invitation.invitationClientInvitationOffer.ifYouResetYourPasswordOpen'],
      );
      expect(offer).toContain(bn['invitation.invitingAgency.poweredByVisastack']);
      expect(offer).toContain(
        (bn['invitation.invitationClientInvitationOffer.agencynameInvitedYou'] ?? '').replace(
          '{agencyName}',
          'Acme Visas',
        ),
      );
      expect(offer).not.toContain('Acme Visas Invited You');
      for (const key of [
        'invitation.invitationClientInvitationOffer.theyCould',
        'invitation.invitationClientInvitationOffer.theyCouldNot',
        'invitation.invitationClientInvitationOffer.beforeYouStart',
        'invitation.invitationClientInvitationOffer.createAnAccountOrSignIn',
        'invitation.invitationClientInvitationOffer.youStayInControl',
      ] as const) {
        expect(offer, key).toContain(bn[key]);
      }
      // The step names stay English, so the spoken "(Done)" after them stays English too.
      expect(offer).toContain('1 Sign In 2 Review 3 Decide');
      expect(offer).not.toMatch(/invitation\.invitationClientInvitationOffer\./);
      expect(offer).not.toMatch(/\{[A-Za-z]+\}/);
      for (const key of [
        'invitation.invitationClientInvitationOffer.openingThisLinkAcceptsNothingYou',
        'invitation.invitationClientInvitationOffer.nothingIsSharedUntilYouAccept',
        'invitation.invitationClientInvitationOffer.youCanStopSharingAtAny',
      ] as const) {
        expect(offer, key).toContain(invitationCatalog.bn[key]);
        expect(offer, key).not.toContain(invitationCatalog.en[key]);
      }
    } finally {
      preview.page = { state: 'unavailable' };
    }
  });

  it('signed in, the offer asks for the invited address in Bengali (refill 3)', async () => {
    preview.page = {
      state: 'open',
      view: {
        agencyName: 'Acme Visas',
        verified: true,
        accentColor: null,
        logoVersion: null,
        grantActions: DEFAULT_CLIENT_GRANT_ACTIONS,
        expiresAt: new Date(Date.now() + 6.5 * 24 * 60 * 60 * 1000),
      },
    };
    session.signedIn = true;
    try {
      const offer = await render('bn', { kind: 'client', token: TOKEN });
      expect(offer).toContain(
        invitationCatalog.bn[
          'invitation.invitationClientInvitationOffer.useTheEmailAddressThatReceived'
        ],
      );
      expect(offer).not.toMatch(/invitation\.invitationClientInvitationOffer\./);
    } finally {
      preview.page = { state: 'unavailable' };
      session.signedIn = false;
    }
  });

  it('has no raw placeholder in any Bengali string', () => {
    for (const [key, value] of Object.entries(invitationCatalog.bn))
      expect(value.replace(/\{[A-Za-z]+\}/g, ''), key).not.toMatch(/[{}]/);
  });
});

describe('the public invitation page under English', () => {
  it('renders the original English with no Bengali', async () => {
    const incomplete = await render('en', {});
    expect(incomplete).toContain('Incomplete Invitation Link');
    expect(incomplete).not.toMatch(BENGALI);
    const page = await render('en', { kind: 'client', token: TOKEN });
    expect(page).toContain('VisaStack Invitation');
    expect(page).not.toMatch(BENGALI);
  });
});
