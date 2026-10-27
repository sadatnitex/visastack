import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ loadCalendarFeed: vi.fn() }));

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': '198.51.100.7, 10.0.0.1' }),
}));
vi.mock('../../../../lib/calendar-feed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/calendar-feed')>()),
  loadCalendarFeed: mocks.loadCalendarFeed,
}));
vi.mock('../../../../lib/server-error', () => ({ reportServerError: vi.fn() }));

const { GET } = await import('./route');

const SECRET = 'k'.repeat(43);
const get = (file: string) =>
  GET(new Request(`https://vs.example.test/api/calendar-feed/${file}`), {
    params: Promise.resolve({ file }),
  });
const ICS = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/calendar-feed/[file]', () => {
  it('serves the calendar with private, never-cached headers and no sign-in', async () => {
    mocks.loadCalendarFeed.mockResolvedValue({ state: 'feed', ics: ICS });
    const response = await get(`${SECRET}.ics`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(await response.text()).toBe(ICS);
    // The secret without its ending, and the caller's own address (the first forwarded one).
    expect(mocks.loadCalendarFeed).toHaveBeenCalledWith(SECRET, '198.51.100.7');
  });

  it('answers 404 for a stopped, replaced or unknown link, and for a malformed one without a lookup', async () => {
    mocks.loadCalendarFeed.mockResolvedValue({ state: 'not_found' });
    const unknown = await get(`${SECRET}.ics`);
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get('cache-control')).toBe('private, no-store');

    for (const bad of ['short.ics', `${SECRET}x.ics`, '..%2F..%2Fetc', `${SECRET}.ics.ics`]) {
      expect((await get(bad)).status, bad).toBe(404);
    }
    expect(mocks.loadCalendarFeed).toHaveBeenCalledOnce();
  });

  it('answers 429 when slowed and 503 (never an empty calendar) when something fails', async () => {
    mocks.loadCalendarFeed.mockResolvedValue({ state: 'busy' });
    const busy = await get(SECRET);
    expect(busy.status).toBe(429);
    expect(busy.headers.get('retry-after')).toBe('3600');

    mocks.loadCalendarFeed.mockRejectedValue(new Error('database down'));
    const down = await get(SECRET);
    expect(down.status).toBe(503);
    expect(await down.text()).not.toContain('BEGIN:VCALENDAR');
  });
});
