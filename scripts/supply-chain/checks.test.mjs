// Run with: node --test scripts/supply-chain
// Each check is proved able to FAIL on a planted bad input, as well as pass on good input.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  checkBrowserBundle,
  checkFixtures,
  checkLicences,
  checkPreviewCredentials,
  checkPrompts,
  checkSecrets,
  checkStaticAnalysis,
  classifyLicences,
  summarise,
  toMarkdown,
} from './checks.mjs';

// Fake credentials are built from parts so this file never holds a whole one.
const fakeAws = `${'AKIA'}${'ABCDEFGHIJKLMNOP'}`;
const fakeLive = `${'sk_live_'}${'a1b2c3d4e5f6g7h8i9j0k1'}`;
const fakeUrl = `${'postgres://'}app:${'S3cretPw9x'}@ep-cool-1234.neon.tech/db`;

function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'sc-'));
  for (const [name, body] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body);
  }
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['add', '-A'], { cwd: dir });
  return dir;
}

test('secret scan passes on clean files and fails on a planted key', () => {
  const clean = repo({ 'a.ts': 'const x = 1;\n' });
  assert.equal(checkSecrets(clean, undefined, { history: false }).status, 'passed');
  const dirty = repo({ 'a.ts': `const k = '${fakeAws}';\n`, 'b.env': `DB=${fakeUrl}\n` });
  const r = checkSecrets(dirty, undefined, { history: false });
  assert.equal(r.status, 'failed');
  assert.ok(r.findings.some((f) => f.includes('AWS access key id')));
  assert.ok(r.findings.some((f) => f.includes('database URL with password')));
});

test('secret scan honours a reviewed allow marker', () => {
  const dir = repo({ 'a.ts': `const k = '${fakeAws}'; // supply-chain-allow: documented dummy\n` });
  assert.equal(checkSecrets(dir, undefined, { history: false }).status, 'passed');
});

test('secret scan finds a secret that was added and later deleted (history)', () => {
  const dir = repo({ 'a.ts': `const k = '${fakeAws}';\n` });
  const git = (...a) =>
    execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...a], {
      cwd: dir,
    });
  git('commit', '-qm', 'add');
  writeFileSync(join(dir, 'a.ts'), 'const k = 1;\n');
  git('commit', '-qam', 'remove');
  const r = checkSecrets(dir, undefined, { history: true });
  assert.equal(r.status, 'failed');
  assert.ok(r.findings.some((f) => f.startsWith('history ')));
});

test('licence classification denies copyleft and tolerates an OR with a permissive choice', () => {
  const { denied, unknown } = classifyLicences({
    MIT: [{ name: 'a', versions: ['1.0.0'] }],
    'GPL-3.0': [{ name: 'bad', versions: ['2.0.0'] }],
    'AGPL-3.0-only': [{ name: 'worse', versions: ['1.0.0'] }],
    '(MIT OR GPL-3.0)': [{ name: 'dual', versions: ['1.0.0'] }],
    Unknown: [{ name: 'mystery', versions: ['0.1.0'] }],
  });
  assert.deepEqual(
    denied.map((d) => d.split('@')[0]),
    ['bad', 'worse'],
  );
  assert.equal(unknown.length, 1);
});

test('a reviewed licence exception is accepted by exact name only', () => {
  const ok = classifyLicences({
    'LGPL-3.0-or-later': [{ name: '@img/sharp-libvips-linux-x64', versions: ['1.3.3'] }],
  });
  assert.equal(ok.denied.length, 0);
  assert.equal(ok.accepted.length, 1);
  const bad = classifyLicences({
    'LGPL-3.0-or-later': [{ name: 'some-other-lgpl-lib', versions: ['1.0.0'] }],
  });
  assert.equal(bad.denied.length, 1);
});

test('licence scan fails on a denied licence and is skipped when it cannot run', () => {
  const bad = checkLicences('.', () => ({ 'GPL-2.0': [{ name: 'x', versions: ['1.0.0'] }] }));
  assert.equal(bad.status, 'failed');
  const ok = checkLicences('.', () => ({ MIT: [{ name: 'x', versions: ['1.0.0'] }] }));
  assert.equal(ok.status, 'passed');
  const skipped = checkLicences('.', () => {
    throw new Error('no lockfile');
  });
  assert.equal(skipped.status, 'skipped');
});

