/**
 * Proves, by reading the code, that no application code mints a session or trusts one that did
 * not come from the sign-in library (docs/operations/staging-journeys.md). The signed-in browser
 * tests sign in through the real form with synthetic accounts, because the product has, and must
 * keep, no test-mode door: a way to be "signed in" that the library did not give would be a way
 * into every account.
 *
 * What it holds:
 * - the only session reader is `NeonIdentityPort`, fed by the library's own session call;
 * - the Neon Auth cookie names are read (as a prefix) in one place and never written by the app;
 * - the cookie secret is touched only by the files that already use it (a new file that does must
 *   be reviewed, then added here on purpose);
 * - no setting, header or cookie in the app turns sign-in off or fakes a person;
 * - nothing in the app imports test or journey code, and the journey code never builds a session
 *   cookie by hand.
 *
 * Run with: node --test scripts/no-auth-bypass.test.mjs (part of `pnpm run test:node`).
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

function filesUnder(dir) {
  const found = [];
  for (const entry of readdirSync(join(root, dir))) {
    if (entry === 'node_modules' || entry === '.next' || entry === 'dist') continue;
    const path = join(dir, entry);
    if (statSync(join(root, path)).isDirectory()) found.push(...filesUnder(path));
    else found.push(path);
  }
  return found;
}

const isTest = (path) => /\.(test|spec)\.(ts|tsx|mjs)$/.test(path) || /\/test\//.test(path);
const code = (path) => /\.(ts|tsx|mjs)$/.test(path) && !isTest(path);
/** The app and the packages it runs on, without tests. */
const applicationFiles = [
  ...filesUnder('apps/web/src'),
  ...filesUnder('packages').filter((path) => path.includes('/src/')),
  'apps/web/next.config.mjs',
].filter((path) => code(path) && !path.endsWith('.d.ts'));

/** The files that read the cookie secret today. Adding a file here is a security decision. */
const COOKIE_SECRET_USERS = [
  'apps/web/src/lib/env.ts',
  'apps/web/src/lib/neon-auth.ts',
  'apps/web/src/lib/payment-result.ts',
  'apps/web/src/lib/pending-confirmation.ts',
  'apps/web/src/lib/public-beta.ts',
  'apps/web/src/lib/signed-retry-cookie.ts',
];

const withText = (pattern) => applicationFiles.filter((path) => pattern.test(read(path)));

test('the only reader of a signed-in person is the library-backed identity port', () => {
  const implementations = withText(/implements\s+IdentityPort\b/);
  assert.deepEqual(implementations, ['apps/web/src/lib/identity-provider.ts']);
  // One class in one file, and no second way to answer "who is signed in" in the same file or
  // an object that stands in for the port.
  const answers = applicationFiles.flatMap((path) =>
    [
      ...read(path).matchAll(
        /\basync\s+currentIdentity\s*\(|\bcurrentIdentity\s*:\s*(async\s*)?\(|\bcurrentIdentity\s*=/g,
      ),
    ].map(() => path),
  );
  assert.deepEqual(answers, ['apps/web/src/lib/identity-provider.ts']);
  assert.equal(
    applicationFiles.reduce(
      (n, path) => n + (read(path).match(/implements\s+IdentityPort\b/g) ?? []).length,
      0,
    ),
    1,
  );
  const port = read('apps/web/src/lib/identity-provider.ts');
  assert.match(port, /requestSessionReader/);
  const reader = read('apps/web/src/lib/neon-request-session.ts');
  assert.match(reader, /getNeonAuth\(\)\.getSession\(\)/);
});

test('the Neon Auth cookie names are read as a prefix in one file and never written', () => {
  assert.deepEqual(withText(/__Secure-neon-auth|session_token|session_data/), [
    'apps/web/src/lib/neon-request-session.ts',
  ]);
  const reader = read('apps/web/src/lib/neon-request-session.ts');
  assert.doesNotMatch(reader, /cookies\(\)\.set|store\.set\(|\.cookies\.set\(|Set-Cookie/i);
});

test('only the files that already use the cookie secret touch it', () => {
  assert.deepEqual(withText(/NEON_AUTH_COOKIE_SECRET/).sort(), COOKIE_SECRET_USERS);
});

test('no setting, header or cookie turns sign-in off or fakes a person', () => {
  const doors =
    /AUTH_BYPASS|BYPASS_AUTH|SKIP_AUTH|DISABLE_AUTH|NO_AUTH|TEST_AUTH|E2E_AUTH|E2E_SESSION|FAKE_SESSION|MOCK_SESSION|FAKE_USER|MOCK_USER|TEST_USER_ID|x-e2e-|x-test-user|x-test-auth|x-impersonate|testMode\b|test_mode\b/i;
  assert.deepEqual(withText(doors), []);
});

test('the staging attestation is the only place the app mentions the staging suite, and it signs nobody in', () => {
  const mentions = withText(/E2E_[A-Z_]+/);
  assert.deepEqual(mentions, ['apps/web/src/app/api/staging/attestation/route.ts']);
  const route = read(mentions[0]);
  assert.doesNotMatch(route, /getSession|cookies\(|Set-Cookie|signIn\(|NEON_AUTH_COOKIE_SECRET/);
  // It answers 404 unless this is a preview deployment, isolation is confirmed and a secret is set.
  assert.match(route, /VERCEL_ENV'\) !== 'preview'/);
});

test('nothing in the app imports test or journey code', () => {
  assert.deepEqual(withText(/(?:from|import|require\()\s*\(?\s*['"][^'"]*\/e2e\//), []);
});

test('the journey code signs in through the real form and only re-uses the cookies it gave', () => {
  const journeyFiles = filesUnder('apps/web/e2e').filter((path) => /\.ts$/.test(path));
  // No journey builds a session cookie by name or signs anything itself.
  for (const path of journeyFiles) {
    const text = read(path);
    assert.doesNotMatch(
      text,
      /__Secure-neon-auth|session_token|session_data|NEON_AUTH_COOKIE_SECRET/,
      path,
    );
    // The second-step code generator is the one place that computes a keyed hash, for a code a
    // person types, not for anything the app trusts.
    if (!path.endsWith('signed-in/support/totp.ts')) {
      assert.doesNotMatch(text, /createHmac|SignJWT|jsonwebtoken/, `${path} signs something`);
    }
  }
  // Cookies are added back in exactly one place, and only the ones read from the browser earlier.
  const adders = journeyFiles
    .filter((path) => path.includes('e2e/signed-in/'))
    .filter((path) => /\.addCookies\(/.test(read(path)));
  assert.deepEqual(adders, ['apps/web/e2e/signed-in/support/session.ts']);
  const writes = (read('apps/web/e2e/signed-in/support/session.ts').match(/\.addCookies\(/g) ?? [])
    .length;
  assert.equal(writes, 1, 'the harness may add back only the cookies it kept, in one place');
  const session = read('apps/web/e2e/signed-in/support/session.ts');
  assert.match(session, /page\.context\(\)\.addCookies\(existing\)/);
  assert.match(session, /kept\.set\(role, await page\.context\(\)\.cookies\(\)\)/);
  assert.match(session, /getByRole\('button', \{ name: 'Sign In', exact: true \}\)\.click\(\)/);
});
