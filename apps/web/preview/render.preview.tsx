/// <reference types="vite/client" />
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { schema } from '@visastack/db';
import type { Db } from '@visastack/services';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { navigationState } from '../src/lib/next-mocks.test-support';
import { type PersonaKey, type World, buildWorld } from './world';

/**
 * Renders every page of the product, inside its real layouts, against a made-up database, and
 * writes plain HTML files for the screenshot step (`preview/shoot.mjs`). The pages are the
 * product's own code; only three things are stood in for: who is signed in, the language, and
 * the sign-in provider. Everything a page shows comes from the database through the product's
 * own services, so the pages react to data exactly as they will to real data.
 */

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
vi.mock('@workos-inc/authkit-nextjs', () => ({
  withAuth: async () => ({ user: state.signedIn ? { id: 'preview' } : null }),
  signOut: async () => undefined,
  getSignInUrl: async () => '/sign-in',
  checkRecentAuth: async () => true,
}));
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

const OUT = fileURLToPath(new URL('../.preview/html', import.meta.url));
const migrationsFolder = fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url));

type Params = Readonly<Record<string, string>>;
interface Scenario {
  /** The page's folder under `src/app`, for example `app/applicant/[id]/profile`. Empty is the home page. */
  readonly route: string;
  readonly persona: PersonaKey | null;
  readonly params?: (w: World) => Params;
  /** A name for a second look at the same page, for example with a very long name. */
  readonly variant?: string;
  readonly locale?: 'en' | 'bn';
  /** Settings for this one page, for example which sign-in system is switched on. */
  readonly env?: Readonly<Record<string, string>>;
}

const self = (w: World): Params => ({ id: w.ids.applicantSelf });
const org = (w: World): Params => ({ orgId: w.ids.orgId });

