/**
 * Database preload for the signed-in guard on the CI machine (docs/operations/ci-signed-in-guard.md).
 *
 * Loaded into the unchanged production server with
 *   CI_DB_PRELOAD_START=1 NODE_OPTIONS="--require ./ci-signed-in/db-preload.cjs" next start
 * The app's database driver (`@neondatabase/serverless`, the one production uses) speaks Postgres
 * inside a WebSocket. This preload starts the repository's loopback bridge (packages/db/src/pg-bridge.ts)
 * and points the driver at it, so the app talks to the throwaway Postgres service container of the
 * CI job. Nothing in the app imports this file, and it refuses to run anywhere but a database on
 * 127.0.0.1 on a machine that is not Vercel.
 *
 * The bridge port is fixed by the runner (CI_DB_BRIDGE_PORT), so the driver is pointed at it
 * synchronously, before the server can take its first request; the runner waits for the bridge
 * to listen before it calls the server ready.
 */
'use strict';

const path = require('node:path');

const LOOPBACK = '127.0.0.1';

/** The database the app will use, chosen the same way as `resolveDatabaseUrl` in @visastack/db. */
const DATABASE_URL_NAMES = [
  'DIRECT_DATABASE_URL',
  'DATABASE_URL',
  'POSTGRES_URL',
  'DATABASE_URL_UNPOOLED',
  'POSTGRES_URL_NON_POOLING',
  'POSTGRES_PRISMA_URL',
];

/**
 * Throws unless every configured database address is 127.0.0.1 and this is not Vercel. Returns
 * the address the app uses (the first one set, as `resolveDatabaseUrl` picks it) and its port.
 * Shared with seed.ts, so the seed and the app always agree on the database.
 */
function assertLoopbackDatabase(env) {
  if (env.VERCEL) throw new Error('The CI database preload never runs on Vercel.');
  const set = DATABASE_URL_NAMES.filter((name) => env[name]);
  if (set.length === 0) throw new Error('The CI database preload needs DATABASE_URL.');
  let chosen;
  for (const name of set) {
    let url;
    try {
      url = new URL(env[name]);
    } catch {
      throw new Error(`The CI database preload could not read ${name}.`);
    }
    if (url.hostname !== LOOPBACK) {
      throw new Error(`The CI database preload only allows a database on ${LOOPBACK} (${name}).`);
    }
    chosen ??= { url: String(env[name]), host: LOOPBACK, port: Number(url.port || '5432') };
  }
  if (!chosen) throw new Error('The CI database preload needs DATABASE_URL.');
  return chosen;
}

/** The bridge port the runner chose. Throws when missing or not a usable port. */
function bridgePort(env) {
  const port = Number(env.CI_DB_BRIDGE_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('The CI database preload needs CI_DB_BRIDGE_PORT (1024 to 65535).');
  }
  return port;
}

/**
 * Starts the bridge on the fixed port and points both copies of the driver at it. The driver
 * ships as two copies (one for `require`, one for `import`), each with its own settings, and the
 * server may load either: `useLocalBridge` sets the `import` copy (pg-bridge.ts imports it), and the
 * same function is applied to the `require` copy, so the two can never differ.
 */
function start(env) {
  const target = assertLoopbackDatabase(env);
  const port = bridgePort(env);
  const { startBridge, useLocalBridge } = require('../../../packages/db/src/pg-bridge.ts');
  useLocalBridge(port);
  const requirePath = require.resolve('@neondatabase/serverless');
  const required = require(requirePath).neonConfig;
  // The `import` copy, by its file path (the package exports it only to `import`).
  const fromImport = require(path.join(path.dirname(requirePath), 'index.mjs')).neonConfig;
  if (required !== fromImport) {
    for (const key of [
      'wsProxy',
      'useSecureWebSocket',
      'pipelineTLS',
      'pipelineConnect',
      'forceDisablePgSSL',
    ]) {
      required[key] = fromImport[key];
    }
  }
  return startBridge({ listenPort: port, pgHost: target.host, pgPort: target.port });
}

module.exports = { assertLoopbackDatabase, bridgePort, start, LOOPBACK };

// Starts only when the runner asks (run.sh sets CI_DB_PRELOAD_START for `next start`); the seed
// and the test import this file for its checks alone.
if (process.env.CI_DB_PRELOAD_START === '1') {
  if (!globalThis.__visastackCiDbBridge) {
    // Refuses (throws) synchronously, before the server can start serving anything.
    globalThis.__visastackCiDbBridge = start(process.env).catch((error) => {
      console.error(
        `CI database preload failed: ${error instanceof Error ? error.message : error}`,
      );
      process.exit(1);
    });
  }
}
