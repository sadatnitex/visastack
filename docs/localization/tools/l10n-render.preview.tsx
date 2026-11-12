/// <reference types="vite/client" />
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { schema } from '@visastack/db';
import type { Db } from '@visastack/services';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { ReactElement } from 'react';
import { prerender } from 'react-dom/static';
import { describe, expect, it, vi } from 'vitest';
import { navigationState } from '../src/lib/next-mocks.test-support';

/** Prerender awaits async server components; the output is read into one string with the text separators, Suspense markers and the doctype removed, like static markup. */
async function prerenderToString(element: Parameters<typeof prerender>[0]): Promise<string> {
  const { prelude } = await prerender(element);
  const reader = prelude.getReader();
  const decoder = new TextDecoder();
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return (out + decoder.decode())
    .replace(/^<!DOCTYPE html>/, '')
    .replaceAll('<!-- -->', '')
    .replaceAll('<!--$-->', '')
    .replaceAll('<!--/$-->', '');
}
import { type PersonaKey, type World, buildWorld } from './world';

/**
 * Renders every page of the product, inside its real layouts, against a made-up database, and
 * writes plain HTML files for the screenshot step (`preview/shoot.mjs`). The pages are the
 * product's own code; only three things are stood in for: who is signed in, the language, and
 * the sign-in provider. Everything a page shows comes from the database through the product's
 * own services, so the pages react to data exactly as they will to real data.
 */

/**
 * Every render must give the same pages for the same code, so a before/after comparison of the
 * English (scripts/i18n/verify-english.mjs) can prove "unchanged" instead of guessing. Ids, case
 * reference codes, signing values and the clock are the only things that vary between runs, so
 * they are drawn from a fixed-seed generator and a fixed date. This runs before any module that
 * reads them (hoisted above the imports of the world and the services).
 */
await vi.hoisted(async () => {
  const nodeModule = await import('node:module');
  const nodeCrypto = nodeModule.createRequire(import.meta.url)('node:crypto');
  let seed = 0x9e3779b9;
  const next = () => {
    // mulberry32
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const fill = <T extends ArrayBufferView>(view: T): T => {
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(next() * 256);
    return view;
  };
  const uuid = () => {
    const b = fill(new Uint8Array(16));
    b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
    b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
  const put = (target: object, name: string, value: unknown) => {
    try {
      Object.defineProperty(target, name, { value, configurable: true, writable: true });
    } catch {
      // A read-only property cannot be replaced; the others still are.
    }
  };
  put(nodeCrypto, 'randomUUID', uuid);
  put(nodeCrypto, 'randomBytes', (n: number) => Buffer.from(fill(new Uint8Array(n))));
  put(nodeCrypto, 'randomFillSync', fill);
  put(nodeCrypto, 'getRandomValues', fill);
  put(nodeCrypto, 'randomInt', (a: number, b?: number) =>
    b === undefined ? Math.floor(next() * a) : a + Math.floor(next() * (b - a)),
  );
  const web = globalThis.crypto as unknown as Record<string, unknown>;
  put(web, 'randomUUID', uuid);
  put(web, 'getRandomValues', fill);
  nodeModule.syncBuiltinESMExports();
  Math.random = next;
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-12T12:00:00Z') });
});

const state = vi.hoisted(() => ({
  persona: null as null | { accountId: string; email: string },
  db: null as unknown,
  locale: 'en' as 'en' | 'bn',
  signedIn: true,
}));

vi.mock('../src/lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) => {
    if (!state.persona) throw new Error('preview: no signed-in persona for this scenario');
    return fn({ db: state.db, accountId: state.persona.accountId, email: state.persona.email });
  },
}));
vi.mock('../src/lib/locale', () => ({
  LOCALE_COOKIE: 'visastack_locale',
  localeCookieOptions: () => ({}),
  getLocale: async () => state.locale,
}));
vi.mock('../src/lib/public-db', () => ({
  withPublicDb: async (fn: (db: unknown) => Promise<unknown>) => fn(state.db),
}));
vi.mock('../src/app/actions', () => ({ setLocaleAction: async () => undefined }));
vi.mock('../src/lib/signed-in', () => ({ isSignedIn: async () => state.signedIn }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => undefined,
    getAll: () => [],
    has: () => false,
    set: () => undefined,
  }),
  headers: async () => new Headers(),
}));
vi.mock('@neondatabase/auth/next/server', () => ({ createNeonAuth: () => ({}) }));
vi.mock('next/font/local', () => ({
  default: () => ({ variable: 'font-variable', className: 'font-class' }),
}));

/** Variable-keyed env write: satisfies both the TypeScript index-signature rule and Biome. */
function setEnv(name: string, value: string): void {
  process.env[name] = value;
}

setEnv('DEPLOYMENT_MODE', 'controlled_pilot');
// A made-up value for a signing key the pages ask for; it protects nothing and is never used elsewhere.
setEnv('BLOB_SIGNING_SECRET', 'preview-only-signing-value-not-a-real-secret-0000');
setEnv('BLOB_READ_WRITE_TOKEN', 'preview-only-not-a-real-token');

