// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  VERSION_NOTICE_COOKIE,
  parseVersionNoticeSeen,
  rememberVersionNoticeSeen,
  versionNoticeCookie,
} from './version-notice';

afterEach(() => vi.restoreAllMocks());

describe('remembering that a visitor has seen the notice about this version', () => {
  it('counts as seen only for the exact word, so anything else shows the notice again', () => {
    expect(parseVersionNoticeSeen('seen')).toBe(true);
    for (const value of [undefined, null, '', 'Seen', 'seen ', 'yes', '1', 'true']) {
      expect(parseVersionNoticeSeen(value)).toBe(false);
    }
  });

  it('is one small site-wide cookie, half a year long, sent only with same-site requests', () => {
    expect(VERSION_NOTICE_COOKIE).toBe('visastack_notice');
    expect(versionNoticeCookie(false)).toBe(
      'visastack_notice=seen; path=/; max-age=15724800; SameSite=Lax',
    );
    expect(versionNoticeCookie(true)).toBe(
      'visastack_notice=seen; path=/; max-age=15724800; SameSite=Lax; Secure',
    );
  });

  it('holds one word and nothing about the person', () => {
    const [pair] = versionNoticeCookie(true).split('; ');
    expect(pair).toBe(`${VERSION_NOTICE_COOKIE}=seen`);
  });

  it('writes the cookie on this device', () => {
    const written: string[] = [];
    vi.spyOn(document, 'cookie', 'set').mockImplementation((value) => {
      written.push(value);
    });
    rememberVersionNoticeSeen();
    // jsdom serves the page over http, so the Secure flag is left off here.
    expect(written).toEqual(['visastack_notice=seen; path=/; max-age=15724800; SameSite=Lax']);
  });

  it('never throws when the cookie store is blocked: the notice simply shows again', () => {
    vi.spyOn(document, 'cookie', 'set').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => rememberVersionNoticeSeen()).not.toThrow();
  });
});
