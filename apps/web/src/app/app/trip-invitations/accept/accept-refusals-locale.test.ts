import { type ServiceError, keyedError, serviceError } from '@visastack/services';
import { serviceMessages } from '@visastack/services/i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../../../../lib/next-mocks.test-support';

/**
 * The trip invitation's one refusal, in the visitor's language: every bad invitation (missing,
 * malformed, someone else's, ended), on the page and in both answers, reads the same words, the
 * service's own, so a real and a made-up invitation look alike in English and in Bangla.
 * Synthetic values only.
 */

const loc = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn', holder: null as unknown }));
const svc = vi.hoisted(() => ({
  tripCompanionsEnabled: vi.fn(),
  openCompanionInvitation: vi.fn(),
  previewCompanionInvitation: vi.fn(),
  readCompanionTripSummary: vi.fn(),
  acceptCompanionInvitation: vi.fn(),
  declineCompanionInvitation: vi.fn(),
}));
const limit = vi.hoisted(() => ({ busy: false }));

vi.mock('../../../../lib/locale', () => ({ getLocale: async () => loc.locale }));
// Outside the server runtime React's cache remembers nothing; stand in for one request per render.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: (build: () => unknown) => () => {
    loc.holder ??= build();
    return loc.holder;
  },
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  ...svc,
}));
vi.mock('./network-limit', () => ({ networkLimited: async () => limit.busy }));
vi.mock('../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => unknown) => fn({ db: {}, accountId: 'acct-1' }),
}));
vi.mock('../../actions', () => ({ setConsentAction: async () => ({ ok: true, message: '' }) }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
  unstable_rethrow: (error: unknown) => {
    if (error instanceof Error && error.message.startsWith('NEXT_')) throw error;
  },
}));

const { acceptTripInvitationAction, declineTripInvitationAction } = await import('./actions');
const { default: TripInvitationPage } = await import('./page');
const words = await import('./words');

const BENGALI = /[ঀ-৿]/;
const INITIAL = { ok: true, message: '' };
const TOKEN = 'T'.repeat(43);
const bn = serviceMessages.bn as Readonly<Record<string, string>>;
const UNAVAILABLE_BN = 'এই আমন্ত্রণ পাওয়া যাচ্ছে না।';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const refused = (error: ServiceError) => ({ ok: false, error });
const join = (extra: Record<string, string> = {}) =>
  acceptTripInvitationAction(
    INITIAL,
    form({ intent: 'join', token: TOKEN, displayName: 'Synthetic Friend', ...extra }),
  );
const decline = (extra: Record<string, string> = {}) =>
  declineTripInvitationAction(INITIAL, form({ intent: 'decline', token: TOKEN, ...extra }));

/** Every way to reach the one refusal. */
const UNAVAILABLE_PATHS: readonly (readonly [string, () => Promise<unknown>])[] = [
  ['join: a forged post', () => join({ intent: 'other' })],
  [
    'join: a made-up invitation',
    () => {
      svc.openCompanionInvitation.mockResolvedValue(
        refused(
          keyedError('not_found', 'umpe_trip_companion_case.this_invitation_is_not_available'),
        ),
      );
      return join();
    },
  ],
  [
    'join: a real invitation that ended before the answer',
    () => {
      svc.acceptCompanionInvitation.mockResolvedValue(
        refused(
          keyedError('not_found', 'umpe_trip_companion_case.this_invitation_is_not_available'),
        ),
      );
      return join();
    },
  ],
  ['decline: a forged post', () => decline({ intent: 'other' })],
  [
    'decline: a made-up invitation',
    () => {
      svc.openCompanionInvitation.mockResolvedValue(refused(serviceError('not_found', 'x')));
      return decline();
    },
  ],
  [
    'decline: a real invitation that ended before the answer',
    () => {
      svc.declineCompanionInvitation.mockResolvedValue(refused(serviceError('not_found', 'x')));
      return decline();
    },
  ],
];

