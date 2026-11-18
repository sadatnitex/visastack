/**
 * Stand-in sign-in service for the signed-in guard on the CI machine (docs/operations/ci-signed-in-guard.md).
 *
 * The production build is started unchanged with NEON_AUTH_BASE_URL pointing here. Neon Auth's own
 * server code then asks this service "who owns this session cookie?" exactly as it asks the real
 * Neon Auth (`GET <base>/get-session` with the session cookie), and this service answers for two
 * made-up people only (people.json). Nothing here is part of the app: no file under src/ or
 * packages/ imports it, and a test (scripts/ci-signed-in.test.mjs) keeps it that way.
 *
 * Safety:
 * - It listens on 127.0.0.1 only, so nothing outside the machine can reach it.
 * - Its certificate is made fresh for every run, and only the one `next start` of that run is told
 *   to trust it (NODE_EXTRA_CA_CERTS). No other program trusts it, and it is never stored.
 * - The two session tokens are random for every run and written only to the run folder (owner-only
 *   file), where the browser tests read them. A token from another run is unknown here.
 * - It refuses to start on Vercel or when told to listen anywhere but loopback.
 *
 * Usage: node ci-signed-in/stand-in-auth.mjs <run folder>
 * Writes <run folder>/cert.pem, key.pem, tokens.json and, once listening, stand-in.json.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The only address this service ever listens on. */
export const LOOPBACK = '127.0.0.1';

/** Path prefix of the base URL, shaped like a real Neon Auth URL (`.../neondb/auth`). */
export const BASE_PATH = '/neondb/auth';

/** The one Neon Auth call this service answers (the pinned SDK's `get-session` endpoint). */
export const SESSION_PATH = `${BASE_PATH}/get-session`;

/** Neon Auth's session cookie name in the pinned SDK (pinned by scripts/ci-signed-in.test.mjs). */
export const SESSION_COOKIE = '__Secure-neon-auth.session_token';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The made-up people, keyed by role (`traveller`, `agencyAdmin`). */
export function readPeople() {
  return JSON.parse(readFileSync(join(here, 'people.json'), 'utf8'));
}

/** Refuses to run anywhere it could matter. */
export function assertSafeToRun(env = process.env) {
  if (env.VERCEL) throw new Error('The CI sign-in stand-in never runs on Vercel.');
  if (env.CI_STAND_IN_HOST && env.CI_STAND_IN_HOST !== LOOPBACK) {
    throw new Error(`The CI sign-in stand-in listens on ${LOOPBACK} only.`);
  }
}

/** Reads one cookie value from a Cookie header without any regular expression. */
function cookieValue(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    if (part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
}

/**
 * The answer Better Auth's `get-session` gives for a signed-in person: the session and the user,
 * dates as ISO strings. `signedInAt` is when the run started, so the app's session-age rules see a
 * session that grows older during the run exactly like a real one.
 */
export function sessionBody(person, token, signedInAt, now = Date.now()) {
  const created = new Date(signedInAt).toISOString();
  return {
    session: {
      id: `ci-stand-in-session-${person.role}`,
      token,
      userId: person.providerId,
      expiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
      createdAt: created,
      updatedAt: created,
      ipAddress: null,
      userAgent: null,
    },
    user: {
      id: person.providerId,
      email: person.email,
      name: person.name,
      emailVerified: true,
      image: null,
      createdAt: created,
      updatedAt: created,
    },
  };
}

/** The request handler, separate from the server so the test can call it directly. */
export function createHandler({ people, tokens, signedInAt }) {
  const byToken = new Map();
  for (const [role, token] of Object.entries(tokens)) {
    const person = people[role];
    if (person) byToken.set(token, person);
  }
  return (req, res) => {
    const path = (req.url ?? '').split('?')[0];
    if (req.method !== 'GET' || path !== SESSION_PATH) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{"message":"Not found"}');
      return;
    }
    const token = cookieValue(req.headers.cookie, SESSION_COOKIE);
    const person = token ? byToken.get(token) : undefined;
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    // Better Auth answers `null` for an unknown or missing session.
    res.end(JSON.stringify(person ? sessionBody(person, token, signedInAt) : null));
  };
}

/** A fresh self-signed certificate for 127.0.0.1 and localhost, valid for one day. */
export function makeCertificate(runDir) {
  const cert = join(runDir, 'cert.pem');
  const key = join(runDir, 'key.pem');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'ec',
      '-pkeyopt',
      'ec_paramgen_curve:prime256v1',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=VisaStack CI stand-in',
      '-addext',
      `subjectAltName=IP:${LOOPBACK},DNS:localhost`,
      '-keyout',
      key,
      '-out',
      cert,
    ],
    { stdio: 'ignore' },
  );
  return { cert, key };
}

/** Starts the service on loopback. Resolves with its base URL and a close function. */
export async function startStandIn({ runDir, port = 0, env = process.env }) {
  assertSafeToRun(env);
  const people = readPeople();
  const tokens = {};
  for (const role of Object.keys(people)) tokens[role] = `ci.${randomBytes(24).toString('hex')}`;
  const { cert, key } = makeCertificate(runDir);
  writeFileSync(join(runDir, 'tokens.json'), `${JSON.stringify(tokens)}\n`, { mode: 0o600 });
  const server = createServer(
    { cert: readFileSync(cert), key: readFileSync(key) },
    createHandler({ people, tokens, signedInAt: Date.now() }),
  );
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, LOOPBACK, resolve);
  });
  const address = server.address();
  if (typeof address !== 'object' || address === null || address.address !== LOOPBACK) {
    server.close();
    throw new Error('The CI sign-in stand-in is not on loopback; stopped.');
  }
  const baseUrl = `https://${LOOPBACK}:${address.port}${BASE_PATH}`;
  return {
    baseUrl,
    cert,
    tokens,
    close: () => new Promise((resolve) => server.close(() => resolve(undefined))),
  };
}

async function main() {
  const runDir = process.argv[2];
  if (!runDir) throw new Error('usage: node ci-signed-in/stand-in-auth.mjs <run folder>');
  const { baseUrl, cert } = await startStandIn({
    runDir,
    port: Number(process.env.CI_STAND_IN_PORT ?? '0'),
  });
  // Written last and moved into place, so a waiting step never reads it half written.
  const ready = join(runDir, 'stand-in.json');
  writeFileSync(`${ready}.tmp`, `${JSON.stringify({ baseUrl, cert })}\n`);
  renameSync(`${ready}.tmp`, ready);
  console.info(`CI sign-in stand-in listening at ${baseUrl}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