const OUT = fileURLToPath(new URL('../.preview/l10n/html', import.meta.url));
const migrationsFolder = fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url));

type Params = Readonly<Record<string, string>>;
type Component = (props: Record<string, unknown>) => Promise<ReactElement> | ReactElement;

interface Scenario {
  /** The page's folder under `src/app`, route groups included. */
  readonly route: string;
  readonly persona: PersonaKey | null;
  readonly params?: (w: World) => Params | null;
  readonly variant?: string;
  readonly locale?: 'en' | 'bn';
  readonly env?: Readonly<Record<string, string>>;
}

const pages = import.meta.glob('../src/app/**/page.tsx');
const layouts = import.meta.glob('../src/app/**/layout.tsx');
const routeOf = (key: string) => key.replace('../src/app/', '').replace(/\/?page\.tsx$/, '');
const allRoutes = Object.keys(pages).map(routeOf).sort();
const stripGroups = (route: string) =>
  route
    .split('/')
    .filter((s) => s && !/^\(.*\)$/.test(s))
    .join('/');

/** Fixture ids per dynamic segment. null means the world has no such record: not rendered, said so. */
function paramsFor(route: string, w: World): Params | null {
  const out: Record<string, string> = {};
  for (const m of route.matchAll(/\[(\w+)\]/g)) {
    const name = m[1] as string;
    let v: string | undefined;
    if (name === 'orgId') v = w.ids.orgId;
    else if (name === 'packId') v = w.ids.packId;
    else if (name === 'packKey') v = w.ids.packKey;
    else if (name === 'grantId') v = w.ids.incomingGrant;
    else if (name === 'iso2') v = 'SG';
    else if (name === 'id' && route.startsWith('app/applicant')) v = w.ids.applicantSelf;
    else if (name === 'id' && route.startsWith('app/mission')) v = w.ids.missionSingapore;
    if (v === undefined) return null;
    out[name] = v;
  }
  return out;
}

function personaFor(route: string): PersonaKey | null {
  if (!route.startsWith('app')) return null;
  if (route.startsWith('app/admin') || route.startsWith('app/staff-code')) return 'platformAdmin';
  if (route.startsWith('app/agency')) return 'agencyOwner';
  return 'rahim';
}

const self = (w: World): Params => ({ id: w.ids.applicantSelf });
const org = (w: World): Params => ({ orgId: w.ids.orgId });
const EXTRA: readonly Scenario[] = [
  { route: 'app/(home)', persona: 'rahim', variant: 'bangla', locale: 'bn' },
  { route: 'page-root-bn', persona: null },
  { route: 'app/(home)', persona: 'shirin', variant: 'new-traveller' },
  { route: 'app/(home)', persona: 'imran', variant: 'no-consent-yet' },
  { route: 'app/applicants', persona: 'shirin', variant: 'new-traveller' },
  { route: 'app/applicants', persona: 'imran', variant: 'no-consent-yet' },
  { route: 'app/notifications', persona: 'shirin', variant: 'new-traveller' },
  { route: 'app/shared/(list)', persona: 'shirin', variant: 'new-traveller' },
  {
    route: 'app/applicant/[id]',
    persona: 'rahim',
    variant: 'long-name',
    params: (w) => ({ id: w.ids.applicantLongName }),
  },
  {
    route: 'app/applicant/[id]',
    persona: 'rahim',
    variant: 'bangla-name',
    params: (w) => ({ id: w.ids.applicantBangla }),
  },
  {
    route: 'app/applicant/[id]/documents',
    persona: 'rahim',
    variant: 'empty',
    params: (w) => ({ id: w.ids.applicantMinor }),
  },
  {
    route: 'app/applicant/[id]/documents',
    persona: 'rahim',
    variant: 'spouse',
    params: (w) => ({ id: w.ids.applicantSpouse }),
  },
  {
    route: 'app/mission/[id]',
    persona: 'rahim',
    variant: 'manual-mode',
    params: (w) => ({ id: w.ids.missionJapan }),
  },
  {
    route: 'app/mission/[id]',
    persona: 'rahim',
    variant: 'germany',
    params: (w) => ({ id: w.ids.missionGermany }),
  },
  { route: 'app/agency/[orgId]', persona: 'agencyMember', variant: 'case-manager', params: org },
  { route: 'app/agency', persona: 'agencyNew', variant: 'new-agency' },
  ...['', '/cases', '/clients', '/team'].map((s) => ({
    route: `app/agency/[orgId]${s}`,
    persona: 'agencyNew' as PersonaKey,
    variant: 'new-agency',
    params: (w: World) => ({ orgId: w.ids.newOrgId }),
  })),
  ...['', '/cases', '/clients', '/team'].map((s) => ({
    route: `app/agency/[orgId]${s}`,
    persona: 'agencyMember' as PersonaKey,
    variant: 'member-view',
    params: org,
  })),
  {
    route: 'app/agency/[orgId]',
    persona: 'agencyOwner',
    variant: 'pending-org',
    params: (w) => ({ orgId: w.ids.pendingOrgId }),
  },
  { route: 'app/applicant/[id]/profile', persona: 'rahim', variant: 'self', params: self },
];

