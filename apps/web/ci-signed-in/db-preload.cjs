/**
 * Database preload for the signed-in guard on the CI machine (docs/operations/ci-signed-in-guard.md).
 *
 * Loaded into the unchanged production server with
 *   NODE_OPTIONS="--require ./ci-signed-in/db-preload.cjs" next start
 * The app's database driver (`@neondatabase/serverless`, the one production uses) speaks Postgres
 * inside a WebSocket. This preload starts the repository's loopback bridge (packages/db/src/pg-bridge.ts)
 * and points the driver at it, so the app talks to the throwaway Postgres service container of the
 * CI job. Nothing in the app imports this file, and it refuses to run anywhere but a loopback
 * database on a machine that is not Vercel.
 */
'use strict';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);

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
 * Throws unless every configured database address is on this machine and this is not Vercel.
 * Returns the Postgres host and port the bridge connects to.
 */
function assertLoopbackDatabase(env) {
  if (env.VERCEL) throw new Error('The CI database preload never runs on Vercel.');
  const set = DATABASE_URL_NAMES.filter((name) => env[name]);
  if (set.length === 0) throw new Error('The CI database preload needs DATABASE_URL.');
  let target;
  for (const name of set) {
    let url;
    try {
      url = new URL(env[name]);
    } catch {
      throw new Error(`The CI database preload could not read ${name}.`);
    }
    if (!LOOPBACK_HOSTS.has(url.hostname)) {
      throw new Error(`The CI database preload only allows a database on 127.0.0.1 (${name}).`);
    }
    target ??= { host: '127.0.0.1', port: Number(url.port || '5432') };
  }
  return target;
}

/** Points one copy of the Neon driver's settings at the bridge (same settings as `useLocalBridge`). */
function pointAtBridge(neonConfig, port) {
  neonConfig.wsProxy = () => `127.0.0.1:${port}`;
  neonConfig.useSecureWebSocket = false;
  neonConfig.pipelineTLS = false;
  neonConfig.pipelineConnect = false;
  neonConfig.forceDisablePgSSL = true;
}

async function start(env) {
  const target = assertLoopbackDatabase(env);
  const { startBridge, useLocalBridge } = require('../../../packages/db/src/pg-bridge.ts');
  const bridge = await startBridge({
    listenPort: Number(env.CI_DB_BRIDGE_PORT ?? '0'),
    pgHost: target.host,
    pgPort: target.port,
  });
  // The driver ships as two separate copies (require and import), each with its own settings.
  // The server may load either, so both are pointed at the bridge.
  useLocalBridge(bridge.port);
  pointAtBridge(require('@neondatabase/serverless').neonConfig, bridge.port);
  pointAtBridge((await import('@neondatabase/serverless')).neonConfig, bridge.port);
  return bridge;
}

module.exports = { assertLoopbackDatabase, start, LOOPBACK_HOSTS };

// Loaded through --require (not by the test, which only imports the checks above).
if (require.main !== module && !process.env.CI_DB_PRELOAD_TEST) {
  // Refuse synchronously, before the server can start serving anything.
  assertLoopbackDatabase(process.env);
  if (!globalThis.__visastackCiDbBridge) {
    globalThis.__visastackCiDbBridge = start(process.env).catch((error) => {
      console.error(
        `CI database preload failed: ${error instanceof Error ? error.message : error}`,
      );
      process.exit(1);
    });
  }
}
