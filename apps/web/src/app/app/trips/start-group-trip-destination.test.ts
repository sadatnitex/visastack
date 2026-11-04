import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Start a Group Trip: the destination is typed text, checked before anything is made. A refused
 * destination leaves no traveller, family member or trip behind.
 */

const mocks = vi.hoisted(() => ({ withSession: vi.fn(), startGroupTrip: vi.fn() }));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  startGroupTrip: mocks.startGroupTrip,
}));
vi.mock('../../../lib/session', () => ({ withSession: mocks.withSession }));
vi.mock('../../../lib/server-error', () => ({ reportServerError: vi.fn() }));
vi.mock('../../../lib/providers', () => ({ createKeyManagementPort: () => undefined }));
vi.mock('../../../lib/send-now', () => ({ sendEmailNow: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/server', () => ({ after: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  unstable_rethrow: (error: unknown) => {
    throw error;
  },
}));

const { startGroupTripAction } = await import('./actions');

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
});

describe('startGroupTripAction: the destination text', () => {
  it.each(['Korea', 'Congo', 'Atlantis', 'gb'])(
    'refuses "%s" before anything is read or made',
    async (typed) => {
      const result = await startGroupTripAction(
        PREV,
        form({ destination: typed, purpose: 'tourism' }),
      );
      expect(result).toEqual({
        ok: false,
        message: 'We could not match that to a country. Pick one from the list.',
        field: 'destination',
      });
      expect(mocks.withSession).not.toHaveBeenCalled();
      expect(mocks.startGroupTrip).not.toHaveBeenCalled();
    },
  );

  it('asks plainly when the box is empty', async () => {
    const result = await startGroupTripAction(PREV, form({ destination: '', purpose: 'tourism' }));
    expect(result).toEqual({
      ok: false,
      message: 'Choose where you are going.',
      field: 'destination',
    });
    expect(mocks.withSession).not.toHaveBeenCalled();
  });

  it('accepts a typed name and moves on to the next question (who is travelling)', async () => {
    const result = await startGroupTripAction(
      PREV,
      form({ destination: 'japan', purpose: 'tourism' }, []),
    );
    expect(result).toMatchObject({ ok: false, field: 'traveller' });
    expect(mocks.withSession).not.toHaveBeenCalled();
  });
});
