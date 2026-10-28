import { renderToStaticMarkup } from 'react-dom/server';
import { vi } from 'vitest';
import './../next-mocks.test-support';
import { registerParity } from './parity-kit.test-support';

/** Account (screen 13): see parity-kit.test-support.ts for how the comparison works. */

const state = vi.hoisted(() => ({
  isAdmin: false,
  memberships: [] as unknown[],
  whatsapp: false,
  whatsappConnected: false,
  photo: null as unknown,
  languageChoice: false,
  depth: 'auto' as string,
}));

vi.mock('../locale', () => ({ getLocale: async () => 'en' }));
vi.mock('../session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'traveller@example.com' }),
}));
vi.mock('../admin', () => ({ holdsPlatformRole: async () => state.isAdmin }));
vi.mock('../profile-photos', () => ({ loadOwnPhoto: async () => state.photo }));
vi.mock('../whatsapp', () => ({ readWhatsAppConfig: () => (state.whatsapp ? {} : null) }));
vi.mock('../language-choice', () => ({
  get LANGUAGE_CHOICE_ENABLED() {
    return state.languageChoice;
  },
}));
vi.mock('./depth.server', () => ({ readDepth: async () => state.depth }));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  listMembershipsForAccount: async () => state.memberships,
  getWhatsAppConnection: async () => ({ connected: state.whatsappConnected }),
}));

const { default: AccountPage } = await import('../../app/app/account/page');

registerParity({
  name: 'account',
  reset: () => {
    state.isAdmin = false;
    state.memberships = [];
    state.whatsapp = false;
    state.whatsappConnected = false;
    state.photo = null;
    state.languageChoice = false;
    state.depth = 'auto';
  },
  render: async () => renderToStaticMarkup(await AccountPage()),
  states: [
    { name: 'plain account', setup: () => undefined },
    {
      name: 'everything switched on',
      setup: () => {
        state.isAdmin = true;
        state.memberships = [{ active: true, role: 'OWNER' }];
        state.whatsapp = true;
        state.photo = { self: null };
        state.languageChoice = true;
      },
    },
    {
      name: 'whatsapp connected, no longer configured',
      setup: () => {
        state.whatsappConnected = true;
      },
    },
  ],
});
