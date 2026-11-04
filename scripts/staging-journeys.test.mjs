/**
 * Guards the on-demand signed-in journey suite (docs/operations/staging-journeys.md).
 *
 * The suite can never be green by accident, so this holds the things that would let it be:
 * - it runs only from the one manual workflow (no schedule, no pull request, no production
 *   address), and no other workflow or default Playwright run picks the specs up;
 * - a journey that cannot run FAILS, it is never skipped: no skip, fixme or conditional pass in
 *   the specs;
 * - the setting names the specs read, the setup script lists, the workflow passes and the document
 *   explains are the same set;
 * - the setup report prints names, never values;
 * - no image or document is committed for the specimen passport (it is drawn at test time).
 *
 * Run with: node --test scripts/staging-journeys.test.mjs (part of `pnpm run test:node`).
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  GROUPS,
  OPTIONAL_NAMES,
  SUITES,
  allNames,
  filesFor,
  missingIn,
  report,
  sharedIdentities,
} from './check-staging-journey-setup.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const SIGNED_IN = 'apps/web/e2e/signed-in';
const JOURNEYS_WORKFLOW = '.github/workflows/neon-staging-journeys.yml';

/** Every file under `dir` (relative to the repository), skipping dependency and build folders. */
function filesUnder(dir) {
  const found = [];
  for (const entry of readdirSync(join(root, dir))) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const path = join(dir, entry);
    if (statSync(join(root, path)).isDirectory()) found.push(...filesUnder(path));
    else found.push(path);
  }
  return found;
}

const specFiles = filesUnder(SIGNED_IN).filter((path) => path.endsWith('.spec.ts'));
const sourceFiles = filesUnder(SIGNED_IN).filter((path) => path.endsWith('.ts'));

test('the journeys run only from the one manual workflow, on main, never against production', () => {
  const text = read(JOURNEYS_WORKFLOW);
  const triggers = text.slice(text.indexOf('\non:'), text.indexOf('\npermissions:'));
  assert.match(triggers, /^ {2}workflow_dispatch:/m);
  for (const forbidden of [
    'schedule',
    'pull_request',
    'push:',
    'deployment_status',
    'workflow_run',
  ]) {
    assert.ok(!triggers.includes(forbidden), `the journeys workflow must not use ${forbidden}`);
  }
  assert.match(text, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(text, /scripts\/check-staging-target\.mjs/);
  assert.match(text, /scripts\/check-authenticated-results\.mjs/);
  assert.match(text, /scripts\/check-staging-journey-setup\.mjs/);
  assert.doesNotMatch(text, /continue-on-error/);
  assert.doesNotMatch(text, /visastack-five\.vercel\.app|vs\.obsidianglobal\.studio/);
  assert.match(text, /Refuse missing, skipped, retried or failed/);
});

test('no other workflow runs the signed-in journeys or the retired authenticated suite', () => {
  for (const name of readdirSync(join(root, '.github/workflows'))) {
    if (name === 'neon-staging-journeys.yml') continue;
    const text = read(join('.github/workflows', name));
    assert.doesNotMatch(text, /e2e\/signed-in|signed-in\/|playwright\.signed-in\.config/, name);
    assert.doesNotMatch(text, /authenticated-workspace/, `${name} runs the retired suite`);
  }
});

test('the default Playwright run ignores the signed-in journeys and the retired suite', () => {
  const config = read('apps/web/playwright.config.ts');
  const ignore = config.match(/testIgnore:\s*\[([^\]]*)\]/)?.[1] ?? '';
  for (const entry of [
    'neon-staging-routes.spec.ts',
    'authenticated-workspace.spec.ts',
    'signed-in/**',
  ]) {
    assert.ok(ignore.includes(`'${entry}'`), `testIgnore must list ${entry}`);
  }
  assert.ok(
    existsSync(join(root, 'apps/web/e2e/authenticated-workspace.spec.ts')),
    'retiring it is a separate decision',
  );
});

