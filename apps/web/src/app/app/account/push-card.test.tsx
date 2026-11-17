import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, stub, stubProps } from '../../../lib/next-mocks.test-support';

/**
 * WP-PIC18: the Account page offers phone and desktop alerts only while Web Push is ready, and
 * the Turn On and Turn Off actions give one uniform refusal otherwise.
 */

vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({
  ready: null as { publicKey: string } | null,
  saved: [] as unknown[],
  removed: [] as unknown[],
  saveResult: 'saved' as 'saved' | 'unavailable',
  sessionRef: 'session-ref-1' as string | null,
}));

vi.mock('../../../lib/web-push', () => ({
  webPushReady: async () => state.ready,
  webPushKeyPort: () => (state.ready ? { currentKeyVersion: () => 'v1' } : null),
}));
vi.mock('../../../lib/neon-recency', () => ({ neonSessionRef: async () => state.sessionRef }));
vi.mock('@visastack/services/web-push', () => ({
  saveWebPushSubscription: async (
    _db: unknown,
    _port: unknown,
    self: { accountId: string },
    input: object,
  ) => {
    state.saved.push({ accountId: self.accountId, ...input });
    return state.saveResult;
  },
  hasWebPushSubscription: async () => true,
  removeWebPushSubscription: async (_db: unknown, self: { accountId: string }, input: object) => {
    state.removed.push({ accountId: self.accountId, ...input });
    return 1;
  },
}));
vi.mock('../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({
      db: {},
      accountId: 'acct-1',
      email: 'traveller@example.com',
      self: { kind: 'self', accountId: 'acct-1' },
    }),
}));
vi.mock('../../../lib/locale', () => ({ getLocale: async () => 'en' }));
vi.mock('../../../lib/ccd/depth.server', () => ({ readDepth: async () => 'auto' }));
vi.mock('../../../lib/admin', () => ({ holdsPlatformRole: async () => false }));
vi.mock('../../../lib/profile-photos', () => ({ loadOwnPhoto: async () => null }));
vi.mock('../../../lib/sign-out', () => ({ signOutCurrentUser: async () => undefined }));
vi.mock('../../../lib/whatsapp', () => ({ readWhatsAppConfig: () => null }));
vi.mock('../../actions', () => ({ setLocaleAction: async () => undefined }));
vi.mock('../../../components/profile-photo/account-photo-card', () => ({
  AccountPhotoCard: stub('AccountPhotoCard'),
}));
vi.mock('./push-card', () => ({
  PushCard: stub('PushCard'),
  TurnOffPushOnSubmit: stub('TurnOffPushOnSubmit'),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  getWhatsAppConnection: async () => ({ connected: false }),
  listMembershipsForAccount: async () => [],
}));

const { default: AccountPage } = await import('./page');
const { pushStatusAction, turnOnPushAction, turnOffPushAction } = await import('./push-actions');

const GOOD = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/device-1',
  keys: {
    p256dh:
      'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  },
};

beforeEach(() => {
  state.ready = null;
  state.saved = [];
  state.removed = [];
  state.saveResult = 'saved';
  state.sessionRef = 'session-ref-1';
});

describe('Account page alerts card', () => {
  it('has no card and no sign-out hook while Web Push is off', async () => {
    const html = await renderServer(await AccountPage());
    expect(html).not.toContain('PushCard');
    expect(html).not.toContain('TurnOffPushOnSubmit');
  });

  it('offers the card with the public key while Web Push is ready', async () => {
    state.ready = { publicKey: 'PUBLIC-KEY' };
    const html = await renderServer(await AccountPage());
    expect(stubProps<{ publicKey: string }>(html, 'PushCard')).toEqual([
      { publicKey: 'PUBLIC-KEY' },
    ]);
    expect(html).toContain('TurnOffPushOnSubmit');
  });
});

describe('Turn On and Turn Off', () => {
  it('give one uniform refusal while Web Push is off, storing and removing nothing', async () => {
    const on = await turnOnPushAction(GOOD);
    const off = await turnOffPushAction(GOOD.endpoint);
    const junk = await turnOnPushAction({ nonsense: true });
    expect(await pushStatusAction(GOOD.endpoint)).toEqual({ ok: false });
    expect(on).toEqual({ ok: false });
    expect(off).toEqual({ ok: false });
    expect(junk).toEqual(on);
    expect(state.saved).toEqual([]);
    expect(state.removed).toEqual([]);
  });

  it('store a good subscription for the signed-in account only', async () => {
    state.ready = { publicKey: 'PUBLIC-KEY' };
    expect(await turnOnPushAction({ ...GOOD, accountId: 'someone-else' })).toEqual({ ok: true });
    expect(state.saved).toEqual([
      { accountId: 'acct-1', subscription: GOOD, sessionRef: 'session-ref-1' },
    ]);
  });

  it('refuse a subscription that is not a real push service or has bad keys', async () => {
    state.ready = { publicKey: 'PUBLIC-KEY' };
    for (const bad of [
      { ...GOOD, endpoint: 'https://169.254.169.254/latest/meta-data' },
      { ...GOOD, endpoint: 'http://fcm.googleapis.com/fcm/send/x' },
      { ...GOOD, keys: { ...GOOD.keys, auth: 'AAAA' } },
      { ...GOOD, keys: { p256dh: 'short', auth: GOOD.keys.auth } },
      'not an object',
      null,
    ]) {
      expect(await turnOnPushAction(bad)).toEqual({ ok: false });
    }
    expect(state.saved).toEqual([]);
  });

  it('refuse to store a browser that signing out could not forget', async () => {
    state.ready = { publicKey: 'PUBLIC-KEY' };
    state.sessionRef = null;
    expect(await turnOnPushAction(GOOD)).toEqual({ ok: false });
    expect(state.saved).toEqual([]);
  });

  it('refuse when the store cannot keep it, and remove only for the signed-in account', async () => {
    state.ready = { publicKey: 'PUBLIC-KEY' };
    state.saveResult = 'unavailable';
    expect(await turnOnPushAction(GOOD)).toEqual({ ok: false });
    expect(await turnOffPushAction(GOOD.endpoint)).toEqual({ ok: true });
    expect(state.removed).toEqual([{ accountId: 'acct-1', endpoint: GOOD.endpoint }]);
    expect(await turnOffPushAction(42)).toEqual({ ok: false });
  });
});
