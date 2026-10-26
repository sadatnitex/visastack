import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APPOINTMENT_KEY,
  CALENDAR_ITEMS,
  DOCUMENT_KEY,
  FOREIGN_KEY,
  REQUEST_KEY,
  TASK_KEY,
  ownerProof,
  sharedProof,
} from '../fixtures.test-support';

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  listCalendarDates: vi.fn(),
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  requireAccess: mocks.requireAccess,
  listCalendarDates: mocks.listCalendarDates,
}));
vi.mock('../../../../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ db: {}, accountId: 'acct-1', email: 'traveller@example.com' }),
}));

const { GET } = await import('./route');

const ID = 'a1';
function download(query: string) {
  return GET(
    new Request(`https://vs.example.test/app/applicant/${ID}/calendar/download?${query}`),
    {
      params: Promise.resolve({ id: ID }),
    },
  );
}
const keys = (...values: string[]) => values.map((k) => `key=${encodeURIComponent(k)}`).join('&');
const summaries = (ics: string) =>
  ics
    .replace(/\r\n /g, '')
    .split('\r\n')
    .filter((line) => line.startsWith('SUMMARY:'));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAccess.mockResolvedValue(ownerProof());
  mocks.listCalendarDates.mockResolvedValue({
    ok: true,
    value: { applicantId: ID, items: CALENDAR_ITEMS, truncated: false },
  });
});

describe('calendar download route (v1.2 B05)', () => {
  it('asks the gate for the owner of this applicant, purpose self', async () => {
    await download(keys(TASK_KEY));
    expect(mocks.requireAccess).toHaveBeenCalledWith(
      {},
      { kind: 'account', accountId: 'acct-1' },
      'VIEW_METADATA',
      { applicantId: ID },
      { purpose: 'self' },
    );
  });

  it('is owner-only: a refused gate or someone shared with gets not found, and nothing is read', async () => {
    mocks.requireAccess.mockResolvedValueOnce({ ok: false, error: { code: 'forbidden' } });
    const refused = await download(keys(TASK_KEY));
    expect(refused.status).toBe(404);
    expect(refused.headers.get('Content-Type')).not.toContain('text/calendar');

    mocks.requireAccess.mockResolvedValueOnce(sharedProof());
    const shared = await download(keys(TASK_KEY));
    expect(shared.status).toBe(404);
    expect(await shared.text()).not.toContain('BEGIN:VCALENDAR');
    expect(mocks.listCalendarDates).not.toHaveBeenCalled();
  });

  it('returns a private calendar attachment with a generic file name', async () => {
    const response = await download(keys(TASK_KEY, APPOINTMENT_KEY));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8');
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="visastack-dates.ics"',
    );
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    const ics = await response.text();
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    // The server's order, not the request's.
    expect(summaries(ics)).toEqual(['SUMMARY:Appointment', 'SUMMARY:Task Due']);
  });

  it("ignores a key that is not one of this person's items, without saying anything about it", async () => {
    const response = await download(keys(FOREIGN_KEY, REQUEST_KEY, 'task:made-up'));
    const ics = await response.text();
    expect(response.status).toBe(200);
    expect(summaries(ics)).toEqual(['SUMMARY:Request Due']);
    expect(ics).not.toContain('9999');
    expect(ics).not.toContain('made-up');
  });

  it('never takes a title or date from the request', async () => {
    const response = await download(
      `${keys(DOCUMENT_KEY)}&summary=Passport%20BX7319046&title=Evil&date=2030-01-01`,
    );
    const ics = await response.text();
    expect(summaries(ics)).toEqual(['SUMMARY:Document Expires']);
    expect(ics).not.toMatch(/BX7319046|Evil|20300101/);
    expect(ics).toContain('DTSTART;VALUE=DATE:20270430');
  });

  it('adds case names only when asked', async () => {
    const plain = summaries(await (await download(keys(TASK_KEY))).text());
    const named = summaries(await (await download(`${keys(TASK_KEY)}&names=1`)).text());
    expect(plain).toEqual(['SUMMARY:Task Due']);
    expect(named).toEqual(['SUMMARY:Task Due - Japan Visit']);
  });

  it('with nothing valid chosen, goes back to the page with a plain message and no file', async () => {
    for (const query of ['', keys(FOREIGN_KEY), 'names=1']) {
      const response = await download(query);
      expect(response.status).toBe(303);
      expect(response.headers.get('Location')).toBe(`/app/applicant/${ID}/calendar?error=nothing`);
      expect(response.headers.get('Content-Type')).toBeNull();
      expect(await response.text()).toBe('');
    }
  });

  it('when the dates cannot be read, goes back to the page saying so', async () => {
    mocks.listCalendarDates.mockResolvedValueOnce({ ok: false, error: { code: 'internal' } });
    const response = await download(keys(TASK_KEY));
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe(`/app/applicant/${ID}/calendar?error=failed`);
  });
});
