import { readFileSync } from 'node:fs';
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
  table: true,
  renewed: [] as unknown[],
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
  renewWebPushSubscription: async (_db: unknown, self: { accountId: string }, input: object) => {
    state.renewed.push({ accountId: self.accountId, ...input });
    return true;
  },
  webPushTableReady: async () => state.table,
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
const { renewPushAction, turnOnPushAction, turnOffPushAction } = await import('./push-actions');

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
  state.table = true;
  state.renewed = [];
});

describe('Account page alerts card', () => {
  it('has no card while Web Push is off, but the sign-out form still forgets this browser', async () => {
    const html = await renderServer(await AccountPage());
    expect(html).not.toContain('"PushCard"');
    expect(html).toContain('TurnOffPushOnSubmit');
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
  it('Turn On and renewal give one uniform refusal while Web Push is off, storing nothing', async () => {
    const on = await turnOnPushAction(GOOD);
    const junk = await turnOnPushAction({ nonsense: true });
    expect(await renewPushAction(GOOD.endpoint)).toEqual({ ok: false });
    expect(on).toEqual({ ok: false });
    expect(junk).toEqual(on);
    expect(state.saved).toEqual([]);
    expect(state.renewed).toEqual([]);
  });

  it('Turn Off still forgets the browser while the switch or keys are off', async () => {
    expect(await turnOffPushAction(GOOD.endpoint)).toEqual({ ok: true });
    expect(state.removed).toEqual([{ accountId: 'acct-1', endpoint: GOOD.endpoint }]);
  });

  it('Turn Off refuses only when the table is missing', async () => {
    state.table = false;
    expect(await turnOffPushAction(GOOD.endpoint)).toEqual({ ok: false });
    expect(state.removed).toEqual([]);
  });

  it('renewal ties the browser to this sign-in for the signed-in account', async () => {
    state.ready = { publicKey: 'PUBLIC-KEY' };
    expect(await renewPushAction(GOOD.endpoint)).toEqual({ ok: true });
    expect(state.renewed).toEqual([
      { accountId: 'acct-1', endpoint: GOOD.endpoint, sessionRef: 'session-ref-1' },
    ]);
    state.sessionRef = null;
    expect(await renewPushAction(GOOD.endpoint)).toEqual({ ok: false });
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

describe('every signed-in sign-out form', () => {
  it('passes its fields on and carries this browser’s push address', () => {
    for (const file of ['../workspace-frame.tsx', './page.tsx']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(source).toMatch(
        /action=\{async \(form: FormData\) => \{\s*'use server';\s*await signOutCurrentUser\('\/', form\);\s*\}\}\s*>\s*<ClearShareInboxOnSubmit \/>\s*<TurnOffPushOnSubmit \/>/,
      );
    }
  });
});
