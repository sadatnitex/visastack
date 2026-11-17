import { createECDH } from 'node:crypto';
import type { Db } from '@visastack/services';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { createPushPort, webPushReady, webPushSwitchOn } = await import('./web-push');

const NAMES = [
  'WEB_PUSH',
  'WEB_PUSH_VAPID_PUBLIC_KEY',
  'WEB_PUSH_VAPID_PRIVATE_KEY',
  'WEB_PUSH_SUBJECT',
  'KMS_PROVIDER',
  'KMS_LOCAL_MASTER_KEY_BASE64',
] as const;

function vapid() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    publicKey: ecdh.getPublicKey().toString('base64url'),
    privateKey: ecdh.getPrivateKey().toString('base64url'),
  };
}

/** A database that fails the test if anything touches it. */
const untouchable = new Proxy(
  {},
  {
    get() {
      throw new Error('the database must not be touched while Web Push is off');
    },
  },
) as Db;

function tableProbe(result: 'present' | 'missing' | 'broken'): Db {
  return {
    execute: async () => {
      if (result === 'missing') {
        throw Object.assign(new Error('relation "web_push_subscriptions" does not exist'), {
          code: '42P01',
        });
      }
      if (result === 'broken') throw new Error('connection lost');
      return { rows: [] };
    },
  } as unknown as Db;
}

let keys: ReturnType<typeof vapid>;

function setOn() {
  vi.stubEnv('WEB_PUSH', 'true');
  vi.stubEnv('WEB_PUSH_VAPID_PUBLIC_KEY', keys.publicKey);
  vi.stubEnv('WEB_PUSH_VAPID_PRIVATE_KEY', keys.privateKey);
  vi.stubEnv('WEB_PUSH_SUBJECT', 'mailto:ops@example.invalid');
  vi.stubEnv('KMS_LOCAL_MASTER_KEY_BASE64', Buffer.alloc(32, 1).toString('base64'));
}

beforeEach(() => {
  keys = vapid();
  for (const name of NAMES) vi.stubEnv(name, undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Web Push switch', () => {
  it('is off by default and with any value but "true"', async () => {
    expect(webPushSwitchOn()).toBe(false);
    expect(createPushPort()).toBeUndefined();
    expect(await webPushReady(untouchable)).toBeNull();
    for (const value of ['on', '1', 'yes', 'TRUE ', 'false']) {
      vi.stubEnv('WEB_PUSH', value);
      expect(createPushPort()).toBeUndefined();
      expect(await webPushReady(untouchable)).toBeNull();
    }
  });

  it('stays off with the switch on but a key missing, mismatched or the protection key absent', async () => {
    setOn();
    vi.stubEnv('WEB_PUSH_VAPID_PRIVATE_KEY', undefined);
    expect(createPushPort()).toBeUndefined();
    expect(await webPushReady(untouchable)).toBeNull();

    setOn();
    vi.stubEnv('WEB_PUSH_VAPID_PRIVATE_KEY', vapid().privateKey);
    expect(createPushPort()).toBeUndefined();
    expect(await webPushReady(untouchable)).toBeNull();

    setOn();
    vi.stubEnv('WEB_PUSH_SUBJECT', 'not-an-address');
    expect(await webPushReady(untouchable)).toBeNull();

    setOn();
    vi.stubEnv('KMS_LOCAL_MASTER_KEY_BASE64', undefined);
    expect(createPushPort()).toBeUndefined();
    expect(await webPushReady(untouchable)).toBeNull();
  });

  it('stays hidden while the table is missing or the database fails', async () => {
    setOn();
    expect(await webPushReady(tableProbe('missing'))).toBeNull();
    expect(await webPushReady(tableProbe('broken'))).toBeNull();
  });

  it('is ready with everything in place, giving only the public key', async () => {
    setOn();
    expect(createPushPort()).toBeDefined();
    const ready = await webPushReady(tableProbe('present'));
    expect(ready).toEqual({ publicKey: keys.publicKey });
    expect(JSON.stringify(ready)).not.toContain(keys.privateKey);
  });
});