beforeEach(() => {
  for (const fn of Object.values(svc)) fn.mockReset();
  svc.tripCompanionsEnabled.mockReturnValue(true);
  svc.openCompanionInvitation.mockResolvedValue({ ok: true, value: {} });
  svc.readCompanionTripSummary.mockResolvedValue({ ok: false });
  svc.acceptCompanionInvitation.mockResolvedValue({ ok: true, value: {} });
  svc.declineCompanionInvitation.mockResolvedValue({ ok: true, value: {} });
  limit.busy = false;
  loc.locale = 'en';
  loc.holder = null;
});

describe('the one refusal in both answers', () => {
  it('keeps the English byte for byte', () => {
    expect(words.INVITATION_UNAVAILABLE).toBe('This invitation is not available.');
    expect(words.INVITATION_BUSY).toBe('Too many tries in a short time. Please try again later.');
    expect(words.SHARE_LEVEL_PROBLEM).toBe('Choose how much you want to share.');
  });

  it.each(UNAVAILABLE_PATHS)('en: %s', async (_name, run) => {
    expect(await run()).toEqual({ ok: false, message: 'This invitation is not available.' });
  });

  it.each(UNAVAILABLE_PATHS)('bn: %s reads the live Bangla', async (_name, run) => {
    loc.locale = 'bn';
    expect(bn[words.INVITATION_UNAVAILABLE_KEY]).toBe(UNAVAILABLE_BN);
    expect(await run()).toEqual({ ok: false, message: UNAVAILABLE_BN });
  });

  it.each(['en', 'bn'] as const)(
    '%s: too many tries, a bad name and a bad share level',
    async (locale) => {
      loc.locale = locale;
      const say = (key: keyof typeof serviceMessages.en) =>
        (locale === 'bn' ? bn[key] : undefined) ?? serviceMessages.en[key];
      for (const key of [
        words.INVITATION_BUSY_KEY,
        words.SHARE_LEVEL_PROBLEM_KEY,
        'umpe_trip_companions.enter_a_name_of_up_to',
      ] as const) {
        if (locale === 'bn') expect(say(key)).toMatch(BENGALI);
      }
      limit.busy = true;
      expect(await join()).toEqual({ ok: false, message: say(words.INVITATION_BUSY_KEY) });
      expect(await decline()).toEqual({ ok: false, message: say(words.INVITATION_BUSY_KEY) });
      limit.busy = false;
      expect(await join({ displayName: '' })).toEqual({
        ok: false,
        message: say('umpe_trip_companions.enter_a_name_of_up_to'),
        field: 'displayName',
      });
      expect(await join({ shareLevel: 'EVERYTHING_PLEASE' })).toEqual({
        ok: false,
        message: say(words.SHARE_LEVEL_PROBLEM_KEY),
        field: 'shareLevel',
      });
    },
  );
});

describe('the one refusal on the page', () => {
  async function html() {
    return renderServer(TripInvitationPage({ searchParams: Promise.resolve({ token: TOKEN }) }));
  }
  async function page() {
    return textOf(await html());
  }

  it('under bn the Bangla refusal is marked as Bangla inside the English page', async () => {
    loc.locale = 'bn';
    svc.previewCompanionInvitation.mockResolvedValue(refused(serviceError('not_found', 'x')));
    expect(await html()).toMatch(new RegExp(`lang="bn"[^>]*>${UNAVAILABLE_BN}<`));
  });

  it.each(['en', 'bn'] as const)('%s: a made-up and a busy invitation page', async (locale) => {
    loc.locale = locale;
    svc.previewCompanionInvitation.mockResolvedValue(refused(serviceError('not_found', 'x')));
    const unavailable = await page();
    expect(unavailable).toContain(
      locale === 'bn' ? UNAVAILABLE_BN : 'This invitation is not available.',
    );
    loc.holder = null;
    limit.busy = true;
    const busy = await page();
    const busyWords =
      locale === 'bn'
        ? (bn[words.INVITATION_BUSY_KEY] as string)
        : 'Too many tries in a short time. Please try again later.';
    if (locale === 'bn') expect(busyWords).toMatch(BENGALI);
    expect(busy).toContain(busyWords);
    expect(busy).not.toContain('umpe_trip');
    expect(unavailable).not.toContain('umpe_trip');
  });
});