test('the journeys config has no default target, no retries and one worker', () => {
  const config = read('apps/web/playwright.signed-in.config.ts');
  assert.match(config, /BLOCKED: explicit isolated staging origin is required/);
  assert.doesNotMatch(
    config,
    /baseURL:\s*['"`]https?:/,
    'a default target would let a mistake reach a real site',
  );
  assert.match(config, /retries: 0/);
  assert.match(config, /workers: 1/);
  assert.match(config, /forbidOnly: true/);
});

test('a journey that cannot run fails; nothing is skipped or marked as expected to fail', () => {
  for (const path of [...sourceFiles, ...filesUnder('apps/web/e2e/journey-screens')]) {
    const text = read(path);
    assert.doesNotMatch(
      text,
      /\btest\.(skip|fixme|fail|slow)\s*\(|\.skip\s*\(|\btest\.only|\bdescribe\.only|testInfo\.skip|info\.skip|\bxit\(|\bxtest\(/,
      `${path} must not skip, hide or restrict a test`,
    );
  }
});

test('every setting a journey reads is declared, passed by the workflow and explained', () => {
  const declared = new Set(allNames());
  const workflow = read(JOURNEYS_WORKFLOW);
  const doc = read('docs/operations/staging-journeys.md');
  const used = new Set();
  for (const path of sourceFiles) {
    for (const match of read(path).matchAll(
      /\b(E2E_[A-Z0-9_]+|NEON_STAGING_[A-Z0-9_]+|STAGING_[A-Z_]+)\b/g,
    )) {
      used.add(match[1]);
    }
  }
  for (const name of used) {
    // Role-templated names (NEON_STAGING_${role}_EMAIL) are written out by the declared list.
    if (name.endsWith('_')) continue;
    assert.ok(
      declared.has(name),
      `${name} is read by a journey but not declared in the setup script`,
    );
  }
  for (const name of declared) {
    assert.ok(
      new RegExp(`^\\s+${name}: `, 'm').test(workflow),
      `${name} is not passed by the workflow`,
    );
    // Set by the workflow itself (the origin from E2E_STAGING_BASE_URL, the revision from the run).
    if (name === 'PLAYWRIGHT_BASE_URL' || name === 'E2E_EXPECTED_SHA') continue;
    assert.ok(
      doc.includes(name),
      `${name} is not explained in docs/operations/staging-journeys.md`,
    );
  }
  assert.ok(doc.includes('E2E_STAGING_BASE_URL'));
  for (const name of OPTIONAL_NAMES) assert.ok(declared.has(name));
});

test('every journey spec belongs to exactly one suite, and every suite file exists', () => {
  const listed = Object.values(SUITES).flatMap((suite) => suite.files);
  const onDisk = specFiles.map((path) => relative(SIGNED_IN, path));
  assert.deepEqual([...new Set(listed)].sort(), onDisk.sort());
  assert.equal(listed.length, new Set(listed).size, 'a spec file is in two suites');
  for (const suite of Object.values(SUITES)) {
    for (const group of suite.groups) assert.ok(GROUPS[group], `unknown group ${group}`);
  }
  assert.deepEqual(filesFor('all').sort(), onDisk.sort());
  assert.throws(() => filesFor('production'));
});

test('the setup report names settings and never prints a value', () => {
  const env = {
    PLAYWRIGHT_BASE_URL: 'https://secret-looking-origin.example',
    STAGING_VERCEL_TOKEN: 'token-value-that-must-not-print',
    NEON_STAGING_TRAVELLER_PASSWORD: 'password-value-that-must-not-print',
  };
  const text = report(env).join('\n');
  assert.match(text, /BLOCKED\s+traveller/);
  assert.match(text, /NEON_STAGING_TRAVELLER_EMAIL/);
  for (const value of Object.values(env)) assert.ok(!text.includes(value), 'a value was printed');
});

test('a confirmation must be exactly "true" and an empty setting is missing', () => {
  assert.deepEqual(missingIn('exactCopy', {}), [
    'E2E_EXACT_COPY_SERVICE_VERIFIED',
    'E2E_ACCESS_SEEDED',
  ]);
  assert.deepEqual(
    missingIn('exactCopy', { E2E_EXACT_COPY_SERVICE_VERIFIED: 'yes', E2E_ACCESS_SEEDED: 'true' }),
    ['E2E_EXACT_COPY_SERVICE_VERIFIED'],
  );
  assert.deepEqual(
    missingIn('exactCopy', { E2E_EXACT_COPY_SERVICE_VERIFIED: 'true', E2E_ACCESS_SEEDED: 'true' }),
    [],
  );
  assert.deepEqual(missingIn('ui', { E2E_CASE_ID: '' }), ['E2E_CASE_ID']);
});

test('the exact-copy loop is blocked until the owner confirms the service is deployed', () => {
  assert.ok(SUITES.loop.groups.includes('exactCopy'));
  const spec = read(`${SIGNED_IN}/agency-loop.spec.ts`);
  assert.match(spec, /confirmed\(\s*'E2E_EXACT_COPY_SERVICE_VERIFIED'/);
  assert.match(spec, /requireExactCopyUi/);
});

test('three accounts must be three different people and two different agencies', () => {
  const base = {
    NEON_STAGING_TRAVELLER_EMAIL: 'a@example.test',
    NEON_STAGING_AGENCY_ADMIN_EMAIL: 'b@example.test',
    NEON_STAGING_UNRELATED_AGENCY_ADMIN_EMAIL: 'c@example.test',
    E2E_AGENCY_ORG_ID: 'org-1',
    E2E_UNRELATED_AGENCY_ORG_ID: 'org-2',
  };
  assert.equal(sharedIdentities(base), false);
  assert.equal(
    sharedIdentities({ ...base, NEON_STAGING_AGENCY_ADMIN_EMAIL: 'A@example.test' }),
    true,
  );
  assert.equal(sharedIdentities({ ...base, E2E_UNRELATED_AGENCY_ORG_ID: 'org-1' }), true);
});

test('no picture or document is committed for the specimen passport', () => {
  const binary = filesUnder('apps/web/e2e').filter((path) =>
    /\.(png|jpe?g|pdf|webp|gif|heic|tiff?)$/i.test(path),
  );
  assert.deepEqual(binary, []);
  const generator = read('apps/web/e2e/fixtures/synthetic-passport.ts');
  assert.match(generator, /SPECIMEN - NOT A REAL DOCUMENT - TEST DATA ONLY/);
});

test('the journeys never print a credential, a cookie or a token', () => {
  for (const path of sourceFiles) {
    const text = read(path);
    assert.doesNotMatch(
      text,
      /console\.(log|info|warn|error)\s*\(/,
      `${path} writes to the console`,
    );
    assert.doesNotMatch(text, /storageState\s*\(\s*\{\s*path/, `${path} writes cookies to disk`);
    assert.doesNotMatch(text, /\.cookies\(\)[^;]*(JSON|attach|writeFile)/, `${path} saves cookies`);
  }
});
