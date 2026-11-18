/**
 * Guards the signed-in guard on the CI machine (docs/operations/ci-signed-in-guard.md): a made-up
 * traveller and agency admin signed in through a loopback stand-in, around the unchanged
 * production build. Nothing of it may ship in the app or reach anything outside the CI machine.
 *
 * Fails when:
 * - any file under apps/web/src or packages/ names ci-signed-in (the stand-ins would ship);
 * - any workflow other than pr-signed-in-guard.yml names it, or that workflow gains secrets, loses
 *   its time limit or takes the name of a required check;
 * - the stand-in sign-in service listens anywhere but 127.0.0.1, starts on Vercel, or answers
 *   anything but the one session call for its two made-up people;
 * - the database preload accepts a database that is not on this machine, or runs on Vercel;
 * - the installed Neon Auth SDK stops asking for the session the way the stand-in answers it.
 *
 * Run with: node --test scripts/ci-signed-in.test.mjs (part of `pnpm run test:node`).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'apps/web');
const guardDir = join(web, 'ci-signed-in');
const read = (path) => readFileSync(join(root, path), 'utf8');
const standIn = await import(pathToFileURL(join(guardDir, 'stand-in-auth.mjs')).href);

function filesUnder(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === 'dist') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...filesUnder(path));
    else found.push(path);
  }
  return found;
}

test('no app or package file names the signed-in guard, so none of it can ship', () => {
  const sources = [...filesUnder(join(web, 'src')), ...filesUnder(join(root, 'packages'))];
  const offenders = sources.filter((path) => readFileSync(path, 'utf8').includes('ci-signed-in'));
  assert.deepEqual(
    offenders.map((path) => relative(root, path)),
    [],
  );
  for (const name of [
    'next.config.ts',
    'next.config.mjs',
    'next.config.js',
    'playwright.config.ts',
  ]) {
    let text = '';
    try {
      text = readFileSync(join(web, name), 'utf8');
    } catch {
      continue;
    }
    assert.doesNotMatch(text, /ci-signed-in|stand-in/, name);
  }
});

test('only the separate, non-required pull request workflow runs it, with no secrets', () => {
  for (const name of readdirSync(join(root, '.github/workflows'))) {
    if (name === 'pr-signed-in-guard.yml') continue;
    assert.doesNotMatch(
      read(`.github/workflows/${name}`),
      /ci-signed-in|db-preload|stand-in-auth/,
      name,
    );
  }
  const flow = read('.github/workflows/pr-signed-in-guard.yml');
  assert.match(flow, /^on:\n {2}pull_request:\n/m);
  assert.doesNotMatch(flow, /guard-run\/\*\.(pem|json)|tokens\.json|key\.pem/);
  assert.match(flow, /^permissions:\n {2}contents: read\n/m);
  assert.match(flow, /^ {4}timeout-minutes: 20$/m);
  assert.doesNotMatch(flow, /secrets\./);
  const steps = flow
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
  assert.doesNotMatch(steps, /vercel|neon\.tech|NEON_AUTH_BASE_URL:/i);
  assert.match(flow, /DATABASE_URL: postgres:\/\/postgres@127\.0\.0\.1:5432\//);
  for (const required of [
    'Lint · Build · Typecheck · Test',
    'No-secret Playwright checks',
    'No-secret smoke check',
  ]) {
    assert.ok(!flow.includes(`name: ${required}`), `takes the required check name ${required}`);
  }
});

test('the browser config refuses anything but this machine', () => {
  const config = read('apps/web/playwright.ci-signed-in.config.ts');
  assert.match(config, /host !== 'localhost' && host !== '127\.0\.0\.1'/);
  assert.match(config, /workers: 2,/);
  const list = (base) =>
    spawnSync(
      join(web, 'node_modules/.bin/playwright'),
      ['test', '--list', '-c', 'playwright.ci-signed-in.config.ts'],
      { cwd: web, env: { PATH: process.env.PATH, PLAYWRIGHT_BASE_URL: base }, encoding: 'utf8' },
    );
  const refused = list('https://vs.obsidianglobal.studio');
  assert.notEqual(refused.status, 0);
  assert.match(
    `${refused.stdout}${refused.stderr}`,
    /only against the app started on this machine/,
  );
  const local = list('http://localhost:3100');
  assert.equal(local.status, 0, local.stderr);
  assert.match(local.stdout, /proof\.guard\.ts/);
});

test('the stand-in sign-in service listens on loopback only and refuses Vercel', async () => {
  assert.throws(() => standIn.assertSafeToRun({ VERCEL: '1' }), /never runs on Vercel/);
  assert.throws(
    () => standIn.assertSafeToRun({ CI_STAND_IN_HOST: '0.0.0.0' }),
    /127\.0\.0\.1 only/,
  );
  await assert.rejects(
    standIn.startStandIn({ runDir: tmpdir(), env: { VERCEL: '1' } }),
    /never runs on Vercel/,
  );
  const runDir = mkdtempSync(join(tmpdir(), 'ci-signed-in-test-'));
  try {
    const started = await standIn.startStandIn({ runDir, env: {} });
    try {
      const url = new URL(started.baseUrl);
      assert.equal(url.protocol, 'https:');
      assert.equal(url.hostname, '127.0.0.1');
      assert.equal(url.pathname, '/neondb/auth');
      // Two random tokens, owner-only file.
      assert.equal(statSync(join(runDir, 'tokens.json')).mode & 0o777, 0o600);
      assert.notEqual(started.tokens.traveller, started.tokens.agencyAdmin);
    } finally {
      await started.close();
    }
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

/** Calls the handler directly with a fake request and returns status and body. */
function call(handler, { method = 'GET', url, cookie }) {
  let status = 0;
  let body = '';
  handler(
    { method, url, headers: cookie ? { cookie } : {} },
    {
      writeHead(code) {
        status = code;
      },
      end(text) {
        body = text;
      },
    },
  );
  return { status, body };
}

