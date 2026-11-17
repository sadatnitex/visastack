import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  PASSKEY_CHALLENGE_LIFETIME_MS,
  challengeOfAnswer,
  encodePasskeyChallenge,
  passkeyChallengeCookieName,
  passkeyChallengeCookieOptions,
  passkeyRelyingParty,
  passkeysEnabled,
  readPasskeyChallenge,
} from './passkeys';

const SECRET = 'test-only-cookie-key-with-at-least-thirty-two-characters';
const BINDING = { purpose: 'confirm', accountId: 'acct-1', sessionRef: 'ref-1' } as const;
const NOW = 1_800_000_000_000;

afterEach(() => vi.unstubAllEnvs());

describe('passkeysEnabled', () => {
  it('is on only for "on"; anything else, including unset, is off', () => {
    vi.stubEnv('PASSKEYS', '');
    expect(passkeysEnabled()).toBe(false);
    for (const value of ['true', '1', 'yes', 'enabled', 'onn']) {
      vi.stubEnv('PASSKEYS', value);
      expect(passkeysEnabled()).toBe(false);
    }
    vi.stubEnv('PASSKEYS', ' On ');
    expect(passkeysEnabled()).toBe(true);
  });
});

describe('passkeyRelyingParty', () => {
  it('uses the app host and exact origin', () => {
    expect(passkeyRelyingParty('https://vs.obsidianglobal.studio')).toEqual({
      rpID: 'vs.obsidianglobal.studio',
      origin: 'https://vs.obsidianglobal.studio',
      rpName: 'VisaStack',
    });
  });
});

describe('the passkey challenge cookie', () => {
  it('round-trips for exactly the same purpose, account and sign-in', () => {
    const value = encodePasskeyChallenge('chal-1', BINDING, SECRET, NOW);
    expect(readPasskeyChallenge(value, BINDING, SECRET, NOW + 1000)).toEqual({
      challenge: 'chal-1',
      issuedAt: new Date(NOW),
    });
  });

  it('is refused for another purpose, account or sign-in (signed out and back in)', () => {
    const value = encodePasskeyChallenge('chal-1', BINDING, SECRET, NOW);
    expect(readPasskeyChallenge(value, { ...BINDING, purpose: 'add' }, SECRET, NOW)).toBeNull();
    expect(
      readPasskeyChallenge(value, { ...BINDING, accountId: 'acct-2' }, SECRET, NOW),
    ).toBeNull();
    expect(
      readPasskeyChallenge(value, { ...BINDING, sessionRef: 'ref-2' }, SECRET, NOW),
    ).toBeNull();
  });

  it('is refused once expired, when tampered with, or signed with another key', () => {
    const value = encodePasskeyChallenge('chal-1', BINDING, SECRET, NOW);
    expect(
      readPasskeyChallenge(value, BINDING, SECRET, NOW + PASSKEY_CHALLENGE_LIFETIME_MS + 1),
    ).toBeNull();
    const [payload, signature] = value.split('.');
    const forged = Buffer.from(
      JSON.stringify({ c: 'chal-x', p: 'confirm', a: 'acct-1', s: 'ref-1', e: NOW + 60_000 }),
    ).toString('base64url');
    expect(readPasskeyChallenge(`${forged}.${signature}`, BINDING, SECRET, NOW)).toBeNull();
    expect(readPasskeyChallenge(`${payload}.`, BINDING, SECRET, NOW)).toBeNull();
    expect(readPasskeyChallenge(value, BINDING, `${SECRET}-other`, NOW)).toBeNull();
    expect(readPasskeyChallenge(undefined, BINDING, SECRET, NOW)).toBeNull();
    expect(readPasskeyChallenge('x'.repeat(5000), BINDING, SECRET, NOW)).toBeNull();
  });

  it('lives two minutes in an httpOnly, strict, host-only cookie on https', () => {
    expect(passkeyChallengeCookieName('confirm', true)).toBe('__Host-vs-passkey-confirm');
    expect(passkeyChallengeCookieName('add', true)).toBe('__Host-vs-passkey-add');
    expect(passkeyChallengeCookieName('add', false)).toBe('vs-passkey-add');
    expect(passkeyChallengeCookieOptions(true)).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      maxAge: 120,
    });
  });
});

describe('challengeOfAnswer', () => {
  it('reads the challenge a browser answer signed, and nothing from anything else', () => {
    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: 'webauthn.get', challenge: 'chal-9' }),
    ).toString('base64url');
    expect(challengeOfAnswer({ response: { clientDataJSON } })).toBe('chal-9');
    expect(challengeOfAnswer({ response: { clientDataJSON: 'not-json' } })).toBeNull();
    expect(challengeOfAnswer({ response: {} })).toBeNull();
    expect(challengeOfAnswer(null)).toBeNull();
  });
});
