import { keyedError } from '@visastack/services';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../../../../lib/next-mocks.test-support';

vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'bn',
  generation: 0,
  error: null as unknown,
}));
vi.mock('../../../../lib/locale', () => ({ getLocale: async () => state.locale }));
// Outside the server runtime React's cache remembers nothing; stand in for one request per render.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T extends (...args: never[]) => unknown>(build: T): T => {
    let seen = -1;
    let value: unknown;
    const cached = (...args: Parameters<T>) => {
      if (seen !== state.generation || args.length > 0) {
        seen = state.generation;
        value = build(...args);
      }
      return value;
    };
    return cached as unknown as T;
  },
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not found');
  },
  redirect: () => {
    throw new Error('redirected');
  },
  unstable_rethrow: (error: unknown) => {
    throw error;
  },
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  previewSharingInvitation: async () => ({ ok: false, error: state.error }),
  acceptSharingInvitation: async () => ({ ok: false, error: state.error }),
}));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1' }),
}));

const { default: Page } = await import('./page');
const { acceptSharingInvitationAction } = await import('./actions');

const BENGALI = /[ঀ-৿]/;
const ENGLISH = 'Confirm account and sharing consent before accepting.';
const BANGLA = 'গ্রহণ করার আগে অ্যাকাউন্ট ও শেয়ার করার সম্মতি নিশ্চিত করুন।';

beforeEach(() => {
  vi.stubEnv('PERSONAL_SHARING_INVITATIONS_ENABLED', 'true');
  state.generation += 1;
});

async function page(locale: 'en' | 'bn') {
  state.locale = locale;
  state.generation += 1;
  return textOf(
    await renderServer(Page({ searchParams: Promise.resolve({ token: 't'.repeat(43) }) })),
  );
}

async function accept(locale: 'en' | 'bn') {
  state.locale = locale;
  const form = new FormData();
  form.set('confirm', 'true');
  form.set('token', 't'.repeat(43));
  return acceptSharingInvitationAction({ ok: false, message: '' }, form);
}

describe('invitation refusals show in the visitor language', () => {
  it('the invitation page shows the Bangla refusal under bn and the exact English under en', async () => {
    state.error = keyedError('consent_required', 'sharing.inviteConsent');
    expect(await page('en')).toContain(ENGLISH);
    const shown = await page('bn');
    expect(shown).toContain(BANGLA);
    expect(shown).not.toContain(ENGLISH);
    expect(shown).toMatch(BENGALI);
  });

  it('the accept button result shows the Bangla refusal under bn and the exact English under en', async () => {
    state.error = keyedError('consent_required', 'sharing.inviteConsent');
    expect(await accept('en')).toEqual({ ok: false, message: ENGLISH });
    expect(await accept('bn')).toEqual({ ok: false, message: BANGLA });
  });

  it('a refusal with no checked Bangla shows English under bn', async () => {
    state.error = keyedError('not_found', 'sharing.inviteUnavailable');
    expect(await accept('bn')).toEqual({ ok: false, message: 'Invitation unavailable.' });
    expect(await page('bn')).toContain('Invitation unavailable.');
  });
});
