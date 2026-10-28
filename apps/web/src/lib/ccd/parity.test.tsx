import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import './../next-mocks.test-support';
import { APPROVED_CHANGES } from './approved-changes';
import {
  type InventoryEntry,
  badLevelWords,
  entryKey,
  headingProblems,
  inventory,
} from './inventory';

/**
 * Nothing is lost (ADR 0023). Each converted screen is rendered in every state a person can
 * meet, at the deepest level, and compared with the inventory captured from the screen as it
 * was before the change (baseline/<screen>.json). Every old element must still be there with
 * the same name, unless the owner approved the change. Run with CCD_CAPTURE=1 on the old
 * screen to write a baseline; never to make a failing comparison pass.
 */

const state = vi.hoisted(() => ({
  isAdmin: false,
  memberships: [] as unknown[],
  whatsapp: false,
  whatsappConnected: false,
  photo: null as unknown,
  languageChoice: false,
  depth: 'auto' as string,
}));

vi.mock('../locale', () => ({ getLocale: async () => 'en' }));
vi.mock('../session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'traveller@example.com' }),
}));
vi.mock('../admin', () => ({ holdsPlatformRole: async () => state.isAdmin }));
vi.mock('../profile-photos', () => ({ loadOwnPhoto: async () => state.photo }));
vi.mock('../whatsapp', () => ({ readWhatsAppConfig: () => (state.whatsapp ? {} : null) }));
vi.mock('../language-choice', () => ({
  get LANGUAGE_CHOICE_ENABLED() {
    return state.languageChoice;
  },
}));
vi.mock('./depth.server', () => ({ readDepth: async () => state.depth }));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  listMembershipsForAccount: async () => state.memberships,
  getWhatsAppConnection: async () => ({ connected: state.whatsappConnected }),
}));

const { default: AccountPage } = await import('../../app/app/account/page');

interface ScreenState {
  readonly name: string;
  readonly setup: () => void;
}

const ACCOUNT_STATES: readonly ScreenState[] = [
  { name: 'plain account', setup: () => undefined },
  {
    name: 'everything switched on',
    setup: () => {
      state.isAdmin = true;
      state.memberships = [{ active: true, role: 'OWNER' }];
      state.whatsapp = true;
      state.photo = { self: null };
      state.languageChoice = true;
    },
  },
  {
    name: 'whatsapp connected, no longer configured',
    setup: () => {
      state.whatsappConnected = true;
    },
  },
];

const SCREENS = [
  { screen: 'account', states: ACCOUNT_STATES, render: async () => await AccountPage() },
] as const;

const BASELINE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'baseline');

function resetState() {
  state.isAdmin = false;
  state.memberships = [];
  state.whatsapp = false;
  state.whatsappConnected = false;
  state.photo = null;
  state.languageChoice = false;
  state.depth = 'auto';
}

beforeEach(resetState);

async function render(screen: (typeof SCREENS)[number], screenState: ScreenState): Promise<string> {
  screenState.setup();
  return `<main>${renderToStaticMarkup(await screen.render())}</main>`;
}

const CAPTURE_FLAG = 'CCD_CAPTURE';
if (process.env[CAPTURE_FLAG]) {
  describe('capture baselines', () => {
    it.each(SCREENS.map((s) => [s.screen, s] as const))('%s', async (_name, screen) => {
      const captured: Record<string, InventoryEntry[]> = {};
      for (const screenState of screen.states) {
        resetState();
        captured[screenState.name] = inventory(await render(screen, screenState));
      }
      mkdirSync(BASELINE_DIR, { recursive: true });
      writeFileSync(
        join(BASELINE_DIR, `${screen.screen}.json`),
        `${JSON.stringify(captured, null, 2)}\n`,
      );
    });
  });
} else {
  describe('every element that existed before is still on the screen', () => {
    for (const screen of SCREENS) {
      const baseline = JSON.parse(
        readFileSync(join(BASELINE_DIR, `${screen.screen}.json`), 'utf8'),
      ) as Record<string, InventoryEntry[]>;
      describe(screen.screen, () => {
        it.each(screen.states.map((s) => [s.name, s] as const))(
          '%s',
          async (_name, screenState) => {
            const html = await render(screen, screenState);
            const now = new Set(inventory(html).map(entryKey));
            const approved = APPROVED_CHANGES.filter((change) => change.screen === screen.screen);
            const missing = (baseline[screenState.name] ?? [])
              .filter((entry) => {
                const change = approved.find((c) => entryKey(c.from) === entryKey(entry));
                const wanted = change ? change.to : entry;
                return wanted !== null && !now.has(entryKey(wanted));
              })
              .map(entryKey);
            expect(missing).toEqual([]);
            expect(baseline[screenState.name]?.length).toBeGreaterThan(0);
          },
        );
      });
    }
  });

  describe('the rules every converted screen follows', () => {
    for (const screen of SCREENS) {
      it.each(screen.states.map((s) => [s.name, s] as const))(
        `${screen.screen}: %s has one h1, no skipped levels and only real level words`,
        async (_name, screenState) => {
          const html = await render(screen, screenState);
          expect(headingProblems(html)).toEqual([]);
          expect(badLevelWords(html)).toEqual([]);
        },
      );
    }
  });
}
