import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const social = vi.fn();
vi.mock('../../../lib/neon-auth', () => ({ getNeonAuth: () => ({ signIn: { social } }) }));
const withinAddressLimit = vi.fn();
vi.mock('../../../lib/auth-throttle', () => ({
  withinAddressLimit: (...args: unknown[]) => withinAddressLimit(...args),
}));
const reportServerError = vi.fn();
vi.mock('../../../lib/server-error', () => ({
  reportServerError: (...args: unknown[]) => reportServerError(...args),
}));

import { GET, HEAD } from './route';

const ORIGIN = 'https://app.example.test';
const SECRET = 'test-only-cookie-key-with-at-least-thirty-two-characters';
const GOOGLE = 'https://accounts.google.com/o/oauth2/v2/auth?state=abc';

function enable(): void {
  vi.stubEnv('GOOGLE_SIGN_IN_ENABLED', 'true');
  vi.stubEnv('NEON_AUTH_BASE_URL', 'https://auth.example.test/neondb/auth');
  vi.stubEnv('NEON_AUTH_COOKIE_SECRET', SECRET);
}

/** A click on the button on our own sign-in page, as a browser sends it. */
function click(query = '', extra: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/auth/google${query}`, {
    headers: { referer: `${ORIGIN}/auth/sign-in`, 'sec-fetch-site': 'same-origin', ...extra },
  });
}

function location(response: Response): string {
  return response.headers.get('location') ?? '';
}

beforeEach(() => {
  social.mockReset();
  withinAddressLimit.mockReset().mockResolvedValue(true);
  reportServerError.mockReset();
  vi.stubEnv('GOOGLE_SIGN_IN_ENABLED', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

it('sends the person back to sign-in when Google sign-in is not switched on, and never calls Neon', async () => {
  const response = await GET(click());
  expect(response.status).toBe(307);
  expect(location(response)).toBe(`${ORIGIN}/auth/sign-in?e=social_off`);
  expect(social).not.toHaveBeenCalled();
  expect(withinAddressLimit).not.toHaveBeenCalled();
});

it('keeps redirects on the host it was reached on, never on a fixed production address', async () => {
  const response = await GET(
    new Request('http://localhost:3100/auth/google?next=%2Fapp%2Fdocuments'),
  );
  expect(location(response)).toBe(
    'http://localhost:3100/auth/sign-in?e=social_off&next=%2Fapp%2Fdocuments',
  );
});

it('asks Neon Auth for Google with return addresses on the same host, then redirects to Google', async () => {
  enable();
  social.mockResolvedValue({ data: { url: GOOGLE, redirect: false }, error: null });
  const response = await GET(click('?next=%2Fapp%2Fdocuments'));
  expect(response.status).toBe(307);
  expect(location(response)).toBe(GOOGLE);
  expect(social).toHaveBeenCalledTimes(1);
  const call = social.mock.calls[0]?.[0];
  expect(call).toEqual({
    provider: 'google',
    callbackURL: `${ORIGIN}/auth/social-return?next=%2Fapp%2Fdocuments`,
    errorCallbackURL: `${ORIGIN}/auth/sign-in?e=social&next=%2Fapp%2Fdocuments`,
    disableRedirect: true,
  });
  expect(withinAddressLimit).toHaveBeenCalledWith({
    byAddress: 'AUTH_SIGN_IN_IP',
    onFailure: 'allow',
  });
});

it('works on the fallback host the same way, so its sign-in cookies match its return address', async () => {
  enable();
  social.mockResolvedValue({ data: { url: GOOGLE }, error: null });
  const host = 'https://visastack-five.vercel.app';
  await GET(
    new Request(`${host}/auth/google`, {
      headers: { referer: `${host}/auth/sign-in`, 'sec-fetch-site': 'same-origin' },
    }),
  );
  expect(social.mock.calls[0]?.[0].callbackURL).toBe(`${host}/auth/social-return?next=%2Fapp`);
});

it('never lets the return path leave the site', async () => {
  enable();
  social.mockResolvedValue({ data: { url: GOOGLE }, error: null });
  await GET(click('?next=https%3A%2F%2Fevil.example%2F'));
  const call = social.mock.calls[0]?.[0];
  expect(call.callbackURL).toBe(`${ORIGIN}/auth/social-return?next=%2Fapp`);
  expect(call.errorCallbackURL).toBe(`${ORIGIN}/auth/sign-in?e=social`);
});

it('refuses a start that did not come from one of our own pages, without calling Neon or counting it', async () => {
  enable();
  const starts: Request[] = [
    new Request(`${ORIGIN}/auth/google`),
    new Request(`${ORIGIN}/auth/google`, { headers: { referer: 'https://evil.example/' } }),
    new Request(`${ORIGIN}/auth/google`, {
      headers: { referer: `${ORIGIN}/x`, 'sec-fetch-site': 'cross-site' },
    }),
    click('', { 'sec-fetch-dest': 'image' }),
  ];
  for (const request of starts) {
    expect(location(await GET(request))).toBe(`${ORIGIN}/auth/sign-in?e=social_start`);
  }
  expect(social).not.toHaveBeenCalled();
  expect(withinAddressLimit).not.toHaveBeenCalled();
});

it('stops a start from an address that has started too many, before calling Neon', async () => {
  enable();
  withinAddressLimit.mockResolvedValue(false);
  expect(location(await GET(click()))).toBe(`${ORIGIN}/auth/sign-in?e=slow`);
  expect(social).not.toHaveBeenCalled();
});

it('shows a fixed message and logs a safe line when Neon fails, returns no address, or a foreign one', async () => {
  enable();
  for (const result of [
    { data: null, error: { message: 'secret provider text', status: 403, code: 'FORBIDDEN' } },
    { data: { url: undefined }, error: null },
    { data: { url: 'http://accounts.google.com/x' }, error: null },
    { data: { url: 'https://evil.example/x' }, error: null },
    { data: { url: GOOGLE }, error: { message: 'x', status: 500 } },
  ]) {
    reportServerError.mockClear();
    social.mockResolvedValueOnce(result);
    const response = await GET(click());
    expect(location(response)).toBe(`${ORIGIN}/auth/sign-in?e=social`);
    expect(reportServerError).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(reportServerError.mock.calls[0])).not.toContain('secret provider text');
  }
  reportServerError.mockClear();
  social.mockResolvedValueOnce({
    data: null,
    error: { message: 'secret provider text', status: 403, code: 'FORBIDDEN' },
  });
  await GET(click());
  expect(reportServerError.mock.calls[0]?.[2]).toEqual({
    step: 'start',
    status: '403',
    code: 'FORBIDDEN',
  });
});

it('shows the fixed message and logs when the call throws', async () => {
  enable();
  social.mockRejectedValueOnce(new Error('network'));
  expect(location(await GET(click()))).toBe(`${ORIGIN}/auth/sign-in?e=social`);
  expect(reportServerError).toHaveBeenCalledTimes(1);
});

it('gives up on a stalled Neon Auth with the fixed message instead of hanging', async () => {
  enable();
  vi.useFakeTimers();
  social.mockReturnValue(new Promise(() => {}));
  const pending = GET(click());
  await vi.advanceTimersByTimeAsync(8000);
  expect(location(await pending)).toBe(`${ORIGIN}/auth/sign-in?e=social`);
  expect(reportServerError).toHaveBeenCalledTimes(1);
});

it('does not start anything for a HEAD request', () => {
  const response = HEAD();
  expect(response.status).toBe(405);
  expect(response.headers.get('allow')).toBe('GET');
  expect(social).not.toHaveBeenCalled();
});
