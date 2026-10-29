import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config.mjs';

/**
 * A package marked external is not bundled: the deployed function loads it from the web app's own
 * node_modules at run time. In this pnpm workspace a package declared only by another workspace
 * package (for example `@visastack/adapters`) is not reachable from there, so the deployment fails
 * with "Cannot find module" on the first request that needs it. That is how image previews and
 * Safe Copies broke in production on 29 Oct 2026 (`@napi-rs/canvas`), while `sharp`, declared
 * here too, kept working. Every external package must therefore be a direct dependency of the
 * web app. Platform builds (`@napi-rs/canvas-linux-x64-gnu` and friends) are the package's own
 * optional dependencies and come with it.
 */
const PLATFORM_BUILD = /^@napi-rs\/canvas-(linux|darwin|win32)-/;

describe('packages kept out of the server bundle', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const direct = new Set(Object.keys(manifest.dependencies ?? {}));
  const external: readonly string[] = nextConfig.serverExternalPackages ?? [];

  it('lists the native packages the server needs', () => {
    expect(external).toEqual(expect.arrayContaining(['@napi-rs/canvas', 'sharp', 'libheif-js']));
  });

  it.each(external.filter((name) => !PLATFORM_BUILD.test(name)))(
    '%s is a direct dependency of the web app, so the deployed function can load it',
    (name) => {
      expect(direct.has(name)).toBe(true);
    },
  );
});