test('the stand-in answers only the session call, and only for its two made-up people', () => {
  const people = standIn.readPeople();
  const tokens = { traveller: 'ci.t', agencyAdmin: 'ci.a' };
  const handler = standIn.createHandler({ people, tokens, signedInAt: Date.now() });
  const known = call(handler, {
    url: '/neondb/auth/get-session',
    cookie: `other=1; ${standIn.SESSION_COOKIE}=ci.t`,
  });
  assert.equal(known.status, 200);
  const session = JSON.parse(known.body);
  assert.equal(session.user.email, people.traveller.email);
  assert.equal(session.user.id, people.traveller.providerId);
  assert.equal(session.user.emailVerified, true);
  assert.equal(session.session.userId, people.traveller.providerId);
  for (const email of [people.traveller.email, people.agencyAdmin.email]) {
    assert.match(email, /@example\.test$/, 'made-up addresses only');
  }
  assert.equal(
    call(handler, { url: '/neondb/auth/get-session', cookie: `${standIn.SESSION_COOKIE}=nope` })
      .body,
    'null',
  );
  assert.equal(call(handler, { url: '/neondb/auth/get-session' }).body, 'null');
  assert.equal(
    call(handler, { url: '/neondb/auth/sign-in/email', cookie: `${standIn.SESSION_COOKIE}=ci.t` })
      .status,
    404,
  );
  assert.equal(call(handler, { method: 'POST', url: '/neondb/auth/get-session' }).status, 404);
});

