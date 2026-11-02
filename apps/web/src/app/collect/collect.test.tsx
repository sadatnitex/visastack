import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../../lib/next-mocks.test-support';

/**
 * The public request link and the guest desk (UMPE P6, P8): the token leaves the address on the
 * first visit and is exchanged for a server-side desk session; the cookie holds only the session's
 * random id; every closed answer reads the same; the checklist shows only once the guest proved
 * the email. Synthetic values only.
 */

const limit = vi.hoisted(() => ({ allowed: true }));
const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  desk: vi.fn(),
  send: vi.fn(),
  verify: vi.fn(),
  retain: vi.fn(),
  end: vi.fn(),
  cookie: undefined as string | undefined,
  set: [] as { name: string; value: string; options: Record<string, unknown> }[],
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  startGuestSession: mocks.start,
  readGuestDesk: mocks.desk,
  sendGuestCode: mocks.send,
  verifyGuestCode: mocks.verify,
  saveGuestRetentionChoice: mocks.retain,
  endGuestSession: mocks.end,
  checkRateLimits: async () =>
    limit.allowed ? { allowed: true } : { allowed: false, reason: 'busy' },
}));
vi.mock('../../lib/public-db', () => ({
  withPublicDb: async (fn: (db: unknown) => Promise<unknown>) => fn({}),
}));
vi.mock('../../lib/providers', () => ({ createKeyManagementPort: () => ({}) }));
vi.mock('../../lib/send-now', () => ({ sendEmailNow: async () => 'sent' }));
vi.mock('../../lib/jobs', () => ({ triggerNotificationWorker: async () => ({}) }));
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: () => undefined,
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.9' }),
  cookies: async () => ({
    get: (name: string) =>
      name === 'vs_collect' && mocks.cookie !== undefined ? { value: mocks.cookie } : undefined,
    set: (name: string, value: string, options: Record<string, unknown>) => {
      mocks.set.push({ name, value, options });
    },
  }),
}));

const { GET } = await import('./open/route');
const { default: CollectPage, metadata } = await import('./page');
const actions = await import('./actions');

const TOKEN = 'A'.repeat(43);
const SESSION = 'S'.repeat(43);
const ROTATED = 'R'.repeat(43);
const AGENCY = { name: 'Synthetic Agency One', accentColor: null, hasLogo: false };
const LANDING = { stage: 'landing', agency: AGENCY, guestAvailable: true, codePending: false };
const VERIFIED = {
  stage: 'verified',
  agency: AGENCY,
  revisionNo: 1,
  intact: true,
  retentionDays: null,
  items: [
    {
      id: 'i1',
      label: 'Passport',
      kind: 'DOCUMENT',
      necessity: 'MANDATORY',
      provenance: 'OFFICIAL',
      groupKey: null,
      note: null,
      order: 0,
    },
    {
      id: 'i2',
      label: 'Bank Statement',
      kind: 'DOCUMENT',
      necessity: 'RECOMMENDED',
      provenance: 'OFFICIAL',
      groupKey: 'money',
      note: null,
      order: 1,
    },
    {
      id: 'i3',
      label: 'Payslips',
      kind: 'DOCUMENT',
      necessity: 'RECOMMENDED',
      provenance: 'OFFICIAL',
      groupKey: 'money',
      note: null,
      order: 2,
    },
    {
      id: 'i4',
      label: 'Agency Cover Letter',
      kind: 'DOCUMENT',
      necessity: 'MANDATORY',
      provenance: 'AGENCY_ADDED',
      groupKey: null,
      note: 'Signed, please.',
      order: 3,
    },
  ],
};

beforeEach(() => {
  vi.stubEnv('AGENCY_COLLECTION_REQUESTS', 'true');
  for (const fn of [mocks.start, mocks.desk, mocks.send, mocks.verify, mocks.retain, mocks.end]) {
    fn.mockReset();
  }
  mocks.cookie = undefined;
  mocks.set.length = 0;
});
afterEach(() => vi.unstubAllEnvs());

