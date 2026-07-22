import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { neonConfig } from '@neondatabase/serverless';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { createPooledDb } from './client';

/**
 * Neon `ws`-masking regression guard (master directive §8D).
 *
 * A prior production incident (`TypeError: b.mask is not a function` →
 * "Connection terminated unexpectedly") came from `ws` being bundled without
 * its pure-JS frame-mask fallback, which silently kills every WebSocket frame
 * to Neon and 500s every authenticated page. Three independent layers fixed
 * it; this suite protects all three so the regression cannot silently return:
 *
 *   1. `createPooledDb` forces the `ws` env flags (works with no live DB).
 *   2. `apps/web/next.config.mjs` keeps `ws` + `@neondatabase/serverless`
 *      external to the bundle (static file check — no live DB needed).
 *   3. `apps/web/src/instrumentation.ts` sets the same flags at server
 *      startup (static file check — no live DB needed).
 *
 * A 4th, LIVE check opens a real interactive transaction through the exact
 * pooled/WebSocket path authenticated pages use. It requires a real
 * connection string and is SKIPPED (not failed) without one, so it never
 * blocks ordinary secret-free CI — but proves the fix end-to-end whenever a
 * database is available (e.g. a protected deploy-smoke run).
 */

function readRepoFile(relativeFromThisFile: string): string {
  return readFileSync(fileURLToPath(new URL(relativeFromThisFile, import.meta.url)), 'utf8');
}

/**
 * Actually unset an env var (an `= undefined` assignment would coerce to the
 * string `"undefined"`, which is not the same as absent).
 */
function unsetEnv(name: string): void {
  delete process.env[name];
}
function getEnv(name: string): string | undefined {
  return process.env[name];
}
function setEnv(name: string, value: string): void {
  process.env[name] = value;
}

describe('ws pure-JS masker is forced (no live DB required)', () => {
  afterEach(() => {
    unsetEnv('WS_NO_BUFFER_UTIL');
    unsetEnv('WS_NO_UTF_8_VALIDATE');
  });

  it('createPooledDb sets WS_NO_BUFFER_UTIL and WS_NO_UTF_8_VALIDATE', () => {
    unsetEnv('WS_NO_BUFFER_UTIL');
    unsetEnv('WS_NO_UTF_8_VALIDATE');
    const { pool } = createPooledDb('postgres://user:pass@localhost:5432/db');
    try {
      expect(getEnv('WS_NO_BUFFER_UTIL')).toBe('1');
      expect(getEnv('WS_NO_UTF_8_VALIDATE')).toBe('1');
      expect(neonConfig.webSocketConstructor).toBeTruthy();
    } finally {
      // No connection was ever opened (no query run), so this is a clean, fast
      // teardown with no live database involved.
      void pool.end();
    }
  });

  it('never overwrites an operator-set value for either flag', () => {
    setEnv('WS_NO_BUFFER_UTIL', '0');
    setEnv('WS_NO_UTF_8_VALIDATE', '0');
    const { pool } = createPooledDb('postgres://user:pass@localhost:5432/db');
    expect(getEnv('WS_NO_BUFFER_UTIL')).toBe('0');
    expect(getEnv('WS_NO_UTF_8_VALIDATE')).toBe('0');
    void pool.end();
  });
});

describe('bundler-externalization protection (static file checks)', () => {
  it('next.config.mjs keeps ws and @neondatabase/serverless external to the bundle', () => {
    const config = readRepoFile('../../../apps/web/next.config.mjs');
    const match = /serverExternalPackages:\s*\[([^\]]*)\]/.exec(config);
    expect(match, 'serverExternalPackages array not found in next.config.mjs').toBeTruthy();
    const arrayContents = match?.[1] ?? '';
    expect(arrayContents).toContain('@neondatabase/serverless');
    expect(arrayContents).toContain("'ws'");
  });

  it('apps/web/src/instrumentation.ts forces the ws env flags at server startup', () => {
    const instrumentation = readRepoFile('../../../apps/web/src/instrumentation.ts');
    expect(instrumentation).toMatch(/register/);
    expect(instrumentation).toMatch(/WS_NO_BUFFER_UTIL/);
    expect(instrumentation).toMatch(/WS_NO_UTF_8_VALIDATE/);
  });
});

const liveConnectionString =
  getEnv('NEON_POOLED_SMOKE_DATABASE_URL') ?? getEnv('DATABASE_URL') ?? '';

describe.skipIf(liveConnectionString.length === 0)(
  'LIVE: a real interactive transaction over the pooled WebSocket path',
  () => {
    it('opens, transacts, and closes successfully — the exact path authenticated pages use', async () => {
      const { db, pool } = createPooledDb(liveConnectionString);
      try {
        const result = await db.transaction(async (tx) => tx.execute(sql`select 1 as ok`));
        expect(result).toBeTruthy();
      } finally {
        await pool.end();
      }
    }, 20_000);
  },
);