test('static analysis flags dangerous code in shipped source but not in tests', () => {
  const dir = repo({
    'apps/web/src/a.ts': 'export const f = (s: string) => eval(s);\n',
    'apps/web/src/b.tsx':
      'export const B = () => <div dangerouslySetInnerHTML={{ __html: x }} />;\n',
    'apps/web/src/a.test.ts': 'eval("1");\n',
  });
  const r = checkStaticAnalysis(dir);
  assert.equal(r.status, 'failed');
  assert.equal(r.findings.length, 2);
  assert.ok(r.findings.every((f) => !f.includes('a.test.ts')));
  const clean = repo({ 'apps/web/src/a.ts': 'export const f = 1;\n' });
  assert.equal(checkStaticAnalysis(clean).status, 'passed');
});

test('browser bundle check is skipped without a build, fails on a leak, passes when clean', () => {
  const none = repo({ '.env.example': 'WORKOS_API_KEY=\n' });
  assert.equal(checkBrowserBundle(none).status, 'skipped');

  const leaky = repo({ '.env.example': 'WORKOS_API_KEY=\nNEXT_PUBLIC_X=\n' });
  const leakyStatic = join(leaky, 'apps/web/.next/static');
  mkdirSync(join(leakyStatic, 'chunks'), { recursive: true });
  writeFileSync(join(leakyStatic, 'chunks/app.js'), 'var a=process.env.WORKOS_API_KEY;');
  writeFileSync(join(leakyStatic, 'chunks/app.js.map'), '{}');
  const bad = checkBrowserBundle(leaky);
  assert.equal(bad.status, 'failed');
  assert.ok(bad.findings.some((f) => f.includes('WORKOS_API_KEY')));
  assert.ok(bad.findings.some((f) => f.includes('source map')));

  const good = repo({ '.env.example': 'WORKOS_API_KEY=\n' });
  const goodStatic = join(good, 'apps/web/.next/static');
  mkdirSync(goodStatic, { recursive: true });
  writeFileSync(join(goodStatic, 'app.js'), 'var a=NEXT_PUBLIC_X;');
  assert.equal(checkBrowserBundle(good).status, 'passed');
});

test('prompt check fails on secrets, environment values and real emails inside a prompt', () => {
  const dir = repo({
    'packages/adapters/src/p.ts':
      'const SYSTEM_PROMPT = `You help. Key: ${process.env.OPENAI_API_KEY} write to boss@realfirm.com`;\n',
  });
  const r = checkPrompts(dir);
  assert.equal(r.status, 'failed');
  assert.ok(r.findings.some((f) => f.includes('environment value')));
  assert.ok(r.findings.some((f) => f.includes('email address')));
  const clean = repo({
    'packages/adapters/src/p.ts': 'const SYSTEM_PROMPT = `You help. Example: jane@example.com`;\n',
  });
  assert.equal(checkPrompts(clean).status, 'passed');
  const none = repo({ 'packages/adapters/src/p.ts': 'export const x = 1;\n' });
  assert.equal(checkPrompts(none).status, 'skipped');
});

test('fixture check fails on a live key or production database host in test data', () => {
  const dir = repo({
    'apps/web/src/x.test.ts': `const k = '${fakeLive}';\n`,
    'apps/web/e2e/y.spec.ts': "const h = 'ep-cool-1234.neon.tech';\n",
  });
  const r = checkFixtures(dir);
  assert.equal(r.status, 'failed');
  assert.ok(r.findings.length >= 2);
  const clean = repo({
    'apps/web/src/x.test.ts': "const k = 'sk_live_accidentally_pasted_secret';\n",
  });
  assert.equal(checkFixtures(clean).status, 'passed');
});

test('preview credential check flags pull_request_target, unlisted secret use and env files', () => {
  const dir = repo({
    '.github/workflows/x.yml':
      'on:\n  pull_request_target:\njobs:\n  a:\n    steps:\n      - run: echo ${{ secrets.DATABASE_URL }}\n',
    'apps/web/.env.production': 'A=1\n',
    '.env.example': 'WORKOS_API_KEY=sk_test_realvalue\n',
  });
  const r = checkPreviewCredentials(dir);
  assert.equal(r.status, 'failed');
  assert.ok(r.findings.some((f) => f.includes('pull_request_target')));
  assert.ok(r.findings.some((f) => f.includes('not in the reviewed allowlist')));
  assert.ok(r.findings.some((f) => f.includes('committed environment file')));
  assert.ok(r.findings.some((f) => f.includes('gives a value to WORKOS_API_KEY')));
  const clean = repo({
    '.github/workflows/ci.yml':
      'on:\n  pull_request:\njobs:\n  a:\n    steps:\n      - run: echo hi\n',
    '.env.example': 'WORKOS_API_KEY=\n',
  });
  assert.equal(checkPreviewCredentials(clean).status, 'passed');
});