function visit(token: string | null, cookie?: string) {
  const url = new URL('https://app.example.test/collect/open');
  if (token !== null) url.searchParams.set('token', token);
  return GET(
    new Request(url, {
      headers: {
        'x-forwarded-for': '203.0.113.9',
        ...(cookie ? { cookie: `vs_collect=${cookie}` } : {}),
      },
    }),
  );
}

const page = async (searchParams: Record<string, string> = {}) =>
  textOf(await renderServer(CollectPage({ searchParams: Promise.resolve(searchParams) })));

describe('/collect/open', () => {
  it('answers not found while the switch is off', async () => {
    vi.stubEnv('AGENCY_COLLECTION_REQUESTS', '');
    const response = await visit(TOKEN);
    expect(response.status).toBe(404);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('exchanges the token for a desk session: the cookie holds only the session id, never the link token', async () => {
    mocks.start.mockResolvedValue({ rawSessionId: SESSION });
    const response = await visit(TOKEN);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/collect');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain(`vs_collect=${SESSION}`);
    expect(cookie).not.toContain(TOKEN);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Path=\/collect/i);
  });

  it('keeps a live session of the same link and sets no new cookie', async () => {
    mocks.start.mockResolvedValue({ rawSessionId: null });
    const response = await visit(TOKEN, SESSION);
    expect(response.headers.get('set-cookie')).toBeNull();
    // The current session was offered to the service as a proof, not a raw value.
    expect(mocks.start.mock.calls[0]?.[2]?.sessionHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gives a closed link no session and the same redirect', async () => {
    mocks.start.mockResolvedValue(null);
    for (const token of [TOKEN, 'too-short', null]) {
      const response = await visit(token);
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/collect');
      expect(response.headers.get('set-cookie') ?? '').toMatch(/vs_collect=;/);
    }
  });

  it('says the network is busy and drops any older cookie', async () => {
    limit.allowed = false;
    const response = await visit(TOKEN);
    limit.allowed = true;
    expect(response.headers.get('location')).toBe('/collect?busy=1');
    expect(response.headers.get('set-cookie') ?? '').toMatch(/vs_collect=;/);
    expect(mocks.start).not.toHaveBeenCalled();
    expect(await page({ busy: '1' })).toContain('Please Try Again Later');
  });
});

describe('/collect', () => {
  it('is not found while the switch is off', async () => {
    vi.stubEnv('AGENCY_COLLECTION_REQUESTS', '');
    await expect(CollectPage({})).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('sends no referrer and is never indexed', () => {
    expect(metadata.referrer).toBe('no-referrer');
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it('a forwarded link alone shows only the branded desk and the two choices, never the checklist', async () => {
    mocks.cookie = SESSION;
    mocks.desk.mockResolvedValue(LANDING);
    const text = await page();
    expect(text).toContain('Synthetic Agency One Asked You for Documents');
    expect(text).toContain('Sign In to Respond');
    expect(text).toContain('Continue Without an Account');
    expect(text).toContain('Powered by VisaStack');
    expect(text).not.toContain('Passport');
    const html = await renderServer(CollectPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('href="/collect/account"');
  });

  it('names no agency that VisaStack has not reviewed', async () => {
    mocks.cookie = SESSION;
    mocks.desk.mockResolvedValue({ ...LANDING, agency: null });
    const text = await page();
    expect(text).toContain('An Agency Asked You for Documents');
    expect(text).not.toContain('Synthetic Agency One');
  });

  it('offers a code to the address the request was sent to, with no field to type an email', async () => {
    mocks.cookie = SESSION;
    mocks.desk.mockResolvedValue(LANDING);
    const html = await renderServer(
      CollectPage({ searchParams: Promise.resolve({ step: 'guest' }) }),
    );
    expect(textOf(html)).toContain('Email Me a Code');
    expect(html).not.toContain('type="email"');
    mocks.desk.mockResolvedValue({ ...LANDING, codePending: true });
    const pending = await page({ step: 'guest', sent: '1' });
    expect(pending).toContain('Six-Digit Code');
    expect(pending).toContain('Send a New Code');
  });

  it('says plainly to ask the agency when the link has no email address', async () => {
    mocks.cookie = SESSION;
    mocks.desk.mockResolvedValue({ ...LANDING, guestAvailable: false });
    const text = await page({ step: 'guest' });
    expect(text).toContain('Ask Synthetic Agency One to email the request to you');
    expect(text).not.toContain('Email Me a Code');
  });

  it('after verification shows the exact checklist with necessity, alternatives and agency labels, and the retention choice with nothing preselected', async () => {
    mocks.cookie = SESSION;
    mocks.desk.mockResolvedValue(VERIFIED);
    const html = await renderServer(CollectPage({ searchParams: Promise.resolve({}) }));
    const text = textOf(html);
    expect(text).toContain('Your Document Checklist');
    for (const words of [
      'Passport',
      'Mandatory · Official Requirement',
      'Any One of These',
      'Bank Statement',
      'Payslips',
      'Requested by Your Agency',
      'Agency Cover Letter',
      'Signed, please.',
    ]) {
      expect(text).toContain(words);
    }
    for (const days of [3, 7, 15, 30, 60, 90, 180]) expect(text).toContain(`${days} Days`);
    expect(html).not.toMatch(/checked=""/);
  });

  it('gives one answer for no cookie, a closed session and a cookie that is not ours', async () => {
    const answers: string[] = [];
    answers.push(await page());
    mocks.cookie = SESSION;
    mocks.desk.mockResolvedValue(null);
    answers.push(await page());
    mocks.cookie = 'not-a-cookie-of-ours';
    answers.push(await page());
    expect(new Set(answers).size).toBe(1);
    expect(answers[0]).toContain('This Link Is Not Open');
  });
});

describe('guest actions', () => {
  const form = (entries: Record<string, string> = {}) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(entries)) data.set(key, value);
    return data;
  };
  const INITIAL = { ok: true, message: '' };

  it('refuse without a session and while the switch is off', async () => {
    expect((await actions.sendCodeAction(INITIAL, form())).ok).toBe(false);
    mocks.cookie = SESSION;
    vi.stubEnv('AGENCY_COLLECTION_REQUESTS', '');
    expect((await actions.verifyCodeAction(INITIAL, form({ code: '123456' }))).ok).toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it('a right code replaces the cookie with the rotated session id', async () => {
    mocks.cookie = SESSION;
    mocks.verify.mockResolvedValue({ ok: true, value: { rawSessionId: ROTATED } });
    await expect(actions.verifyCodeAction(INITIAL, form({ code: '123456' }))).rejects.toThrow(
      'NEXT_REDIRECT:/collect',
    );
    expect(mocks.set).toEqual([
      expect.objectContaining({
        name: 'vs_collect',
        value: ROTATED,
        options: expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'lax' }),
      }),
    ]);
  });

  it('a wrong code says so on the field and keeps the cookie', async () => {
    mocks.cookie = SESSION;
    mocks.verify.mockResolvedValue({
      ok: false,
      error: { code: 'wrong', message: 'That code is not right.' },
    });
    const state = await actions.verifyCodeAction(INITIAL, form({ code: '000000' }));
    expect(state).toEqual({ ok: false, message: 'That code is not right.', field: 'code' });
    expect(mocks.set).toEqual([]);
  });

  it('sending a code goes back to the code step', async () => {
    mocks.cookie = SESSION;
    mocks.send.mockResolvedValue({ ok: true, value: { codeId: 'c1' } });
    await expect(actions.sendCodeAction(INITIAL, form())).rejects.toThrow(
      'NEXT_REDIRECT:/collect?step=guest&sent=1',
    );
  });

  it('leaving ends the session and clears the cookie', async () => {
    mocks.cookie = SESSION;
    mocks.end.mockResolvedValue(true);
    await expect(actions.leaveAction(INITIAL, form())).rejects.toThrow(
      'NEXT_REDIRECT:/collect?left=1',
    );
    expect(mocks.end).toHaveBeenCalled();
    expect(mocks.set[0]).toMatchObject({ name: 'vs_collect', value: '' });
  });
});
