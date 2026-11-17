import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import type { Db } from '@visastack/services';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Q8, Guardian condition (1): a sign-in made by an email link for an address with no VisaStack
 * account cannot reach the product. The link landing sends it to the agreement and invitation
 * step, and with no invitation that step refuses, without creating anything in our tables.
 * Real database, real notice and invitation checks; only the Neon sign-in is stood in for.
 */

const redirect = vi.fn((to: string) => {
  throw new Error(`REDIRECT:${to}`);
});
vi.mock('next/navigation', () => ({ redirect: (to: string) => redirect(to) }));
vi.mock('server-only', () => ({}));
const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string) => {
      jar.set(name, value);
    },
    getAll: () => [],
  }),
  headers: async () => new Headers(),
}));

const NEW_PERSON = {
  id: 'neon-link-only-user',
  email: 'stranger@example.test',
  emailVerified: true,
};
vi.mock('../../../lib/neon-request-session', () => ({
  requestSessionReader: () => ({ getSession: async () => ({ data: { user: NEW_PERSON } }) }),
}));
// A link sign-in has no password account at Neon Auth.
const SECRET = 'test-only-cookie-key-with-at-least-thirty-two-characters';
vi.mock('../../../lib/neon-auth', () => ({
  getNeonAuth: () => ({
    listAccounts: async () => ({ data: [{ providerId: 'magic-link' }] }),
    signOut: vi.fn(),
  }),
  readNeonAuthSettings: () => ({ baseUrl: 'https://auth.example.test', cookieSecret: SECRET }),
}));
const database = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('../../../lib/public-db', () => ({
  withPublicDb: async (work: (db: unknown) => Promise<unknown>) => work(database.db),
}));
vi.mock('../../../lib/server-error', () => ({ reportServerError: vi.fn() }));

async function count(db: Db, table: string): Promise<number> {
  const result = (await db.execute(
    sql.raw(`select count(*)::int as n from ${table}`),
  )) as unknown as { rows: { n: number }[] };
  return result.rows[0]?.n ?? -1;
}

beforeEach(async () => {
  jar.clear();
  database.db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
  vi.stubEnv('DEPLOYMENT_MODE', 'controlled_pilot');
  vi.stubEnv('PUBLIC_BETA_OPEN', '');
  vi.stubEnv('PILOT_ALLOWLIST_EMAILS', '');
  vi.stubEnv('SIGN_IN_LINKS', 'on');
  redirect.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe('a link sign-in for an address with no account', () => {
  it('goes to the agreement and invitation step, never straight to the product', async () => {
    const { encodeLinkPending, linkPendingCookieName } = await import(
      '../../../lib/sign-in-link-guard'
    );
    jar.set(linkPendingCookieName(true), encodeLinkPending(SECRET));
    const { GET } = await import('./route');
    const response = await GET(
      new Request('https://app.example.test/auth/link-return?next=%2Fapp%2Fcases'),
    );
    const location = new URL(response.headers.get('location') ?? '');
    expect(`${location.pathname}${location.search}`).toBe('/auth/notice-check?next=%2Fapp%2Fcases');
  }, 30_000);

  it('is refused there without an invitation, and nothing is created in our tables', async () => {
    const db = database.db as Db;
    const before = {
      accounts: await count(db, 'accounts'),
      audit: await count(db, 'audit_events'),
    };
    const { GET } = await import('../notice-check/route');
    const response = await GET(
      new Request('https://app.example.test/auth/notice-check?next=%2Fapp%2Fcases'),
    );
    expect(new URL(response.headers.get('location') ?? '').pathname).toBe('/pilot-access-denied');
    expect(await count(db, 'accounts')).toBe(before.accounts);
    expect(await count(db, 'audit_events')).toBe(before.audit);
  }, 30_000);
});
