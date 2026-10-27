import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({
  sessions: 0,
  recorded: [] as { accountId: string; iso2: string }[],
}));

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));
vi.mock('../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) => {
    calls.sessions += 1;
    return fn({ db: {}, accountId: 'acct-1', email: 'me@example.com' });
  },
}));
vi.mock('@visastack/services', () => ({
  recordCountryChecklistStarted: async (
    _db: unknown,
    input: { accountId: string; iso2: string },
  ) => {
    calls.recorded.push(input);
    return true;
  },
}));

const { confirmFirstRunCountryAction } = await import('./country-actions');

const form = (country?: string) => {
  const data = new FormData();
  if (country !== undefined) data.set('country', country);
  return data;
};

beforeEach(() => {
  calls.sessions = 0;
  calls.recorded = [];
});

describe('confirming a country in first run (Growth G2)', () => {
  it('records the country for the signed-in account and moves on with the country kept', async () => {
    await expect(confirmFirstRunCountryAction(form('JP'))).rejects.toThrow(
      'NEXT_REDIRECT:/app?country=JP&step=consent',
    );
    expect(calls.recorded).toEqual([{ accountId: 'acct-1', iso2: 'JP' }]);
  });

  it('reads the code in any case and sends it on in capitals', async () => {
    await expect(confirmFirstRunCountryAction(form('gb'))).rejects.toThrow(
      'NEXT_REDIRECT:/app?country=GB&step=consent',
    );
    expect(calls.recorded).toEqual([{ accountId: 'acct-1', iso2: 'GB' }]);
  });

  it.each([undefined, '', 'ZZ', 'Japan', '<script>', 'JP&step=x'])(
    'records nothing and takes no session for %j, and still moves on',
    async (country) => {
      await expect(confirmFirstRunCountryAction(form(country))).rejects.toThrow(
        'NEXT_REDIRECT:/app?step=consent',
      );
      expect(calls.recorded).toEqual([]);
      expect(calls.sessions).toBe(0);
    },
  );

  it('takes the account from the session, never from the form', async () => {
    const data = form('JP');
    data.set('accountId', 'someone-else');
    await expect(confirmFirstRunCountryAction(data)).rejects.toThrow('NEXT_REDIRECT');
    expect(calls.recorded).toEqual([{ accountId: 'acct-1', iso2: 'JP' }]);
  });
});