const SCENARIOS: readonly Scenario[] = [
  // ---- public ----
  { route: '', persona: null },
  { route: '', persona: null, variant: 'bangla', locale: 'bn' },
  { route: 'status', persona: null },
  { route: 'trust', persona: null },
  { route: 'trust/[packKey]', persona: null, params: (w) => ({ packKey: w.ids.packKey }) },
  { route: 'pilot-access-denied', persona: null },
  { route: 'auth/sign-in', persona: null, env: { IDENTITY_PROVIDER: 'neon_auth' } },
  { route: 'auth/sign-up', persona: null, env: { IDENTITY_PROVIDER: 'neon_auth' } },
  // ---- traveller with a busy account ----
  { route: 'app', persona: 'rahim' },
  { route: 'app', persona: 'rahim', variant: 'bangla', locale: 'bn' },
  { route: 'app/applicants', persona: 'rahim' },
  { route: 'app/applicant/[id]', persona: 'rahim', params: self },
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
  { route: 'app/applicant/[id]/profile', persona: 'rahim', params: self },
  { route: 'app/applicant/[id]/documents', persona: 'rahim', params: self },
  {
    route: 'app/applicant/[id]/documents',
    persona: 'rahim',
    variant: 'empty',
    params: (w) => ({ id: w.ids.applicantMinor }),
  },
  { route: 'app/applicant/[id]/missions', persona: 'rahim', params: self },
  { route: 'app/applicant/[id]/sharing', persona: 'rahim', params: self },
  { route: 'app/applicant/[id]/evidence', persona: 'rahim', params: self },
  { route: 'app/applicant/[id]/expiry', persona: 'rahim', params: self },
  { route: 'app/applicant/[id]/history', persona: 'rahim', params: self },
  { route: 'app/mission/[id]', persona: 'rahim', params: (w) => ({ id: w.ids.missionSingapore }) },
  {
    route: 'app/mission/[id]',
    persona: 'rahim',
    variant: 'manual-mode',
    params: (w) => ({ id: w.ids.missionJapan }),
  },
  { route: 'app/shared', persona: 'rahim' },
  {
    route: 'app/shared/[grantId]',
    persona: 'rahim',
    params: (w) => ({ grantId: w.ids.incomingGrant }),
  },
  { route: 'app/notifications', persona: 'rahim' },
  { route: 'app/privacy', persona: 'rahim' },
  { route: 'app/account', persona: 'rahim' },
  // ---- first day: nothing yet, and not yet consented ----
  { route: 'app', persona: 'shirin', variant: 'new-traveller' },
  { route: 'app/applicants', persona: 'shirin', variant: 'new-traveller' },
  { route: 'app/notifications', persona: 'shirin', variant: 'new-traveller' },
  { route: 'app/shared', persona: 'shirin', variant: 'new-traveller' },
  { route: 'app', persona: 'imran', variant: 'no-consent-yet' },
  { route: 'app/applicants', persona: 'imran', variant: 'no-consent-yet' },
  // ---- agency ----
  { route: 'app/agency', persona: 'agencyOwner' },
  { route: 'app/agency/[orgId]', persona: 'agencyOwner', params: org },
  { route: 'app/agency/[orgId]', persona: 'agencyMember', variant: 'case-manager', params: org },
  { route: 'app/agency/[orgId]/cases', persona: 'agencyOwner', params: org },
  { route: 'app/agency/[orgId]/clients', persona: 'agencyOwner', params: org },
  { route: 'app/agency/[orgId]/team', persona: 'agencyOwner', params: org },
  { route: 'app/agency/[orgId]/plan', persona: 'agencyOwner', params: org },
  { route: 'app/agency/[orgId]/settings', persona: 'agencyOwner', params: org },
  { route: 'app/agency', persona: 'agencyNew', variant: 'new-agency' },
  {
    route: 'app/agency/[orgId]',
    persona: 'agencyNew',
    variant: 'new-agency',
    params: (w) => ({ orgId: w.ids.newOrgId }),
  },
  {
    route: 'app/agency/[orgId]/cases',
    persona: 'agencyNew',
    variant: 'new-agency',
    params: (w) => ({ orgId: w.ids.newOrgId }),
  },
  {
    route: 'app/agency/[orgId]/clients',
    persona: 'agencyNew',
    variant: 'new-agency',
    params: (w) => ({ orgId: w.ids.newOrgId }),
  },
  {
    route: 'app/agency/[orgId]/team',
    persona: 'agencyNew',
    variant: 'new-agency',
    params: (w) => ({ orgId: w.ids.newOrgId }),
  },
  // ---- platform administration ----
  { route: 'app/admin', persona: 'platformAdmin' },
  { route: 'app/admin/access', persona: 'platformAdmin' },
  { route: 'app/admin/audit', persona: 'platformAdmin' },
  { route: 'app/admin/complaints', persona: 'platformAdmin' },
  { route: 'app/admin/organizations', persona: 'platformAdmin' },
  {
    route: 'app/admin/organizations/[orgId]',
    persona: 'platformAdmin',
    params: (w) => ({ orgId: w.ids.orgId }),
  },
  { route: 'app/admin/packs', persona: 'platformAdmin' },
  {
    route: 'app/admin/packs/[packId]',
    persona: 'platformAdmin',
    params: (w) => ({ packId: w.ids.packId }),
  },
  { route: 'app/admin/privacy', persona: 'platformAdmin' },
  { route: 'app/admin/ai-settings', persona: 'platformAdmin' },
];

/** Pages that need a one-off link or token to open; listed so nothing is missed silently. */
const NEEDS_A_TOKEN = new Set([
  'app/client-invitations/accept',
  'app/contributor-requests/accept',
  'app/invitations/accept',
  'app/mission/[id]/snapshots/[snapshotId]',
  'app/admin/packs/[packId]/diff',
]);

const pages = import.meta.glob('../src/app/**/page.tsx');
const layouts = import.meta.glob('../src/app/**/layout.tsx');

const routeOf = (key: string) => key.replace('../src/app/', '').replace(/\/?page\.tsx$/, '');