test('the database preload refuses a database off this machine and refuses Vercel', () => {
  const preload = join(guardDir, 'db-preload.cjs');
  const require = createRequire(import.meta.url);
  const { assertLoopbackDatabase, bridgePort } = require(preload);
  const local = 'postgres://postgres@127.0.0.1:5432/x';
  assert.deepEqual(assertLoopbackDatabase({ DATABASE_URL: local }), {
    url: local,
    host: '127.0.0.1',
    port: 5432,
  });
  // The app's own choice order: DIRECT_DATABASE_URL wins over DATABASE_URL.
  const direct = 'postgres://postgres@127.0.0.1:6543/y';
  assert.equal(
    assertLoopbackDatabase({ DATABASE_URL: local, DIRECT_DATABASE_URL: direct }).url,
    direct,
  );
  assert.throws(() => assertLoopbackDatabase({}), /needs DATABASE_URL/);
  for (const remote of [
    'postgres://u@remote-db.example.com/db',
    'postgres://postgres@localhost/x',
  ]) {
    assert.throws(
      () => assertLoopbackDatabase({ DATABASE_URL: remote }),
      /only allows a database on 127\.0\.0\.1/,
    );
  }
  assert.throws(
    () =>
      assertLoopbackDatabase({
        DATABASE_URL: local,
        POSTGRES_URL: 'postgres://u@db.example.com/db',
      }),
    /POSTGRES_URL/,
  );
  assert.throws(
    () => assertLoopbackDatabase({ VERCEL: '1', DATABASE_URL: local }),
    /never runs on Vercel/,
  );
  assert.throws(() => bridgePort({}), /CI_DB_BRIDGE_PORT/);
  assert.equal(bridgePort({ CI_DB_BRIDGE_PORT: '45432' }), 45432);

  // Loaded the way the server loads it, it stops the process before anything starts.
  const run = (env, script = 'console.log("started")') =>
    spawnSync(process.execPath, ['--require', preload, '-e', script], {
      cwd: web,
      env: { PATH: process.env.PATH, CI_DB_PRELOAD_START: '1', ...env },
      encoding: 'utf8',
    });
  for (const env of [
    { DATABASE_URL: 'postgres://u@remote-db.example.com/db', CI_DB_BRIDGE_PORT: '45433' },
    { VERCEL: '1', DATABASE_URL: local, CI_DB_BRIDGE_PORT: '45433' },
    { DATABASE_URL: local },
  ]) {
    const refused = run(env);
    assert.notEqual(refused.status, 0, JSON.stringify(env));
    assert.doesNotMatch(refused.stdout, /started/);
  }
  // Allowed, both copies of the driver point at the bridge before the first line of the app runs.
  const both = run(
    { DATABASE_URL: local, CI_DB_BRIDGE_PORT: '45434' },
    `const c = require('@neondatabase/serverless').neonConfig;
     import('@neondatabase/serverless').then(({ neonConfig: m }) => {
       console.log(JSON.stringify([c.wsProxy('h'), m.wsProxy('h'), c.forceDisablePgSSL, m.forceDisablePgSSL, c.useSecureWebSocket, m.useSecureWebSocket]));
       process.exit(0);
     });`,
  );
  assert.equal(both.status, 0, both.stderr);
  assert.deepEqual(JSON.parse(both.stdout.trim().split('\n').at(-1)), [
    '127.0.0.1:45434',
    '127.0.0.1:45434',
    true,
    true,
    false,
    false,
  ]);
});

test('the installed Neon Auth SDK still asks for the session the way the stand-in answers it', () => {
  const pkgDir = join(web, 'node_modules/@neondatabase/auth');
  assert.equal(
    JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version,
    '0.5.0-beta',
  );
  const dist = join(pkgDir, 'dist');
  const server = readdirSync(dist)
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => readFileSync(join(dist, f), 'utf8'))
    .find((s) => s.includes('async function fetchSessionWithCookie('));
  assert.ok(server, 'Neon Auth no longer has fetchSessionWithCookie: re-check the stand-in');
  // The cookie names.
  assert.ok(server.includes('const NEON_AUTH_COOKIE_PREFIX = "__Secure-neon-auth";'));
  assert.ok(
    server.includes(
      'const NEON_AUTH_SESSION_COOKIE_NAME = `${NEON_AUTH_COOKIE_PREFIX}.session_token`;',
    ),
  );
  assert.equal(standIn.SESSION_COOKIE, '__Secure-neon-auth.session_token');
  assert.ok(read('apps/web/ci-signed-in/session.ts').includes(`'${standIn.SESSION_COOKIE}'`));
  // The one call: GET <base>/get-session, with the session cookie.
  assert.ok(server.includes('getSession: {\n\t\tpath: "get-session",\n\t\tmethod: "GET"\n\t}'));
  const fetchSession = server.slice(server.indexOf('async function fetchSessionWithCookie('));
  assert.ok(fetchSession.slice(0, 900).includes('await fetch(`${baseUrl}/get-session`, {'));
  assert.ok(
    fetchSession.slice(0, 900).includes('headers: { Cookie: `${cookieName}=${cookieValue}` },'),
  );
  assert.ok(
    server.includes('const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);'),
  );
  // The answer shape: a session and a user, or nothing.
  assert.ok(server.includes('if (!data.session || !data.user) return {'));
  for (const field of [
    'session.expiresAt',
    'session.createdAt',
    'session.updatedAt',
    'user.createdAt',
    'user.updatedAt',
  ]) {
    assert.ok(server.includes(`"${field}")`), `parseSessionData no longer reads ${field}`);
  }
  // The app's own sign-in settings still require an https base URL (why the stand-in uses TLS).
  assert.match(
    read('apps/web/src/lib/neon-auth.ts'),
    /NEON_AUTH_BASE_URL must start with https:\/\//,
  );
});
