import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Start a Trip on the server: the country comes in as the text typed in the destination box, and
 * only a whole country name, its code or another common name is turned into a country. Anything
 * else is refused before any account or traveller is touched, and nothing is saved.
 */

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  openOrStartTripCase: vi.fn(),
  attachPackVersion: vi.fn(),
  withSession: vi.fn(),
  checklistToLink: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  requireAccess: mocks.requireAccess,
  openOrStartTripCase: mocks.openOrStartTripCase,
  attachPackVersion: mocks.attachPackVersion,
}));
vi.mock('../../../../lib/session', () => ({ withSession: mocks.withSession }));
vi.mock('../../../../lib/case-checklist-match', () => ({ checklistToLink: mocks.checklistToLink }));
vi.mock('../../../../lib/server-error', () => ({ reportServerError: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  unstable_rethrow: (error: unknown) => {
    throw error;
  },
}));

const { startTripAction } = await import('./actions');

const PREV = { ok: true, message: '' };
const PERSON = '00000000-0000-4000-8000-0000000000a1';
const form = (values: Record<string, string>, travellers: string[] = [PERSON]) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  for (const id of travellers) data.append('traveller', id);
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.withSession.mockImplementation(async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'owner' }),
  );
  mocks.requireAccess.mockResolvedValue({
    ok: true,
    value: { applicant: { displayName: 'Synthetic Person' } },
  });
  mocks.openOrStartTripCase.mockResolvedValue({
    ok: true,
    value: { missionId: 'case-1', existing: false },
  });
  mocks.checklistToLink.mockResolvedValue(null);
});

describe('startTripAction: the destination text', () => {
  it.each(['Korea', 'Congo', 'Atlantis', 'gb', 'Japan or Korea'])(
    'refuses "%s", saves nothing and does not open any account record',
    async (typed) => {
      const result = await startTripAction(PREV, form({ destination: typed, purpose: 'tourism' }));
      expect(result).toEqual({
        ok: false,
        message: 'We could not match that to a country. Pick one from the list.',
        field: 'destination',
      });
      expect(mocks.withSession).not.toHaveBeenCalled();
      expect(mocks.openOrStartTripCase).not.toHaveBeenCalled();
    },
  );

  it('asks plainly when the box is empty', async () => {
    const result = await startTripAction(PREV, form({ destination: '   ', purpose: 'tourism' }));
    expect(result).toEqual({
      ok: false,
      message: 'Choose where you are going.',
      field: 'destination',
    });
    expect(mocks.withSession).not.toHaveBeenCalled();
  });

  it.each([
    ['Japan', 'Japan'],
    [' japan ', 'Japan'],
    ['JP', 'Japan'],
    ['UK', 'United Kingdom'],
    ['united kingdom', 'United Kingdom'],
  ])(
    'starts the trip for "%s" with the country name %s, as the old list did',
    async (typed, name) => {
      await expect(
        startTripAction(PREV, form({ destination: typed, purpose: 'tourism' })),
      ).rejects.toThrow('REDIRECT /app/mission/case-1');
      expect(mocks.openOrStartTripCase).toHaveBeenCalledWith(expect.anything(), {
        destination: name,
        purpose: 'Tourism',
      });
    },
  );

  it('still needs the purpose and the travellers, after the country', async () => {
    expect(
      await startTripAction(PREV, form({ destination: 'Japan', purpose: 'nonsense' })),
    ).toMatchObject({ field: 'purpose' });
    expect(
      await startTripAction(PREV, form({ destination: 'Japan', purpose: 'tourism' }, [])),
    ).toMatchObject({ field: 'traveller' });
  });
});
