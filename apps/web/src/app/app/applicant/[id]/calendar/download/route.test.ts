import { calendarUid } from '@visastack/core/calendar';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APPOINTMENT_KEY,
  CALENDAR_ITEMS,
  DOCUMENT_KEY,
  FOREIGN_KEY,
  IDS,
  REQUEST_KEY,
  TASK_KEY,
  downloadRequest,
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

const route = await import('./route');
const { POST } = route;

const ID = 'a1';
const params = { params: Promise.resolve({ id: ID }) };
const keys = (...values: string[]) => values.map((k) => ['key', k] as const);
const download = (
  fields: readonly (readonly [string, string])[],
  headers?: Record<string, string>,
) => POST(downloadRequest(fields, headers), params);
const unfold = (ics: string) => ics.replace(/\r\n /g, '');
const property = (ics: string, name: string) =>
  unfold(ics)
    .split('\r\n')
    .filter((line) => line.startsWith(`${name}:`) || line.startsWith(`${name};`));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAccess.mockResolvedValue(ownerProof());
  mocks.listCalendarDates.mockResolvedValue({
    ok: true,
    value: { applicantId: ID, items: CALENDAR_ITEMS, truncated: false },
  });
});

describe('calendar download route (v1.2 B05)', () => {
  it('is a POST only, so a long choice never makes a long address', () => {
    expect(Object.keys(route).filter((name) => /^[A-Z]+$/.test(name))).toEqual(['POST']);
  });

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

  it('refuses a form sent from another site, or with no Origin, before reading anything', async () => {
    for (const headers of [
      { origin: 'https://evil.example', host: 'vs.example.test' },
      { host: 'vs.example.test' },
      { origin: 'null', host: 'vs.example.test' },
      { origin: 'not a url', host: 'vs.example.test' },
    ]) {
      const response = await download(keys(TASK_KEY), headers);
      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain('BEGIN:VCALENDAR');
    }
    expect(mocks.requireAccess).not.toHaveBeenCalled();
    // Behind the host's proxy, the forwarded host is the one the person used.
    const proxied = await download(keys(TASK_KEY), {
      origin: 'https://vs.obsidianglobal.studio',
      host: 'internal.example',
      'x-forwarded-host': 'vs.obsidianglobal.studio',
    });
    expect(proxied.status).toBe(200);
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

  it('returns a private calendar attachment with a generic file name, in the server order', async () => {
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
    expect(property(ics, 'SUMMARY')).toEqual(['SUMMARY:Appointment', 'SUMMARY:Task Due']);
    expect(property(ics, 'UID')).toEqual([
      `UID:${calendarUid('appointment', IDS.appointment)}`,
      `UID:${calendarUid('task_due', IDS.task)}`,
    ]);
    expect(ics).not.toContain(IDS.appointment);
    expect(property(ics, 'CLASS')).toEqual(['CLASS:PRIVATE', 'CLASS:PRIVATE']);
  });

  it("leaves out a key that is not one of this person's items now, and still downloads the rest", async () => {
    const response = await download(keys(FOREIGN_KEY, REQUEST_KEY, 'task_due:made-up'));
    const ics = await response.text();
    expect(response.status).toBe(200);
    expect(property(ics, 'SUMMARY')).toEqual(['SUMMARY:Request Due']);
    expect(ics).not.toContain('9999');
    expect(ics).not.toContain('made-up');
  });

  it('never takes a title or date from the request', async () => {
    const response = await download([
      ...keys(DOCUMENT_KEY),
      ['summary', 'Passport BX7319046'],
      ['title', 'Evil'],
      ['date', '2030-01-01'],
    ]);
    const ics = await response.text();
    expect(property(ics, 'SUMMARY')).toEqual(['SUMMARY:Document Expires']);
    expect(ics).not.toMatch(/BX7319046|Evil|20300101/);
    expect(ics).toContain('DTSTART;VALUE=DATE:20270430');
  });

  it('applies the options through the one parser: case names and a reminder only when asked', async () => {
    const plain = await (await download(keys(TASK_KEY))).text();
    expect(property(plain, 'SUMMARY')).toEqual(['SUMMARY:Task Due']);
    expect(plain).not.toContain('BEGIN:VALARM');
    const chosen = await (
      await download([...keys(TASK_KEY), ['titles', 'withCaseNames'], ['remind', '1440']])
    ).text();
    expect(property(chosen, 'SUMMARY')).toEqual(['SUMMARY:Task Due - Japan Visit']);
    expect(property(chosen, 'TRIGGER')).toEqual(['TRIGGER:-PT900M']);
    const junk = await (
      await download([...keys(TASK_KEY), ['titles', 'everything'], ['remind', '999999']])
    ).text();
    expect(property(junk, 'SUMMARY')).toEqual(['SUMMARY:Task Due']);
    expect(junk).not.toContain('BEGIN:VALARM');
  });

  it('with nothing valid chosen, goes back to the page with a plain message and no file', async () => {
    for (const fields of [[], keys(FOREIGN_KEY), [['titles', 'withCaseNames'] as const]]) {
      const response = await download(fields);
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
