import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderServer, textOf } from '../../lib/next-mocks.test-support';

/**
 * The public request link (UMPE P6): the token leaves the address on the first visit, a cookie
 * bound to the link carries it, and every closed link reads the same. Synthetic values only.
 */

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  cookie: undefined as string | undefined,
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  openCollectionLink: mocks.open,
  checkRateLimits: async () => ({ allowed: true }),
}));
vi.mock('../../lib/public-db', () => ({
  withPublicDb: async (fn: (db: unknown) => Promise<unknown>) => fn({}),
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.9' }),
  cookies: async () => ({
    get: (name: string) =>
      name === 'vs_collect' && mocks.cookie !== undefined ? { value: mocks.cookie } : undefined,
  }),
}));

const { GET } = await import('./open/route');
const { default: CollectPage, metadata } = await import('./page');

const TOKEN = 'A'.repeat(43);
const LINK = '11111111-2222-4333-8444-555555555555';
const OPEN = {
  linkId: LINK,
  agency: { name: 'Synthetic Agency One', accentColor: null },
  expiresAt: new Date('2027-01-01T00:00:00Z'),
};

beforeEach(() => {
  vi.stubEnv('AGENCY_COLLECTION_REQUESTS', 'true');
  mocks.open.mockReset();
  mocks.cookie = undefined;
});
afterEach(() => vi.unstubAllEnvs());

function visit(token: string | null) {
  const url = new URL('https://app.example.test/collect/open');
  if (token !== null) url.searchParams.set('token', token);
  return GET(new Request(url, { headers: { 'x-forwarded-for': '203.0.113.9' } }));
}

describe('/collect/open', () => {
  it('answers not found while the switch is off', async () => {
    vi.stubEnv('AGENCY_COLLECTION_REQUESTS', '');
    const response = await visit(TOKEN);
    expect(response.status).toBe(404);
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it('moves the token into a short-lived, httpOnly, Secure, SameSite=Lax cookie bound to the link, and drops it from the address', async () => {
    mocks.open.mockResolvedValue(OPEN);
    const response = await visit(TOKEN);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/collect');
    expect(response.headers.get('location')).not.toContain(TOKEN);
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain(`vs_collect=${LINK}.${TOKEN}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Path=\/collect/i);
    expect(cookie).toMatch(/Max-Age=1800/i);
  });

  it('gives a closed link no cookie and the same redirect', async () => {
    mocks.open.mockResolvedValue(null);
    for (const token of [TOKEN, 'too-short', null]) {
      const response = await visit(token);
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/collect');
      expect(response.headers.get('set-cookie') ?? '').not.toContain(TOKEN);
    }
  });
});

describe('/collect', () => {
  it('is not found while the switch is off', async () => {
    vi.stubEnv('AGENCY_COLLECTION_REQUESTS', '');
    await expect(CollectPage()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('sends no referrer and is never indexed', () => {
    expect(metadata.referrer).toBe('no-referrer');
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it('shows a reviewed agency and says plainly that responding opens later, and nothing else', async () => {
    mocks.cookie = `${LINK}.${TOKEN}`;
    mocks.open.mockResolvedValue(OPEN);
    const text = textOf(await renderServer(CollectPage()));
    expect(text).toContain('Synthetic Agency One Asked You for Documents');
    expect(text).toContain('Responding through this link opens in a later release');
    expect(text).toContain('Opening it has shared nothing');
  });

  it('names no agency that VisaStack has not reviewed', async () => {
    mocks.cookie = `${LINK}.${TOKEN}`;
    mocks.open.mockResolvedValue({ ...OPEN, agency: null });
    const text = textOf(await renderServer(CollectPage()));
    expect(text).toContain('An Agency Asked You for Documents');
    expect(text).not.toContain('Synthetic Agency One');
  });

  it('gives one answer for no cookie, a closed link and a cookie made for another link', async () => {
    const answers: string[] = [];
    answers.push(textOf(await renderServer(CollectPage())));
    mocks.cookie = `${LINK}.${TOKEN}`;
    mocks.open.mockResolvedValue(null);
    answers.push(textOf(await renderServer(CollectPage())));
    mocks.open.mockResolvedValue({ ...OPEN, linkId: '99999999-2222-4333-8444-555555555555' });
    answers.push(textOf(await renderServer(CollectPage())));
    mocks.cookie = 'not-a-cookie-of-ours';
    answers.push(textOf(await renderServer(CollectPage())));
    expect(new Set(answers).size).toBe(1);
    expect(answers[0]).toContain('This Link Is Not Open');
  });
});
