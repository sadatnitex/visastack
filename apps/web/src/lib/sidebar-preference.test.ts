// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SIDEBAR_COOKIE,
  parseSidebarState,
  saveSidebarState,
  sidebarCookie,
} from './sidebar-preference';

afterEach(() => vi.restoreAllMocks());

describe('the remembered sidebar choice', () => {
  it('is collapsed only for the exact word, never for anything else', () => {
    expect(parseSidebarState('collapsed')).toBe('collapsed');
    for (const value of [undefined, null, '', 'expanded', 'Collapsed', 'collapsed ', '1', 'true']) {
      expect(parseSidebarState(value)).toBe('expanded');
    }
  });

  it('is one small cookie for the signed-in area, a year long, sent only with same-site requests', () => {
    expect(SIDEBAR_COOKIE).toBe('visastack_sidebar');
    expect(sidebarCookie('collapsed', false)).toBe(
      'visastack_sidebar=collapsed; path=/app; max-age=31536000; SameSite=Lax',
    );
    expect(sidebarCookie('expanded', true)).toBe(
      'visastack_sidebar=expanded; path=/app; max-age=31536000; SameSite=Lax; Secure',
    );
  });

  it('holds one word and nothing about the person', () => {
    for (const state of ['collapsed', 'expanded'] as const) {
      const [pair] = sidebarCookie(state, true).split('; ');
      expect(pair).toBe(`${SIDEBAR_COOKIE}=${state}`);
    }
  });

  it('writes the cookie, adding Secure only on https', () => {
    const written: string[] = [];
    vi.spyOn(document, 'cookie', 'set').mockImplementation((value) => {
      written.push(value);
    });
    saveSidebarState('collapsed');
    expect(written).toHaveLength(1);
    // jsdom serves http, so no Secure flag.
    expect(written[0]).not.toContain('Secure');
  });

  it('does nothing worse than forget when the browser blocks cookies', () => {
    vi.spyOn(document, 'cookie', 'set').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => saveSidebarState('collapsed')).not.toThrow();
  });
});
