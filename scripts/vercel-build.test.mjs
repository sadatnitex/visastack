/**
 * Guards how Vercel builds the web app (apps/web/vercel.json). On 31 Oct 2026 a production build
 * that restored the compiler cache from earlier deployments left the admin action buttons out of
 * the Organisations and Access pages' client manifests, so both pages failed for everyone while
 * the same commit built from scratch was correct (docs/commercial-v1/known-issues.md). The build
 * therefore clears the compiler cache before `next build`; Vercel still restores the rest of the
 * build cache (the installed packages), so only compiling starts fresh.
 *
 * Run with: node --test scripts/vercel-build.test.mjs (part of `pnpm run test:node`).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vercel = JSON.parse(readFileSync(join(root, 'apps/web/vercel.json'), 'utf8'));

test('the Vercel build clears the compiler cache, then runs next build', () => {
  const steps = String(vercel.buildCommand ?? '')
    .split('&&')
    .map((step) => step.trim());
  const clear = steps.indexOf('rm -rf .next/cache/webpack');
  const build = steps.indexOf('next build');
  assert.notEqual(clear, -1, 'buildCommand must clear .next/cache/webpack');
  assert.notEqual(build, -1, 'buildCommand must run next build');
  assert.ok(clear < build, 'the cache must be cleared before next build runs');
});
