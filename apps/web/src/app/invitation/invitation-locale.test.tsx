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
vi.mock('../../lib/invitation-preview', () => ({
  loadClientInvitationPage: async () => ({ state: 'unavailable' }),
}));
vi.mock('../../lib/signed-in', () => ({ isSignedIn: async () => false }));

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

  it('keeps the expiry rule and every consent or acceptance sentence in English', async () => {
    const page = await render('bn', { kind: 'client', token: TOKEN });
    for (const key of [
      'invitation.invitationPage.invitationsExpireAfter7DaysIf',
      'invitation.invitationClientInvitationOffer.anAdministratorAtAgencynameInvitedYou',
      'invitation.invitationClientInvitationOffer.nothingIsSharedUntilYouAccept',
      'invitation.invitationClientInvitationOffer.openingThisLinkAcceptsNothingYou',
      'invitation.invitationClientInvitationOffer.youCanStopSharingAtAny',
    ] as const) {
      expect(key in invitationCatalog.bn, key).toBe(false);
    }
    expect(page).toContain(
      invitationCatalog.en['invitation.invitationPage.invitationsExpireAfter7DaysIf'],
    );
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
