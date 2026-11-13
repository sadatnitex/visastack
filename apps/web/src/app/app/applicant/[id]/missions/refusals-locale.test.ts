import { keyedError } from '@visastack/services';
import { type ServiceMessageKey, serviceMessages } from '@visastack/services/i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Start a Case: a refusal the screen does not word itself is the service's, in the visitor's language. */

const loc = vi.hoisted(() => ({ locale: 'en' as 'en' | 'bn' }));
const mocks = vi.hoisted(() => ({ createMission: vi.fn() }));
vi.mock('../../../../../lib/locale', () => ({ getLocale: async () => loc.locale }));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  createMission: mocks.createMission,
}));
vi.mock('../../../../../lib/case-checklist-match', () => ({
  checklistToLink: vi.fn(),
  attachChecklistFor: vi.fn(),
}));
vi.mock('../../../../../lib/server-error', () => ({ reportServerError: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
vi.mock('../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) => fn({ db: {}, accountId: 'owner' }),
}));

const { createMissionAction } = await import('./actions');

const BENGALI = /[ঀ-৿]/;
const bn = serviceMessages.bn as Readonly<Record<string, string>>;
const KEYS: readonly ServiceMessageKey[] = [
  'missions.a_title_is_required',
  'missions.pack_version_not_found',
];

function form(): FormData {
  const data = new FormData();
  data.set('applicantId', 'applicant-1');
  data.set('title', 'Trip');
  data.set('destination', 'GB');
  data.set('purpose', 'tourism');
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  loc.locale = 'en';
});

describe('start a case: service refusals in the visitor language', () => {
  it.each(KEYS)('en: %s is the exact English', async (key) => {
    const error = keyedError('invalid', key);
    mocks.createMission.mockResolvedValue({ ok: false, error });
    expect((await createMissionAction({ ok: true, message: '' }, form())).message).toBe(
      error.message,
    );
  });

  it.each(KEYS)('bn: %s is the checked Bangla', async (key) => {
    loc.locale = 'bn';
    mocks.createMission.mockResolvedValue({ ok: false, error: keyedError('invalid', key) });
    expect(bn[key]).toMatch(BENGALI);
    expect((await createMissionAction({ ok: true, message: '' }, form())).message).toBe(bn[key]);
  });

  it('the refusals the screen words itself stay its own', async () => {
    loc.locale = 'bn';
    mocks.createMission.mockResolvedValue({
      ok: false,
      error: keyedError('not_found', 'missions.applicant_not_found'),
    });
    expect((await createMissionAction({ ok: true, message: '' }, form())).message).toBe(
      'This traveller is not available to you.',
    );
  });
});