test('summary counts skipped separately and never as passed', () => {
  const results = [
    { id: 'a', title: 'A', status: 'passed', detail: 'd', findings: [] },
    { id: 'b', title: 'B', status: 'skipped', detail: 'd', findings: [] },
    { id: 'c', title: 'C', status: 'failed', detail: 'd', findings: ['x'] },
  ];
  assert.deepEqual(summarise(results), { executed: 2, passed: 1, failed: 1, skipped: 1 });
  assert.match(toMarkdown(results), /Executed 2 \| Passed 1 \| Failed 1 \| Skipped 1/);
});

test('reviewed database backup cannot expose credentials through PR triggers or missing main guards', () => {
  const safe =
    "on:\n  schedule:\n    - cron: '0 6 * * 0'\n  workflow_dispatch:\njobs:\n  backup:\n    if: github.ref == 'refs/heads/main'\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          persist-credentials: false\n      - run: backup\n        env:\n          BACKUP_DATABASE_URL: ${{ secrets.BACKUP_DATABASE_URL }}\n";
  const file = '.github/workflows/database-backup.yml';
  assert.equal(checkPreviewCredentials(repo({ [file]: safe })).status, 'passed');
  assert.equal(
    checkPreviewCredentials(
      repo({ [file]: safe.replace("if: github.ref == 'refs/heads/main'", 'if: true') }),
    ).status,
    'failed',
  );
  assert.equal(
    checkPreviewCredentials(repo({ [file]: safe.replace('workflow_dispatch:', 'pull_request:') }))
      .status,
    'failed',
  );
  assert.equal(
    checkPreviewCredentials(
      repo({ [file]: safe.replace('persist-credentials: false', 'persist-credentials: true') }),
    ).status,
    'failed',
  );
});

test('private intake secrets require enabled main code and discarded checkout credentials', () => {
  const safe =
    "on:\n  workflow_dispatch:\njobs:\n  intake:\n    if: github.ref == 'refs/heads/main' && vars.DOCUMENT_INTAKE_ENABLED == 'true'\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          persist-credentials: false\n      - run: intake\n        env:\n          INTAKE_DATABASE_URL: ${{ secrets.INTAKE_DATABASE_URL }}\n";
  const file = '.github/workflows/document-intake.yml';
  assert.equal(checkPreviewCredentials(repo({ [file]: safe })).status, 'passed');
  for (const unsafe of [
    safe.replace("github.ref == 'refs/heads/main'", 'true'),
    safe.replace(" && vars.DOCUMENT_INTAKE_ENABLED == 'true'", ''),
    safe.replace('persist-credentials: false', 'persist-credentials: true'),
    safe.replace('workflow_dispatch:', 'pull_request:'),
  ])
    assert.equal(checkPreviewCredentials(repo({ [file]: unsafe })).status, 'failed');
});

test('isolated restore allows only manual main code and recovery secrets', () => {
  const safe =
    "on:\n  workflow_dispatch:\njobs:\n  restore:\n    if: github.ref == 'refs/heads/main'\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          persist-credentials: false\n      - run: restore\n        env:\n          R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}\n";
  const file = '.github/workflows/database-restore-drill.yml';
  assert.equal(checkPreviewCredentials(repo({ [file]: safe })).status, 'passed');
  for (const unsafe of [
    safe.replace("github.ref == 'refs/heads/main'", 'true'),
    safe.replace('persist-credentials: false', 'persist-credentials: true'),
    safe.replace('workflow_dispatch:', 'pull_request:'),
    safe.replace('workflow_dispatch:', 'push:'),
    safe.replace('secrets.R2_ACCESS_KEY_ID', 'secrets.BACKUP_DATABASE_URL'),
    safe.replace('secrets.R2_ACCESS_KEY_ID', 'secrets.UNKNOWN_CREDENTIAL'),
  ])
    assert.equal(checkPreviewCredentials(repo({ [file]: unsafe })).status, 'failed');
});
