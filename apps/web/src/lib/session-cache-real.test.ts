import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

/*
 * session.ts keeps per-request sign-in state in React `cache()`. Its own tests replace `cache`
 * with a stand-in, so this one checks the assumption that makes the sharing safe against the
 * real thing: the React build Next.js runs server code with (its vendored react-server build).
 * Outside a page render (server actions, route handlers, background work) `cache()` must not
 * remember anything, so two of those calls, or two people, can never share sign-in state.
 */
const require = createRequire(import.meta.url);
type CacheModule = { cache: <T>(fn: () => T) => () => T };

describe('the real React cache that session.ts relies on', () => {
  it('hands out fresh state on every call outside a page render, in the build Next.js uses', () => {
    const serverReact = require('next/dist/compiled/react/react.react-server.js') as CacheModule;
    const scope = serverReact.cache(() => ({ shared: null }));
    expect(scope()).not.toBe(scope());
  });

  it('does the same in the plain React build', () => {
    const react = require('react') as CacheModule;
    const scope = react.cache(() => ({ shared: null }));
    expect(scope()).not.toBe(scope());
  });
});
