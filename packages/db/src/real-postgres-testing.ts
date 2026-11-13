import { randomBytes } from 'node:crypto';
import { type AddressInfo, connect } from 'node:net';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { migrate } from 'drizzle-orm/neon-serverless/migrator';
import ws, { WebSocketServer } from 'ws';
import { migrationsFolder } from './paths';
import * as schema from './schema';

/**
 * Test support: a real Postgres server reached through the exact driver production uses.
 *
 * PGlite is one connection, so it cannot show what two requests do to each other at the same
 * moment. These helpers open real, separate connections to a real Postgres server (a CI service
 * container, or a local server) through `@neondatabase/serverless`'s `Pool`, the driver behind
 * every signed-in request (`createPooledDb`). That driver speaks Postgres over a WebSocket, which
 * Neon's own proxy turns into a socket; here a small in-process bridge does the same, and it only
 * ever connects to the one server named by `TEST_POSTGRES_URL`. No Neon branch and no
 * production database is involved.
 *
 * `TEST_POSTGRES_URL` must name a throwaway server whose role may create databases, for example
 * `postgres://postgres@127.0.0.1:5432/postgres`. Every database these helpers create is dropped by
 * `close()`.
 */

/** The server the bridge and the admin connection talk to. Throws when it is not configured. */
export function testPostgresUrl(): URL {
  const { TEST_POSTGRES_URL: raw } = process.env;
  if (!raw) {
    throw new Error(
      'TEST_POSTGRES_URL is not set. These tests need a real throwaway Postgres server (see packages/db/src/real-postgres-testing.ts).',
    );
  }
  return new URL(raw);
}

export interface RealPostgres {
  /** A new pool (its own connections) on `database`, through the production driver. */
  pool(database: string, max?: number): Pool;
  /** A migrated database of its own, copied from the template migrated once per run. */
  freshDatabase(): Promise<string>;
  /** Ends every pool, drops every database made here and stops the bridge. */
  close(): Promise<void>;
}

/** Start the bridge and migrate one template database. */
export async function startRealPostgres(): Promise<RealPostgres> {
  const target = testPostgresUrl();
  const host = target.hostname;
  const port = Number(target.port || '5432');

  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  server.on('connection', (socket) => {
    // Bytes in both directions, unchanged. The destination is fixed: whatever the client asks for,
    // only the configured test server is ever reached.
    const tcp = connect({ host, port });
    const pending: Buffer[] = [];
    let open = false;
    tcp.on('connect', () => {
      open = true;
      for (const chunk of pending.splice(0)) tcp.write(chunk);
    });
    tcp.on('data', (chunk) => {
      if (socket.readyState === ws.OPEN) socket.send(chunk);
    });
    tcp.on('close', () => socket.close());
    tcp.on('error', () => socket.terminate());
    socket.on('message', (data: Buffer) => {
      if (open) tcp.write(data);
      else pending.push(data);
    });
    socket.on('close', () => tcp.end());
    socket.on('error', () => tcp.destroy());
  });
  const bridgePort = (server.address() as AddressInfo).port;

  neonConfig.webSocketConstructor = ws;
  neonConfig.wsProxy = () => `127.0.0.1:${bridgePort}/`;
  neonConfig.useSecureWebSocket = false;
  neonConfig.forceDisablePgSSL = true;
  neonConfig.pipelineConnect = false;
  neonConfig.pipelineTLS = false;

  const urlFor = (database: string) => {
    const url = new URL(target.toString());
    url.pathname = `/${database}`;
    url.search = '';
    return url.toString();
  };
  const pools: Pool[] = [];
  const pool = (database: string, max = 4) => {
    const p = new Pool({ connectionString: urlFor(database), max });
    // An idle connection ended by the server (the databases are dropped at the end) is expected
    // here; without a listener the pool would raise it as an uncaught error.
    p.on('error', () => undefined);
    pools.push(p);
    return p;
  };

  const admin = pool(target.pathname.replace(/^\//, '') || 'postgres', 1);
  const suffix = randomBytes(4).toString('hex');
  const template = `vs_race_template_${suffix}`;
  const made: string[] = [template];
  await admin.query(`create database ${template}`);
  const templatePool = new Pool({ connectionString: urlFor(template), max: 1 });
  try {
    await migrate(drizzle(templatePool, { schema }), { migrationsFolder });
  } finally {
    await templatePool.end();
  }

  let count = 0;
  return {
    pool,
    async freshDatabase() {
      count += 1;
      const name = `vs_race_${suffix}_${count}`;
      await admin.query(`create database ${name} template ${template}`);
      made.push(name);
      return name;
    },
    async close() {
      const others = pools.filter((p) => p !== admin);
      await Promise.all(others.map((p) => p.end().catch(() => undefined)));
      for (const name of made.reverse()) {
        await admin.query(`drop database if exists ${name} with (force)`);
      }
      await admin.end();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** The drizzle handle the services take, over one pool. */
export function realPostgresDb(pool: Pool) {
  return drizzle(pool, { schema });
}
