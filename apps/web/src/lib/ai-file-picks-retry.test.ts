import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AI_FILE_PICKS_CONSENT,
  aiFilePicksCookieOptions,
  decodeAiFilePicks,
  encodeAiFilePicks,
} from './ai-file-picks-retry';

/** S20: ticked files kept across a fresh sign-in check, in a signed cookie, never a link. */
const APPLICANT = '11111111-1111-4111-8111-111111111111';
const CONNECTION = '22222222-2222-4222-8222-222222222222';
const DOC = '44444444-4444-4444-8444-444444444444';
const FILES = [{ documentId: DOC, variant: 'ORIGINAL' as const }];
const consent = { accountId: 'acct-1', applicantId: APPLICANT, target: AI_FILE_PICKS_CONSENT };

beforeEach(() => vi.stubEnv('NEON_AUTH_COOKIE_SECRET', 'k'.repeat(64)));
afterEach(() => vi.unstubAllEnvs());

describe('the ticked-files cookie', () => {
  it('gives the files back only to the same account, record and form, before it expires', () => {
    const value = encodeAiFilePicks(
      { applicantId: APPLICANT, target: AI_FILE_PICKS_CONSENT, files: FILES },
      'acct-1',
    );
    expect(value).not.toBeNull();
    expect(decodeAiFilePicks(value ?? '', consent)).toEqual(FILES);
    expect(decodeAiFilePicks(value ?? '', { ...consent, accountId: 'acct-2' })).toBeNull();
    expect(decodeAiFilePicks(value ?? '', { ...consent, target: CONNECTION })).toBeNull();
    expect(
      decodeAiFilePicks(value ?? '', { ...consent, applicantId: DOC.replace('4', '6') }),
    ).toBeNull();
    const old = encodeAiFilePicks(
      { applicantId: APPLICANT, target: AI_FILE_PICKS_CONSENT, files: FILES },
      'acct-1',
      new Date('2020-01-01T00:00:00Z'),
    );
    expect(decodeAiFilePicks(old ?? '', consent)).toBeNull();
  });

  it('refuses a value it did not sign, or one changed after signing', () => {
    const value =
      encodeAiFilePicks(
        { applicantId: APPLICANT, target: AI_FILE_PICKS_CONSENT, files: FILES },
        'acct-1',
      ) ?? '';
    const [payload, signature] = value.split('.');
    const forged = Buffer.from(
      JSON.stringify({ p: APPLICANT, t: 'consent', f: [`O${DOC}`], a: 'acct-1', x: 9e9 }),
    ).toString('base64url');
    expect(decodeAiFilePicks(`${forged}.${signature}`, consent)).toBeNull();
    expect(decodeAiFilePicks(`${payload}.x${signature?.slice(1)}`, consent)).toBeNull();
    expect(decodeAiFilePicks(undefined, consent)).toBeNull();
    vi.stubEnv('NEON_AUTH_COOKIE_SECRET', 'other'.repeat(13));
    expect(decodeAiFilePicks(value, consent)).toBeNull();
  });

  it('is httpOnly, short-lived and scoped to the one page that reads it', () => {
    expect(aiFilePicksCookieOptions(true, '/oauth/authorize')).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/oauth/authorize',
      maxAge: 15 * 60,
    });
  });
});
