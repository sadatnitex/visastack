import { randomBytes } from 'node:crypto';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { migrate } from 'drizzle-orm/neon-serverless/migrator';
import ws from 'ws';
import { migrationsFolder } from './paths';
import { startBridge, useLocalBridge } from './pg-bridge';
import * as schema from './schema';

/**
 * Test support: a real Postgres server reached through the exact driver production uses.
 *
 * PGlite is one connection, so it cannot show what two requests do to each other at the same
 * moment. These helpers open real, separate connections to a real Postgres server (a CI service
 * container, or a local server) through `@neondatabase/serverless`'s `Pool`, the driver behind
 * every signed-in request (`createPooledDb`). That driver speaks Postgres over a WebSocket, which
 * Neon's own proxy turns into a socket; here the loopback bridge in pg-bridge.ts does the same, and
 * it only ever connects to the one server named by `TEST_POSTGRES_URL`. No Neon branch and no
 * production database is involved.
 *
 * `TEST_POSTGRES_URL` must name a throwaway server whose role may create databases, for example
 * `postgres://postgres@127.0.0.1:5432/postgres`. Every database these helpers create is dropped by
 * `close()`, and by `startRealPostgres` itself when it fails part way.
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
  const bridge = await startBridge({
    listenPort: 0,
    pgHost: target.hostname,
    pgPort: Number(target.port || '5432'),
  });
  neonConfig.webSocketConstructor = ws;
  useLocalBridge(bridge.port);

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
  const made: string[] = [];
  const close = async () => {
    const others = pools.filter((p) => p !== admin);
    await Promise.all(others.map((p) => p.end().catch(() => undefined)));
    for (const name of [...made].reverse()) {
      await admin.query(`drop database if exists ${name} with (force)`).catch(() => undefined);
    }
    await admin.end().catch(() => undefined);
    await bridge.close();
  };

  try {
    await admin.query(`create database ${template}`);
    made.push(template);
    const templatePool = pool(template, 1);
    await migrate(drizzle(templatePool, { schema }), { migrationsFolder });
    // The template must have no open connection when databases are copied from it.
    await templatePool.end();
  } catch (error) {
    await close();
    throw error;
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
    close,
  };
}

/** The drizzle handle the services take, over one pool. */
export function realPostgresDb(pool: Pool) {
  return drizzle(pool, { schema });
}