function layoutKeys(route: string): string[] {
  const segments = route === '' ? [] : route.split('/');
  const keys: string[] = [];
  for (let i = 0; i <= segments.length; i++) {
    const dir = segments.slice(0, i).join('/');
    const key = `../src/app/${dir === '' ? '' : `${dir}/`}layout.tsx`;
    if (key in layouts) keys.push(key);
  }
  return keys;
}

const slug = (s: Scenario) =>
  `${s.persona ?? 'public'}__${s.route === '' ? 'home' : s.route.replace(/[/[\]]/g, '_')}${s.variant ? `__${s.variant}` : ''}`;

type Component = (props: Record<string, unknown>) => Promise<ReactElement> | ReactElement;

describe('preview: every page against a made-up world', () => {
  it('renders each scenario and covers every page in the app', async () => {
    rmSync(OUT, { recursive: true, force: true });
    mkdirSync(OUT, { recursive: true });

    const client = new PGlite();
    const db = drizzle(client, { schema }) as unknown as Db;
    await migrate(db as never, { migrationsFolder });
    state.db = db;
    const world = await buildWorld(db);

    // Coverage: every page file must have a scenario, or be listed as needing a token.
    const covered = new Set(SCENARIOS.map((s) => s.route));
    const missing = Object.keys(pages)
      .map(routeOf)
      .filter((route) => !covered.has(route) && !NEEDS_A_TOKEN.has(route));
    expect(missing, 'pages with no preview scenario').toEqual([]);

    const manifest: {
      slug: string;
      route: string;
      persona: string;
      variant: string;
      path: string;
      outcome: string;
    }[] = [];

    for (const scenario of SCENARIOS) {
      const params = scenario.params?.(world) ?? {};
      const concretePath = `/${scenario.route
        .split('/')
        .filter(Boolean)
        .map((segment) =>
          segment.startsWith('[') ? (params[segment.slice(1, -1)] ?? segment) : segment,
        )
        .join('/')}`;
      state.persona = scenario.persona ? world.personas[scenario.persona] : null;
      state.signedIn = scenario.persona !== null;
      state.locale = scenario.locale ?? 'en';
      navigationState.pathname = concretePath;

      const pageKey = `../src/app/${scenario.route === '' ? '' : `${scenario.route}/`}page.tsx`;
      const loader = pages[pageKey];
      if (!loader) throw new Error(`no page file for ${scenario.route}`);

      const previousEnv: Record<string, string | undefined> = {};
      for (const [key, value] of Object.entries(scenario.env ?? {})) {
        previousEnv[key] = process.env[key];
        process.env[key] = value;
      }
      let html = '';
      let outcome = 'ok';
      try {
        const page = ((await loader()) as { default: Component }).default;
        const props = { params: Promise.resolve(params), searchParams: Promise.resolve({}) };
        let element = await page(props);
        const chain = layoutKeys(scenario.route);
        for (const key of [...chain].reverse()) {
          const layout = ((await layouts[key]?.()) as { default: Component }).default;
          element = await layout({ children: element, params: Promise.resolve(params) });
        }
        html = renderToStaticMarkup(element);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        outcome = message.startsWith('NEXT_NOT_FOUND')
          ? 'not-found'
          : message.startsWith('NEXT_REDIRECT')
            ? `redirect ${message.slice('NEXT_REDIRECT:'.length)}`
            : `ERROR ${message.slice(0, 160)}`;
      }
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      manifest.push({
        slug: slug(scenario),
        route: scenario.route,
        persona: scenario.persona ?? 'public',
        variant: scenario.variant ?? '',
        path: concretePath,
        outcome,
      });
      if (html) writeFileSync(`${OUT}/${slug(scenario)}.html`, html);
    }
    writeFileSync(`${OUT}/../manifest.json`, JSON.stringify(manifest, null, 2));
    const failed = manifest.filter((m) => m.outcome.startsWith('ERROR'));
    expect(
      failed.map((f) => `${f.slug}: ${f.outcome}`),
      'scenarios that threw',
    ).toEqual([]);
  });
});