const layoutKeys = (route: string): string[] => {
  const segments = route === '' ? [] : route.split('/');
  const keys: string[] = [];
  for (let i = 0; i <= segments.length; i++) {
    const dir = segments.slice(0, i).join('/');
    const key = `../src/app/${dir === '' ? '' : `${dir}/`}layout.tsx`;
    if (key in layouts) keys.push(key);
  }
  return keys;
};

const slug = (s: Scenario) =>
  `${s.persona ?? 'public'}__${s.route === '' ? 'home' : s.route.replace(/[/[\]()]/g, '_')}${s.variant ? `__${s.variant}` : ''}${s.locale === 'bn' ? '__bn' : ''}`;

describe('l10n render: every page against a made-up world', () => {
  it('renders every page that has a fixture and records what could not be rendered', async () => {
    rmSync(OUT, { recursive: true, force: true });
    mkdirSync(OUT, { recursive: true });
    const client = new PGlite();
    const db = drizzle(client, { schema }) as unknown as Db;
    await migrate(db as never, { migrationsFolder });
    state.db = db;
    const world = await buildWorld(db);

    const scenarios: Scenario[] = [
      ...allRoutes.map((route) => ({ route, persona: personaFor(route) })),
      ...allRoutes
        .filter((r) => r === '' || r === 'status' || r === 'trust')
        .map((route) => ({ route, persona: null, variant: 'bangla', locale: 'bn' as const })),
      ...EXTRA.filter((e) => e.route !== 'page-root-bn'),
    ];

    const manifest: Record<string, unknown>[] = [];
    for (const scenario of scenarios) {
      const params = scenario.params ? scenario.params(world) : paramsFor(scenario.route, world);
      const base = {
        slug: slug(scenario),
        route: scenario.route,
        persona: scenario.persona ?? 'public',
        variant: scenario.variant ?? '',
        locale: scenario.locale ?? 'en',
      };
      if (params === null) {
        manifest.push({ ...base, path: '', outcome: 'NOT_RENDERED_NO_FIXTURE' });
        continue;
      }
      const concretePath = `/${stripGroups(scenario.route)
        .split('/')
        .filter(Boolean)
        .map((seg) => (seg.startsWith('[') ? (params[seg.slice(1, -1)] ?? seg) : seg))
        .join('/')}`;
      state.persona = scenario.persona ? world.personas[scenario.persona] : null;
      state.signedIn = scenario.persona !== null;
      state.locale = scenario.locale ?? 'en';
      navigationState.pathname = concretePath;
      const env: Record<string, string> = {
        IDENTITY_PROVIDER: 'neon_auth',
        // Placeholders that reach no real service, as the pull-request browser checks use.
        NEON_AUTH_BASE_URL: 'https://auth.placeholder.invalid/neondb/auth',
        NEON_AUTH_COOKIE_SECRET: 'a'.repeat(64),
        // Render-only: shows the guest request screens. Nothing is switched on in the product.
        AGENCY_COLLECTION_REQUESTS: 'on',
        DOCUMENT_REMOVAL_REQUESTS: 'on',
        ...(scenario.env ?? {}),
      };
      const previousEnv: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(env)) {
        previousEnv[k] = process.env[k];
        process.env[k] = v;
      }
      let html = '';
      let outcome = 'ok';
      try {
        const loader =
          pages[`../src/app/${scenario.route === '' ? '' : `${scenario.route}/`}page.tsx`];
        if (!loader) throw new Error(`no page file for ${scenario.route}`);
        const page = ((await loader()) as { default: Component }).default;
        let element = await page({
          params: Promise.resolve(params),
          searchParams: Promise.resolve({}),
        });
        for (const key of [...layoutKeys(scenario.route)].reverse()) {
          const layout = ((await layouts[key]?.()) as { default: Component }).default;
          element = await layout({ children: element, params: Promise.resolve(params) });
        }
        html = await prerenderToString(element);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        outcome = message.startsWith('NEXT_NOT_FOUND')
          ? 'NOT_FOUND_SCREEN'
          : message.startsWith('NEXT_REDIRECT')
            ? `REDIRECT ${message.slice('NEXT_REDIRECT:'.length)}`
            : `ERROR ${message.slice(0, 200)}`;
      }
      for (const [k, v] of Object.entries(previousEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      manifest.push({ ...base, path: concretePath, outcome });
      if (html) writeFileSync(`${OUT}/${slug(scenario)}.html`, html);
    }
    writeFileSync(`${OUT}/../manifest.json`, JSON.stringify(manifest, null, 2));
    expect(manifest.length).toBeGreaterThan(0);
  });
});
