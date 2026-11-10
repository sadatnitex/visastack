import { describe, expect, it } from 'vitest';
import manifest from './manifest';

/**
 * The installed app's identity and entry points. `id` and `scope` decide whether a phone treats a
 * new release as the same app, and every launch address must sit inside `scope`; the home-screen
 * marker on the start page and shortcuts lets a launch that fell back to a browser tab say so.
 */
describe('the app manifest', () => {
  const m = manifest();

  it('keeps the app identity and scope stable', () => {
    expect(m.id).toBe('/');
    expect(m.scope).toBe('/');
    expect(m.display).toBe('standalone');
  });

  it('starts at the workspace with the home-screen marker, inside the scope', () => {
    expect(m.start_url).toBe('/app?source=pwa');
    for (const url of [m.start_url, ...(m.shortcuts ?? []).map((shortcut) => shortcut.url)]) {
      expect(url, 'a launch address').toMatch(/^\/app(\/[a-z]+)?\?source=pwa$/);
      expect(new URL(url ?? '', 'https://example.test').origin).toBe('https://example.test');
    }
  });
});
