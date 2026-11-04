import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  setConsent: vi.fn(),
  hasConsent: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@visastack/services', () => ({
  setConsent: mocks.setConsent,
  hasConsent: mocks.hasConsent,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('../../../../../../lib/session', () => ({
  withSession: async (run: (context: unknown) => Promise<unknown>) =>
    run({ db: {}, accountId: 'acct-1' }),
}));

const { setReadingAction } = await import('./actions');

const form = (entries: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
};
const ID = '11111111-1111-4111-8111-111111111111';
const NONE = { ok: false, message: '' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.setConsent.mockResolvedValue({ ok: true, value: {} });
  mocks.hasConsent.mockResolvedValue(false);
});

describe('the automatic reading action', () => {
  it('turning it on grants both reading consents for the signed-in account only', async () => {
    const result = await setReadingAction(NONE, form({ choice: 'on', applicantId: ID }));
    expect(result).toEqual({ ok: true, message: 'Automatic reading is on for you.' });
    expect(mocks.setConsent.mock.calls.map(([, input]) => input)).toEqual([
      { actorAccountId: 'acct-1', accountId: 'acct-1', type: 'AI_EXTRACTION', granted: true },
      { actorAccountId: 'acct-1', accountId: 'acct-1', type: 'AI_OCR', granted: true },
    ]);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/app/applicant/${ID}/documents/add`);
  });

  it('turning it off withdraws both', async () => {
    mocks.hasConsent.mockResolvedValue(true);
    const result = await setReadingAction(NONE, form({ choice: 'off', applicantId: ID }));
    expect(result).toEqual({ ok: true, message: 'Automatic reading is off for you.' });
    expect(mocks.setConsent.mock.calls.map(([, input]) => input.granted)).toEqual([false, false]);
  });

  it('takes nothing but On or Off, and changes nothing otherwise', async () => {
    for (const choice of ['maybe', '', 'ON']) {
      const result = await setReadingAction(NONE, form({ choice, applicantId: ID }));
      expect(result).toEqual({ ok: false, message: 'Choose On or Off.' });
    }
    expect(await setReadingAction(NONE, form({ applicantId: ID }))).toEqual({
      ok: false,
      message: 'Choose On or Off.',
    });
    expect(mocks.setConsent).not.toHaveBeenCalled();
  });

  it('leaves a consent that is already as asked alone, so the record shows only real changes', async () => {
    mocks.hasConsent.mockImplementation(
      async (_db: unknown, _id: string, type: string) => type === 'AI_EXTRACTION',
    );
    await setReadingAction(NONE, form({ choice: 'on', applicantId: ID }));
    expect(mocks.setConsent.mock.calls.map(([, input]) => input.type)).toEqual(['AI_OCR']);
    mocks.setConsent.mockClear();
    mocks.hasConsent.mockResolvedValue(false);
    await setReadingAction(NONE, form({ choice: 'off', applicantId: ID }));
    expect(mocks.setConsent).not.toHaveBeenCalled();
  });

  it('stops at the first refusal, says a plain line (never the service text), and still refreshes the page', async () => {
    mocks.setConsent.mockResolvedValueOnce({
      ok: false,
      error: { message: 'consent may only be changed by the account owner' },
    });
    const result = await setReadingAction(NONE, form({ choice: 'on', applicantId: ID }));
    expect(result).toEqual({
      ok: false,
      message: 'We could not change this just now. Try again in a minute.',
    });
    expect(mocks.setConsent).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/app/applicant/${ID}/documents/add`);
  });

  it('answers a thrown failure with the same plain line instead of an error page', async () => {
    mocks.hasConsent.mockRejectedValue(new Error('database unavailable'));
    const result = await setReadingAction(NONE, form({ choice: 'on', applicantId: ID }));
    expect(result).toEqual({
      ok: false,
      message: 'We could not change this just now. Try again in a minute.',
    });
  });

  it('never refreshes a page for an id that is not a record id', async () => {
    await setReadingAction(NONE, form({ choice: 'on', applicantId: '../../x' }));
    expect(mocks.revalidatePath).not.toHaveBeenCalledWith(expect.stringContaining('..'));
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/app/privacy');
  });
});
