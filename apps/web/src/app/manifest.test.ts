import { describe, expect, it } from 'vitest';
import manifest from './manifest';

/**
 * The installed app's identity and entry points. `id`, `scope` and `start_url` decide whether a
 * phone treats a new release as the same app: changing any of them makes Android Chrome rebuild
 * every installed copy, so they are pinned here. Every launch address must sit inside `scope`.
 */
describe('the app manifest', () => {
  const m = manifest();

  it('keeps the app identity, scope and start page stable', () => {
    expect(m.id).toBe('/');
    expect(m.scope).toBe('/');
    expect(m.display).toBe('standalone');
    expect(m.start_url).toBe('/app');
  });

  it('keeps every shortcut inside the scope', () => {
    const urls = (m.shortcuts ?? []).map((shortcut) => shortcut.url);
    expect(urls).toEqual(['/app', '/app/notifications']);
    for (const url of urls) {
      expect(new URL(url, 'https://example.test').origin).toBe('https://example.test');
    }
  });
});
